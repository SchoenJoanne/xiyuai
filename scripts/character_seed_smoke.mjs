#!/usr/bin/env node
/**
 * character_seed_smoke —— PR-3.2 commit A 红验（¥0·零 LLM·纯函数·进 CI）。
 *
 * 重点=防误伤：tension 不误杀(傲娇+治愈) / 关系隔离不误伤(她自己的家人朋友进 self) /
 * child_safety 强不合理职业拦·合理兼职放 / scope=self / values_core derived / legacy_passthrough。
 *
 * 隐私：纯合成输入·零 DB·零真实数据。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import {
  classifyValidity, extractFromMixedNoise, classifySafety, detectConflicts,
  classifyRelationshipSeed, processSeedInput, decideFallback,
  validateGeneratedCharacter, buildCharacterSeedMeta, ATTACHMENT_STYLES,
} from '../src/character_seed.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// ── 层2 validity 5 类 + mixed_noise 抽取（⑦）─────────────────────────────────
ok(classifyValidity('') === 'minimal', '空 → minimal(当没填)');
ok(classifyValidity('温柔') === 'minimal', '短有效"温柔" → minimal');
ok(classifyValidity('她是个温柔慢热的女生，喜欢看书，性格内向但熟了话很多') === 'meaningful', '完整描述 → meaningful');
ok(classifyValidity('温柔慢热 aaa 2333 喜欢猫猫') === 'mixed_noise', 'mixed_noise(有义+噪声)');
ok(classifyValidity('asdfghjkl') === 'garbage', '键盘游走 → garbage');
ok(classifyValidity('我想要个调教的萝莉') === 'unsafe', '剥削词 → unsafe');
const ex = extractFromMixedNoise('温柔慢热 aaa 2333 喜欢猫猫');
ok(ex.traits.includes('温柔') && ex.traits.includes('慢热') && ex.hobbies.some(h => h.includes('猫')) && ex.noise_dropped.some(x => /aaa|2333/.test(x)),
  '🔴mixed_noise 抽 traits/hobbies·丢噪声(不当全垃圾)');

// ── 层0/1 安全闸 + child_safety（③⑤）────────────────────────────────────────
ok(classifySafety({ age: 22, persona_prompt: '温柔' }).verdict === 'ok' && classifySafety({ age: 22 }).child_safety === false, '成年正常 → ok·非 child_safety');
ok(classifySafety({ age: 16 }).child_safety === true, 'age<18 → child_safety=true');
ok(classifySafety({ age: 16, persona_prompt: '想做我老婆' }).verdict === 'safe_mode', '🔴未成年+恋爱词 → safe_mode(剥离恋爱语义)');
ok(classifySafety({ age: 22, persona_prompt: '喜欢调教' }).verdict === 'reject', '🔴剥削词(任何年龄) → reject');

// ── 层3 冲突 3 表·tension 不误杀（⑥）────────────────────────────────────────
const cf1 = detectConflicts({ personality_tags: ['傲娇', '治愈'] });
ok(cf1.tension_pairs.some(p => p.includes('傲娇') && p.includes('治愈')) && cf1.hard_conflicts.length === 0 && cf1.safety_conflicts.length === 0,
  '🔴tension 不误杀：傲娇+治愈 → tension_pairs(非 hard/safety·热门角色不死)');
const cf2 = detectConflicts({ persona_prompt: '社交达人但其实社恐', introvert_level: 1 });
ok(cf2.hard_conflicts.length > 0, 'hard 冲突：社交达人+社恐 → hard_conflicts(主次降级)');
const cf3 = detectConflicts({ age: 5, persona_prompt: '她是外科医生' });
ok(cf3.safety_conflicts.some(c => /外科医生/.test(JSON.stringify(c))), '🔴child_safety 强不合理职业：5岁+外科医生 → safety_conflict(拦)');
const cf4 = detectConflicts({ age: 16, persona_prompt: '周末兼职当店员' });
ok(cf4.safety_conflicts.length === 0, '🔴合理兼职放行：16岁+兼职店员 → 不拦(不一刀切未成年+职业)');

// ── 关系隔离 legacy_passthrough + 仅指向用户·她自己的不误剥（②④⑧）──────────────
const r1 = classifyRelationshipSeed({ role_title: '青梅竹马' });
ok(r1.relationship_seed.some(x => x.raw === '青梅竹马' && x.status === 'legacy_passthrough' && x.excluded_from_self_seed === true)
  && r1.self_role_title === '邻家女孩' && r1.runtime_role_title_unchanged === true,
  '🔴legacy_passthrough：role_title=青梅竹马 → relationship_seed/excluded_from_self·self 退化中性·runtime 标 unchanged');
const r2 = classifyRelationshipSeed({ persona_prompt: '我们是青梅竹马，从小一起长大' });
ok(r2.relationship_seed.some(x => x.raw === '青梅竹马'), '指向用户的自由文本关系词(我们+青梅竹马) → 隔离');
const r3 = classifyRelationshipSeed({ persona_prompt: '她和妈妈关系很好，有个发小朋友叫阿宁' });
ok(r3.relationship_seed.length === 0, '🔴不误剥：她自己的家人朋友(她和妈妈/朋友阿宁)→ 不隔离·进 self');

// ── processSeedInput 编排：legacy_passthrough 落 user_character_seed（②）──────────
const proc = processSeedInput({ name: '小柚', age: 22, role_title: '青梅竹马', personality_tags: ['傲娇', '治愈'] });
ok(proc.user_character_seed.role_title === null && proc.user_character_seed.self_role_title === '邻家女孩'
  && proc.seed_processing.compat.runtime_role_title_unchanged === true
  && proc.user_character_seed.relationship_seed.length === 1,
  '🔴processSeedInput：青梅竹马 chip → self role_title=null·relationship_seed 隔离·compat 标 runtime 不动');
ok(proc.seed_processing.conflicts.tension_pairs.length > 0, 'processSeedInput：傲娇+治愈 进 tension(不 fail)');

// ── fallback 决策（reject>safe_default>field_default>none）────────────────────
ok(decideFallback({ safety: { verdict: 'reject' } }) === 'reject', 'fallback：reject');
ok(decideFallback({ safety: { verdict: 'safe_mode' } }) === 'safe_default', 'fallback：safe_mode → safe_default');
ok(decideFallback({ safety: { verdict: 'ok' }, conflicts: { safety_conflicts: [] }, validity: { persona_prompt: 'garbage' } }) === 'field_default', 'fallback：garbage → field_default');
ok(decideFallback({ safety: { verdict: 'ok' }, conflicts: { safety_conflicts: [] }, validity: { persona_prompt: 'meaningful' } }) === 'none', 'fallback：干净 → none');

// ── validator 层5（B 的 retry 闸·A 先建·④⑤）──────────────────────────────────
const good = {
  character_core: { formative_chain: ['幼时搬家多→慢热'] },
  values_core: { life_attitude: { text: '随遇而安', derived_from: 'personality:温柔' } },
  seed_alignment: [{ seed_point: 'personality:温柔' }],
};
ok(validateGeneratedCharacter(good, { personality_tags: ['温柔'] }, { child_safety: false }).ok, 'validator：合格生成 → ok');
ok(validateGeneratedCharacter({}, {}, {}).violations.some(v => v.rule === 'causality'), 'validator：缺 formative_chain → causality violation');
ok(validateGeneratedCharacter({ character_core: { formative_chain: ['x'] }, note: '我们是青梅竹马一起长大的' }, {}, {}).violations.some(v => v.rule === 'scope_self'),
  '🔴validator scope=self：输出含指向用户关系 → violation');
ok(validateGeneratedCharacter({ character_core: { formative_chain: ['x'] }, story: '她和他恋爱了' }, {}, { child_safety: true }).violations.some(v => v.rule === 'child_safety'),
  '🔴validator child_safety：未成年档含恋爱 → violation');
ok(validateGeneratedCharacter({ character_core: { formative_chain: ['x'] }, values_core: { moral_style: { text: '极端' } }, seed_alignment: [] }, {}, {}).violations.some(v => v.rule === 'values_core_derived'),
  '🔴validator：values_core 缺 derived_from(凭空) → violation');

// ── schema：A 不生成（character_core/values_core/seed_alignment 留 null·⑤）───────
const meta = buildCharacterSeedMeta({ name: '小柚', age: 22, personality_tags: ['温柔'] });
ok(meta.character_core === null && meta.self_facts === null && meta.values_core === null && meta.seed_alignment === null,
  '🔴commit A 不生成：character_core/self_facts/values_core/seed_alignment 留 null(留 B·schema 4 键)');
ok(meta.user_character_seed && meta.seed_processing, 'A 填 user_character_seed + seed_processing');
ok(ATTACHMENT_STYLES.length === 4, 'attachment 4 选枚举齐');

console.log(`\ncharacter_seed_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
