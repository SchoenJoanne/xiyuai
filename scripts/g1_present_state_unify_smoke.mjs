#!/usr/bin/env node
/**
 * g1_present_state_unify_smoke —— G1 逻辑 bug 修复 坏版本验红（确定性·DB_PATH=/tmp）。
 *
 * G1：同一条 proactive prompt 自相矛盾——presence 锚②主语取 band(图书馆)、coherence guard 取 curAct 优先(食堂)。
 *   双因：(a) 两源优先级相反；(b) currentScheduleActivity 只取 time≤now 不判结束→12:00 食堂@15:39 仍当此刻。
 * 修(C1·GPT 原则2 单源)：抽 resolveWhereNow(curAct-first·fresh 日程>band·含过期窗)·presence②主语 + coherence 都从它取。
 *   过期窗 SCHEDULE_FRESH_WINDOW_MIN=120（留 fresh 课/≤2h 块·毙 3.5h 前午饭·14:00在家@16:00=120 边界 inclusive 保留）。
 *
 * 8 块：①G1 复现+根除(两源一致) ②过期窗 120 边界 ③B 不回归(改测试后·防穿帮没削弱只更具体) ④C 不回归 ⑤D 不回归
 *      ⑥reply 不碰主体(band 锚不变去 stale 括号·fresh 时主语变具体=改善) ⑦冻结存量未成年 排除 ⑧闸关零变更。
 *
 * 跑：DB_PATH=/tmp/g1.db node scripts/g1_present_state_unify_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/g1.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/g1_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');
const { buildPresenceAnchor, buildProactiveCoherenceGuard, resolveWhereNow, isRoutineCoherenceOn } = await import('../src/companion.mjs');
const { buildWorksPromptHint } = await import('../src/current_works.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// ── 夹具 ──
const bandLib    = { expectedBand: { act: '上自习', place: '图书馆' }, dayContext: { dayKind: 'active' } };   // busyOut
const bandCollege = { expectedBand: { act: '有课就在上课，没课在自习/睡懒觉', place: '教室/宿舍/图书馆' }, dayContext: { dayKind: 'active' } }; // 含"睡"=非 busyOut（现象2 band 塌）
const bandWorker = { expectedBand: { act: '在上班', place: '公司' }, dayContext: { dayKind: 'active' } };   // busyOut
const schedLunch = { items: [{ time: '12:00', activity: '食堂吃午饭' }] };
const schedClass = { items: [{ time: '09:00', activity: '在教三201上现代文学课，笔记记了两页半' }, { time: '10:30', activity: '课间读《海边的卡夫卡》' }] };
const schedWork  = { items: [{ time: '09:00', activity: '在公司开晨会' }] };
const schedCafe  = { items: [{ time: '15:00', activity: '在咖啡馆见朋友' }] };
const schedHome  = { items: [{ time: '14:00', activity: '在家休息' }] };
const at = (utc) => new Date(`2026-06-28T${utc}:00Z`);   // 沪=UTC+8
const T1539 = at('07:39');   // 沪 15:39（nowMin=939·食堂 12:00 已过 219min）
const T0904 = at('01:04');   // 沪 09:04（课中·现象2）

console.log('── ① 🔴 G1 复现 + 根除（两源对"此刻在哪"一致）──');
{
  // 红基线机制：同一食堂项·fresh(12:30) 会显示·stale(15:39) 过期 → 证 (b) 是 stale 在作祟
  ok(resolveWhereNow(schedLunch, bandLib, 750).curAct === '食堂吃午饭', '红基线：12:00 食堂@12:30(30min fresh)→curAct=食堂（不过期就会当此刻=旧 coherence 取它）');
  ok(resolveWhereNow(schedLunch, bandLib, 939).curAct === null, '🔴 根除(b)：12:00 食堂@15:39(219min)→curAct=null（过期·不再当此刻）');
  const pres = buildPresenceAnchor({ age: 22 }, bandLib, schedLunch, T1539, { scheduleBusyOut: true });
  const coh  = buildProactiveCoherenceGuard({ age: 22 }, bandLib, schedLunch, T1539);
  ok(/图书馆/.test(pres) && !/食堂/.test(pres), '🔴 修后 presence 主语=图书馆(band)·无"食堂"');
  ok(/图书馆/.test(coh)  && !/食堂/.test(coh),  '🔴 修后 coherence 主语=图书馆(band)·无"食堂"');
  ok(/图书馆/.test(pres) && /图书馆/.test(coh), '🔴 根除(a)：presence 与 coherence "此刻在哪"主语一致（都图书馆·修前=图书馆 vs 食堂矛盾）');
}

console.log('── ② 🔴 过期窗 SCHEDULE_FRESH_WINDOW_MIN=120 边界 ──');
{
  ok(resolveWhereNow(schedClass, bandCollege, 600).curAct?.includes('现代文学课'), '🔴 09:00 课@10:00(60min)→保留（fresh 课不被毙=不回归 B）');
  ok(resolveWhereNow(schedHome, bandLib, 960).curAct === '在家休息', '🔴 14:00 在家@16:00(120min 边界 inclusive)→保留（instant_state:36 schedSaysHome 依赖）');
  const oneAt13 = { items: [{ time: '13:00', activity: '某事' }] };
  ok(resolveWhereNow(oneAt13, bandLib, 900).curAct === '某事' && resolveWhereNow(oneAt13, bandLib, 901).curAct === null, '🔴 边界钉死：120min 保留 / 121min 过期');
}

console.log('── ③ 🔴 B 不回归（改测试后·防穿帮没削弱·只表述更具体）──');
{
  const wk = buildPresenceAnchor({ id: 9, age: 28, life_identity: 'worker' }, bandWorker, schedWork, T0904, { scheduleBusyOut: true });
  ok(/按今天的日程在「在公司开晨会/.test(wk) && /别说成"在家躺着/.test(wk) && !/通常在公司在上班/.test(wk),
     '🔴 worker band busyOut + fresh 工作项 → 锚具体工作项「开晨会」(非通用 band)·busyOut 防穿帮(禁在家躺着)仍在=B 保护没削弱');
  const cl = buildPresenceAnchor({ id: 3, age: 22 }, bandCollege, schedClass, T0904, { scheduleBusyOut: true });
  ok(/按今天的日程在「在教三201上现代文学课/.test(cl) && /刚吃完早餐/.test(cl), '🔴 现象2：大学生 band 塌但 fresh 课 → else-if 建 busyOut·禁"刚吃完早餐"');
  const clOff = buildPresenceAnchor({ id: 3, age: 22 }, bandCollege, schedClass, T0904, { scheduleBusyOut: false });
  ok(!/刚吃完早餐/.test(clOff), '🔴 B 红基线(闸关/reply)：band 塌→不建 busyOut（坏版本复现）');
}

console.log('── ④ 🔴 C 不回归 ──');
{
  const cg = buildProactiveCoherenceGuard({ id: 3, age: 22 }, bandCollege, schedClass, T0904);
  ok(/你此刻大概在「在教三201上现代文学课/.test(cg), '🔴 C posLine 软正向锚真实课程项');
  ok(cg.includes('别编和此刻矛盾的"刚做完X"') && /刚吃完早餐/.test(cg), '🔴 C 仍禁"刚做完X"(含刚吃早餐)');
}

console.log('── ⑤ 🔴 D 不回归（独立未动）──');
{
  const works = [{ kind: 'book', title: '推理小说', verify_status: 'generic' }];
  ok(/别把它们说成"刚看完\/已读完/.test(buildWorksPromptHint(works, { lockTense: true })), '🔴 D worksHint lockTense 仍禁"刚看完/已读完"');
  ok(buildWorksPromptHint(works) === buildWorksPromptHint(works, {}), '🔴 D reply(无 lockTense) 字节一致');
}

console.log('── ⑥ 🔴 reply 不碰主体（band 锚不变去 stale 括号·fresh 时主语变具体=改善）──');
{
  // reply = scheduleBusyOut:false（promptMode!=proactive）。G1 stale 食堂 → 主语回退 band 图书馆·去掉过期"（日程：食堂）"括号
  const replyStale = buildPresenceAnchor({ age: 22 }, bandLib, schedLunch, T1539, { scheduleBusyOut: false });
  ok(/通常在图书馆上自习/.test(replyStale) && !/食堂/.test(replyStale) && !/（日程：/.test(replyStale), '🔴 reply 主体：band 锚不变(通常在图书馆上自习)·去掉过期食堂 stale 括号');
  ok(/别说成"在家躺着/.test(replyStale), '🔴 reply busyOut 防穿帮仍在');
  // fresh 异于 band → reply 主语 curAct-first 变具体（咖啡馆）=改善非回归（真实日程>通用 band·reply 也吃 presence）
  const replyFresh = buildPresenceAnchor({ age: 22 }, bandLib, schedCafe, T1539, { scheduleBusyOut: false });
  ok(/在咖啡馆见朋友/.test(replyFresh), '🔴 reply 主语变具体(咖啡馆·curAct-first)=改善非回归');
}

console.log('── ⑦ 🔴 冻结存量未成年 排除 ──');
{
  ok(buildProactiveCoherenceGuard({ id: 16, age: 16 }, bandCollege, schedClass, T0904) === '', '🔴 coherence(age16)=空串（函数内自护）');
  const 冻结存量未成年On = buildPresenceAnchor({ id: 16, age: 16 }, bandCollege, schedClass, T0904, { scheduleBusyOut: true });
  ok(!/按今天的日程/.test(冻结存量未成年On), '🔴 presence scheduleBusyOut(age16)→不进 else-if（无 B 文本）');
}

console.log('── ⑧ 🔴 闸关零变更 ──');
{
  delete process.env.PROACTIVE_ROUTINE_COHERENCE;
  ok(isRoutineCoherenceOn() === false, '🔴 闸默认关（未设=零变更先验·coherence 由 proactive.mjs gate 不注入）');
}

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} g1_present_state_unify 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
