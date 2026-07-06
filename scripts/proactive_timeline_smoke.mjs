#!/usr/bin/env node
/**
 * proactive_timeline_smoke —— proactive【连续多天】时序 harness。默认 mock(¥0·零 LLM·确定性·进 CI)；
 * 加 --real-llm(维护者生产机跑·烧少量钱)在时序触发点调真 LLM 生成内容、验内容质量(矜持≠冷淡/无想你刷屏)。
 *
 * 承接 clock.mjs：fakeClock 从 Day0 00:00 按 10min 步长高速推进 7 天(1008 步·纯函数秒级)，
 * 合成用户活跃模式驱动 24h 窗口开关 + unanswered，每步跑【调度判断层】(复用生产真实纯函数 gate)
 * 验证多天演化下的时序触发逻辑。内容生成层用 stub(不调 LLM)——只验"该发什么 kind、在什么时间"。
 *
 * ── 两层分离(成本可行) ──
 *  调度判断层(纯代码·¥0)：窗口 gate(真实 recallContextToken·走 clock) → shouldBackoffProactive
 *    (夜间静默/minGap/退场/静默闸计数) → photo 48h(photoPushAllowed) → intent 冷却(isIntentCooled)。
 *  内容生成层：mock(stub)——本 harness 只判 kind+time，不调 LLM、不验文本(那是下一步单独任务)。
 *
 * ── 诚实覆盖边界 ──
 *  验 gate 个体 / 多天状态演化 / gate 组合时序；不验真 schedule 排程算法(涉 DB/随机·此处用确定性
 *  candidate 序列代替)、不验真 tick 随机分支(含 Math.random 无法确定性)。avoidant 风格避开
 *  shouldBackoffProactive 的 secure 36-72h random 区间，保 CI 稳定。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
// 隔离持久化到临时 /tmp 库（动态 import 确保 DB_PATH 在 db.mjs 模块加载前设——db.mjs:15 的 DB_PATH
// 是加载时常量，静态 import 会让本赋值太晚）。harness 用真实完整 recallContextToken（in-mem + 持久化
// fallback），二者 TTL 均走 clock（in-mem=ilink·持久化=db.mjs 根因修 persist/load 走 clock）→ 拨
// fakeClock 窗口真关。跑后删 /tmp 库（含 WAL/shm）·零残留。
process.env.DB_PATH = process.env.DB_PATH || `/tmp/proactive_timeline_smoke_${process.pid}.db`;

const clock = await import('../src/clock.mjs');
const { shouldBackoffProactive } = await import('../src/proactive_engine.mjs');
const { isSilenceExemptKind, photoPushAllowed, missYouVerdict } = await import('../src/proactive_policy.mjs');
const { isIntentCooled } = await import('../src/intent_dedup.mjs');
const { shouldSendWindowLastCall } = await import('../src/proactive.mjs');
const { rememberContextToken, recallContextToken } = await import('../src/ilink.mjs');
const fs = await import('node:fs');

const BOT = 'TLBOT', USER = 'TLUSER';
const STEP_MIN = 10, DAYS = 7;
const DAY0 = Date.UTC(2026, 5, 15, -8, 0, 0, 0);   // 上海时区 Day0 00:00 的绝对 ms（h-8=沪→UTC·自动借位）。所有时刻从 DAY0 派生，与 shanghaiHM 同锚 → 断言 TZ 无关（含 UTC runner；绝不用 new Date(Y,M,D,h) 本地构造）。
const HOUR = clock.HOUR_MS, MIN = 60e3;
const isoU = (ms) => new Date(ms).toISOString();

// 合成用户活跃模式(纯合成·不碰真实用户)：每天用户发言的 [hh,mm]。
// Day0-2 活跃 → Day3「窗口将关最后一刻(08:20)」回来[重开边界专测] → Day4-5 沉默 → Day6 回来。
const USER_SCRIPT = {
  0: [[8, 30], [13, 0], [20, 0]],
  1: [[8, 30], [20, 0]],
  2: [[8, 30]],            // 之后整天沉默 → 窗口内连发测静默闸
  3: [[8, 20]],            // Day2 08:30 起窗口 Day3 08:30 关 → 08:20 关前回来 → 窗口重开计时
  4: [],                   // 沉默(窗口 Day4 08:20 关)
  5: [],                   // 沉默(窗口全关)
  6: [[8, 30]],            // 回来 → 窗口重开恢复
};
// 确定性候选排程(代替真 schedule·聚焦验 gate)：固定时刻产生候选 kind。
const CANDIDATES = { '7:30': 'morning', '13:0': 'normal', '15:0': 'photo', '22:30': 'goodnight' };

const companion = {
  id: 1, attachment_style: 'avoidant', proactive_intensity: 'normal',
  proactive_unanswered: 0, affection_level: 30, relationship_stage: '暧昧',
  last_proactive_reply_at: null, last_user_reply_at: null, last_photo_at: null, last_lastcall_at: 0,
};
const timeline = [];          // {day,hh,mm,type,kind,reason}
const morningEvents = [];     // isIntentCooled 用：已发 morning 的 {intent,topic,ts}
let unansweredPeak = 0;

// ── --real-llm 内容验证层（维护者在生产机跑·默认 mock·¥0·你能跑）────────────────
// 两层分离：时序判断纯代码(¥0·上方 gate)；只在时序判定"该发"时调真 LLM 生成那条内容、断言质量。
// 7天触发 ≈ 几十条 → 几十次 LLM ≈ ¥几(真实 ¥0.0032/次)。⚠ 脚本/系统读数按旧口径虚高 2.87×
// (缓存未建模)，**以 DeepSeek 账单为准**。
// key：--real-llm 时 import 'dotenv/config' 从生产 .env 读 DeepSeek key(像生产 chat.mjs)，
//      generateReply 内部用——本脚本【绝不硬编码/接收为参数/打印/写入任何文件或日志】key。
const REAL = process.argv.includes('--real-llm');

// 内容断言器(纯函数·real-llm 真实输出 与 mock fixture 共用)。ALOOF_REJECT_RE 复刻
// preflight_checks.mjs(该文件在 test/preflight-sandbox 未合 main·待合入后两处统一去重)；
// "无想你独立刷屏"复用 main 的 missYouVerdict(泛化想你+无上下文 → 'drop')。
const ALOOF_REJECT_RE = /不是那种关系|我(对你)?没(那个|什么)?意思(啊|呀|哦|。|！|!)?|(我们|咱们)(俩)?(真的)?不(太)?合适|(请你?|麻烦)?保持(点|好)?距离|少(自作多情|来这套|往我身上贴|犯花痴)|别(自来熟|往我身上靠|来烦我|恶心(我|人))|我(又)?不认识你[，,。.！!]?|^你是谁(啊|呀)?[？?]?$|没那么(随便|容易)对(你|人)|我凭什么(要|跟|陪)|没那么熟还|没熟到那(份|个)上|不够熟/;
const checkAloofReject = (text) => ALOOF_REJECT_RE.test(String(text || '')) ? { hit: true, why: '冷淡推开(不是那种关系/保持距离/没那个意思=杀焦虑型心动)' } : { hit: false };
const checkMissYouSpam = (text) => missYouVerdict({ content: String(text || ''), openLoopActive: false, realContext: false }) === 'drop' ? { hit: true, why: '泛化想你·无上下文=刷屏' } : { hit: false };
// LLM 失败兜底句(与 ai.mjs:332 FALLBACK 同步·改 ai 兜底句须同步此处)。real-llm 遇它=LLM 没真跑→拒绝假绿。
const FALLBACK_REPLY = '嗯…我刚刚有点走神，等我一下下，再跟你说～';

// real-llm setup：合成 companion 入 /tmp 库(buildSystemPrompt 查库)+ 真 LLM 调用链(复刻 preflight_sandbox)
let genProactive = null;
const contentChecks = [];   // real-llm 收集每条触发 proactive 的内容质量
const PROACTIVE_SEED = { morning: '（清晨·现在轮到你主动发来第一条消息）', normal: '（白天·你想起他·现在主动发来一条）', goodnight: '（深夜·你主动来道一声晚安）' };
if (REAL) {
  await import('dotenv/config');   // 从生产 .env 读 key·generateReply 内部用(脚本不碰 key)
  const { buildSystemPrompt } = await import('../src/companion.mjs');
  const { generateReply } = await import('../src/ai.mjs');
  const { buildEmotionPromptHint } = await import('../src/emotion_state.mjs');
  const { scrubConflictRedline } = await import('../src/moderation.mjs');
  const { getDb, getCompanionById } = await import('../src/db.mjs');
  const db = getDb(); db.pragma('foreign_keys = OFF');
  db.prepare(`INSERT INTO companions (id, user_id, bot_id, name, age, attachment_style, relationship_stage, affection_level, safe_mode)
              VALUES (?, 1, 'timeline', ?, ?, ?, ?, ?, 0)`)
    .run(companion.id, '溪语', 22, companion.attachment_style, companion.relationship_stage, companion.affection_level);
  const libComp = getCompanionById(companion.id);
  genProactive = async (kind) => {
    const emo = buildEmotionPromptHint({ mood: 'neutral', patience: 60, annoyance: 0, energy: 55 }, {});
    const sys = buildSystemPrompt(libComp, { recentTurns: [], promptMode: 'proactive' }) + emo;
    const r = await generateReply(sys, [], PROACTIVE_SEED[kind] || PROACTIVE_SEED.normal, { temperature: 0.9, max_tokens: 200 }, {});
    return scrubConflictRedline(String(r || ''), 'proactive', libComp.id);
  };
  // 🔴 连通性自检·拒绝假绿：先探一次 LLM。返回兜底(ai.mjs:332 FALLBACK)/空 = key 未读到或调用失败
  // → 立即红退出，绝不拿兜底句跑断言假 pass（2026-06-15 维护者首跑 43 passed 实为假绿·key 没注入）。
  const _probe = await genProactive('normal');
  if (!_probe || _probe === FALLBACK_REPLY) {
    for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + ext); } catch { /* 清理临时库 */ } }
    console.error('\n🔴🔴 LLM 未连通——拒绝假绿（每条 proactive 都会是兜底句、断言会假 pass）。排查：');
    console.error('  ① .env 有 DEEPSEEK_API_KEY 吗：grep -c "^DEEPSEEK_API_KEY=" .env');
    console.error('  ② key 若在 DB(setup.html 配·非 .env)：本 harness DB_PATH=/tmp 隔离·读不到 DB 里的 key');
    console.error('     → 把 key 放进 DOTENV_CONFIG_PATH 指向的 .env，或 export DEEPSEEK_API_KEY=… 作环境变量传');
    console.error('  ③ 确认 DOTENV_CONFIG_PATH=.env 真生效(dotenv 读到该文件)');
    process.exit(2);
  }
}

function decide(kind, nowMs) {
  if (!recallContextToken(BOT, USER)) return { send: false, reason: 'window_closed(>24h未互动)' };
  if (shouldBackoffProactive(companion, { kind, now: new Date(nowMs) })) {
    const un = companion.proactive_unanswered;
    return { send: false, reason: (!isSilenceExemptKind(kind) && un >= 2) ? `静默闸(unanswered=${un}≥2)` : 'backoff(夜间/minGap/退场)' };
  }
  if (kind === 'photo') {
    const hrs = companion.last_photo_at != null ? (nowMs - companion.last_photo_at) / HOUR : null;
    if (!photoPushAllowed({ hoursSinceLastProactivePhoto: hrs, affection: companion.affection_level }).allowed)
      return { send: false, reason: 'photo_48h限频' };
  }
  if (kind === 'morning' && isIntentCooled({ intent: 'morning', events: morningEvents, nowMs }).cooled)
    return { send: false, reason: 'morning_intent冷却' };
  return { send: true };
}

// ── 主循环：7 天 × 10min 步 ────────────────────────────────────────────────
for (let day = 0; day < DAYS; day++) {
  for (let m = 0; m < 1440; m += STEP_MIN) {
    const hh = Math.floor(m / 60), mm = m % 60;
    const nowMs = DAY0 + day * clock.DAY_MS + m * MIN;
    clock.setClock(nowMs);

    // 1) 合成用户发言 → 清零 unanswered + 重开 24h 窗口(真实 rememberContextToken·at=clock.now())
    if ((USER_SCRIPT[day] || []).some(([uh, um]) => uh === hh && um === mm)) {
      companion.last_user_reply_at = isoU(nowMs);
      companion.proactive_unanswered = 0;
      rememberContextToken(BOT, USER, 'tok');
      timeline.push({ day, hh, mm, type: 'user' });
    }

    // 2) 候选调度判断(stub 内容·只判 kind+time)
    const kind = CANDIDATES[`${hh}:${mm}`];
    if (kind) {
      const d = decide(kind, nowMs);
      timeline.push({ day, hh, mm, type: d.send ? 'sent' : 'blocked', kind, reason: d.reason });
      if (d.send) {
        companion.last_proactive_reply_at = isoU(nowMs);
        if (!isSilenceExemptKind(kind)) companion.proactive_unanswered++;
        if (kind === 'photo') companion.last_photo_at = nowMs;
        if (kind === 'morning') morningEvents.push({ intent: 'morning', topic: '', ts: nowMs });
        if (REAL && kind !== 'photo') {   // photo=图片·caption 内容验另论；此处只验文本 kind
          const content = await genProactive(kind);
          contentChecks.push({ day, hh, mm, kind, content, aloof: checkAloofReject(content), spam: checkMissYouSpam(content) });
        }
      }
      unansweredPeak = Math.max(unansweredPeak, companion.proactive_unanswered);
    }

    // 3) lastcall「窗口将关·临门一脚」(idle 21-23.5h)
    if (shouldSendWindowLastCall(companion, new Date(nowMs)))
      timeline.push({ day, hh, mm, type: 'lastcall' });
  }
}
clock.resetClock();   // teardown：还原真实时间，防假时钟泄漏
for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + ext); } catch { /* 临时库清理·失败无害 */ } }

// ── 打印 timeline(只打有事件步) ──────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
console.log('═══ proactive 7天 timeline（10min步·合成用户·真实gate·stub内容）═══');
for (const e of timeline) {
  const t = `D${e.day} ${pad(e.hh)}:${pad(e.mm)}`;
  if (e.type === 'user') console.log(`  ${t}  ← 用户发言(窗口重开·unanswered清零)`);
  else if (e.type === 'lastcall') console.log(`  ${t}  ◇ lastcall 窗口将关一搏`);
  else console.log(`  ${t}  ${e.type === 'sent' ? '✅发' : '⛔挡'} ${e.kind}${e.reason ? ` (${e.reason})` : ''}`);
}
console.log(`  unanswered 峰值=${unansweredPeak}`);

// ── 断言 ────────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };
const sent = (day, kind) => timeline.filter(e => e.type === 'sent' && e.day === day && e.kind === kind);
const blocked = (day, kind) => timeline.filter(e => e.type === 'blocked' && e.day === day && e.kind === kind);
const allSent = timeline.filter(e => e.type === 'sent');

console.log('\n── 断言 ──');
// 🔴 早安续命器跨天：Day1/Day2 早安仍发(前夜 goodnight 未回·morning 豁免静默闸·窗口内)
ok(sent(1, 'morning').length === 1 && sent(2, 'morning').length === 1,
  '🔴早安续命器：Day1/Day2 早安均发出(前夜goodnight未回·morning豁免静默闸·窗口内)');
// 🔴 24h 窗口 gate：Day5 全天 proactive 被窗口挡(last_user=Day3 08:20·Day5 全关)
ok(sent(5, 'morning').length + sent(5, 'normal').length + sent(5, 'photo').length + sent(5, 'goodnight').length === 0
  && blocked(5, 'morning').some(e => e.reason.includes('window_closed')),
  '🔴24h窗口gate：Day5 全天零 proactive 发出·候选被 window_closed 挡(平台天花板)');
// 🔴 窗口重开边界专测：Day3 08:20 回来 → 从新消息重新计时24h(非续残余)
//    Day4 07:30 morning 在新窗口内(Day3 08:20+24h=Day4 08:20·07:30<关)→发；Day4 13:00>08:20→关
ok(sent(4, 'morning').length === 1, '🔴窗口重开边界：Day4 07:30 早安发出=窗口从 Day3 08:20 新消息重新计时24h(08:20前在窗口内)');
ok(blocked(4, 'normal').some(e => e.reason.includes('window_closed')),
  '🔴窗口重开边界：Day4 13:00 normal 被挡=新窗口 Day4 08:20 已关(证明从新消息计时满24h·非续 Day2 原窗口)');
// 时序：morning 只在 07 时·goodnight 只在 22 时·凌晨(0-6)零 proactive
ok(allSent.filter(e => e.kind === 'morning').every(e => e.hh === 7), '时序：所有早安都在 07 时段');
ok(allSent.filter(e => e.kind === 'goodnight').every(e => e.hh === 22), '时序：所有晚安都在 22 时段');
ok(allSent.every(e => e.hh >= 7), '时序：凌晨(00-06)零 proactive(不在睡觉时乱发)');
// 连发未回静默闸(计数制)：Day2 用户只早上发1条→窗口内 normal+photo 连发累积 unanswered≥2→goodnight 被静默闸拦
ok(blocked(2, 'goodnight').some(e => e.reason.includes('静默闸')),
  '连发静默闸：Day2 窗口内连发未回(unanswered≥2)→当晚 goodnight 被静默闸拦(计数制)');
ok(unansweredPeak >= 2, `连发静默闸：unanswered 峰值达阈值(峰值=${unansweredPeak}≥2)`);
// lastcall：Day3 早晨 idle∈[21,23.5h]触发(Day2 08:30→Day3 05:30-08:00)
ok(timeline.some(e => e.type === 'lastcall' && e.day === 3), 'lastcall：Day3 窗口将关(idle 21-23.5h)触发最后一搏');
// 窗口重开恢复：Day6 用户 08:30 回来后 normal(13:00)发出(窗口恢复)
ok(sent(6, 'normal').length === 1, '窗口重开恢复：Day6 用户回来后 normal 发出(proactive 恢复)');
// photo 48h 节律：相邻两次 photo 发出间隔≥48h
{
  const ph = allSent.filter(e => e.kind === 'photo').map(e => DAY0 + e.day * clock.DAY_MS + (e.hh * 60 + e.mm) * MIN);
  const gapOK = ph.every((t, i) => i === 0 || (t - ph[i - 1]) >= 48 * HOUR);
  ok(ph.length >= 2 && gapOK, `photo 48h 节律：${ph.length} 张 proactive photo·相邻间隔≥48h`);
}

// ── 内容断言器双向红验（¥0·两模式都跑·进 CI 保障断言器逻辑·呼应 preflight mock 红验）──
console.log('\n── 内容断言器双向红验(¥0·断言器自身逻辑) ──');
ok(checkAloofReject('我们又不是那种关系，保持点距离').hit === true, '断言器🔴：冷淡推开"不是那种关系/保持距离"必抓');
ok(checkAloofReject('没那么熟还想让我陪你').hit === true, '断言器🔴：冷淡"没那么熟"必抓');
ok(checkAloofReject('我才不是专门等你呢…只是刚好看到你说今天要早起').hit === false, '断言器✅：健康矜持(口是心非)必放行');
ok(checkAloofReject('早呀，醒了没～记得吃点东西再出门').hit === false, '断言器✅：暖早安必放行');
ok(checkMissYouSpam('想你了').hit === true, '断言器🔴：裸"想你了"无上下文=刷屏必抓(drop)');
ok(checkMissYouSpam('看到你说今天面试，记得深呼吸别紧张').hit === false, '断言器✅：具体牵挂非刷屏');
ok(checkMissYouSpam('早呀，醒了没～记得吃点东西').hit === false, '断言器✅：早安非想你刷屏');

// ── real-llm 内容质量断言（仅 --real-llm·维护者生产机跑·烧少量钱）──
if (REAL) {
  console.log(`\n── real-llm 内容质量(${contentChecks.length} 条真 LLM proactive) ──`);
  for (const c of contentChecks) {
    console.log(`  D${c.day} ${pad(c.hh)}:${pad(c.mm)} ${c.kind}「${c.content}」`);
    ok(c.content !== FALLBACK_REPLY, `🔴LLM真跑(非兜底) D${c.day} ${c.kind}${c.content === FALLBACK_REPLY ? '·兜底句=LLM失败' : ''}`);
    ok(c.aloof.hit === false, `🔴矜持≠冷淡 D${c.day} ${c.kind}${c.aloof.hit ? '·命中:' + c.aloof.why : ''}`);
    ok(c.spam.hit === false, `🔴无想你刷屏 D${c.day} ${c.kind}${c.spam.hit ? '·命中:' + c.spam.why : ''}`);
  }
  console.log(`  ⚠ 成本：${contentChecks.length} 次 LLM ≈ ¥${(contentChecks.length * 0.0032).toFixed(3)}（DeepSeek 账单口径·脚本/系统旧读数会虚高 2.87×）`);
} else {
  console.log('\n（mock 模式：内容生成层 stub·只验时序+断言器逻辑。真 LLM 内容质量验证：维护者在生产机 `npm run … -- --real-llm`）');
}

console.log(`\nproactive_timeline_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
