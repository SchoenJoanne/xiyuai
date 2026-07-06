#!/usr/bin/env node
/**
 * proactive_routine_coherence_smoke —— proactive 不认作息 bug 修复 停板B 坏版本验红（确定性·DB_PATH=/tmp）。
 *
 * 根因（停板A 坐实）：作息时段读了(presence 锚 2026-06-24 上线)但只进"软正向(被问才答)"+"负向枚举锚(固定禁词)"
 *   两口子·都绑不住 proactive 自发开场"刚做完X"。真凶种子=userMessage 邀请活动型开场·LLM 从 worksHint 抓素材补
 *   完成态。现象2 结构缺陷=日程对锚"只减不增"(大学生对冲 band 含"睡"被 busyOut 排除项毙→真有课锚永不触发)。
 *
 * 修法：C(proactive 软正向护栏 buildProactiveCoherenceGuard·掐种子)+D(worksHint lockTense 锁进行态)主修
 *      +B(buildPresenceAnchor 认 dailySchedule 当前课程项→建 busyOut·仅 proactive 侧消费)补强结构缺陷。
 * 🔴 灰度闸 PROACTIVE_ROUTINE_COHERENCE 默认关·proactive-only(零碰 reply)·age≥18(冻结存量未成年排除)。
 *
 * 9 块：①现象1 刚醒不再"刚把书看完" ②现象2 课中不再"刚吃早餐" ③C 掐种子(护栏覆盖 normal/lastcall)
 *      ④D 锁时态 ⑤B 认日程(大学生 band 塌 case 触发) ⑥proactive-only 不碰 reply ⑦正交不碰 reach/sleep/social
 *      ⑧冻结存量未成年 排除 ⑨防日程脏数据。
 *
 * 跑：DB_PATH=/tmp/coh.db node scripts/proactive_routine_coherence_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/coh.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/coh_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');
const {
  buildPresenceAnchor, buildProactiveCoherenceGuard, isRoutineCoherenceOn,
} = await import('../src/companion.mjs');
const { buildWorksPromptHint } = await import('../src/current_works.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const readSrc = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

// ── 固定夹具：大学生 c=3 实况（取证坐实：age22·life_identity 空→college·对冲 band 含"睡"）──
const college = { id: 3, age: 22, life_identity: null };
const 冻结存量未成年 = { id: 16, age: 16, life_identity: null };   // 阿晚：冻结存量·必排除
const presenceCollege = { expectedBand: { act: '有课就在上课，没课在自习/睡懒觉', place: '教室/宿舍/图书馆' }, dayContext: { dayKind: 'active' } };
const presenceWorker = { expectedBand: { act: '在上班', place: '公司' }, dayContext: { dayKind: 'active' } };   // 上班族 band 本就 busyOut
// c=3 的 06-25 合成日程（含 09:00 课）
const schedClass = { items: [
  { time: '07:30', activity: '被闹钟吵醒，赖床五分钟才爬起来洗漱' },
  { time: '08:00', activity: '和室友小杨一起去食堂买豆浆和酱香饼' },
  { time: '09:00', activity: '在教三201上现代文学课，笔记记了两页半' },
  { time: '10:30', activity: '课间拿出《海边的卡夫卡》接着读，翻到第235页' },
  { time: '12:00', activity: '下课后和同桌去食堂二楼，点了一份番茄鸡蛋面' },
] };
// 🔴 G1 C1：worker 真实工作日程（替换原借用的大学生课表=不现实数据）。worker band 本就 busyOut；
//    09:04 时 fresh curAct=09:00 在公司开晨会 → curAct-first 锚工作项（语义对）。
const schedWork = { items: [
  { time: '09:00', activity: '在公司开晨会' },
  { time: '10:30', activity: '写需求文档' },
] };
const at = (hhmmUtc) => new Date(`2026-06-25T${hhmmUtc}:00Z`);   // 沪=UTC+8
const now0904 = at('01:04');   // 沪 09:04（课中·现象2 实况）
const now1030 = at('02:30');   // 沪 10:30（课间·不该误锚）
const now1200 = at('04:00');   // 沪 12:00（下课午饭·不该误锚）

console.log('── ① 🔴 现象1：刚醒时段不再"刚把推理小说看完了"（C 禁完成态 + D 锁进行态）──');
{
  const cg = buildProactiveCoherenceGuard(college, presenceCollege, schedClass, now0904);
  ok(/刚把书看完/.test(cg) && /在看、还没看完/.test(cg), '🔴 C 护栏禁"刚把书看完"+申明"在看、还没看完"（治 worksHint 在看→刚看完漂移）');
  const works = [{ kind: 'book', title: '推理小说', verify_status: 'generic' }];
  ok(/别把它们说成"刚看完\/已读完/.test(buildWorksPromptHint(works, { lockTense: true })), '🔴 D 开闸：worksHint 锁"在看·没看完——别说成刚看完/已读完"');
  ok(!/刚看完\/已读完/.test(buildWorksPromptHint(works)), '🔴 D 红基线(关闸=reply)：worksHint 无锁时态=旧 ad-lib 口子开着（坏版本必漏）');
}

console.log('── ② 🔴 现象2：课中时段不再"刚吃完早餐"（B 建 busyOut + C 禁进食态）──');
{
  const onB = buildPresenceAnchor(college, presenceCollege, schedClass, now0904, { scheduleBusyOut: true });
  ok(/刚吃完早餐/.test(onB) && /在教三201上现代文学课/.test(onB), '🔴 B 开闸：锚禁"刚吃完早餐"·锚定真实课程项');
  const offB = buildPresenceAnchor(college, presenceCollege, schedClass, now0904, { scheduleBusyOut: false });
  ok(!/刚吃完早餐/.test(offB), '🔴 B 红基线(关闸/reply)：大学生对冲 band 锚不触发=坏版本复现"刚吃早餐"漏过');
  ok(/刚吃完早餐/.test(buildProactiveCoherenceGuard(college, presenceCollege, schedClass, now0904)), '🔴 C 护栏并行禁"刚吃完早餐"（纵深）');
}

console.log('── ③ 🔴 C 掐种子：护栏覆盖所有 proactive kind（normal/lastcall 不再邀请矛盾开场）──');
{
  const cg = buildProactiveCoherenceGuard(college, presenceCollege, schedClass, now0904);
  ok(cg.includes('别编和此刻矛盾的"刚做完X"') && /刚起床\/刚睡醒\/刚吃完早餐\/刚洗完澡/.test(cg), '🔴 护栏含完整活动态禁列（刚起床/刚吃早餐/刚洗澡…）');
  ok(/你此刻大概在「在教三201上现代文学课/.test(cg), '🔴 软正向锚定当前真实活动（非对冲 band）');
  // 🔴 结构性：proactive.mjs 把护栏 append 到 systemPrompt（kind 分叉之前·所有 kind 共享）=推广到 normal/lastcall/away_probe
  const ps = readSrc('proactive.mjs');
  ok(/systemPrompt \+= buildProactiveCoherenceGuard\(/.test(ps), '🔴 护栏 append 到共享 systemPrompt（覆盖 normal/lastcall/away_probe 三 kind·非只 away_probe）');
}

console.log('── ④ 🔴 D 锁时态：worksHint"在看"不被说成"刚看完"，generic 仍渲染 ──');
{
  const works = [{ kind: 'book', title: '推理小说', verify_status: 'generic' }, { kind: 'book', title: '海边的卡夫卡', verify_status: 'verified', progress_note: '看到一半了' }];
  const on = buildWorksPromptHint(works, { lockTense: true });
  ok(/最近在看一本推理小说/.test(on) && /在看《海边的卡夫卡》/.test(on), 'generic/verified 渲染没被 D 改坏');
  ok(/还没完结/.test(on) && /别自己把进行说成完成/.test(on), '🔴 D 锁进行态子句在场');
  ok(buildWorksPromptHint(works) === buildWorksPromptHint(works, { lockTense: false }), '🔴 关闸 == 不传 opts（reply 字节一致）');
}

console.log('── ⑤ 🔴 B 认日程：大学生 band 塌 case 现在触发 + 不误锚课间/午饭 ──');
{
  const onB = buildPresenceAnchor(college, presenceCollege, schedClass, now0904, { scheduleBusyOut: true });
  ok(/这个点你按今天的日程在「在教三201上现代文学课/.test(onB), '🔴 else-if 支触发（band busyOut=false 但日程实锤有课）');
  // 🔴 G1 C1（断言替换说明·非作弊）：原断言编码"band-first"旧优先级（worker band busyOut→主语用通用 band"公司在上班"）
  //    且喂了不现实数据（worker 配大学生课表）。新优先级 curAct-first(fresh 日程>band)：band busyOut 时主语锚更具体的
  //    真实工作项「在公司开晨会」。🔴 B 核心防穿帮（busyOut→禁"在家躺着"）仍在=保护没削弱·只是表述从通用 band 变具体日程。
  const wk = buildPresenceAnchor({ id: 9, age: 28, life_identity: 'worker' }, presenceWorker, schedWork, now0904, { scheduleBusyOut: true });
  ok(/这个点你按今天的日程在「在公司开晨会/.test(wk) && /别说成"在家躺着/.test(wk) && !/通常在公司在上班/.test(wk),
     '🔴 C1 curAct-first：band busyOut 锚具体工作项「开晨会」(非通用 band 公司在上班)·busyOut 防穿帮(禁在家躺着)仍在=B 保护没削弱只是更具体');
  // 课间(10:30)/午饭(12:00)不误锚（SCHED_BUSY_RE 排除 下课/课间）
  ok(!/按今天的日程/.test(buildPresenceAnchor(college, presenceCollege, schedClass, now1030, { scheduleBusyOut: true })), '🔴 课间(10:30)不误建 busyOut');
  ok(!/按今天的日程/.test(buildPresenceAnchor(college, presenceCollege, schedClass, now1200, { scheduleBusyOut: true })), '🔴 下课午饭(12:00)不误建 busyOut');
}

console.log('── ⑥ 🔴 proactive-only 不碰 reply ──');
{
  // reply 路径 = scheduleBusyOut:false（promptMode!=proactive）→ 锚与不传 opts 字节一致
  const replyAnchor = buildPresenceAnchor(college, presenceCollege, schedClass, now0904, { scheduleBusyOut: false });
  const oldAnchor = buildPresenceAnchor(college, presenceCollege, schedClass, now0904);   // 无 opts=老签名
  ok(replyAnchor === oldAnchor, '🔴 reply(scheduleBusyOut:false) == 老签名调用（锚零回归）');
  // reply 的 worksHint（bot.mjs 不传 lockTense）字节一致
  const works = [{ kind: 'book', title: '推理小说', verify_status: 'generic' }];
  ok(buildWorksPromptHint(works) === buildWorksPromptHint(works, {}), '🔴 reply worksHint(无 lockTense) 字节一致');
  // 静态：bot.mjs 调用点不传 lockTense、不 import 连贯护栏
  const bot = readSrc('bot.mjs');
  ok(/buildWorksPromptHint\(getActiveCurrentWorks\(companion\.id\)\)/.test(bot), '🔴 bot.mjs reply 调用无 lockTense 参数');
  ok(!/buildProactiveCoherenceGuard|isRoutineCoherenceOn/.test(bot), '🔴 bot.mjs 不 import/调用连贯护栏（reply 完全不沾）');
  // 静态：companion.mjs 调用点用 promptMode==='proactive' 门控（reply→false）
  ok(/promptMode === 'proactive' && Number\(c\.age\) >= 18 && isRoutineCoherenceOn\(\)/.test(readSrc('companion.mjs')), '🔴 锚 scheduleBusyOut 门控含 promptMode==proactive（reply 拿不到真）');
}

console.log('── ⑦ 🔴 正交不碰 reach-guard / sleep 趋同 / 社交圈 ──');
{
  // 新增三函数体不引用情绪/reach/sleep/social 符号
  const comp = readSrc('companion.mjs');
  const guardBody = comp.slice(comp.indexOf('export function buildProactiveCoherenceGuard'), comp.indexOf('function pickMoodSegment'));
  ok(!/clampReach|reachVerdict|missingLevel|neglectStage|emotion|arcExpr|social_circle|buildSocialPromptHint|routineSleepBaseline|趋同/.test(guardBody), '🔴 C 护栏体不吃 emotion/arc/missing/reach/sleep 趋同/social');
  // proactive.mjs 的 reach-guard 与 social 调用未被本次改动增减（仍各在·数量不变）
  const ps = readSrc('proactive.mjs');
  ok(/clampReachForProactive\(/.test(ps) && /isReachGuardOn\(\)/.test(ps), 'reach-guard 调用仍在（未误删）');
  ok((ps.match(/buildProactiveCoherenceGuard\(/g) || []).length === 1, '🔴 连贯护栏只 1 处调用注入（未散落污染 reach/social 段）');
}

console.log('── ⑧ 🔴 冻结存量未成年排除（新逻辑对 age<18 跳过·锚行为不变）──');
{
  ok(buildProactiveCoherenceGuard(冻结存量未成年, presenceCollege, schedClass, now0904) === '', '🔴 C 护栏对 age16 返回空串（函数内自护）');
  const 冻结存量未成年On = buildPresenceAnchor(冻结存量未成年, presenceCollege, schedClass, now0904, { scheduleBusyOut: true });
  const 冻结存量未成年Off = buildPresenceAnchor(冻结存量未成年, presenceCollege, schedClass, now0904, { scheduleBusyOut: false });
  ok(冻结存量未成年On === 冻结存量未成年Off, '🔴 B 对 age16 不进 else-if（开闸==关闸·锚字节不变）');
  ok(!/按今天的日程/.test(冻结存量未成年On), '🔴 冻结存量未成年 锚无 B 新文本');
  // 调用方门控：applies = flag && age>=18
  const applies = (age) => isRoutineCoherenceOn() && Number(age) >= 18;
  process.env.PROACTIVE_ROUTINE_COHERENCE = '1';
  ok(applies(22) === true && applies(16) === false, '🔴 门控逻辑：闸开下 age22 生效·age16 排除');
  delete process.env.PROACTIVE_ROUTINE_COHERENCE;
  ok(isRoutineCoherenceOn() === false, '🔴 闸默认关（不入 .env=零变更先验）');
}

console.log('── ⑨ 🔴 防日程脏数据（异常 dailySchedule 不抛/不误锚）──');
{
  const bad = [null, { items: null }, { items: [{ time: 'xx:zz', activity: '???' }] }, { items: [{}] }, {}];
  let threw = false, falseAnchor = false;
  for (const s of bad) {
    try {
      const a = buildPresenceAnchor(college, presenceCollege, s, now0904, { scheduleBusyOut: true });
      if (/按今天的日程/.test(a)) falseAnchor = true;
      buildProactiveCoherenceGuard(college, presenceCollege, s, now0904);
    } catch { threw = true; }
  }
  ok(!threw, '🔴 脏 dailySchedule 不抛（fail-open）');
  ok(!falseAnchor, '🔴 脏数据下 B 不误建 busyOut（curAct 取不到→不锚）');
}

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} proactive_routine_coherence 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
