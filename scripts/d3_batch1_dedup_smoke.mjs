#!/usr/bin/env node
/**
 * d3_batch1_dedup_smoke —— 停板B 批B1（D3 批1 纯去重合并·六改写对 P1-P5b）落码守卫·坏版本验红（确定性·进 CI）。
 *
 * 六对（design_D3_batch1.md / harness/d3_batch1_pairs.mjs·n=40 A/B 语义等价基线）落码到 companion.mjs 后，
 * 本 smoke 建 prompt 断言：每处**新文本在场（neu）· 旧文本消失（old）**——防落码回退/漂移。
 *   P1 §18 长度块字数单一化 / P2 §9 反例瘦身 / P3 §18 语气+节奏两块并一块 /
 *   P4 §18 名字硬编码「溪语」→${c.name} 插值 / P5a 演足规则从 §重要规则删 / P5b 并入 §16 定界块尾。
 * 🔴 坏版本验红：任一 old 文本重现（落码回退）→ 红；neu 缺失 → 红。
 * 🔴 DB_PATH 硬闸。跑：DB_PATH=/tmp/b1.db PERSONA_PROMPT_HARDEN=1 node scripts/d3_batch1_dedup_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/b1_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.PERSONA_PROMPT_HARDEN = process.env.PERSONA_PROMPT_HARDEN || '1';   // 生产 =1 live·P5 定界块保真
const { buildSystemPrompt } = await import('../src/companion.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

const C = { id: 999001, name: '星禾', age: 22, role_title: '女友', relationship_stage: '恋人',
  persona_prompt: '活泼里带点小傲娇，喜欢和他斗嘴但很在乎他' };
const sys = buildSystemPrompt(C, { promptMode: 'reply' });

console.log('── P1 §18 长度块字数单一化（指向【你的说话方式】唯一源）──');
ok(sys.includes('单条字数上限以上面【你的说话方式】里的数字为准（全篇唯一标准）'), 'P1 neu 在（数字单一源）');
ok(!sys.includes('每条消息严格不超过 15 字'), '🔴 P1 old 消（不再自带 15 字数字·L2① 双轨解除）');

console.log('── P2 §9 反例瘦身（六行→两行·轰炸式关心删）──');
ok(sys.includes('反例一眼记住：「熬夜对身体有很多危害，建议你...」这种展开说教'), 'P2 neu 在');
ok(!sys.includes('★ 关键反例（AI 味）：') && !sys.includes('轰炸式关心'), '🔴 P2 old 消（反例清单+轰炸式关心行去重）');
ok(sys.includes('她不是来 fix 他的人生的，她是陪他过日子的人。'), 'P2 ★核心句原文逐字保留（去重不删语义）');

console.log('── P3 §18 语气示范+节奏两块→一块（类别全保留）──');
ok(sys.includes('【真人语气与节奏】'), 'P3 neu 合并块在');
ok(!sys.includes('【真人语气示范】') && !sys.includes('【参考真实聊天节奏】'), '🔴 P3 old 两块头消（合一）');

console.log('── P4 §18 名字硬编码「溪语」→${c.name} 插值（绝不字面写死·D1 审①）──');
ok(sys.includes('"星禾觉得..." ← 自指太诡异'), 'P4 neu 名字插值渲染（c.name=星禾）');
ok(!sys.includes('溪语觉得') && !sys.includes('我溪语就是'), '🔴 P4 old 硬编码「溪语」消（+⑦示例瘦身 2→1）');

console.log('── P5a/b 演足规则从 §重要规则移到 §16 定界块尾（去 L2⑧ 双注入·单处）──');
ok(sys.includes('</角色性格资料>\n资料里是给她设定的性格，把它【演足】'), 'P5b neu 演足在 §16 定界块尾（贴 </角色性格资料>）');
ok(!sys.includes('把这个性格【演足】'), '🔴 P5a old 演足从 §重要规则消（旧句去重）');
// 演足只在 §16 出现一次（不再 §重要规则+§16 双注入）
ok((sys.match(/【演足】/g) || []).length === 1, '🔴 【演足】全篇仅 1 处（双注入合一·L2⑧）');
// 门控保真：闸关时 §16 定界块与演足都不注入（PERSONA_PROMPT_HARDEN 行为不变）
delete process.env.PERSONA_PROMPT_HARDEN;
const sysOff = buildSystemPrompt(C, { promptMode: 'reply' });
ok(!sysOff.includes('把它【演足】') && !sysOff.includes('<角色性格资料>'), '🔴 闸关：演足+定界块都不注入（门控行为不变·P5 未破闸）');
ok(sysOff.includes('- 保持人设，不要跳出角色'), '闸关：§重要规则「保持人设」行仍在（P5a 删的是尾部演足·非整行）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} 批B1 六改写对落码守卫: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
