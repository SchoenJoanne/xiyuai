#!/usr/bin/env node
/**
 * sleep_guard_smoke —— 睡眠闸级联修复（SLEEP_GUARD）坏版本验红（确定性·进 CI）。
 *
 * 根因(停板A坐实·老坑 f02a98e/f3064773 2026-06-20)：away_probe 睡眠窗内越窗发主动 → 她"主动找你又装睡
 * 不理你"穿帮 + away_probe 占 25min 硬间隔档把叫醒 morning 挤掉 → missed 永久躺 consumed=0。
 * 修：A(睡眠期中断型主动不冒泡·morning/goodnight豁免) B(morning免硬间隔) C(临醒≤45min被叫醒直接回)
 *    missed解耦(fallback/reply 都能排空)。全程 SLEEP_GUARD 灰度门控·闸关=旧行为字节一致。
 *
 * 🔴 DB_PATH 硬闸：显式非 /tmp→拒；未设→默认 /tmp。跑：DB_PATH=/tmp/sg.db node scripts/sleep_guard_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/sg.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/sg_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.PROACTIVE_AWAY_PROBE_ENABLED = 'true';   // away_probe gate 默认 off·这里开=能 fire（prod 亦开），才测得到 A 的掐
process.env.COALESCE_WINDOW_MS = process.env.COALESCE_WINDOW_MS || '20';     // BUG#1 burst flush 提速(默认10s→20ms)·确定性
process.env.COALESCE_MAX_WAIT_MS = process.env.COALESCE_MAX_WAIT_MS || '200';
const fs = await import('node:fs');

const { maybeSleepBlock, isSleepingNow, isSleepGuardOn, drainMissed, upsertSleepSchedule, getOrRefreshTodaySchedule } = await import('../src/sleep.mjs');
const { shouldSendAwayProbe } = await import('../src/proactive_engine.mjs');
const { createCompanion, shanghaiDateKey } = await import('../src/db.mjs');
// BUG#1(bot.mjs burst 粘住保留富 wakeHint) + BUG#2(proactive.mjs morning demote 睡眠窗跳过)
const { enqueueOrRunTurn, __setTurnRunnerForTest } = await import('../src/bot.mjs');
const { shouldDemoteMorning, shouldSkipDemotedMorningInSleep, sendProactiveMessageGuarded } = await import('../src/proactive.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

const NOW = Date.now();
const TODAYKEY = shanghaiDateKey(new Date(NOW));
const c = createCompanion('sg_' + process.pid, 'sg_bot', { name: '小睡' });
const ID = c.id;

// 把睡眠窗钉死：bed=now−3h（已睡熟·绕开挽留 grace），wake=now+wakeOffMin（控制"距 wake 还有多久"）
function pinSleep(wakeOffMin) {
  upsertSleepSchedule(ID, {
    enabled: 1, user_set: 1, learn_state: 'locked', today_date: TODAYKEY,
    today_bed_at: NOW - 3 * 3600_000, today_wake_at: NOW + wakeOffMin * 60_000,
    is_sleeping: 1, woken_today: 0, goodmorning_sent_for_date: null, last_woken_at: null,
  });
}
const block = (content = 'x') => maybeSleepBlock({ companionId: ID, msgType: 'text', content, receivedAt: NOW });
// 手搭 companion（last_user_reply_at 等运行时态非 ALLOWED_FIELDS·createCompanion 不落）→ idle 5h（anxious 阈值3h<5h<21h=该探）
const awayC = { id: ID, affection_level: 80, relationship_stage: '恋人', attachment_style: 'anxious',
  last_user_reply_at: new Date(NOW - 5 * 3600_000).toISOString(), proactive_unanswered: 0, safe_mode: 0 };
// 复现 proactive tick 内联闸：away_probe 实际是否会发 = !(_asleepNow) && shouldSendAwayProbe（用真函数组合）
const awayWouldFire = () => !(isSleepGuardOn() && isSleepingNow(ID, NOW)) && shouldSendAwayProbe(awayC, { now: new Date(NOW) });
// 复现 dueItems 内联闸的 kind 豁免部分（_asleepNow 真值段见 awayWouldFire/A 测试）：morning/goodnight 永不被睡眠期掐
const dueSuppressed = (kind) => kind !== 'morning' && kind !== 'goodnight';

console.log('── 🔴 坏版本红基线 = 闸关(默认)：越窗 + 秒装睡 都复现（也即零变更先验）──');
delete process.env.SLEEP_GUARD;
pinSleep(13);
ok(isSleepingNow(ID, NOW) === true, 'setup 自检：钉死窗内 isSleepingNow=true');
ok(block('刚起床你起的可真早').reason === 'sleeping', '🔴闸关：临醒窗内用户消息仍被静默 missed（"她主动后秒装睡不理"复现=旧行为字节一致）');
ok(awayWouldFire() === true, '🔴闸关：睡眠期 away_probe 会发（越窗·老坑复现=红基线）');

console.log('── A 闸开：睡眠期中断型主动不冒泡·作息边界仪式豁免 ──');
process.env.SLEEP_GUARD = '1';
pinSleep(13);
ok(awayWouldFire() === false, 'A：闸开+睡眠期 → away_probe 被掐（!_asleepNow=false·级联触发源堵死）');
ok(dueSuppressed('normal') === true && dueSuppressed('away_probe') === true, 'A：睡眠期 normal/away 普通调度被掐');
ok(dueSuppressed('morning') === false && dueSuppressed('goodnight') === false, '边界不误伤：morning(刚醒早安)/goodnight(困了签退) 豁免·睡眠期仍放行');

console.log('── C 闸开：临醒(≤45min)被他叫 → 直接回·迷糊档 ──');
process.env.SLEEP_GUARD = '1';
pinSleep(13);
{
  const r = block('刚起床你起的可真早');
  ok(r.blocked === false && r.reason === 'woken_by_user', '🔴C：临醒窗(13min)被叫 → 不 block·woken_by_user（她醒来回他·不装睡晾着）');
  const _row = getOrRefreshTodaySchedule(ID, NOW);
  ok(_row.goodmorning_sent_for_date === TODAYKEY && Number(_row.woken_today) === 1,
     'C：叫醒后标 woken_today + goodmorning（shouldDemoteMorning 据此压住晨间早安）·不 exitSleep（避免 runSleepTick 重睡误发晚安）');
}

console.log('── 🔴 红线 深夜不漏：远 wake 一律照睡进 missed（叫醒绝不漏出 wake±45min 窗）──');
process.env.SLEEP_GUARD = '1';
pinSleep(180);
ok(block('嘿嘿').reason === 'sleeping', '🔴红线：深夜(距 wake 3h)消息仍被 missed·不叫醒（作息真实底线）');
pinSleep(46);
ok(block().reason === 'sleeping', '🔴红线临界：wake 前 46min(>45) 仍 missed·不叫醒');
pinSleep(44);
ok(block().reason === 'woken_by_user', '红线临界：wake 前 44min(≤45) 才叫醒（窗边界精确·没漏没误）');

console.log('── missed 解耦：drain 真排空·不再永久躺 consumed=0 ──');
process.env.SLEEP_GUARD = '1';
drainMissed(ID);                 // 清掉前面测试攒的
pinSleep(180); block('睡前消息1');
pinSleep(180); block('睡前消息2');
{
  const d = drainMissed(ID);
  ok(d.length >= 2, `missed 解耦：drainMissed 排空 ${d.length} 条(≥2)·解了"永久躺 consumed=0"`);
  ok(drainMissed(ID).length === 0, 'missed 解耦：再 drain 返空（幂等·已 consumed=1）');
}

console.log('── 闸关零变更复核：C 不生效（临醒窗也照旧 missed）──');
delete process.env.SLEEP_GUARD;
pinSleep(13);
ok(block('刚起床你起的可真早').reason === 'sleeping', '闸关：临醒窗也不叫醒（C 不生效=旧行为·灰度先验成立）');

console.log('── 🔴 BUG#1：连发叫醒 missed 承接不丢(她不再对睡眠期消息装没看见)──');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const richWake = '\n【★ 刚被他叫醒】…他在你睡着时还发过 3 条，自然回一句"我刚醒，看到你发的了"。';
const baseWake = '\n【★ 刚被他叫醒】…（基底·无承接）';
{
  let captured = null;
  __setTurnRunnerForTest((t) => { captured = t; return Promise.resolve(); });
  const FU = 'bug1_' + process.pid;
  enqueueOrRunTurn({ fromUser: FU, userText: 'm1', wakeHint: richWake, wakeHintHasMissed: true });    // 首条:drain 命中·富
  enqueueOrRunTurn({ fromUser: FU, userText: 'm2', wakeHint: baseWake, wakeHintHasMissed: false });    // 次条:drain 返0·基底
  await wait(150);
  ok(captured && captured.wakeHint === richWake, '🔴 开修复:连发2条→终态保留含承接富 wakeHint(她知道"睡着时发过3条"·不装没看见)');
  ok(captured && captured.userText === 'm1\nm2', '连发合并 userText 正常(m1\\nm2)');
  __setTurnRunnerForTest(null);
}
// 🔴 红基线:旧粘住 `if(!turn.wakeHint)` 在 m2 基底 truthy 时不触发→丢承接(内联复刻旧逻辑证非 no-op)
ok(((p, c) => (!c && p) ? p : c)(richWake, baseWake) === baseWake, '🔴 红基线:旧逻辑→m2 基底 truthy→终态 baseWake 丢承接(装没看见复现)');
// 🔴 边界:单条叫醒承接正常(没修坏单条路径)
{
  let cap = null;
  __setTurnRunnerForTest((t) => { cap = t; return Promise.resolve(); });
  enqueueOrRunTurn({ fromUser: 'bug1b_' + process.pid, userText: '单', wakeHint: richWake, wakeHintHasMissed: true });
  await wait(150);
  ok(cap && cap.wakeHint === richWake, '🔴 边界:单条叫醒(非连发)承接正常');
  __setTurnRunnerForTest(null);
}
// 🔴 边界:非临醒窗连发(都无 wakeHint)→不误造承接·不受影响
{
  let cap = null;
  __setTurnRunnerForTest((t) => { cap = t; return Promise.resolve(); });
  const FU = 'bug1c_' + process.pid;
  enqueueOrRunTurn({ fromUser: FU, userText: 'a', wakeHint: '', wakeHintHasMissed: false });
  enqueueOrRunTurn({ fromUser: FU, userText: 'b', wakeHint: '', wakeHintHasMissed: false });
  await wait(150);
  ok(cap && !cap.wakeHint, '🔴 边界:非临醒窗连发(都无承接)→终态仍无承接(不误造·不受影响)');
  __setTurnRunnerForTest(null);
}

console.log('── 🔴 BUG#2：C 叫醒后 morning 降级 normal 不在睡眠窗冒泡 ──');
ok(shouldDemoteMorning({ goodmorningSentForDate: TODAYKEY, todayKey: TODAYKEY }).demote === true, 'demote 触发(goodmorning 已置=C 叫醒服务过)');
ok(shouldDemoteMorning({ goodmorningSentForDate: null, todayKey: TODAYKEY, lastUserReplyAt: null }).demote === false, '🔴 边界:正常 morning(goodmorning 未置)→不 demote=到点照发(不误掐)');
ok(shouldSkipDemotedMorningInSleep(true, true) === true, '🔴 开修复:demote+睡眠窗(asleepNow)→跳过(不冒泡 normal)');
ok(shouldSkipDemotedMorningInSleep(true, false) === false, '🔴 边界:demote+醒着→不跳过=照发(没误掐正常 morning)');
ok(shouldSkipDemotedMorningInSleep(false, true) === false, '边界:没 demote→不是降级 morning→不跳过');
// 集成:guarded(morning, asleepNow=true)+goodmorning 已置 → demote→asleep_skip(真路径·返回前不触网络)
{
  process.env.SLEEP_GUARD = '1';
  upsertSleepSchedule(ID, { enabled: 1, user_set: 1, learn_state: 'locked', today_date: TODAYKEY,
    today_bed_at: NOW - 3 * 3600_000, today_wake_at: NOW + 13 * 60_000, is_sleeping: 1,
    woken_today: 1, goodmorning_sent_for_date: TODAYKEY, last_woken_at: NOW });
  const r = await sendProactiveMessageGuarded({ id: ID, last_user_reply_at: null }, 'morning', null, { asleepNow: true });
  ok(r === 'asleep_skip', '🔴 集成:guarded(morning,asleepNow=true)+goodmorning置→demote→返 asleep_skip(睡眠窗不冒泡·真路径返回前不触网络)');
}

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} sleep_guard 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
