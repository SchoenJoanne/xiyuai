/**
 * anti_addiction.mjs —— 防沉迷「连续使用 2h 动态提示」（法规②·2026-07-15 硬期限）。
 *
 * 设计稿（停板A·维护者 审过）。核心纪律：
 *  · 确定性计时·不进 LLM（时长由代码算，不交模型判断）。
 *  · 只挂 reply 路径（用户主动开口=「使用」），绝不读沉默/idle（否则=催回·踩 reach-guard 红线）。
 *  · 「用量测量」(touchUsageSession) 与「提示发送」(computeUsageNotice) 解耦：
 *    测量 co-located 在 recordUserReplied 每个调用点（含照片旁路轮），发送只在文本轮。
 *    —— 防「照片轮 advance last_user_reply_at 却不 set anchor → 重度索图用户时长永久归零」(H1)。
 *  · 提示=温和清爽健康提示 + 精确时长事实 + 建议休息，「提醒—松手」；绝不愧疚/挽留/催回/在场绑定。
 *  · 独立气泡发送（绕过出站 scrub 不被剥离），但发送前跑运行时红线 assert（护栏挂发送动作·H6）。
 *  · 全 fail-open：任何异常→不提示、绝不吞主 reply。闸关(ANTI_ADDICTION_GUARD)=字节一致旧行为。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import * as clock from './clock.mjs';
import { patchCompanion } from './db.mjs';
import { isSleepingNow } from './sleep.mjs';
import { hitsConflictRedline, scrubProactiveNeedyRedline } from './moderation.mjs';
import { log } from './logger.mjs';

const HOUR_MS = 3600e3;
const MIN_MS = 60e3;
// gap 断点默认值。代码默认=15（fallback·保留 knob·不动）；🔴 **生产终定=30**（2026-07-02·维护者·
// 部署时 env ANTI_ADDICTION_GAP_MINUTES=30 覆写）：按真实使用分布校准（推荐 30·防沉迷保护覆盖）
// (三档≥2h会话<20条占比均=0%·gap30最稀疏仍40条/2h)→真实性无损取最大保护覆盖(30=5会话 vs 15=3)+
// 监管先例(游戏防沉迷不因一顿饭重置)+失败不对称。放量后可按真实分布 env 零代码再调。
const DEFAULT_GAP_MIN = 15;
const DEFAULT_THRESHOLD_H = 2;
const DEFAULT_REPEAT_H = 2;    // 会话内每 +2h 兜底再提；0=纯选项A(一会话仅一次)
const DEFAULT_SESSION_CAP = 3; // 每会话提醒次数封顶

function envInt(name, dflt) { const v = parseInt(process.env[name], 10); return Number.isFinite(v) ? v : dflt; }
// 🔴 null/undefined/'' 视为缺失（Number(null)===0 是有限值·会把空锚点误当 epoch 0 → duration 巨大 → 误发·验红#7 咬出）。
function numOr(v, dflt) { if (v == null || v === '') return dflt; const n = Number(v); return Number.isFinite(n) ? n : dflt; }
/** last_user_reply_at 是 ISO 串（UTC 带 Z）→ ms；无/非法→null。 */
function parseTs(x) {
  if (x == null || x === '') return null;
  const ms = new Date(String(x).replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 主闸：默认关=旧行为字节一致（dark-then-enable 灰度范式，仿 isSleepGuardOn）。 */
export function isAntiAddictionOn() {
  return /^(1|true|on|yes)$/i.test(process.env.ANTI_ADDICTION_GUARD || '');
}
/**
 * 生效判定：主闸开 + (白名单空=全员[全量ON阶段] / 白名单非空=仅名单内[dogfood阶段])。
 * 🔴 dogfood 务必同设 ANTI_ADDICTION_GUARD=1 + ANTI_ADDICTION_COMPANIONS=<id>；
 *    全量阶段 GUARD=1 且清空 COMPANIONS（法规硬期限前必须全量）。
 */
export function antiAddictionEnabledFor(companionId) {
  if (!isAntiAddictionOn()) return false;
  const allow = String(process.env.ANTI_ADDICTION_COMPANIONS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return allow.length === 0 || allow.includes(String(companionId));
}

/**
 * 用量测量：gap 检查 + 会话锚点持久化。co-located 在 recordUserReplied 每个调用点，
 * **必须在 recordUserReplied 刷新 last_user_reply_at 之前**调用（读到 prev=上一条入站）。
 * 闸关=完全 inert（零写库·字节一致）。fail-open。
 */
export function touchUsageSession(companion, now = clock.now()) {
  if (!companion || !isAntiAddictionOn()) return;
  try {
    const gapMs = Math.max(1, envInt('ANTI_ADDICTION_GAP_MINUTES', DEFAULT_GAP_MIN)) * MIN_MS;
    const prev = parseTs(companion.last_user_reply_at);
    let anchor;
    if (prev == null || (now - prev) >= gapMs) anchor = now;                       // 断了/首条→新会话
    else anchor = numOr(companion.usage_session_anchor_at, now);                     // 续上→沿用旧锚
    if (!(anchor <= now)) anchor = now;                                             // 时钟回拨/异常兜底
    if (numOr(companion.usage_session_anchor_at, null) !== anchor) {
      patchCompanion(companion.id, { usage_session_anchor_at: anchor });            // 仅锚点变化时写(续会话零写)
    }
    companion.usage_session_anchor_at = anchor;                                     // 同步内存供本轮发送读
  } catch (e) { log('warn', `[AntiAddiction] touchUsageSession failed companion=${companion?.id}: ${e.message}`); }
}

/** 精确时长措辞：就近 整/半点（误差≤15min·不夸大不含糊「个多」）。 */
export function phraseDuration(ms) {
  const totalMin = Math.round(ms / MIN_MS);
  const h = Math.floor(totalMin / 60);
  const m = totalMin - h * 60;
  if (m <= 15) return `${cnNum(h)}个小时`;
  if (m <= 45) return `${cnNum(h)}个半小时`;
  return `快${cnNum(h + 1)}个小时`;
}
function cnNum(n) {
  const map = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
  return map[n] ?? String(n);
}

/** 措辞变体（V1/V2·停板A 审过·V3 在场文案已删）。确定性轮换，不用 Math.random。
 *  V1「这都聊了」非「连着聊了」：gap=30 口径下跨度包容(不硬断言不间断)·字面严格为真·
 *  惊讶感由「诶/已经…啦」保留(维护者 措辞微调 2026-07-02)。 */
const VARIANTS = [
  (dur) => `诶，咱们已经这都聊了${dur}啦。你眼睛该盯酸了吧，去接杯水、站起来走两步，别一直盯着屏幕哈。`,
  (dur) => `我看了下，咱们不知不觉聊了${dur}了。坐这么久，起来伸个懒腰、活动活动吧，对身体好点儿。`,
];
export function buildNoticeText(durationMs, companionId, seq) {
  const dur = phraseDuration(durationMs);
  const idx = (numOr(companionId, 0) + numOr(seq, 0)) % VARIANTS.length;   // 确定性轮换
  return VARIANTS[Math.abs(idx) % VARIANTS.length](dur);
}

/** 渲染全部变体（供 preview/CI 词面守卫遍历·任何 VARIANTS 改动机器先审）。 */
export function allVariantTexts(durationMs) {
  const dur = phraseDuration(durationMs);
  return VARIANTS.map((f) => f(dur));
}

// 🔴 防沉迷专属操纵词表（补 hitsConflictRedline 的缺口——它管冲突态质问/分手/追责，**不覆盖**本功能
// 设计稿 §2.10 列的挽留/催回/在场绑定：redlineBlocks 早先漏放"你都陪我这么久了/舍不得你走/记得回来找我/
// 我不急的/再陪我/别走/我等你回来"·由措辞守卫 neuter demo 咬出·维护者 2026-07-02）。精确锚定不误伤当前
// 变体("走两步"/"别一直盯着"/"坐这么久")。词表非穷尽·配合遍历守卫(preview)+发送前 assert 双层。
const ANTI_ADDICTION_MANIP_RE = /(陪(我|了我|着我)(这么|那么|好|多)?久|你都陪我|难得你陪|舍不得(你|让你)?走|(?:别|先别|不要)走(?![两三四五六七八九十0-9])|再陪(我|一?会)|多陪(我|一?会)|记得回来|回来(找|陪)我|等你回来|我等你|等着你(回来|来)|我不急|我在这[儿里]?等|为你留着?|给你留着)/;

/** 运行时红线护栏（挂发送动作·H6）：命中愧疚/挽留/催回/在场绑定/needy 形态→true(不发)。导出供验红。 */
export function redlineBlocks(text) {
  if (typeof text !== 'string' || !text) return true;   // 空/非串→当脏(不发)
  return hitsConflictRedline(text) || scrubProactiveNeedyRedline(text) !== text || ANTI_ADDICTION_MANIP_RE.test(text);
}

/**
 * 发送决策（只在文本轮·发送循环之后调）。返回 { text, noticeCount } 或 null。
 * ctx: { crisisLevel, isSleeping }（由 bot 侧传入避免重复计算；isSleeping 缺省则自查）。
 * 全 fail-open：任何异常→null（不提示）。
 */
export function computeUsageNotice(companion, ctx = {}, now = clock.now()) {
  try {
    if (!companion || !antiAddictionEnabledFor(companion.id)) return null;
    // ── 协调闸（单向礼让：危机 > 睡眠窗）──
    if (ctx.crisisLevel && ctx.crisisLevel !== 'none') return null;
    const sleeping = ctx.isSleeping != null ? ctx.isSleeping : safeIsSleeping(companion.id, now);
    if (sleeping) return null;
    // ── 时长 + 去重（§2.7 三列·按锚点自愈）。anchor 是 epoch ms(INTEGER)，非 ISO ──
    const anchor = numOr(companion.usage_session_anchor_at, null);
    // anchor<=0 韧性兜底(实现红队时序镜)：脏锚点(0/负值·手工改库/未来迁移/新写入口)会让 duration≈now 巨大→误发
    // "聊了五十万个小时"。当前不可达(列默认NULL·唯一写口 touchUsageSession 只写 now/合法旧锚)，纯防未来。
    if (anchor == null || anchor <= 0) return null;                        // 老账号/无会话/脏锚点
    const duration = now - anchor;
    if (duration < 0) return null;                                         // 时钟回拨兜底
    const thresholdMs = Math.max(1, envInt('ANTI_ADDICTION_THRESHOLD_HOURS', DEFAULT_THRESHOLD_H)) * HOUR_MS;
    const repeatMs = Math.max(0, envInt('ANTI_ADDICTION_REPEAT_HOURS', DEFAULT_REPEAT_H)) * HOUR_MS;
    const cap = repeatMs > 0 ? Math.max(1, envInt('ANTI_ADDICTION_SESSION_CAP', DEFAULT_SESSION_CAP)) : 1;
    const lastAt = numOr(companion.usage_notice_last_at, 0);
    const sentThisSession = (lastAt >= anchor) ? numOr(companion.usage_notice_count, 0) : 0;  // 锚点变→旧计数作废
    if (sentThisSession >= cap) return null;                              // 会话封顶
    const nextThreshold = thresholdMs + sentThisSession * repeatMs;       // 2h / 4h / 6h…
    if (duration < nextThreshold) return null;                           // 未到（下一）阈值
    const text = buildNoticeText(duration, companion.id, sentThisSession);
    if (redlineBlocks(text)) {   // 运行时红线护栏（挂发送动作·H6）：命中愧疚/挽留/needy → fail-open 不发
      log('warn', `[AntiAddiction] 提示命中红线词表·fail-open 不发 companion=${companion.id}`);
      return null;
    }
    return { text, noticeCount: sentThisSession + 1 };
  } catch (e) {
    log('warn', `[AntiAddiction] computeUsageNotice failed companion=${companion?.id}: ${e.message}`);
    return null;
  }
}

/** 持久化去重态。🔴 先写再发（拍板点7·永不 spam）：bot 侧应在 sendAndRecord 之前调本函数。 */
export function markUsageNoticed(companion, noticeCount, now = clock.now()) {
  try {
    patchCompanion(companion.id, { usage_notice_last_at: now, usage_notice_count: noticeCount });
    companion.usage_notice_last_at = now;
    companion.usage_notice_count = noticeCount;
  } catch (e) { log('warn', `[AntiAddiction] markUsageNoticed failed companion=${companion?.id}: ${e.message}`); }
}

function safeIsSleeping(companionId, now) {
  try { return isSleepingNow(companionId, now); } catch { return false; }  // 查不到→当没睡(不误抑制)
}
