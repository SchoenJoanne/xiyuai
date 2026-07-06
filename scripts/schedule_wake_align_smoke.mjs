#!/usr/bin/env node
/**
 * schedule_wake_align_smoke —— 作息双源对齐（SCHEDULE_WAKE_ALIGN）坏版本验红（确定性·真LLM 无关）。
 *
 * daily 日程"起床项"贴 sleep_schedule 权威：daily 生成时把 sleep 的 today_wake_at（或 routineSleepBaseline.wakeMin）
 * 作软约束喂提示词。🔴 单向 sleep→daily（只读不写）·🔴 冻结存量未成年（age<18）明确排除·灰度闸默认关=零变更先验。
 * 5 块：①闸关零变更/闸开 hint 贴 sleep wake ②🔴冻结存量未成年（age<18）明确跳过 ③null/stale 回退 routineSleepBaseline（非07:30）
 *      ④🔴红线 sleep 系统零碰（只读·调用前后 today_wake_at 不变·无 UPDATE/INSERT sleep 表）⑤叙事不僵（自然口吻别精确报分钟）
 *
 * 🔴 DB_PATH 硬闸：显式非 /tmp→拒。跑：DB_PATH=/tmp/swa.db node scripts/schedule_wake_align_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/swa.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/swa_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');

const { isScheduleWakeAlignOn, resolveAlignWakeMin, buildWakeAlignHint } = await import('../src/plan_tasks.mjs');
const { createCompanion, getDb, shanghaiDateKey } = await import('../src/db.mjs');
const { upsertSleepSchedule } = await import('../src/sleep.mjs');
const { routineSleepBaseline } = await import('../src/routine_profiles.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const src = (f) => fs.readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8');

const NOW = Date.now();
const TK = shanghaiDateKey(new Date(NOW));
const wakeMsAt = (hhmm) => new Date(`${TK}T${hhmm}:00+08:00`).getTime();
const dayCtx = { dayKind: 'active' };

const c = createCompanion('swa_' + process.pid, 'swa_bot', { name: '小作', age: 22 });
const ID = c.id;
// sleep today_wake_at = 今天 08:00（user_set·行为权威），与身份基线可能不同
upsertSleepSchedule(ID, { enabled: 1, user_set: 1, learn_state: 'locked', today_date: TK,
  today_bed_at: wakeMsAt('00:00'), today_wake_at: wakeMsAt('08:00'), is_sleeping: 0,
  woken_today: 0, wake_time: '08:00', bed_time: '23:00' });

console.log('── ① 闸关零变更 / 闸开 hint 贴 sleep wake ──');
delete process.env.SCHEDULE_WAKE_ALIGN;
ok(isScheduleWakeAlignOn() === false, 'setup：闸关');
ok(buildWakeAlignHint(c, TK, dayCtx) === '', '🔴 闸关：buildWakeAlignHint=\'\'（零变更先验·daily 仍 LLM 自由编=旧打架行为）');
process.env.SCHEDULE_WAKE_ALIGN = '1';
const h = buildWakeAlignHint(c, TK, dayCtx);
ok(h.includes('08:00'), '🔴 闸开：hint 含 sleep wake 08:00（对齐·贴行为权威）');
ok(resolveAlignWakeMin(c, TK, dayCtx) === 8 * 60, 'resolveAlignWakeMin=480（08:00·读 today_wake_at）');

console.log('── 🔴 ② 冻结存量未成年（age<18）明确排除 ──');
ok(buildWakeAlignHint({ id: 999001, age: 16, life_identity: 'highschool' }, TK, dayCtx) === '', '🔴 闸开+age16（冻结存量未成年 类）→hint=\'\'（明确跳过·保持现状双源·不是碰巧没变）');
ok(buildWakeAlignHint({ id: 999002, age: 17 }, TK, dayCtx) === '', 'age17→也跳过（age<18 全冻结存量类）');
ok(buildWakeAlignHint(c, TK, dayCtx) !== '', '对照：age22→不跳过（正常对齐）');

console.log('── ③ today_wake_at null/stale → 回退 routineSleepBaseline（非硬编码 07:30）──');
const c2 = createCompanion('swa2_' + process.pid, 'swa2_bot', { name: '小作2', age: 20 });   // 无 sleep row
const baseWake = routineSleepBaseline(c2, 'active').wakeMin % 1440;
ok(resolveAlignWakeMin(c2, TK, dayCtx) === baseWake, `🔴 无 sleep row→回退 routineSleepBaseline.wakeMin(${baseWake})·非硬编码 450(07:30)`);
upsertSleepSchedule(c2.id, { enabled: 1, user_set: 1, learn_state: 'locked', today_date: '2000-01-01', today_wake_at: wakeMsAt('05:00'), is_sleeping: 0, woken_today: 0, wake_time: '05:00', bed_time: '23:00' });
ok(resolveAlignWakeMin(c2, TK, dayCtx) === baseWake, '🔴 stale（today_date≠今天）→不用旧 today_wake_at·回退 routineSleepBaseline');

console.log('── 🔴 ④ 红线：sleep 系统零碰（只读单向）──');
const before = getDb().prepare('SELECT today_wake_at FROM companion_sleep_schedule WHERE companion_id=?').get(ID).today_wake_at;
buildWakeAlignHint(c, TK, dayCtx); resolveAlignWakeMin(c, TK, dayCtx); resolveAlignWakeMin(c2, TK, dayCtx);   // 多次调用
const after = getDb().prepare('SELECT today_wake_at FROM companion_sleep_schedule WHERE companion_id=?').get(ID).today_wake_at;
ok(before === after && before === wakeMsAt('08:00'), '🔴 调 buildWakeAlignHint/resolveAlignWakeMin 后 sleep today_wake_at 不变（只读·不写）');
const ptSrc = src('plan_tasks');
ok(/SELECT today_wake_at, today_date FROM companion_sleep_schedule/.test(ptSrc), '对齐用只读 SELECT 取 today_wake_at');
ok(!/UPDATE\s+companion_sleep_schedule|INSERT\s+INTO\s+companion_sleep_schedule/i.test(ptSrc), '🔴 plan_tasks 对齐码无 UPDATE/INSERT companion_sleep_schedule（单向 sleep→daily）');
ok(!/getOrRefreshTodaySchedule/.test(ptSrc.slice(ptSrc.indexOf('export function resolveAlignWakeMin'), ptSrc.indexOf('export function buildWakeAlignHint'))), '🔴 resolveAlignWakeMin 不调会写的 getOrRefreshTodaySchedule（只读 SELECT）');

console.log('── ⑤ 叙事不僵（软约束·自然口吻不钉死毫秒）──');
ok(h.includes('别精确报分钟') && (h.includes('自然口吻') || h.includes('赖床')), '🔴 hint 含"自然口吻/赖床·别精确报分钟"（软约束不钉死毫秒·叙事不僵）');
ok(h.includes('大约'), 'hint 用"大约 X 起床"软措辞（非机械"08:00 醒"）');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} schedule_wake_align 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
