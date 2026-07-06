/**
 * proactive_engine.mjs
 * Motivation-driven proactive message engine v2.
 * Wraps and extends the existing proactive.mjs scheduler.
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { log } from './logger.mjs';
import { patchCompanion, getDailySchedule, shanghaiDateKey, shanghaiHM } from './db.mjs';
import { getEmotionStateWithDefaults } from './emotion_state.mjs';
import { isSilenceExemptKind, SILENCE_LIMIT } from './proactive_policy.mjs';   // PR-2 静默闸：早安/reminder 豁免
import * as clock from './clock.mjs';   // 可注入时钟（生产=真实时间·测试可拨快进多天）

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_GAP_CLINGY  = 45;   // minutes between proactive messages (clingy)
const MIN_GAP_NORMAL  = 90;   // minutes (normal)
const MIN_GAP_QUIET   = 180;  // minutes (quiet)

const NIGHT_QUIET_START = 23;  // 23:00
const NIGHT_QUIET_END   = 7;   // 07:00

// ─── Missing score ────────────────────────────────────────────────────────────

/**
 * Compute how much the companion "misses" the user.
 * Returns a float 0–100.
 */
export function computeMissingScore(companion, user, context = {}) {
  let score = companion.missing_score ?? 0;

  const now  = context.now ? context.now.getTime() : clock.now();
  const lastReply = companion.last_user_reply_at
    ? new Date(String(companion.last_user_reply_at).replace(' ', 'T')).getTime()
    : null;

  if (lastReply) {
    const idleH = (now - lastReply) / 3_600_000;
    score += Math.min(40, idleH * 3); // +3 per hour, cap 40
  } else {
    score += 20; // never replied → moderate miss
  }

  const emotion = getEmotionStateWithDefaults(companion.id);
  score += (emotion.dependency ?? 30) * 0.3;
  score -= (emotion.security   ?? 50) * 0.1;

  const stage = companion.relationship_stage || '陌生人';
  const stageBonus = { '深爱': 20, '恋人': 15, '暧昧': 8, '朋友': 3, '陌生人': 0 };
  score += (stageBonus[stage] ?? 0);

  return Math.min(100, Math.max(0, score));
}

// ─── P2-B time-gap：把"距上次多久"喂给 proactive 冷开场 prompt ────────────────
// 防御式纯函数：null/非法时间戳→"暂无记录"，未来时间→clamp 0（不到1小时），
// <24h→约N小时，≥24h→约N天。第三个布尔"你上次主动后对方是否回复"=最危险象限
// （你刚追过、他还没回→别再追）的直接判据，不指望 LLM 自己比时间戳（line 110 摆真相）。
// 🔴 必改1：空值文案中性（"暂无记录"），不写"他还没回过你"——连喂 LLM 的时间事实都
// 不给委屈种子（守 PR-2 红线更深一层）。仅 proactive 用，reply 不传（companion.mjs 默认 ''）。
function _parseGapTs(s) {
  if (!s) return null;
  const ms = new Date(String(s).replace(' ', 'T')).getTime();
  return Number.isFinite(ms) ? ms : null;
}
function _humanGap(now, ts) {
  if (ts == null) return '暂无记录';
  let h = (now - ts) / 3_600_000;
  if (!(h > 0)) h = 0;                        // 未来/NaN → clamp 0
  if (h < 1)  return '不到1小时';
  if (h < 24) return `约${Math.round(h)}小时`;
  return `约${Math.round(h / 24)}天`;
}
export function buildTimeGapPhrase({ now, lastUserReplyAt, lastProactiveReplyAt } = {}) {
  const _now = Number.isFinite(now) ? now : clock.now();
  const uMs = _parseGapTs(lastUserReplyAt);
  const pMs = _parseGapTs(lastProactiveReplyAt);
  let repliedAfter;
  if (pMs == null)      repliedAfter = '暂无主动记录';
  else if (uMs == null) repliedAfter = '否';
  else                  repliedAfter = uMs > pMs ? '是' : '否';
  return [
    `距对方上次回复：${_humanGap(_now, uMs)}。`,
    `距你上次主动：${_humanGap(_now, pMs)}。`,
    `你上次主动后，对方是否回复：${repliedAfter}。`,
  ].join('\n');
}

// ─── P1 开场多样化：开场由头类型分类 + "换一种"提示 ──────────────────────────────
// 🔴 只存 type 不存内容。deterministic 关键词分类·不上 LLM（纯函数好测）。
// 🔴 必改4 优先级（首命中胜·memory_echo 提前防被"想到/累/心情"抢走）：
//   memory_echo > share_seen > share_food > care_check > ask_plan > random_thought > share_mood > other
const HOOK_PATTERNS = [
  ['memory_echo',    /之前你说|上次你说|上次你提|你说过|你之前|还记得[^。？\n]{0,8}吗|上回说/],
  ['share_seen',     /看到|看见|刷到|刷视频|刷手机|路过|听到|听见/],
  ['share_food',     /吃到|吃了|喝到|喝了|买了|点了|外卖|奶茶|咖啡|火锅|做了顿|做了点/],
  ['care_check',     /还好吗|还好吧|休息了|睡了没|睡了吗|早点睡|多喝水|注意身体|照顾好|累不累|冷不冷/],
  ['ask_plan',       /在干嘛|在忙|忙吗|忙不忙|在吗|干嘛呢|做什么呢|下班了|到家了|吃饭了吗|吃了没|今天.{0,6}安排/],
  ['random_thought', /突然想到|突然想起|刚想到|刚想起|在想|你说.{0,6}为啥|为什么会|是不是该|有没有想过|你猜/],
  ['share_mood',     /好累|好烦|好困|累死|烦死|无聊|emo|心情|不开心|难受|开心|想你|有点丧/],
];
export function classifyOpeningHook(text) {
  const s = String(text || '');
  for (const [type, re] of HOOK_PATTERNS) { if (re.test(s)) return type; }
  return 'other';
}

// type→描述符（🔴只把 type 翻成中文喂 prompt·绝不喂真实内容）。
const HOOK_DESC = {
  share_seen: '分享看到/刷到的东西',
  share_food: '分享吃喝小事',
  care_check: '关心状态',
  ask_plan: '问他在做什么/今天安排',
  random_thought: '随机想到一个问题',
  share_mood: '分享自己的心情',
  memory_echo: '提起之前聊过的事',
};
// 🔴 必改5：文案放轻——"优先换个由头·不要为了换而生硬"。空列表不注入。
export function buildRecentHooksHint(lastHookTypes) {
  let arr = [];
  try { const p = JSON.parse(lastHookTypes || '[]'); if (Array.isArray(p)) arr = p; } catch { arr = []; }
  const seen = [];
  for (const t of arr) { if (HOOK_DESC[t] && !seen.includes(t)) seen.push(t); }   // recognized·去重保序（other 本不入库·再滤一道）
  if (seen.length === 0) return '';
  const descs = seen.map((t) => HOOK_DESC[t]);
  if (seen.length === 1) {
    return `\n你上次主动开场偏「${descs[0]}」，这次优先换个由头开场。`;
  }
  return `\n最近几次你主动开场用过：${descs.join('、')}。这次优先换个没用过的由头，别连续用同一种开场方式；自然一点，不要为了换而生硬——真有想分享的就自然说。`;
}

// ─── Motivation score (v1.6 三驱动) ──────────────────────────────────────
// motivation = base_time_score × emotion_multiplier × schedule_multiplier × random_jitter
//   - base_time_score: 0-80，纯时段（早晚高峰最高，午饭/凌晨最低）
//   - emotion_multiplier: 0.2-2.5，由 7 维情绪合成（clingy/dep/sec/poss/mood）
//   - schedule_multiplier: 0.3-1.5，基于今日日程当前活动（在忙/在闲）
//   - random_jitter: 0.8-1.2 真人不机械
// 用户原话："加 7 维情绪驱动和日程驱动以及随机时间驱动"——三驱动 = emotion + schedule + time/jitter

/** 0-80：单纯时段基线，模拟真人"什么时候有空发消息" */
export function computeTimeBaseScore(now = clock.nowDate()) {
  const h = shanghaiHM(now).hour;
  if (h >= 23 || h < 7)   return 5;    // 凌晨/深夜：基本不打扰
  if (h >= 7  && h < 9)   return 70;   // 早安高峰
  if (h >= 9  && h < 11)  return 40;
  if (h >= 11 && h < 13)  return 30;   // 午饭忙
  if (h >= 13 && h < 17)  return 50;
  if (h >= 17 && h < 19)  return 60;   // 傍晚下班/放学
  if (h >= 19 && h < 22)  return 70;   // 晚间高峰
  return 50;                            // 22-23
}

/** 0.2-2.5：基于 7 维情绪 + mood 的乘数 */
export function computeEmotionMultiplier(emotion) {
  const mood = emotion?.mood || 'neutral';
  const dep  = emotion?.dependency ?? 30;
  const sec  = emotion?.security   ?? 50;
  const poss = emotion?.possessiveness ?? 20;
  // 各 mood 的基础倍率
  const moodMul = mood === 'clingy'    ? 1.6
               : mood === 'wronged'    ? 1.3
               : mood === 'jealous'    ? 1.4
               : mood === 'comforting' ? 1.2
               : mood === 'happy'      ? 1.1
               : mood === 'cold'       ? 0.5
               : mood === 'angry'      ? 0.6
               : mood === 'tired'      ? 0.7
               : 1.0;
  // dependency 高 → 想发；低 → 不想
  const depMul = 0.5 + (dep / 100) * 1.5;            // dep=0 → 0.5, dep=100 → 2.0
  // security 低 → 更主动找（想确认）；高 → 不焦虑
  const secMul = 1.4 - (sec / 100) * 0.7;            // sec=0 → 1.4, sec=100 → 0.7
  // possessiveness 高 → 多 +0.2
  const possBonus = poss >= 60 ? 1.2 : poss >= 40 ? 1.1 : 1.0;
  const raw = moodMul * depMul * secMul * possBonus;
  return Math.min(2.5, Math.max(0.2, raw));
}

/** 0.3-1.5：基于今日日程当前活动 */
export function computeScheduleMultiplier(companionId, now = clock.nowDate()) {
  try {
    const sched = getDailySchedule(companionId, shanghaiDateKey(now));
    if (!sched || !Array.isArray(sched.items)) return 1.0;
    const _hm = shanghaiHM(now);
    const nowMin = _hm.hour * 60 + _hm.minute;
    // 找当前正在进行的活动（time <= now，取最近一个）
    let curItem = null;
    for (const it of sched.items) {
      const m = String(it.time || '').match(/^(\d{1,2}):(\d{2})$/);
      if (!m) continue;
      const itMin = Number(m[1]) * 60 + Number(m[2]);
      if (itMin <= nowMin && (!curItem || itMin > curItem._min)) {
        curItem = { ...it, _min: itMin };
      }
    }
    if (!curItem) return 1.0;
    const act = String(curItem.activity || '');
    // 在忙：上课/开会/上班/工作/写代码/做饭/睡觉/考试/面试 → 0.3
    if (/上课|开会|上班|工作|写代码|做饭|睡觉|考试|面试|健身|跑步|加班/.test(act)) return 0.3;
    // 半忙：吃饭/通勤/购物/去/路上 → 0.6
    if (/吃饭|吃午|吃晚|早餐|午餐|晚餐|通勤|购物|路上|去[^里]/.test(act)) return 0.6;
    // 闲：休息/刷手机/看剧/发呆/咖啡/听歌/逛 → 1.4
    if (/休息|刷手机|看剧|发呆|咖啡|听歌|逛|放空|阳台|窗边/.test(act)) return 1.4;
    // 默认中等
    return 1.0;
  } catch {
    return 1.0;
  }
}

/**
 * Combines time + emotion + schedule + jitter to produce a 0–100 motivation.
 * v1.6: 三驱动 multiplier 重构（旧版是加法 score，新版乘法 multiplier 表达力更强）
 */
export function computeProactiveMotivation(companion, context = {}) {
  const now = context.now || clock.nowDate();
  const emotion = getEmotionStateWithDefaults(companion.id);

  const base    = computeTimeBaseScore(now);
  const emoMul  = computeEmotionMultiplier(emotion);
  const schMul  = computeScheduleMultiplier(companion.id, now);
  const jitter  = 0.8 + Math.random() * 0.4;

  let motivation = base * emoMul * schMul * jitter;

  // intensity 整体调节（用户拖动 quiet/normal/clingy 强度）
  const intensity = companion.proactive_intensity || 'normal';
  if (intensity === 'clingy') motivation *= 1.3;
  if (intensity === 'quiet')  motivation *= 0.4;

  // 想念 score 作为最后微调（保留向后兼容；不再主导）
  if (context.includeMissingScore !== false) {
    const miss = computeMissingScore(companion, null, context);
    motivation += miss * 0.1;
  }

  return Math.min(100, Math.max(0, motivation));
}

/** 调试用：返回 motivation 的全部因子拆解 */
export function debugMotivationFactors(companion, context = {}) {
  const now = context.now || clock.nowDate();
  const emotion = getEmotionStateWithDefaults(companion.id);
  return {
    base_time: computeTimeBaseScore(now),
    emotion_multiplier: computeEmotionMultiplier(emotion),
    schedule_multiplier: computeScheduleMultiplier(companion.id, now),
    final: computeProactiveMotivation(companion, context),
    emotion_snapshot: { mood: emotion.mood, dep: emotion.dependency, sec: emotion.security, poss: emotion.possessiveness },
    hour: shanghaiHM(now).hour,
  };
}

// ─── Anti-spam backoff ────────────────────────────────────────────────────────

export function shouldBackoffProactive(companion, context = {}) {
  const now = context.now ? context.now.getTime() : clock.now();

  // Night quiet hours（夜间静默闸 23:00-07:00 走上海时区）
  const hour = shanghaiHM(new Date(now)).hour;
  if (hour >= NIGHT_QUIET_START || hour < NIGHT_QUIET_END) {
    // Allow a single goodnight-type message but not spam
    const lastPro = companion.last_proactive_reply_at
      ? new Date(String(companion.last_proactive_reply_at).replace(' ', 'T')).getTime()
      : 0;
    if (now - lastPro < 3 * 3_600_000) return true;
  }

  const intensity = companion.proactive_intensity || 'normal';
  const minGap = intensity === 'clingy' ? MIN_GAP_CLINGY
               : intensity === 'quiet'  ? MIN_GAP_QUIET
               : MIN_GAP_NORMAL;

  const lastPro = companion.last_proactive_reply_at
    ? new Date(String(companion.last_proactive_reply_at).replace(' ', 'T')).getTime()
    : 0;
  if (now - lastPro < minGap * 60_000) return true;

  // v1.14: 被冷落退场 —— 不再一刀切「12h 没回就停」，按依恋风格分级（配合 neglect 阶段语气）。
  //   anxious  : 越冷落越想找，不退场（仅 minGap 防刷屏）
  //   secure   : 36h 内照常找 → 36-72h 渐进减频 → >72h 基本停（她也凉了）
  //   avoidant : 24h 后就收手自保（早抽离）
  // clingy intensity 滑块仍可强制不退场。
  const lastUser = companion.last_user_reply_at
    ? new Date(String(companion.last_user_reply_at).replace(' ', 'T')).getTime()
    : 0;
  const idleSinceUserH = lastUser ? (now - lastUser) / 3_600_000 : 0;
  const style = String(companion.attachment_style || 'secure').toLowerCase();
  if (intensity !== 'clingy') {
    // v1.16.x 读空气 + PR-2(2026-06-14) 静默闸：连续 N 条【非豁免】proactive 用户一条没回 → 闭嘴。
    // 计数已改为只对非豁免 kind +1（proactive.mjs 发送侧）；阈值 SILENCE_LIMIT(2，原 3)=更快刹对空气。
    // 生死线①：morning/reminder/confession 豁免静默闸（早安续命器/牵挂接住/告白绝不被对空气拦），
    // 但它们仍受下方依恋风格长期退场约束（长期沉默降频=保持现状，本 PR 不扩张）。
    if (!isSilenceExemptKind(context.kind) && (companion.proactive_unanswered || 0) >= SILENCE_LIMIT) return true;
    if (style === 'anxious') {
      // v1.14.5 (P2-5) 焦虑型会追，但有尊严上限：追到 ~5 天没任何回应也收手，别滑向 needy/纠缠。
      if (idleSinceUserH > 120) return true;
    } else if (style === 'avoidant') {
      if (idleSinceUserH > 24) return true;                          // 回避型：早抽离自保
    } else {
      if (idleSinceUserH > 72) return true;                          // secure：>72h 基本停
      if (idleSinceUserH > 36 &&
          Math.random() < (idleSinceUserH - 36) / 48) return true;   // 36-72h 渐进减频
    }
  }

  return false;
}

// ─── A刀（2026-06-20）：away_probe「离开 3–6h 撒娇探一句」gate（纯函数·全 env 可调） ─────────
// 定位=比竞品平均主动一档的差异化甜区；三道确定性闸夹在 Replika 失败模式外（同 tick 单条 /
// SILENCE_LIMIT=2 熔断 / 出站 needy 红线 drop）。本函数只判「该不该探」；语气/内容在 proactive.mjs。
const AWAY_PROBE_ENABLED         = String(process.env.PROACTIVE_AWAY_PROBE_ENABLED || 'false').toLowerCase() === 'true';
const AWAY_PROBE_MIN_AFFECTION   = Number(process.env.PROACTIVE_AWAY_PROBE_MIN_AFFECTION || 35);
const AWAY_PROBE_ANXIOUS_H       = Number(process.env.PROACTIVE_AWAY_PROBE_ANXIOUS_H || 3);        // 恋人/深爱 + 焦虑/closeness_seeking
const AWAY_PROBE_SECURE_H        = Number(process.env.PROACTIVE_AWAY_PROBE_SECURE_H || 4.5);       // 恋人/深爱 + secure/warm_direct
const AWAY_PROBE_SLOWWARM_H      = Number(process.env.PROACTIVE_AWAY_PROBE_SLOWWARM_H || 6);       // 恋人/深爱 + slow_warm_exclusive（慢热最晚·专一不 skip）
const AWAY_PROBE_CRUSH_ANXIOUS_H = Number(process.env.PROACTIVE_AWAY_PROBE_CRUSH_ANXIOUS_H || 5);  // 暧昧 + anxious（沙箱待定是否显黏）
const AWAY_PROBE_LASTCALL_FLOOR_H = 21;   // 与「窗口将关·临门一脚」(idle 21h) 不重叠

// 4 新 attachment 枚举 → away gate 用的 3+1 桶。🔴 只给本 gate·绝不改 shouldBackoffProactive
// （动它=改既有退场行为 + 踩 deadman 会话的 proactive.mjs）。slow_warm 单列（自有 6h 阈值）。
export function normalizeAttachmentBucket(style) {
  const s = String(style || '').toLowerCase();
  if (s === 'closeness_seeking'      || s === 'anxious')  return 'anxious';
  if (s === 'independent_boundaries' || s === 'avoidant') return 'avoidant';
  if (s === 'slow_warm_exclusive')                        return 'slow_warm';
  return 'secure';   // warm_direct / legacy 'secure' / 未知
}

// stage × bucket → 起探时刻(h)；null = 不早探（走 21h lastcall）。
function awayProbeThresholdH(stage, bucket) {
  if (bucket === 'avoidant') return null;                       // 回避型永不早探（与既有 avoidant>24h 抽离同向）
  const lover = stage === '恋人' || stage === '深爱';
  if (lover) {
    if (bucket === 'anxious')   return AWAY_PROBE_ANXIOUS_H;    // 3h
    if (bucket === 'slow_warm') return AWAY_PROBE_SLOWWARM_H;   // 6h
    return AWAY_PROBE_SECURE_H;                                  // 4.5h（secure / warm_direct）
  }
  if (stage === '暧昧' && bucket === 'anxious') return AWAY_PROBE_CRUSH_ANXIOUS_H;  // 5h
  return null;   // 暧昧+secure/slow_warm 端着不早探；朋友/陌生人 不早探
}

/**
 * 离开几小时是否该撒娇探一句（away_probe）。纯函数（companion 字段 + env + 时钟），易红验。
 * skip：未开关 / safe_mode(含「shared」语义) / affection 不足 / stage×bucket 不早探 /
 * 不在 [threshold, 21h) 区间 / 本离开周期已探（last_away_probe_at > last_user_reply_at）。
 */
export function shouldSendAwayProbe(companion, context = {}) {
  if (!AWAY_PROBE_ENABLED) return false;
  if (Number(companion.safe_mode)) return false;
  const aff = Number(companion.affection_level ?? companion.affection ?? 0);
  if (aff < AWAY_PROBE_MIN_AFFECTION) return false;
  if ((Number(companion.proactive_unanswered) || 0) >= SILENCE_LIMIT) return false;  // 🔴非豁免·受熔断控（防 3–6h 探问绕过 SILENCE_LIMIT 后门）
  const threshold = awayProbeThresholdH(companion.relationship_stage, normalizeAttachmentBucket(companion.attachment_style));
  if (threshold == null) return false;
  const now = context.now ? context.now.getTime() : clock.now();
  const lastUserMs = companion.last_user_reply_at
    ? new Date(String(companion.last_user_reply_at).replace(' ', 'T')).getTime() : NaN;
  if (!Number.isFinite(lastUserMs)) return false;               // 没有"离开"基准 → 不探
  const idleH = (now - lastUserMs) / 3_600_000;
  if (!(idleH >= threshold && idleH < AWAY_PROBE_LASTCALL_FLOOR_H)) return false;
  // 一离开周期一次（镜像 last_lastcall_at：存 epoch 秒，与 last_user 秒比较）。
  const lastProbeSec = Number(companion.last_away_probe_at) || 0;
  const lastUserSec  = Math.floor(lastUserMs / 1000);
  if (lastProbeSec > lastUserSec) return false;
  return true;
}

// A刀：mark 边界（P1「hook 只记真实发出」纪律）——仅 guarded 返 'sent' 才记本周期已探。
// 'sent' 含 redline/empty drop（wrapper 对 drop 也返 'sent'·防重试风暴）；restrained/throttled/
// safety/arc_skip/inflight/undefined(error) 一律不 mark（没发却记 = 漏掉真该探的）。
export function shouldMarkAwayProbe(guardedResult) { return guardedResult === 'sent'; }

// ─── Trigger selection ────────────────────────────────────────────────────────

const _TRIGGER_TYPES = [
  'morning_greeting',
  'goodnight',
  'idle_miss',
  'share_thought',
  'check_in',
  'recall_memory',
  'emotion_driven',
  'schedule_item',
];

export function selectProactiveTrigger(companion, context = {}) {
  const hour = shanghaiHM(context.now || clock.nowDate()).hour;
  const motivation = context.motivation ?? computeProactiveMotivation(companion, context);
  const emotion    = getEmotionStateWithDefaults(companion.id);

  if (hour >= 7 && hour <= 9)   return 'morning_greeting';
  if (hour >= 22 && hour <= 23) return 'goodnight';

  if (emotion.mood === 'wronged' || emotion.mood === 'clingy') return 'emotion_driven';
  if (motivation >= 70) return 'idle_miss';
  if (motivation >= 50) return 'check_in';
  if (context.scheduleItem) return 'schedule_item';
  return 'share_thought';
}

// ─── Intent builder ───────────────────────────────────────────────────────────

const INTENTS = {
  morning_greeting: [
    '早安，你今天有什么计划吗？',
    '早~你昨晚睡好了吗？',
    '早上好，又是新的一天了～',
  ],
  goodnight: [
    '晚安，早点休息哦',
    '要睡觉了吗？做个好梦～',
    '明天见，晚安',
  ],
  idle_miss: [
    '你在吗，好久没听到你消息了…',
    '在干嘛呀，有点想你',
    '是不是忘记我了？',
  ],
  check_in: [
    '最近怎么样？',
    '你还好吗，一直没说话',
    '嗯…想知道你在做什么',
  ],
  emotion_driven: [
    '我有点想你，能陪我聊聊吗？',
    '最近心里有点奇怪的感觉…',
    '你现在方便说话吗？',
  ],
  share_thought: [
    '刚才想到一件事想跟你说…',
    '不知道为什么突然想起你了',
    '你有没有想过…（算了，就是想你而已）',
  ],
  schedule_item: null, // built by caller from schedule context
  recall_memory: null, // built by caller from memory context
};

export function buildProactiveIntent(companion, trigger, context = {}) {
  const pool = INTENTS[trigger];
  if (!pool) {
    if (context.scheduleItem) return context.scheduleItem.content || '你在吗？';
    if (context.memory)       return `我突然想起你说过的一件事……${(context.memory.content || '').slice(0, 30)}`;
    return '在吗？';
  }
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

// ─── Record outgoing proactive message ───────────────────────────────────────

export function recordProactiveSent(companionId) {
  const now = clock.nowDate().toISOString();
  try {
    patchCompanion(companionId, { last_proactive_reply_at: now });
  } catch (e) {
    log('warn', `[ProactiveEngine] recordProactiveSent failed: ${e.message}`);
  }
}

// ─── Record user reply ────────────────────────────────────────────────────────

export function recordUserReplied(companionId) {
  const now = clock.nowDate().toISOString();
  try {
    patchCompanion(companionId, { last_user_reply_at: now, missing_score: 0 });
  } catch (e) {
    log('warn', `[ProactiveEngine] recordUserReplied failed: ${e.message}`);
  }
}

// ─── Decide whether to send proactive now ────────────────────────────────────

/**
 * High-level function used by proactive scheduler tick.
 * Returns null if should not send, or { trigger, message } if should send.
 */
export function evaluateProactive(companion, context = {}) {
  if (shouldBackoffProactive(companion, context)) return null;

  const motivation = computeProactiveMotivation(companion, context);
  const intensity  = companion.proactive_intensity || 'normal';

  // v1.6: 阈值放宽 + 中间值随机
  // 旧版固定阈值（normal=60）经常拒发。新版用"硬下限 + 软随机"：
  //   < 25: 拒
  //   25-50: 按 motivation/100 概率通过
  //   >= 50: 必过
  const hardFloor = intensity === 'quiet'  ? 50
                  : intensity === 'clingy' ? 15
                  : 25;
  // 2026-06-22 早安豁免 motivation 闸：morning 是「她还在」的基本温暖，受伤/冷战态 motivation 偏低
  // 也应照发（否则被 v2 反复拒发 defer 拖到大晚=「她消失」）。仍受 shouldBackoffProactive 顶部的
  // 夜间静默/间隔/长期退场约束——类②长期离开（cid7 >72h idle）仍被退场拦，符合「不在本次范围」。
  if (context.kind !== 'morning') {
    if (motivation < hardFloor) return null;
    if (motivation < 50) {
      // 软通过：motivation 25-50 时按 motivation/100 概率随机
      if (Math.random() > motivation / 100) return null;
    }
  }

  const trigger = selectProactiveTrigger(companion, { ...context, motivation });
  const message = buildProactiveIntent(companion, trigger, context);
  return { trigger, message, motivation };
}
