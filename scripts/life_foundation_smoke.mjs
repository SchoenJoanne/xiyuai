#!/usr/bin/env node
/**
 * life_foundation_smoke —— 静态生活地基（LIFE_FOUNDATION）坏版本验红（确定性·进 CI）。
 *
 * 核心=「现编→结构上消除」(同 voice 枚举)：城市/学校/职业在 prompt 里确定性恒定·跨对话不变。
 * 7 条全可确定性证（固化是结构性的·非靠 LLM 采样）：①跨对话恒定+关零变更基线 ②协调一致
 * ③不报专名 ④老家避省 ⑤persona注入+确定性底没碰 ⑥🔴identity自适应(选X核心收益) ⑦灰度闸零变更。
 *
 * 🔴 DB_PATH 硬闸：显式非 /tmp→拒；未设→默认 /tmp。跑：DB_PATH=/tmp/lf.db node scripts/life_foundation_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/lf.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/lf_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');

const lf = await import('../src/life_foundation.mjs');
const { CITY_POOL, FIELD_SLOTS, deriveLifeFoundation, extractHometownProvince } = lf;
const { createCompanion } = await import('../src/db.mjs');
const { buildSystemPrompt } = await import('../src/companion.mjs');

// 与 companion.mjs 内联池同步（smoke 锁：改 companion.mjs 池记得改这）
const MAJOR0 = '中文系';   // idx=0 专业
// 6 个 worker 职业整句（自带 venue·与 companion.mjs LIFE_JOB_CLAUSE 同步·锁自然 + 无"公司做护士"穿帮）
const JOB_CLAUSE = ['一家互联网公司做运营', '一家医院当护士', '一所小学当老师', '一家公司做文员', '一家广告公司做设计', '一家奶茶店打工'];

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const baseC = (extra) => ({ name: '小地', age: 26, relationship_stage: '恋人', ...extra });
const lifeLine = (p) => (p.match(/【你的生活】[^\n。]+/) || [''])[0];   // 只取地基这一句（别误命中 prompt 别处的"做/公司"）

console.log('── 🔴 ① 跨对话恒定（命根）+ 关零变更红基线 ──');
process.env.LIFE_FOUNDATION = '1';
const c1 = createCompanion('lf_w_' + process.pid, 'lf_bot', { name: '小地', age: 26 });   // worker(26)
ok(CITY_POOL.includes(c1.home_city), `创建即派生现居城市=「${c1.home_city}」∈ 城市池`);
ok(Number.isInteger(c1.life_field_idx) && c1.life_field_idx >= 0 && c1.life_field_idx < FIELD_SLOTS, `life_field_idx=${c1.life_field_idx} ∈ [0,${FIELD_SLOTS})`);
const p1a = buildSystemPrompt(c1), p1b = buildSystemPrompt(c1);
const cityOf = (p) => (p.match(/你住在(.+?)，/) || [])[1] || null;
ok(cityOf(p1a) === c1.home_city && cityOf(p1a) === cityOf(p1b), `🔴 多次构造 prompt 城市恒定=「${cityOf(p1a)}」(读存字段·非现编)`);
// 红基线：关修复 → 根本没【你的生活】行 = 无城市锚（LLM 只能现编=旧坏行为）
delete process.env.LIFE_FOUNDATION;
ok(!buildSystemPrompt(c1).includes('【你的生活】'), '🔴 闸关：无【你的生活】行=无城市锚（旧版"每次现编"红基线）');

console.log('── ② 协调一致（身份单源派生·杜绝"学生却有公司"）──');
process.env.LIFE_FOUNDATION = '1';
const pw = buildSystemPrompt(baseC({ home_city: '成都', life_district: '城西', life_field_idx: 0, life_identity: 'worker' }));
const ps = buildSystemPrompt(baseC({ home_city: '成都', life_district: '城西', life_field_idx: 0, life_identity: 'college' }));
ok(pw.includes(JOB_CLAUSE[0]) && !pw.includes('一所大学'), `worker → "${JOB_CLAUSE[0]}"（venue 整句·不出大学）`);
ok(ps.includes('一所大学读') && !lifeLine(ps).includes('做'), `college → "一所大学读${MAJOR0}"（地基句不出职业"做"）`);

console.log('── 🔴 ②b venue 整句：每职业出对的 venue·护士/店员不再"一家公司做X"（本次修穿帮目标）──');
for (let i = 0; i < JOB_CLAUSE.length; i++) {
  const pv = buildSystemPrompt(baseC({ home_city: '杭州', life_district: '城东', life_field_idx: i, life_identity: 'worker' }));
  ok(pv.includes(`在杭州城东${JOB_CLAUSE[i]}`), `idx${i} worker → "…${JOB_CLAUSE[i]}"（venue 对·自然）`);
}
{
  const pn = buildSystemPrompt(baseC({ home_city: '杭州', life_district: '城东', life_field_idx: 1, life_identity: 'worker' }));
  ok(pn.includes('一家医院当护士') && !pn.includes('公司做护士') && !pn.includes('公司当护士'), '🔴 护士 → "一家医院当护士"·绝不出"公司做护士"（LIVE 穿帮修掉）');
  const pt = buildSystemPrompt(baseC({ home_city: '杭州', life_district: '城东', life_field_idx: 5, life_identity: 'worker' }));
  ok(pt.includes('一家奶茶店打工') && !lifeLine(pt).includes('公司'), '🔴 奶茶店店员 → "一家奶茶店打工"·地基句不出"公司"');
}

console.log('── ③ 不报专名（城市通名/大学类型/职业类型·无真校名公司名）──');
ok(CITY_POOL.every(c => !/大学|学院|公司|腾讯|阿里/.test(c)), '城市池全是城市通名（无校名/公司名）');
ok(ps.includes('一所大学') && !ps.includes('浙江大学'), '学生 prompt="一所大学读X系" 非真校名');
ok(JOB_CLAUSE.every(j => !/腾讯|阿里|字节|华为|美团/.test(j)), '职业整句无真公司名（只行业通名:互联网公司/医院/小学/广告公司/奶茶店）');

console.log('── ④ 老家 vs 现居不冲突（现居避开老家省·离家质感）──');
ok(extractHometownProvince([{ category: 'family', content: '老家在浙江一个小镇，爷爷奶奶住老房子' }]) === '浙江', 'extractHometownProvince 抽出老家省=浙江');
ok(extractHometownProvince([{ category: 'school', content: '小学在班里当过班长' }]) === null, '无老家线索 → null（不乱抽）');
{
  // 杭州是池内唯一浙江城市 → 避开浙江后绝不出杭州
  let hitHangzhou = false, allAvoid = true;
  for (let id = 1; id <= 40; id++) {
    const r = deriveLifeFoundation({ id }, { avoidProvince: '浙江' });
    if (r.home_city === '杭州') hitHangzhou = true;
    // 城市池里浙江系只有杭州，避开后 home_city 必非杭州
  }
  ok(!hitHangzhou, '🔴 avoidProvince=浙江 → 40 个 id 派生现居无一是杭州（避开老家省）');
  void allAvoid;
}

console.log('── ⑤ persona 注入 + 确定性底没碰 ──');
const p5 = buildSystemPrompt(baseC({ home_city: '南京', life_district: '城东', life_field_idx: 1, life_identity: 'college' }));
ok(p5.includes('【你的生活】你住在南京'), 'home_city 进【你的生活】·她聊天知道住哪');
ok(p5.includes('绝不自称 AI / 作为 AI / 语言模型'), '确定性底"人设 AI 口径"仍在（没被碰·07-15 合规⑥软化后新锚·persona_hardening:69 同源）');
ok(p5.includes('别每次换地方'), 'prompt 含"别每次换地方"恒定指令');

console.log('── 🔴 ⑥ identity 自适应（选 X 非 Y 的核心收益·必须证）──');
const cAdapt = baseC({ home_city: '武汉', life_district: '城南', life_field_idx: 0, life_identity: 'college' });
const before = buildSystemPrompt(cAdapt);
cAdapt.life_identity = 'worker';   // 改身份 student → worker（idx 不变=0）
const after = buildSystemPrompt(cAdapt);
ok(before.includes(`一所大学读${MAJOR0}`), `改前(college)="一所大学读${MAJOR0}"`);
ok(after.includes(JOB_CLAUSE[0]) && !after.includes(MAJOR0), `🔴 改后(worker)自适应="${JOB_CLAUSE[0]}"·不留旧"${MAJOR0}"措辞（venue 整句下防漂移仍生效）`);
// idx 没串位复核（venue 整句关键）：idx=1 college读会计 ↔ worker一家医院当护士（两池同 idx 严格对齐）
const cA1 = baseC({ home_city: '武汉', life_district: '城南', life_field_idx: 1, life_identity: 'college' });
const b1 = buildSystemPrompt(cA1); cA1.life_identity = 'worker'; const a1 = buildSystemPrompt(cA1);
ok(b1.includes('读会计') && a1.includes('一家医院当护士') && !a1.includes('会计'), '🔴 idx1：college读会计 ↔ worker一家医院当护士·idx 没串位（venue 整句未打乱两池对齐）');

console.log('── ⑦ 灰度闸零变更（关→home_city 即便有也不出地基行=字节一致）──');
delete process.env.LIFE_FOUNDATION;
const off = buildSystemPrompt(baseC({ home_city: '西安', life_district: '城西', life_field_idx: 2, life_identity: 'worker' }));
ok(!off.includes('【你的生活】') && !off.includes('你住在西安'), '🔴 闸关：有 home_city 也不注入地基行（零变更先验）');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} life_foundation 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
