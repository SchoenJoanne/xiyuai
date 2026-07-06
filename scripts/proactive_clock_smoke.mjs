#!/usr/bin/env node
/**
 * proactive_clock_smoke —— 注入时钟下的 proactive【时序逻辑】红验（mock·¥0·零 LLM·零 DB·确定性）。
 *
 * 两层分离架构里的【调度判断层】测试：用 clock.setClock 拨到各时间点 → 跑确定性调度纯函数
 * (shouldBackoffProactive / computeTimeBaseScore / photoPushAllowed / isIntentCooled /
 *  shouldSendWindowLastCall) → 断言「此刻该不该发 / 发哪种」。不调 LLM、不碰 DB、不跑真 tick。
 * 内容质量(矜持≠冷淡/无想你刷屏)由真 LLM 沙箱(preflight_sandbox)另验，本 smoke 只钉【时序】。
 *
 * ★ 两条生死线写进断言：
 *   🔴 早安续命器时序：晚安未回(unanswered 高)场景下，次日早安仍触发(morning 豁免静默闸)。
 *   🔴 静默闸计数制：unanswered 计数到 2 拦第 3 条、清零后恢复（非时间解除——见对应 PR
 *      决议③，时间制偏差在 backlog「proactive 节律精调」，本 smoke 不测不存在的时间解除边界）。
 *
 * 时区：时段/夜间静默判断走 shanghaiHM(Asia/Shanghai·见 db.mjs)。本 smoke 的 at() 用 Date.UTC
 *   构造目标「上海时刻」的绝对 ms，构造与判断同锚上海 → 断言在任何 CI 时区（含 UTC runner）都稳定
 *   （不假设服务器=沪时区）。🔴 绝不用 `new Date(Y,M,D,h)`（本地时区构造）——那会假设服务器=沪，
 *   UTC runner 上被 shanghaiHM +8 读成别的小时→时段断言全错（2026-07-06 UTC CI 暴露·本地 CST 掩盖）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import * as clock from '../src/clock.mjs';
import { shouldBackoffProactive, computeTimeBaseScore } from '../src/proactive_engine.mjs';
import { photoPushAllowed } from '../src/proactive_policy.mjs';
import { isIntentCooled } from '../src/intent_dedup.mjs';
import { shouldSendWindowLastCall } from '../src/proactive.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// 构造「上海时区 2026-06-15(+dOff 天) h:m」的绝对 ms（月份 0-based：5=June；h-8=沪→UTC，
// Date.UTC 自动借位跨日）。与 shanghaiHM 同锚 → TZ 无关。
const at = (h, m = 0, dOff = 0) => Date.UTC(2026, 5, 15 + dOff, h - 8, m, 0, 0);
const iso = (ms) => new Date(ms).toISOString();
const HOUR = clock.HOUR_MS;
const mkC = (o = {}) => ({
  id: 1, attachment_style: 'secure', proactive_intensity: 'normal',
  proactive_unanswered: 0, missing_score: 0, relationship_stage: '恋人',
  affection_level: 100, last_proactive_reply_at: null, last_user_reply_at: null,
  ...o,
});

// ── clock 基础 + 生产零污染 ────────────────────────────────────────────────
clock.resetClock();
ok(clock.isFake() === false, 'clock：默认非注入态(生产=真实时间)');
ok(Math.abs(clock.now() - Date.now()) < 1000, 'clock：真实态 now()≈Date.now()');
clock.setClock('2026-06-15T00:00:00Z');
ok(clock.isFake() === true && clock.now() === Date.parse('2026-06-15T00:00:00Z'), 'clock：setClock 字符串解析');
clock.advanceClock(clock.DAY_MS);
ok(clock.now() === Date.parse('2026-06-16T00:00:00Z'), 'clock：advanceClock +1 天');
clock.resetClock();
ok(clock.isFake() === false, 'clock：resetClock 还原真实时间(防泄漏)');

// ── 🔴 早安续命器时序：晚安未回 → 次日早安仍照发(morning 豁免静默闸) ──────────
{
  const c = mkC({
    last_user_reply_at: iso(at(22, 0, -1)),       // 昨晚 22:00 用户最后说话
    last_proactive_reply_at: iso(at(23, 0, -1)),  // 昨晚 23:00 她发晚安
    proactive_unanswered: 3,                       // 晚安等连发没回累积
  });
  clock.setClock(at(7, 30));                        // 次日 07:30
  ok(shouldBackoffProactive(c, { kind: 'morning' }) === false,
    '🔴早安续命器：晚安未回(unanswered=3) 次日 07:30 早安仍照发(morning 豁免静默闸)');
  ok(shouldBackoffProactive(c, { kind: 'normal' }) === true,
    '🔴对照：同场景 normal 被静默闸拦(unanswered=3≥2) → 证明 morning 豁免是关键(否则续命器死)');
}

// ── 🔴 静默闸计数边界(计数制·非时间制) ──────────────────────────────────────
{
  clock.setClock(at(12, 0));
  const base = mkC({ last_user_reply_at: iso(at(10, 0)), last_proactive_reply_at: iso(at(8, 0)) });
  ok(shouldBackoffProactive({ ...base, proactive_unanswered: 1 }, { kind: 'normal' }) === false, '静默闸：unanswered=1<2 放行');
  ok(shouldBackoffProactive({ ...base, proactive_unanswered: 2 }, { kind: 'normal' }) === true, '🔴静默闸：unanswered=2≥2 拦第 3 条(计数制)');
  ok(shouldBackoffProactive({ ...base, proactive_unanswered: 2 }, { kind: 'morning' }) === false, '静默闸：morning 豁免(unanswered=2 仍放行)');
  ok(shouldBackoffProactive({ ...base, proactive_unanswered: 0 }, { kind: 'normal' }) === false, '🔴静默闸：清零(user msg 回)后恢复发送(0 放行)');
}

// ── photo 48h 限频边界(暗恋期) ──────────────────────────────────────────────
ok(photoPushAllowed({ hoursSinceLastProactivePhoto: 47, affection: 30 }).allowed === false, 'photo：暗恋期 47h<48h 不发');
ok(photoPushAllowed({ hoursSinceLastProactivePhoto: 49, affection: 30 }).allowed === true, 'photo：暗恋期 49h>48h 可发');
ok(photoPushAllowed({ hoursSinceLastProactivePhoto: 1, affection: 30, isUserRequested: true }).allowed === true, 'photo：用户请求永远放行(豁免限频)');
ok(photoPushAllowed({ hoursSinceLastProactivePhoto: 1, affection: 100 }).allowed === true, 'photo：非暗恋期(affection≥55)走原节流·不强限');

// ── morning 12h 冷却(PR-1 数学保证：<24h → cross-day 必放行) ────────────────
{
  const T = at(8, 0);
  clock.setClock(T);   // isIntentCooled 默认 nowMs=clock.now()=T → 验 clock 驱动
  ok(isIntentCooled({ intent: 'morning', events: [{ intent: 'morning', ts: T - (11 * 3600e3 + 59 * 60e3) }] }).cooled === true,
    'morning 冷却：11h59m<12h 冷却(压同日重复早安)');
  ok(isIntentCooled({ intent: 'morning', events: [{ intent: 'morning', ts: T - (12 * 3600e3 + 60e3) }] }).cooled === false,
    '🔴morning 冷却：12h01m>12h 放行(cross-day 早安数学保证不误杀·12<24)');
}

// ── 夜间静默(23:00–07:00) ───────────────────────────────────────────────────
{
  clock.setClock(at(2, 0));   // 02:00 凌晨
  const cN = mkC({ last_proactive_reply_at: iso(at(0, 0)), last_user_reply_at: iso(at(1, 30)) });
  ok(shouldBackoffProactive(cN, { kind: 'normal' }) === true, '🌙夜间静默：02:00 + last_pro 2h前(<3h) → 拦');
  clock.setClock(at(13, 0));  // 13:00 白天·同 2h 间隔
  const cD = mkC({ last_proactive_reply_at: iso(at(11, 0)), last_user_reply_at: iso(at(12, 30)) });
  ok(shouldBackoffProactive(cD, { kind: 'normal' }) === false, '白天对照：13:00 + last_pro 2h前(120min>90min minGap) → 放行(证明上面是夜间拦非 minGap)');
}

// ── 依恋风格退场边界(避开 secure 36-72h 的 random 区间) ──────────────────────
{
  clock.setClock(at(13, 0));
  const ev = (style, idleH) => mkC({
    attachment_style: style,
    last_proactive_reply_at: iso(at(13, 0) - 4 * HOUR),   // 4h前(>90min minGap·不夜间)
    last_user_reply_at: iso(at(13, 0) - idleH * HOUR),
  });
  ok(shouldBackoffProactive(ev('avoidant', 23), { kind: 'normal' }) === false, '退场：avoidant idle23h<24h 仍找');
  ok(shouldBackoffProactive(ev('avoidant', 25), { kind: 'normal' }) === true, '退场：avoidant idle25h>24h 收手自保');
  ok(shouldBackoffProactive(ev('secure', 73), { kind: 'normal' }) === true, '退场：secure idle73h>72h 基本停');
  ok(shouldBackoffProactive(ev('anxious', 100), { kind: 'normal' }) === false, '退场：anxious idle100h<120h 仍追(尊严上限内)');
  ok(shouldBackoffProactive(ev('anxious', 121), { kind: 'normal' }) === true, '退场：anxious idle121h>120h 收手(尊严上限)');
}

// ── computeTimeBaseScore 时段(拨 clock 验时段评分) ──────────────────────────
ok(computeTimeBaseScore(new Date(at(7, 30))) === 70, '时段：07:30 早安高峰=70');
ok(computeTimeBaseScore(new Date(at(2, 0))) === 5, '时段：02:00 凌晨=5(基本不打扰)');
ok(computeTimeBaseScore(new Date(at(12, 0))) === 30, '时段：12:00 午饭=30');
ok(computeTimeBaseScore(new Date(at(20, 0))) === 70, '时段：20:00 晚间高峰=70');
clock.setClock(at(8, 0));
ok(computeTimeBaseScore() === 70, '时段：不传参默认走 clock(08:00=70·验注入驱动默认值)');

// ── lastcall「窗口将关·临门一脚」(idle 21–23.5h) ───────────────────────────
{
  clock.setClock(at(12, 0));
  const cLast = (idleH) => mkC({ last_user_reply_at: iso(at(12, 0) - idleH * HOUR), last_lastcall_at: 0 });
  ok(shouldSendWindowLastCall(cLast(22)) === true, 'lastcall：idle22h∈[21,23.5] 触发最后一搏');
  ok(shouldSendWindowLastCall(cLast(20)) === false, 'lastcall：idle20h<21 未到窗口将关');
  ok(shouldSendWindowLastCall(cLast(24)) === false, 'lastcall：idle24h>23.5 窗口已过(超窗口·发不出)');
}

clock.resetClock();   // teardown：防假时钟泄漏到别的进程/用例
console.log(`\nproactive_clock_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
