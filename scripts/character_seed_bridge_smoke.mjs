/**
 * character_seed_bridge_smoke.mjs —— PR-3.2 commit C1：seedMetaToFactItems（meta → FactItem[] 桥）。
 *
 * C1 = 纯数据转换：把 commit B 落在 character_seed_meta 的 character_core/self_facts/values_core
 * 转成 PR-3.1 buildCanonicalFactSnapshot 可召回的 FactItem 形状。不接线·不进表·不改 prompt/创建。
 *
 * 验收重点（维护者拍）：
 *  ① FactItem 形状（slot/layer/source/seedGroup/content/value/priority）
 *  ② family 保守映射（明确含职业才 father_occupation·否则 family.father）
 *  ③ family.father_occupation 与 PR-3.1 detectFactTopics 触发槽【咬合】
 *  ④ 🔴 优先级：generated character_seed(60) > 普通 persona_fact(40) > values_core(32) > safe_default(28)
 *  ⑤ 零泄漏（「用户」/关系禁词整条丢弃）·永不 identity_core·永不 relationship.*
 *  ⑥ close_friend 仅 knows_current_chat_partner===false 才 emit（profile.friend·非 relationship.*）
 *  ⑦ null/{}/坏串 优雅返回 []·C1 不接线零依赖（静态自检）
 *
 * fixture = 用 live dump 提炼的【合成】fixture（手写·非真实用户数据·不提交原始 verbose logs）。
 */
import { readFileSync } from 'node:fs';
import { seedMetaToFactItems, buildSafeDefaultCharacter } from '../src/character_seed.mjs';
import { detectFactTopics } from '../src/fact_guard.mjs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('  ✗', name); } };

// ─── 合成 fixture（提炼自 6 类 live dump·手写干净）────────────────────────────
// 1. generated·傲娇治愈（父职业明确/母普通/外婆/成长/工作/朋友 knows=false/三观/内核）
const META_GEN = {
  v: 1,
  user_character_seed: { self_role_title: '学姐', personality_tags: ['傲娇', '治愈'] },
  seed_processing: { safety: { verdict: 'ok' }, fallback_decision: 'none' },
  character_core: {
    formative_chain: '她在一家老书店长大，父亲常年开出租早出晚归，母亲守着书店，她从小一个人看书、学会自己消化情绪，养成嘴上倔强、心里柔软的性子。',
    trait_causes: [{ trait: '嘴硬心软', caused_by: ['父亲常不在家', '独自长大'], expression: '刀子嘴豆腐心、关心人偏要装凶' }],
    inner_summary: '外壳傲娇、内里治愈的书店女孩',
  },
  self_facts: {
    family: [
      { who: '爸爸', detail: '出租车司机，常年早出晚归', influence_on_her: '让她学会独立' },
      { who: '妈妈', detail: '守着家里的老书店，话不多', influence_on_her: '给了她安静的底色' },
      { who: '外婆', detail: '偶尔来住、爱给她做红糖糕', influence_on_her: '童年的暖光' },
    ],
    growth: [{ event: '高中一个人搬到县城读书', influence_on_her: '更独立也更想家' }],
    work: { what: '书店店员，业余画插画', influence_on_her: '安静里有自己的小世界' },
    close_friend_anchor: { nickname: '阿芜', detail_level: 'low', knows_current_chat_partner: false, allowed_usage: 'low_frequency_life_anchor' },
  },
  values_core: {
    life_attitude: { text: '慢慢来，把日子过踏实', derived_from: ['personality:治愈'] },
    relationship_values: { text: '认定一个人就很专一', derived_from: ['personality:傲娇'] },
    moral_style: { text: '见不得人受委屈', derived_from: ['personality:治愈'] },
    boundaries: { text: '熟了才肯露软的一面', derived_from: ['attachment_style'] },
  },
  seed_alignment: [],
};
// 2. 父普通描述（无职业词）→family.father·哥哥→family.background
const META_FATHER_PLAIN = {
  character_core: { inner_summary: '踏实安静的女孩', formative_chain: '普通家庭长大', trait_causes: [] },
  self_facts: { family: [{ who: '爸爸', detail: '话不多但顾家' }, { who: '哥哥', detail: '在外地工作' }] },
};
// 3. 母含职业（护士）→family.mother_occupation
const META_MOTHER_OCC = { self_facts: { family: [{ who: '妈妈', detail: '是医院的护士，三班倒' }] } };
// 4. 关系泄漏 + close_friend knows=true（红验：泄漏整条丢弃·认识聊天对象不 emit·干净项幸存）
const META_REL_LEAK = {
  character_core: { inner_summary: '我们是青梅竹马一起长大的女孩', formative_chain: '和你从小一起长大', trait_causes: [] },
  self_facts: {
    family: [{ who: '妈妈', detail: '温柔会做饭' }],
    close_friend_anchor: { nickname: '小敏', knows_current_chat_partner: true },
  },
  values_core: { relationship_values: { text: '和你在一起最安心' } },
};
// 5. safe_default（character_core._source='safe_default'·全降 28）
const sd = buildSafeDefaultCharacter({});
const META_SAFE = { character_core: sd.character_core, self_facts: sd.self_facts, values_core: sd.values_core };

const genItems = seedMetaToFactItems(META_GEN);

// ─── ① 形状 + 通用红线 ───────────────────────────────────────────────────────
const allClean = [...genItems, ...seedMetaToFactItems(META_FATHER_PLAIN), ...seedMetaToFactItems(META_MOTHER_OCC), ...seedMetaToFactItems(META_SAFE)];
ok(genItems.length > 0, 'generated meta 产出非空');
ok(allClean.every((i) => i.source === 'character_seed'), 'source 全 character_seed');
ok(allClean.every((i) => i.layer === 'profile_core'), 'layer 全 profile_core（永不 identity_core）');
ok(allClean.every((i) => i.seedGroup && i.slot && i.content && typeof i.priority === 'number' && i.value != null), 'FactItem 形状完整(seedGroup/slot/content/value/priority)');
ok(allClean.every((i) => !i.slot.startsWith('identity.')), '永不产 identity.* slot（身份锁 companions）');
ok(allClean.every((i) => !i.slot.startsWith('relationship.')), '永不产 relationship.* slot（不指向用户）');
ok(allClean.every((i) => i.layer !== 'identity_core'), '永不产 identity_core layer');

// ─── ② family 保守映射 ───────────────────────────────────────────────────────
ok(genItems.some((i) => i.slot === 'family.father_occupation' && i.content.includes('出租车司机')), '父含职业(出租车司机)→family.father_occupation');
const fp = seedMetaToFactItems(META_FATHER_PLAIN);
ok(fp.some((i) => i.slot === 'family.father'), '父普通描述→family.father(不硬猜职业)');
ok(!fp.some((i) => i.slot === 'family.father_occupation'), '父无职业词→不产 father_occupation');
ok(fp.some((i) => i.slot === 'family.background' && i.content.includes('哥哥')), '哥哥→family.background');
ok(seedMetaToFactItems(META_MOTHER_OCC).some((i) => i.slot === 'family.mother_occupation'), '母含职业(护士)→family.mother_occupation');
ok(genItems.some((i) => i.slot === 'family.mother' && i.content.includes('书店')), '母普通描述→family.mother');
ok(genItems.some((i) => i.slot === 'family.background' && i.content.includes('外婆')), '外婆→family.background');
ok(seedMetaToFactItems(JSON.stringify(META_MOTHER_OCC)).some((i) => i.slot === 'family.mother_occupation'), 'JSON 串入参也能解析');

// ─── ③ 咬合 PR-3.1 detectFactTopics ─────────────────────────────────────────
ok(detectFactTopics('你爸是做什么工作的？').slots.includes('family.father_occupation'), 'detectFactTopics 命中 family.father_occupation');
ok(genItems.some((i) => i.slot === 'family.father_occupation'), '🔴咬合：seed 桥产 family.father_occupation（与 PR-3.1 触发槽同串）');
ok(detectFactTopics('你妈是做什么工作的？').slots.includes('family.mother_occupation'), 'detectFactTopics 命中 family.mother_occupation（母咬合）');

// ─── ④ 🔴优先级：generated > 普通 persona_fact(40) > values > safe_default ──────
const ff = genItems.find((i) => i.slot === 'family.father_occupation');
ok(ff.priority === 60, 'self_fact(father_occupation)=60');
ok(ff.priority > 40, '🔴 generated character_seed(60) > 普通 persona_fact(40)');
ok(genItems.find((i) => i.slot === 'profile.occupation').priority === 60, 'work→profile.occupation=60');
ok(genItems.find((i) => i.slot === 'profile.inner_summary').priority === 58, 'inner_summary→58(C2 常驻候选)');
ok(genItems.find((i) => i.slot === 'profile.trait').priority === 55, 'trait→55');
ok(genItems.find((i) => i.slot === 'profile.formative').priority === 52, 'formative→52(长叙事·C2 先裁)');
ok(genItems.find((i) => i.slot === 'profile.friend').priority === 55, 'close_friend→profile.friend=55');
const val = genItems.find((i) => i.slot.startsWith('values.'));
ok(val && val.priority === 32, 'values_core=32');
ok(val.priority < 40, 'values_core(32) < 普通 persona_fact(40)');
const safeItems = seedMetaToFactItems(META_SAFE);
ok(safeItems.length > 0 && safeItems.every((i) => i.priority === 28), '🔴 safe_default 全降 28(最低兜底)');
ok(safeItems.every((i) => i.priority < ff.priority), '🔴 safe_default(28) < generated(60)·让位真自有事实');

// ─── ⑤ 零泄漏 + close_friend 门控（红验）─────────────────────────────────────
ok(allClean.every((i) => !i.content.includes('用户')), '零「用户」泄漏');
const REL = ['和你', '你们', '青梅竹马', '同校', '同班', '前任', '夫妻', '同居', '当前聊天对象'];
ok(allClean.every((i) => !REL.some((w) => i.content.includes(w))), '零关系禁词泄漏');
ok(genItems.some((i) => i.slot === 'profile.friend' && i.content.includes('阿芜')), 'close_friend(knows=false)→profile.friend emit');
const leak = seedMetaToFactItems(META_REL_LEAK);
ok(!leak.some((i) => i.slot === 'profile.friend'), '🔴 close_friend(knows=true)→不 emit');
ok(!leak.some((i) => i.seedGroup === 'character_core'), '🔴 inner_summary/formative 含青梅竹马/和你→整条丢弃');
ok(!leak.some((i) => i.slot === 'values.relationship_values'), '🔴 relationship_values 含「和你」→丢弃');
ok(leak.some((i) => i.slot === 'family.mother'), '干净 family.mother 仍 emit（不误伤）');
ok(leak.length === 1, 'rel-leak fixture 仅 1 条干净项幸存（其余泄漏全丢）');

// ─── ⑥ null/坏串 优雅 ───────────────────────────────────────────────────────
ok(seedMetaToFactItems(null).length === 0, 'null→[]');
ok(seedMetaToFactItems(undefined).length === 0, 'undefined→[]');
ok(seedMetaToFactItems({}).length === 0, '{}→[]');
ok(seedMetaToFactItems('not json{').length === 0, '坏串→[]');
ok(seedMetaToFactItems({ character_core: null, self_facts: null, values_core: null }).length === 0, '全 null 字段→[]');

// ─── ⑦ C1 不接线·零依赖（静态自检）──────────────────────────────────────────
const src = readFileSync(new URL('../src/character_seed.mjs', import.meta.url), 'utf8');
ok(!/buildCanonicalFactSnapshot\s*\(|buildSystemPrompt\s*\(/.test(src), 'C1 不接线：character_seed.mjs 不【调用】snapshot/buildSystemPrompt（注释提及不算）');
ok(!/from '\.\/fact_guard/.test(src), 'character_seed.mjs 保持零依赖：不 import fact_guard');

console.log(`\ncharacter_seed_bridge: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
