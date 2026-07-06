#!/usr/bin/env node
/**
 * self_facts_scope_self_leak_smoke —— 元认知 P1(scope=self 泄漏)修复 坏版本验红（确定性·DB_PATH=/tmp）。
 *
 * P1：从 user_character_seed 生成她人生内核时，本该剥离的关系词(前女友/一起上学/我们)经 kept=整段
 *   persona_prompt 原文回注 prompt(标签"已去噪"名实不符)，出口两道兜底齐漏(scope_self 要 user-directed
 *   与关系词共现 / guardGeneratedText 禁词表缺 女友/前女友/老婆 等 8 词)。scope=self 从确定性降级成 LLM 概率。
 *
 * 修(方案A·只改确定性脚手架·不动 prompt 措辞)：
 *   A1' denoiseKept 句级去噪(关系句整句丢弃 + 后置零命中断言·宁误删不残留) → 关系词不进 prompt body；
 *   A2 guardGeneratedText 关系禁词收【单一来源】REL_FORBIDDEN_WORDS(补全 8 词)·「在一起」挪条件判定防误伤；
 *   A3(+补丁) decideFallback：mixed_noise 且抽取全空 且 collectSeedPoints 空 → safe_default(防误删 probe4)；
 *   A4 collectSeedPoints 去 personality/pp_trait 同 trait 双发；A5 relationship_seed.raw 子串去重。
 *
 * 🔴 红基线：本 smoke 在【旧版本】必失败(旧 kept=原文带关系词→①②失败；旧 guard 缺 前女友→②④失败；旧无 A3→③失败)。
 *   验证方式见对应 PR：git stash 改动后跑本 smoke 应 🔴 红。
 *
 * 跑：DB_PATH=/tmp/sf.db node scripts/self_facts_scope_self_leak_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/sf.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/sf_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const {
  processSeedInput, guardGeneratedText, collectSeedPoints, decideFallback,
  denoiseKept, validateGeneratedCharacter,
} = await import('../src/character_seed.mjs');
const { generateSelfFacts } = await import('../src/ai.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// 关系词全集(断言"零命中"用)·与 02_self_facts.md 实测泄漏 case 对齐
const REL_PROBE = ['青梅竹马', '同校', '同班', '一起上学', '前任', '前男友', '前女友', '老婆', '人妻', '女友', '女朋友', '男友', '同居', '网恋', '在一起', '我们', '对我', '和我'];
const keptOf = (c) => processSeedInput(c).user_character_seed.persona_prompt_extracted.kept;
const hasAnyRel = (s) => REL_PROBE.some((t) => String(s).includes(t));

console.log('── ① 🔴 复现泄漏红基线 + 双层防（A1\' 入口 + A2 出口）──');
{
  const seed = { name: '星禾', personality_tags: ['温柔'], persona_prompt: '我们从小一起上学，是青梅竹马，她一直对我很好，和你在一起很安心' };
  const kept = keptOf(seed);
  ok(!hasAnyRel(kept), `A1' 入口：kept 零关系命中（实测 kept=${JSON.stringify(kept)}）← 旧版本 kept=整段原文必含关系词=红`);
  // 出口：若 LLM 仍吐含关系词结果 → guard 必拦(双层防)
  ok(guardGeneratedText({ inner_summary: '她和你是前女友' }).length > 0, 'A2 出口：含「前女友」结果被 guard 拦（旧 guard 缺此词=漏=红）');
  ok(guardGeneratedText({ x: '青梅竹马一起上学' }).length > 0, 'A2 出口：含「青梅竹马/一起上学」被拦');
}

console.log('── ② 🔴 leak probe 全过（设计稿实测泄漏 case 修后全不泄漏）──');
{
  // 无 user-directed 标记的关系词(前女友离开后…)——旧出口 scope_self 要共现→漏；A2 无条件禁词补上
  ok(guardGeneratedText('前女友离开后她变得慢热').length > 0, '无 user-directed 标记「前女友」→ A2 无条件禁词拦住（旧两表齐漏=红）');
  for (const w of ['老婆', '人妻', '男友', '前男友', '网恋', '女友']) {
    ok(guardGeneratedText(`提到${w}`).length > 0, `A2 补表词「${w}」被拦`);
  }
  // 入口：含这些词的脏 seed → kept 全清
  for (const w of ['前女友', '一起上学', '同居', '网恋']) {
    ok(!hasAnyRel(keptOf({ personality_tags: ['温柔'], persona_prompt: `我和你${w}的事` })), `入口去噪：含「${w}」脏 seed → kept 零关系命中`);
  }
}

console.log('── ③ 🔴 A3 不误删合法信号（probe4 不 fire / 真全空才 safe_default·矩阵）──');
{
  // probe4：结构化字段填了 + 自由文本写噪声 → 不该 safe_default(保留 3 个结构化点)
  const p4 = processSeedInput({ personality_tags: ['温柔', '活泼'], hobbies: ['画画'], persona_prompt: 'asdf 哈哈哈哈哈 6666' });
  ok(p4.seed_processing.fallback_decision !== 'safe_default', '🔴 probe4 fallback ≠ safe_default（旧字面 A3 会误删=红）');
  const sp = collectSeedPoints(p4.user_character_seed);
  ok(['personality:温柔', 'personality:活泼', 'hobby:画画'].every((p) => sp.includes(p)), '🔴 probe4 三个结构化 seed point 一个不丢');
  // 真全空：无结构化 + 自由文本纯噪声 → safe_default(本地兜底·不进 LLM)
  ok(processSeedInput({ persona_prompt: 'asdf 哈哈哈哈哈 6666' }).seed_processing.fallback_decision === 'safe_default', '🔴 真全空 → safe_default（堵零约束生成+成本空转）');
  // 矩阵：mixed_noise 抽取全空但有结构化 → none；抽取非空 → none
  ok(decideFallback({ validity: { persona_prompt: 'mixed_noise' }, extractAllEmpty: true, hasStructuredSeed: true }) === 'none', '矩阵 C4：抽空+有结构化 → none');
  ok(decideFallback({ validity: { persona_prompt: 'mixed_noise' }, extractAllEmpty: true, hasStructuredSeed: false }) === 'safe_default', '矩阵 C5：抽空+无结构化 → safe_default');
  ok(decideFallback({ validity: { persona_prompt: 'mixed_noise' }, extractAllEmpty: false, hasStructuredSeed: false }) === 'none', '矩阵：抽非空 → none(有信号)');
}

console.log('── ④ 🔴 scope=self 恢复确定性（入口确定性 strip + 出口确定性 catch·非 LLM 概率）──');
{
  // 入口：同一脏 seed 反复跑 → kept 恒零关系命中(确定性·不靠 LLM 概率)
  const dirty = { personality_tags: ['慢热'], persona_prompt: '我们是前女友，一起上学过，她对我很好' };
  ok([keptOf(dirty), keptOf(dirty), keptOf(dirty)].every((k) => !hasAnyRel(k)), '入口确定性：脏 seed 反复跑 kept 恒零关系命中');
  // 出口：validator scope_self 共现 + guard 无条件 双保险
  const leakGen = { character_core: { inner_summary: '我们是前女友', formative_chain: 'x' }, seed_alignment: [] };
  const viol = [...guardGeneratedText(leakGen), ...validateGeneratedCharacter(leakGen, processSeedInput(dirty).user_character_seed, { child_safety: false }).violations];
  ok(viol.some((v) => v.rule === 'relationship_forbidden' || v.rule === 'scope_self'), '出口确定性：含关系词生成结果被 guard/validator 拦');
}

console.log('── ⑤ 🔴 不误伤正常生成（无关系词 seed：kept 原样 + seedPoints 正常 + guard 不误报）──');
{
  const cleanPP = '她很温柔，喜欢画画，从小和奶奶长大，性格慢热但认真';
  ok(keptOf({ personality_tags: ['温柔'], persona_prompt: cleanPP }) === cleanPP, '🔴 干净 meaningful：kept 原样保留(零行为变更)');
  ok(guardGeneratedText('她喜欢周末和家人在一起，和朋友逛街').length === 0, '🔴 「和家人在一起」不误报(在一起 条件判定)');
  ok(guardGeneratedText({ family: [{ who: '奶奶', detail: '把她带大' }], inner_summary: '温柔踏实的女孩' }).length === 0, '正常 self_facts 内容 guard 零命中');
  // 正常 seed 生成质量基线：seedPoints 完整(忠实度依赖)
  const normSp = collectSeedPoints(processSeedInput({ personality_tags: ['温柔', '内向'], hobbies: ['看书'], introvert_level: 7 }).user_character_seed);
  ok(['personality:温柔', 'personality:内向', 'hobby:看书', 'introvert_level'].every((p) => normSp.includes(p)), '正常 seed seedPoints 完整(忠实度不降)');
}

console.log('── ⑥ 🔴 A4/A5 去重 ──');
{
  // A4：温柔 同时在 personality_tags 与 persona_prompt → 只发一条(优先 personality)
  const a4 = collectSeedPoints(processSeedInput({ personality_tags: ['温柔'], persona_prompt: '温柔 活泼 哈哈哈哈 asdf' }).user_character_seed);
  ok(a4.filter((p) => p === 'personality:温柔').length === 1 && !a4.includes('pp_trait:温柔'), 'A4：温柔 不 personality/pp_trait 双发');
  // A5：前女友命中即跳过子串 女友·relationship_seed.raw 去重
  const a5 = processSeedInput({ persona_prompt: '我们以前是前女友' }).user_character_seed.relationship_seed.map((r) => r.raw);
  ok(a5.includes('前女友') && !a5.includes('女友'), 'A5：前女友 命中→跳过子串 女友');
}

console.log('── ⑦ 🔴 denoiseKept 后置零命中断言（宁误删不残留）──');
{
  ok(denoiseKept('我和你是青梅竹马').postassert_ok && denoiseKept('我和你是青梅竹马').kept === '', '整句关系→kept 清空·postassert_ok');
  const mix = denoiseKept('她喜欢画画。我们是前女友。她性格温柔');
  ok(!hasAnyRel(mix.kept) && /画画/.test(mix.kept) && /温柔/.test(mix.kept), '混合句：丢关系句留自述句（画画/温柔 在·关系零命中）');
}

console.log('── ⑧ 🔴 真实 prompt 抓取（注入假 llm·额外描述段零关系词）──');
{
  let capturedSystem = '';
  const fakeLlm = async ({ system }) => { capturedSystem = system; return { text: JSON.stringify({ character_core: { formative_chain: '普通家庭长大', trait_causes: [{ trait: '温柔', caused_by: ['家庭平和'], expression: '说话和气' }], inner_summary: '温柔的女孩' }, self_facts: { family: [{ who: '妈妈', detail: '顾家', influence_on_her: '安全感' }], growth: [{ event: '安稳', influence_on_her: '平和' }], work: { what: '学生', influence_on_her: '规律' }, close_friend_anchor: { nickname: '小敏', detail_level: 'low', knows_current_chat_partner: false, allowed_usage: 'low_frequency_life_anchor' } }, values_core: { life_attitude: { text: '平淡', derived_from: ['personality:温柔'] }, relationship_values: { text: '真诚', derived_from: ['personality:温柔'] }, moral_style: { text: '善良', derived_from: ['personality:温柔'] }, boundaries: { text: '有分寸', derived_from: ['personality:温柔'] } }, seed_alignment: [{ seed_point: 'personality:温柔', expanded_into: 'x' }] }) }; };
  const r = await generateSelfFacts({ name: '星禾', age: 22, personality_tags: ['温柔'], persona_prompt: '我们从小一起上学，是青梅竹马，她一直对我很好' }, { llm: fakeLlm });
  const extraLine = (capturedSystem.match(/额外描述\(已去噪\)：(.*)/) || [])[1] || '';
  ok(!hasAnyRel(extraLine), `真实 prompt「额外描述(已去噪)」段零关系词（实测=${JSON.stringify(extraLine.trim())}）← 旧版此处=整段原文带关系词=红`);
  ok(['generated', 'safe_default', 'safe_default_after_retry'].includes(r.status), `generateSelfFacts 正常收尾(status=${r.status})`);
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} self_facts_scope_self_leak 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
