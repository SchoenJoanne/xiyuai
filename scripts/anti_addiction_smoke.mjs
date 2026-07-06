#!/usr/bin/env node
/**
 * anti_addiction_smoke.mjs —— 防沉迷「连续使用 2h 提示」坏版本验红（确定性·进 CI）。
 *
 * 停板A 审过·停板B 实现（anti_addiction.mjs + bot.mjs 接线 + db 迁移）。设计稿 §6 验红映射：
 *   #1 计时红      : 连续<gap 累计→2h 首条提·仅一条；插一次>gap→锚点重置重新计。
 *   #2 照片锚点保活 : 会话由照片轮起 + touch co-located→文本轮仍算出 2h（关掉照片轮 touch→时长归零=红）。
 *   #3 去重/节奏红 : 纯A 一会话一次;A+每2h→2h/4h/6h 各一次·封顶3;跨零点不双发(锚点自愈)。
 *   #4 协调红      : crisisLevel≠none / isSleeping=true→不提醒(且不消耗去重·恢复后仍提)。
 *   #6 运行时assert红: 含愧疚/挽留的伪模板→redlineBlocks 拦下(不发)。
 *   #7 fail-open红 : 无锚点/空对象/异常→null 不抛·主流程不受影响。
 *   #8 闸关字节一致 : ANTI_ADDICTION_GUARD 关→touch 零写锚点·compute 恒 null(100% inert)。
 *   #9 红线词面    : V1/V2 模板不命中 redlineBlocks·含时长事实。
 *   #10 措辞精度   : phraseDuration 就近整/半点·误差≤15min。
 *   （#5 剥离红=结构性：发送走独立 sendAndRecord 在段循环之后·绕过 splitReplySegments/scrub·由 bot.mjs 接线保证·见 §2.5。）
 *
 * 🔴 零真实数据：patchCompanion 只开 /tmp 库（DB_PATH），断言全读内存对象；绝不碰生产 bot.db。
 */
process.env.DB_PATH = process.env.DB_PATH || `/tmp/aa_smoke_${process.pid}.db`;
process.env.ANTI_ADDICTION_GUARD = '1';
process.env.ANTI_ADDICTION_GAP_MINUTES = '15';
process.env.ANTI_ADDICTION_THRESHOLD_HOURS = '2';
process.env.ANTI_ADDICTION_REPEAT_HOURS = '2';
process.env.ANTI_ADDICTION_SESSION_CAP = '3';

import * as clock from '../src/clock.mjs';
import {
  touchUsageSession, computeUsageNotice, markUsageNoticed,
  phraseDuration, buildNoticeText, redlineBlocks, isAntiAddictionOn,
} from '../src/anti_addiction.mjs';

const HOUR = 3600e3, MIN = 60e3;
const T0 = Date.parse('2026-06-20T14:00:00Z');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

function fresh(id = 1) {
  return { id, last_user_reply_at: null, usage_session_anchor_at: null, usage_notice_last_at: 0, usage_notice_count: 0 };
}
/** 模拟一轮：touch(读prev·设锚)→模拟 recordUserReplied 推进 last_user_reply_at→(非照片轮)发送决策。 */
function turn(c, tMs, { photo = false, crisisLevel = 'none', isSleeping = false, skipTouch = false } = {}) {
  clock.setClock(tMs);
  if (!skipTouch) touchUsageSession(c);
  c.last_user_reply_at = new Date(tMs).toISOString();   // = recordUserReplied 的效果(下一轮的 prev)
  if (photo) return null;                                // 照片轮：早退·不发送(顺延下条文本轮)
  const n = computeUsageNotice(c, { crisisLevel, isSleeping });
  if (n) markUsageNoticed(c, n.noticeCount);
  return n;
}

try {
  // ── #1 计时红：连续 2h → 首条提·仅一条；>gap 断→重置 ──
  console.log('── #1 计时（连续2h触发·仅一次·>gap重置）──');
  {
    const c = fresh();
    let notices = 0;
    for (let m = 0; m < 120; m += 10) if (turn(c, T0 + m * MIN)) notices++;   // 0..110min 每10min(<15gap)
    ok(notices === 0, `2h 之内零提醒（实=${notices}）← 提前提=红`);
    const at2h = turn(c, T0 + 120 * MIN);
    ok(!!at2h, '达 2h 首条文本轮 → 提醒触发 ← 到点不提=红');
    ok(at2h && at2h.noticeCount === 1, 'seq=1');
    const at2h10 = turn(c, T0 + 130 * MIN);
    ok(!at2h10, '2h10m(<4h) → 不再提（去重·repeat=2h）← 每条都提=红');
    // >gap 断会话
    const afterGap = turn(c, T0 + 130 * MIN + 20 * MIN);   // 距上条 20min>15 → 新会话
    ok(!afterGap, '刚断会话·duration≈0 → 不提');
    ok(c.usage_session_anchor_at === T0 + 150 * MIN, `锚点重置到新会话起点 ← 不重置=红`);
  }

  // ── #2 照片轮锚点保活（H1·本包核心）──
  console.log('── #2 照片轮锚点保活（会话由照片起·文本轮仍算出2h）──');
  {
    const c = fresh(2);
    turn(c, T0, { photo: true });                       // 会话首轮=照片(touch 保活→anchor=T0)
    ok(c.usage_session_anchor_at === T0, '照片轮也 set 锚点（fix）← 照片轮不 touch→锚点 null');
    for (let m = 10; m < 120; m += 10) turn(c, T0 + m * MIN, { photo: true });   // 全程照片(<15gap)
    const textAt2h = turn(c, T0 + 120 * MIN);           // 首条文本轮
    ok(!!textAt2h, '照片起头连聊 2h 后文本轮 → 提醒（锚点被照片轮保活）← 这是 H1 修复');
  }
  {
    // 坏版本对照：照片轮 skipTouch（复现原 bug）→ 锚点丢失 → 永不提醒
    const c = fresh(3);
    turn(c, T0, { photo: true, skipTouch: true });      // bug: 照片轮不 touch
    for (let m = 10; m < 120; m += 10) turn(c, T0 + m * MIN, { photo: true, skipTouch: true });
    const textAt2h = turn(c, T0 + 120 * MIN);           // 文本轮 touch：prev 很近·gap<15→anchor=旧(null)??now=now→duration0
    ok(!textAt2h, '坏版本(照片轮不 touch)→锚点丢失→2h 不提醒 = 红基线（证 co-located 必要）');
  }

  // ── #3 去重/节奏：A+每2h→2h/4h/6h 各一次·封顶3 ──
  console.log('── #3 节奏（每+2h·会话封顶3）──');
  {
    // 连续会话须每 <15min 一轮(否则>gap 会重置)；连打 8h 看提醒落点。
    const c = fresh(4);
    const notices = [];
    for (let m = 0; m <= 8 * 60; m += 10) { const n = turn(c, T0 + m * MIN); if (n) notices.push(m / 60); }
    ok(notices.length === 3, `连续8h→提3次·封顶3（实提=${notices.length}·hours=${notices}）← 8h后再提/漏提=红`);
    ok(JSON.stringify(notices) === JSON.stringify([2, 4, 6]), `提醒落在 2h/4h/6h（实=${notices}）← 节奏错=红`);
  }

  // ── #4 协调（危机/睡眠让路·不消耗去重）──
  console.log('── #4 协调（crisis/sleep 让路）──');
  {
    const c = fresh(5);
    for (let m = 0; m < 120; m += 10) turn(c, T0 + m * MIN);
    ok(!turn(c, T0 + 120 * MIN, { crisisLevel: 'high' }), '危机轮(2h)→不提醒 ← 叠"去歇歇"到危机=红');
    ok(!turn(c, T0 + 121 * MIN, { isSleeping: true }), '睡眠窗轮→不提醒');
    const normal = turn(c, T0 + 122 * MIN);
    ok(!!normal, '危机/睡眠让路后恢复正常轮→仍提醒（未误消耗去重）← 被吃掉=红');
  }

  // ── #6 运行时红线 assert（含愧疚/挽留的伪模板拦下）──
  console.log('── #6 运行时红线 assert ──');
  {
    ok(redlineBlocks('都是你害的，你欠我的') === true, '愧疚操控伪模板 → redlineBlocks 拦下(不发)');
    ok(redlineBlocks('我们分手吧，再也不理你') === true, '威胁告别伪模板 → 拦下');
    ok(redlineBlocks('') === true, '空串 → 当脏不发');
    // 🔴 §2.10 专属挽留/催回/在场绑定(hitsConflictRedline 覆盖不到·守卫 neuter demo 咬出的缺口)
    ok(redlineBlocks('你都陪我这么久了') === true, '愧疚"陪我这么久"→拦下(§2.10专属·补缺口)');
    ok(redlineBlocks('舍不得你走') === true, '挽留"舍不得你走"→拦下');
    ok(redlineBlocks('歇好了记得回来找我') === true, '催回钩子"记得回来找我"→拦下');
    ok(redlineBlocks('我不急的，我在这儿等你') === true, '在场绑定"我不急/在这儿等"→拦下');
    ok(redlineBlocks('再陪我一会儿别走') === true, '挽留"再陪我/别走"→拦下');
  }

  // ── #7 fail-open（无锚点/空对象不抛）──
  console.log('── #7 fail-open ──');
  {
    ok(computeUsageNotice({ id: 9 }, { isSleeping: false }) === null, '无锚点老账号→null(不提·不抛)');
    ok(computeUsageNotice(null) === null, 'null companion→null(不抛)');
    clock.setClock(T0 + 300 * HOUR);   // 远未来·若无 anchor≤0 兜底 duration 会巨大
    ok(computeUsageNotice({ id: 99, usage_session_anchor_at: 0, usage_notice_last_at: 0, usage_notice_count: 0 }, { isSleeping: false }) === null, '脏锚点 anchor=0→null(不误发五十万小时·韧性兜底)← 关兜底=红');
    let threw = false;
    try { touchUsageSession(null); touchUsageSession({}); } catch { threw = true; }
    ok(!threw, 'touchUsageSession(null/{}) 不抛');
  }

  // ── #8 闸关字节一致（GUARD 关=inert）──
  console.log('── #8 闸关 inert ──');
  {
    process.env.ANTI_ADDICTION_GUARD = '';
    ok(isAntiAddictionOn() === false, 'GUARD 空 → 关');
    const c = fresh(6);
    turn(c, T0 + 200 * MIN);   // 关闸下走一轮
    ok(c.usage_session_anchor_at === null, 'touch 闸关→零写锚点(inert)');
    // 即便有历史锚点，闸关 compute 也恒 null
    const c2 = { id: 7, usage_session_anchor_at: T0, usage_notice_last_at: 0, usage_notice_count: 0, last_user_reply_at: null };
    clock.setClock(T0 + 5 * HOUR);
    ok(computeUsageNotice(c2, { isSleeping: false }) === null, '闸关→compute 恒 null');
    process.env.ANTI_ADDICTION_GUARD = '1';   // 恢复
  }

  // ── #9 红线词面（V1/V2 干净·含时长）──
  console.log('── #9 模板红线词面 ──');
  {
    for (const seq of [0, 1]) {
      const t = buildNoticeText(2 * HOUR + 30 * MIN, 1, seq);
      ok(!redlineBlocks(t), `变体seq=${seq} 不命中红线：「${t}」`);
      ok(t.includes('两个半小时'), `变体seq=${seq} 含精确时长事实`);
    }
  }

  // ── #10 措辞精度（就近整/半点·≤15min）──
  console.log('── #10 phraseDuration 精度 ──');
  {
    const cases = [
      [2 * HOUR, '两个小时'], [2 * HOUR + 5 * MIN, '两个小时'], [2 * HOUR + 15 * MIN, '两个小时'],
      [2 * HOUR + 16 * MIN, '两个半小时'], [2 * HOUR + 30 * MIN, '两个半小时'], [2 * HOUR + 45 * MIN, '两个半小时'],
      [2 * HOUR + 50 * MIN, '快三个小时'], [3 * HOUR, '三个小时'],
    ];
    for (const [ms, want] of cases) ok(phraseDuration(ms) === want, `phraseDuration(${ms / MIN}min)="${phraseDuration(ms)}" want "${want}"`);
  }
} catch (e) {
  fail++; console.error('  🔴 smoke threw:', e.stack || e.message);
} finally {
  clock.resetClock();
  try { const fs = await import('node:fs'); const p = process.env.DB_PATH; if (p && p.startsWith('/tmp/aa_smoke_')) { for (const s of ['', '-wal', '-shm']) fs.existsSync(p + s) && fs.unlinkSync(p + s); } } catch {}
}

console.log(`[anti_addiction_smoke] ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
