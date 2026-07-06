#!/usr/bin/env node
/**
 * proactive_freq_semantic_smoke —— 砍主动滑块·频率语义档（方案b）后端坏版本验红 harness。
 *
 * 🔴 本 harness 的核心使命=【实跑坐实 leaky】（维护者 ③ 硬要求·别只读码）：
 *   驱动【真实】ensureTodaySchedule（已导出）·非重写算法·非读码推断。
 *
 * 覆盖（对应停板B 验红 6 条里后端能跑的部分 2/3/6）：
 *   ②target 映射：随她(4)→count 基线≈4 / 少一些(2)→≈2（实跑分布·仍叠 busyFactor）。
 *   ③🔴leaky 修干净：闸关 target=0 实跑→仍残留 1 条 23:00 goodnight（坐实真源=buildDailyItems:686
 *      无条件 push·非只 :620-621 floor）；闸开 target=0 实跑→0 items（早返真零·修干净·无残留）。
 *   ⑥灰度闸闸关零变更：同一非零 target 闸关/闸开 count 分布一致（早返只对 target=0 生效）。
 *
 * 坏版本验红=闸关 path 就是"旧行为"：同输入闸关=1 goodnight、闸开=0 → 一开一关行为反转
 *   ＝证修非 no-op 且真受灰度闸控（revert 早返/把闸默认改 true 都会让某路断言变红）。
 *
 * 留盘不进库（同 reach-guard / anxiety smoke 惯例）。DB_PATH=/tmp·跑后删·零残留·不碰生产。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
process.env.DB_PATH = process.env.DB_PATH || `/tmp/freq_semantic_smoke_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';   // 压掉 ensureTodaySchedule 的 info 噪声
const fs = await import('node:fs');
const { ensureTodaySchedule } = await import('../src/proactive.mjs');

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : fail++; console.log((cond ? '  ✓ ' : '  🔴 FAIL ') + msg); };

const DATE = '2026-06-26';
const START = 7 * 60;      // 07:00 起床窗
const PREDAWN = 6 * 60;    // 06:00 起算（在窗前）→ remainLen≈dayLen·ratio≈1·排满全天 target（量映射要测全天基线）
let CID = 100000;          // 每次用新 companionId（schedules Map 按 id+dateKey 缓存·避免命中旧）

function gate(on) { if (on) process.env.PROACTIVE_FREQ_SEMANTIC = '1'; else delete process.env.PROACTIVE_FREQ_SEMANTIC; }

// 驱动真实调度：minuteNow=PREDAWN（窗前·全天 ratio≈1）；无 sleep 行 → useSleepBase=false；
// last_proactive_photo_at=now 压掉 photo 重标（photo 只改 kind 不改 count·设近期只为防噪）。
function runSchedule(target) {
  const c = { id: ++CID, proactive_daily_target: target, affection_level: 30,
              last_proactive_photo_at: Date.now(), last_photo_at: Date.now() };
  return ensureTodaySchedule(c.id, DATE, PREDAWN, START, undefined, c);   // endMinute 默认 = GOODNIGHT_MINUTE
}

console.log('── ③🔴 leaky 修干净（实跑真实 ensureTodaySchedule·坐实真源·30 次稳定）──');
// 闸关：target=0 旧 leaky → 每次恰好 1 条 goodnight（坐实"0 静默"名不副实·真源是 :686 无条件 push）
gate(false);
let offGoodnightRuns = 0, offTotalItems = 0, offAllSingleGoodnight = true;
for (let i = 0; i < 30; i++) {
  const s = runSchedule(0);
  offTotalItems += s.items.length;
  const onlyGN = s.items.length === 1 && s.items[0].kind === 'goodnight';
  if (onlyGN) offGoodnightRuns++; else offAllSingleGoodnight = false;
}
ok(offAllSingleGoodnight && offGoodnightRuns === 30,
   `闸关 target=0 → 30/30 次恰好残留 1 条 goodnight（坐实 leaky·总 items=${offTotalItems}·应 30）`);

// 闸开：target=0 → 早返真零·0 items·无残留 goodnight（修干净）
gate(true);
let onZeroRuns = 0, onTotalItems = 0;
for (let i = 0; i < 30; i++) {
  const s = runSchedule(0);
  onTotalItems += s.items.length;
  if (s.items.length === 0) onZeroRuns++;
}
ok(onZeroRuns === 30 && onTotalItems === 0,
   `闸开 target=0 → 30/30 次 0 items·无残留 goodnight（早返真零·修干净·总 items=${onTotalItems}·应 0）`);

console.log('── ②target 映射：随她(4)≈4 / 少一些(2)≈2（闸开·实跑分布·仍叠 busyFactor）──');
gate(true);
function dist(target, n = 80) {
  let sum = 0, min = Infinity, max = -Infinity, busyDays = 0;
  for (let i = 0; i < n; i++) {
    const len = runSchedule(target).items.length;
    sum += len; min = Math.min(min, len); max = Math.max(max, len);
    if (len <= Math.floor(target * 0.8 * 0.5)) busyDays++;   // 明显低于基线 = busyFactor(×0.35) 命中那天
  }
  return { mean: sum / n, min, max, busyDays, n };
}
const d4 = dist(4), d2 = dist(2);
console.log(`    随她(4): mean=${d4.mean.toFixed(2)} range[${d4.min},${d4.max}] busy命中≈${d4.busyDays}/${d4.n}`);
console.log(`    少一些(2): mean=${d2.mean.toFixed(2)} range[${d2.min},${d2.max}] busy命中≈${d2.busyDays}/${d2.n}`);
ok(d4.mean >= 3 && d4.mean <= 5.2, `随她(4) 均值≈4（在 ±20% 抖动+busyFactor 合理带 3~5.2·实测 ${d4.mean.toFixed(2)}）`);
ok(d2.mean >= 1.3 && d2.mean <= 3, `少一些(2) 均值≈2（实测 ${d2.mean.toFixed(2)}）`);
ok(d4.mean > d2.mean + 0.8, `随她明显多于少一些（${d4.mean.toFixed(2)} > ${d2.mean.toFixed(2)}·非两档同效）`);
ok(d4.busyDays > 0 || d2.busyDays > 0, `busyFactor 仍在叠（观察到明显变少的"她忙自己"日·随她${d4.busyDays}+少一些${d2.busyDays}>0）`);

console.log('── ⑥灰度闸闸关零变更：非零 target 闸关/闸开 count 分布一致（早返只动 target=0）──');
gate(false); const off4 = dist(4, 120);
gate(true);  const on4 = dist(4, 120);
// 同分布（均值差 < 0.6·随机抖动容差）→ 早返不影响 target>0·闸对非零零变更
ok(Math.abs(off4.mean - on4.mean) < 0.6,
   `target=4 闸关 mean=${off4.mean.toFixed(2)} ≈ 闸开 mean=${on4.mean.toFixed(2)}（差<0.6·非零 target 闸不改行为）`);
ok(off4.min >= 1 && on4.min >= 1, `target=4 两路最小都≥1（floor 对非零仍兜·没被早返误伤·off${off4.min}/on${on4.min}）`);

// 清理 /tmp 库（含 WAL/shm）
try {
  const base = process.env.DB_PATH;
  for (const f of [base, base + '-wal', base + '-shm']) { if (fs.existsSync(f)) fs.unlinkSync(f); }
} catch { /* 尽力删 */ }

console.log(`\n${fail === 0 ? '✅' : '🔴'} freq_semantic 后端验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
