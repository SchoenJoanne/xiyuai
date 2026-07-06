#!/usr/bin/env node
/**
 * character_seed_gen_smoke —— PR-3.2 commit B 红验。
 *   --mock(默认·¥0·进 CI·llm 注入 stub)：危险 call count=0 / relationship 不进生成 / unknown reject /
 *     retry 带 violations 修复 / safe default / B 只写 meta / child_safety / scope=self。
 *   --live(维护者看·Claude 跑)：nonce 自检 → 真 LLM 从各类合成 seed 生成 → dump character_core/
 *     self_facts/values_core 人眼看灵魂/忠实/安全。合成 seed·不碰真实用户·不打印 key·transcript 落 gitignored。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
const LIVE = process.argv.includes('--live');
const OUT = process.argv.includes('--out');

const { generateSelfFacts } = await import('../src/ai.mjs');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// 注入式 stub llm：按队列返回·计调用数·捕获 prompt（验危险 call count=0 / retry 喂 violations）
function makeLLM(responses) {
  const calls = [];
  const fn = async ({ system }) => { const i = calls.length; calls.push(system); return { text: responses[Math.min(i, responses.length - 1)] }; };
  fn.calls = calls;
  return fn;
}
const J = (o) => JSON.stringify(o);
const GOOD = (seedPoints = ['personality:温柔']) => J({
  character_core: { formative_chain: '家里忙她从小常独处→慢慢养成先观察的慢热→后来做护理又更细心→现在是熟了才敞开、敞开后很真诚的人', trait_causes: [{ trait: '温柔', caused_by: ['家庭平和', '独处多'], expression: '说话和气、愿意听人说完' }], inner_summary: '慢热但认定了就很真诚' },
  self_facts: { family: [{ who: '爸爸', detail: '开出租早出晚归', influence_on_her: '让她学会独立' }], growth: [{ event: '小时候搬过几次家', influence_on_her: '慢热' }], work: { what: '社区医院护士', influence_on_her: '细心耐烦' }, close_friend_anchor: { nickname: '小敏', detail_level: 'low', knows_current_chat_partner: false, allowed_usage: 'low_frequency_life_anchor' } },
  values_core: { life_attitude: { text: '踏实过好每天', derived_from: ['性格:温柔'] }, relationship_values: { text: '真诚有分寸', derived_from: ['性格:温柔'] }, moral_style: { text: '与人为善', derived_from: ['性格:温柔'] }, boundaries: { text: '尊重空间', derived_from: ['性格:温柔'] } },
  seed_alignment: seedPoints.map((p) => ({ seed_point: p, expanded_into: '...' })),
});

if (!LIVE) {
  // ① 🔴危险 seed 不进 LLM（call count=0）
  const llm1 = makeLLM([GOOD()]);
  const r1 = await generateSelfFacts({ age: 22, persona_prompt: '喜欢调教' }, { llm: llm1 });
  ok(r1.status === 'rejected' && r1.llmCalls === 0 && llm1.calls.length === 0, '🔴危险(reject) seed → 不调 LLM·call count=0·status rejected');
  const llm2 = makeLLM([GOOD()]);
  const r2 = await generateSelfFacts({ age: 5, persona_prompt: '她是外科医生' }, { llm: llm2 });
  ok(r2.status === 'safe_default' && llm2.calls.length === 0, '🔴危险(age-职业强不合理→safe_default) → 不调 LLM·本地模板');

  // ② mock 正常生成
  const llm3 = makeLLM([GOOD()]);
  const r3 = await generateSelfFacts({ name: '小柚', age: 22, personality_tags: ['温柔'] }, { llm: llm3 });
  ok(r3.status === 'generated' && r3.llmCalls === 1 && r3.meta.character_core && r3.meta.self_facts && r3.meta.values_core, 'mock 生成：status generated·meta 4 键填充');
  ok(/家里忙|慢热|护理|细心/.test(r3.meta.character_core.formative_chain) && r3.meta.character_core.formative_chain.length > 25, 'formative_chain 是交织叙事(多事实串成一条·非一句拼盘)');

  // ③ 🔴relationship_seed 不进生成：forbidden_context 进 prompt + 输出含青梅竹马→被拦
  const llm4 = makeLLM([GOOD(['role', 'personality:温柔'])]);
  const r4 = await generateSelfFacts({ name: '小柚', age: 22, role_title: '青梅竹马', personality_tags: ['温柔'] }, { llm: llm4 });
  ok(/excluded_relationship_seed/.test(llm4.calls[0]) && /青梅竹马/.test(llm4.calls[0]), 'forbidden_context(excluded_relationship_seed+青梅竹马)进 prompt');
  ok(r4.status === 'generated' && !/青梅竹马/.test(J(r4.meta.character_core) + J(r4.meta.self_facts)), '🔴生成结果不含青梅竹马(relationship 不进 self)');
  const llm4b = makeLLM([J({ character_core: { formative_chain: '她和他从小青梅竹马一起长大', trait_causes: [], inner_summary: 'x' }, self_facts: {}, values_core: {}, seed_alignment: [] }), GOOD(['role', 'personality:温柔'])]);
  const r4b = await generateSelfFacts({ name: '小柚', age: 22, role_title: '青梅竹马', personality_tags: ['温柔'] }, { llm: llm4b });
  ok(r4b.llmCalls === 2, '🔴输出含青梅竹马→guard 拦→retry(第二次修复)');

  // ④ unknown 顶层键 reject(不 strip)
  const llmU = makeLLM([J({ character_core: { formative_chain: 'x', trait_causes: [], inner_summary: 'x' }, relationship_with_user: '青梅竹马' })]);
  const rU = await generateSelfFacts({ name: '小柚', age: 22, personality_tags: ['温柔'] }, { llm: llmU });
  ok(rU.status === 'safe_default_after_retry', '🔴unknown 顶层键(relationship_with_user)→reject 不 strip→retry 失败→safe default');

  // ⑤ retry 带 violations：第一次缺 derived_from→第二次修复
  const badNoDerived = J({ character_core: { formative_chain: 'x', trait_causes: [], inner_summary: 'x' }, self_facts: {}, values_core: { life_attitude: { text: 'x' } }, seed_alignment: [{ seed_point: 'personality:温柔', expanded_into: 'x' }] });
  const llm5 = makeLLM([badNoDerived, GOOD()]);
  const r5 = await generateSelfFacts({ name: '小柚', age: 22, personality_tags: ['温柔'] }, { llm: llm5 });
  ok(r5.status === 'generated' && r5.llmCalls === 2 && /上一次未通过|derived_from/.test(llm5.calls[1]), '🔴retry 带 violations：第一次缺 derived_from→第二次 prompt 含修正提示→修复成功');

  // ⑥ child_safety：未成年档输出含恋爱→拦
  const llm6 = makeLLM([J({ character_core: { formative_chain: '她谈过一场轰轰烈烈的恋爱', trait_causes: [], inner_summary: 'x' }, self_facts: {}, values_core: {}, seed_alignment: [] }), J({ character_core: { formative_chain: '她谈过恋爱', trait_causes: [], inner_summary: 'x' }, self_facts: {}, values_core: {}, seed_alignment: [] })]);
  const r6 = await generateSelfFacts({ name: '小柚', age: 16, personality_tags: ['温柔'] }, { llm: llm6 });
  ok(r6.status === 'safe_default_after_retry', '🔴child_safety：未成年档输出含恋爱→validator 拦→safe default');

  // ⑦ legacy secure 不要求 seed_alignment 覆盖（attachment_style=secure 不进 seedPoints）
  const llm7 = makeLLM([GOOD()]);   // seed_alignment 只 personality:温柔·无 attachment
  const r7 = await generateSelfFacts({ name: '小柚', age: 22, personality_tags: ['温柔'], attachment_style: 'secure' }, { llm: llm7 });
  ok(r7.status === 'generated', 'legacy secure：不要求 seed_alignment 覆盖 secure→正常生成');

  console.log(`\ncharacter_seed_gen_smoke: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// ── --live：真 LLM·维护者看 dump（Claude 跑·nonce 自检防假绿）──────────────────────
const fs = await import('node:fs');
const crypto = await import('node:crypto');
await import('dotenv/config');
const { chatComplete } = await import('../src/providers/chat.mjs');
const FALLBACK = '嗯…我刚刚有点走神，等我一下下，再跟你说～';

const nonce = `PR32_LLM_OK_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
console.log('── LLM 连通性自检(nonce + usage)──');
let probe;
try { probe = await chatComplete({ system: `只输出这串字符，别的都不要：${nonce}`, messages: [{ role: 'user', content: '只回那串' }], temperature: 0, max_tokens: 64 }); }
catch (e) { console.error('🔴 LLM 抛错:', e.message); process.exit(2); }
if (!String(probe?.text || '').includes(nonce) || (probe?.usage?.completion_tokens || 0) === 0 || probe.text === FALLBACK) {
  console.error('🔴🔴 连通性自检失败·拒绝假绿（key 未注入/兜底）'); process.exit(2);
}
console.log(`LLM connectivity: PASS (completion_tokens=${probe.usage.completion_tokens})\n`);

const SEEDS = [
  { label: '傲娇治愈学姐', companion: { name: '小柚', age: 22, role_title: '学姐', personality_tags: ['傲娇', '治愈'], introvert_level: 6, attachment_style: 'slow_warm_exclusive', hobbies: ['看书', '猫'], persona_prompt: '嘴硬心软，刀子嘴豆腐心' } },
  { label: '高冷独立直率', companion: { name: '阿岑', age: 24, role_title: '邻家女孩', personality_tags: ['冷静', '知性'], introvert_level: 3, attachment_style: 'independent_boundaries', hobbies: ['跑步'], persona_prompt: '独立有主见，不爱黏人' } },
  { label: '需要安全感慢热', companion: { name: '糖糖', age: 21, role_title: '邻家女孩', personality_tags: ['温柔', '爱撒娇'], introvert_level: 7, attachment_style: 'closeness_seeking', hobbies: ['烘焙'], persona_prompt: '慢热，熟了很黏，希望被认真回应' } },
  { label: '青梅竹马chip(relationship隔离)', companion: { name: '星禾', age: 22, role_title: '青梅竹马', personality_tags: ['活泼', '开朗'], introvert_level: 8, persona_prompt: '阳光开朗爱笑' } },
  { label: 'mixed_noise脏输入', companion: { name: '默默', age: 23, personality_tags: ['文艺'], persona_prompt: '温柔慢热 aaa 2333 喜欢猫猫和画画' } },
  { label: '未成年(child_safety)', companion: { name: '朵朵', age: 16, role_title: '同班同学', personality_tags: ['活泼'], attachment_style: 'closeness_seeking', persona_prompt: '开朗爱笑' } },
];

const records = [];
let totalLLM = 0, hardBreak = 0;
const REL = ['青梅竹马', '同校', '同班', '一起上学', '前任', '夫妻', '同居', '和你', '你们', '当前聊天对象'];
console.log(`═══ character_seed 真 LLM 生成 dump（${SEEDS.length} 类合成 seed）═══`);
for (const s of SEEDS) {
  const r = await generateSelfFacts(s.companion); totalLLM += r.llmCalls || 0;
  const blob = JSON.stringify({ cc: r.meta.character_core, sf: r.meta.self_facts, vc: r.meta.values_core });
  const relLeak = REL.filter((w) => blob.includes(w));
  const userLeak = blob.replace(/用户协议|用户名/g, '').includes('用户');
  if (relLeak.length || userLeak) hardBreak++;
  console.log(`\n## ${s.label}  [status=${r.status}·llmCalls=${r.llmCalls}]`);
  console.log('formative_chain :', r.meta.character_core?.formative_chain || '(无)');
  console.log('inner_summary   :', r.meta.character_core?.inner_summary || '(无)');
  console.log('trait_causes    :', JSON.stringify(r.meta.character_core?.trait_causes || []));
  console.log('self_facts.family:', JSON.stringify(r.meta.self_facts?.family || []));
  console.log('values_core     :', JSON.stringify(r.meta.values_core || {}));
  console.log(`🔴 relationship 泄漏: ${relLeak.length ? relLeak.join(',') : '无'}｜"用户"泄漏: ${userLeak ? '有' : '无'}`);
  records.push({ label: s.label, status: r.status, llmCalls: r.llmCalls, meta: { character_core: r.meta.character_core, self_facts: r.meta.self_facts, values_core: r.meta.values_core, seed_alignment: r.meta.seed_alignment }, relLeak, userLeak });
}
console.log(`\n═══ 小结：${SEEDS.length} 类·真 LLM 调用 ${totalLLM} 次≈¥${(totalLLM * 0.0032).toFixed(3)}(账单口径·虚高2.87×)·关系/用户泄漏 ${hardBreak} 类(应=0)═══`);
if (hardBreak) console.log('🔴 发现泄漏·先贴 dump 不自动修');
if (OUT) { const f = `logs/character_seed_gen_${Date.now()}.jsonl`; try { fs.writeFileSync(f, records.map((r) => JSON.stringify(r)).join('\n') + '\n'); console.log(`dump → ${f}(gitignored·合成数据)`); } catch (e) { console.log('落文件失败:', e.message); } }
process.exit(hardBreak ? 1 : 0);
