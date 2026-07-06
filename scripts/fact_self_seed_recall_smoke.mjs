#!/usr/bin/env node
/**
 * fact_self_seed_recall_smoke —— PR-3.2 commit C2 防误伤红验（¥0·零 LLM）。
 *
 * C2 = 把 C1 桥(seedMetaToFactItems)的 AI 自有事实接进 buildCanonicalFactSnapshot，
 * 让 bot reply 召回她自己的 backstory（爸爸职业/职业/成长/内核…），同时绝不破 PR-3.1。
 *
 * 核心验收（GPT 11 条·#4 = GPT 抓的 canonicalOwnedSlots 对称漏洞）：
 *   dedup 三层所有权 = companions/shared_memory 压 character_seed 压 persona/user/session，
 *   都【只】作用 SEED_CRITICAL_SELF_SLOTS·不碰 identity/relationship/values/friend·safe_default 不参与。
 *
 * 🔴 canonicalOwnedSlots 当前架构不可达(companions 只产 identity_core 槽·shared_memory 只产
 *   relationship.shared_memory 槽·都不落 critical self 槽)→ 第 4 条【直测 dedupFacts】才非假绿。
 *
 * 隐私：纯合成 companion(test_companion_a) + 手写合成 meta·零 DB·零真实数据。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { readFileSync } from 'node:fs';
import { detectFactTopics, buildCanonicalFactSnapshot, renderFactSnapshot, dedupFacts, scrubUnsupportedSharedTopicConfirmation } from '../src/fact_guard.mjs';
import { seedMetaToFactItems, buildSafeDefaultCharacter } from '../src/character_seed.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };
// 直测 dedupFacts 用的 FactItem 工厂（layer 默认 profile_core·companions identity 才显式传 identity_core）
const fi = (slot, source, content, extra = {}) => ({ slot, layer: 'profile_core', source, content, value: content, priority: 50, ...extra });

// ── 合成正常人设 meta（连贯·有 character_core 因果链）──────────────────────────────
const normalMeta = {
  character_core: {
    inner_summary: '慢热但踏实、心里有杆秤的女孩',
    trait_causes: [{ trait: '慢热', caused_by: ['小时候搬过几次家'], expression: '要熟了才放下防备' }],
    formative_chain: '小时候跟着父母辗转几个城市，学会先观察再交心。',
  },
  self_facts: {
    family: [{ who: '爸爸', detail: '出租车司机，常年跑夜班' }],
    growth: [{ event: '高中住校三年' }],
    work: { what: '在一家书店做店员' },
    close_friend_anchor: { nickname: '阿宁', detail_level: 'low', knows_current_chat_partner: false },
  },
  values_core: { life_attitude: { text: '细水长流' }, boundaries: { text: '不轻易交心但交了就真' } },
};
const comp = { name: 'test_companion_a', age: 22, safe_mode: 0, role_title: '店员', relationship_stage: '朋友', shared_memory: '' };

// ════════════════ #1 无 character_seed 时五源 dedup 不回归（改了 dedup 核心最该验）═════════
ok(dedupFacts([fi('profile.city', 'persona_facts', '城市：杭州'), fi('profile.city', 'shared_memory', '城市：杭州')]).every((x) => x.source === 'shared_memory')
  && dedupFacts([fi('profile.city', 'persona_facts', '城市：杭州'), fi('profile.city', 'shared_memory', '城市：杭州')]).length === 1,
  '#1 同 content shared(4)>persona(3) 仍赢(新增 3.5 不动现有相对序)');
ok(dedupFacts([fi('profile.misc', 'user_fact', '他说：喜欢猫'), fi('profile.misc', 'persona_facts', '他说：喜欢猫')]).map((x) => x.source)[0] === 'persona_facts',
  '#1 同 content persona(3)>user(2) 仍赢');
const idDedup = dedupFacts([fi('identity.name', 'companions', '名字：test_companion_a', { layer: 'identity_core' }), fi('identity.name', 'persona_facts', '名字：若溪')]);
ok(idDedup.length === 1 && idDedup[0].source === 'companions', '#1 companions identity 槽 persona 不反向覆盖(companionIdentitySlots 不回归)');

// ════════════════ #2 (a) seed 同 content 赢 persona·让位 canonical（非 critical 槽隔离 a）═══════
const a1 = dedupFacts([fi('profile.growth', 'character_seed', '成长：高中住校三年'), fi('profile.growth', 'persona_facts', '成长：高中住校三年')]);
ok(a1.length === 1 && a1[0].source === 'character_seed', '#2(a) 同 content 非 critical 槽：seed(3.5)>persona(3) 赢');
const a2 = dedupFacts([fi('profile.growth', 'character_seed', '成长：高中住校三年'), fi('profile.growth', 'shared_memory', '成长：高中住校三年')]);
ok(a2.length === 1 && a2[0].source === 'shared_memory', '#2(a) seed 让位 canonical：shared(4)>seed(3.5)');

// ════════════════ #3 (b) seed 同 critical self 槽不同 content 压 persona/user/session ═══════════
const c1 = dedupFacts([
  fi('family.father_occupation', 'character_seed', '爸爸：出租车司机', { _seedOwnsSlot: true }),
  fi('family.father_occupation', 'persona_facts', '爸爸：开小超市'),
  fi('family.father_occupation', 'user_fact', '他说：你爸是医生'),
  fi('family.father_occupation', 'session_overlay', 'RP：你爸是律师'),
]);
ok(c1.length === 1 && c1[0].source === 'character_seed', '#3(b) seedOwnedSlots：critical self 槽不同 content→压 persona/user/session·seed 独占');
// e2e：persona 落 father_occupation(医生·有职业词)被 (b) 丢·seed 出租车司机胜出
const utDad = '你爸是不是开出租的';
const tDad = detectFactTopics(utDad);
ok(tDad.slots.includes('family.father_occupation'), '#3 前置：detectFactTopics("你爸是不是开出租的")→触发 father_occupation');
const snap3 = buildCanonicalFactSnapshot(comp, { userText: utDad, factTopics: tDad, personaFacts: [{ category: 'family', content: '爸爸是医生' }], selfSeedFacts: seedMetaToFactItems(normalMeta) });
const r3 = renderFactSnapshot(snap3, tDad);
ok(r3.includes('出租车司机') && !r3.includes('医生'), '#3(b) e2e：critical 槽 seed(出租车司机)压 persona(医生)·persona 被丢');

// ════════════════ #4 🔴 canonical 压 seed（GPT 抓的对称漏洞·直测 dedupFacts·当前架构不可达）═══
const d1 = dedupFacts([
  fi('family.father_occupation', 'shared_memory', '共同经历：你爸是医生'),
  fi('family.father_occupation', 'character_seed', '爸爸：出租车司机', { _seedOwnsSlot: true }),
  fi('family.father_occupation', 'persona_facts', '爸爸：开小超市'),
]);
ok(d1.length === 1 && d1[0].source === 'shared_memory', '#4🔴 canonicalOwnedSlots：shared_memory 不同 content→压 seed+persona(用户亲手真相最高)');
const d2 = dedupFacts([
  fi('profile.occupation', 'companions', '职业：医生'),
  fi('profile.occupation', 'character_seed', '职业：书店店员', { _seedOwnsSlot: true }),
]);
ok(d2.length === 1 && d2[0].source === 'companions', '#4 canonicalOwnedSlots：companions 同理压 seed');

// ════════════════ #5 🔴 safe_default 不参与 slot 压制（泛化填充不该压真 persona）════════════════
const sdFacts = seedMetaToFactItems(buildSafeDefaultCharacter());
ok(sdFacts.length > 0 && sdFacts.every((f) => f.priority <= 28), '#5 前置：safe_default 整份被 C1 压到 ≤28(C2 据此识别)');
ok(sdFacts.some((f) => f.slot === 'family.father_occupation'), '#5 前置：safe_default 确实产 critical 槽(「上班族」→father_occupation·正是须排除的原因)');
const snap5 = buildCanonicalFactSnapshot(comp, { userText: utDad, factTopics: tDad, personaFacts: [{ category: 'family', content: '爸爸是医生' }], selfSeedFacts: sdFacts });
ok(renderFactSnapshot(snap5, tDad).includes('医生'), '#5🔴 e2e：safe_default 兜底不夺槽·真 persona(医生)仍在');
const sdItem = snap5.facts.find((f) => f.source === 'character_seed' && f.slot === 'family.father_occupation');
ok(!sdItem || (!sdItem._seedOwnsSlot && sdItem.priority !== 75), '#5 safe_default seed 不标 _seedOwnsSlot·不 75 提权');
const sdDirect = dedupFacts([fi('family.father_occupation', 'character_seed', '爸爸：普通上班族'), fi('family.father_occupation', 'persona_facts', '爸爸是医生')]);
ok(sdDirect.length === 2, '#5 safe_default seed(无 _seedOwnsSlot)不进 seedOwnedSlots→persona 不被压·两条共存');

// ════════════════ #6 identity_pins / triggered_facts 必保（seed 不挤）+ 75 提权 ════════════════
const fillers = [];
for (let i = 1; i <= 40; i++) fillers.push({ category: 'habits', content: `无关填充第${i}条·日常琐事不影响身份` });
const snap6 = buildCanonicalFactSnapshot(comp, { userText: utDad, factTopics: tDad, personaFacts: fillers, selfSeedFacts: seedMetaToFactItems(normalMeta) });
ok(snap6.facts.some((f) => f.bucket === 'identity_pins' && f.slot === 'identity.name'), '#6 identity_pins 必保(seed 不挤掉名字)');
const fatherSeed = snap6.facts.find((f) => f.source === 'character_seed' && f.slot === 'family.father_occupation');
ok(fatherSeed && fatherSeed.bucket === 'triggered_facts', '#6 seed father_occupation 命中 topic→triggered_facts(置顶·必保)');
ok(fatherSeed && fatherSeed.priority === 75, '#6 critical self 槽 seed priority→75 提权(压 persona.critical 70)');
const innerItem = snap6.facts.find((f) => f.slot === 'profile.inner_summary');
ok(!innerItem || innerItem.bucket === 'critical_profile_pins', '#6 inner_summary 常驻 critical_profile_pins(其余 background)');

// ════════════════ #7 relationship_seed / 关系泄漏永不进 snapshot ════════════════════════════
const seedItems = seedMetaToFactItems(normalMeta);
ok(seedItems.every((f) => f.layer !== 'relationship_core' && !f.slot.startsWith('relationship.')), '#7 结构保证：seed 永无 relationship_core / relationship.* 槽(不可能成共同经历支持源)');
const dirtyMeta = { character_core: { inner_summary: '普通女孩' }, self_facts: { family: [{ who: '青梅竹马', detail: '我们和你一起长大' }], close_friend_anchor: { nickname: '你', knows_current_chat_partner: true } } };
const dirtyFacts = seedMetaToFactItems(dirtyMeta);
ok(!dirtyFacts.some((f) => /青梅竹马|和你|你们|同居|前任/.test(f.content)), '#7 C1 桥：关系泄漏整条丢弃(guardGeneratedText)+ knows=true close_friend 不 emit');
const snap7 = buildCanonicalFactSnapshot(comp, { userText: '我们是青梅竹马吧', selfSeedFacts: dirtyFacts });
ok(!snap7.facts.some((f) => f.source === 'character_seed' && (f.slot.startsWith('relationship.') || /青梅竹马|和你|同居|前任/.test(f.content))), '#7 snapshot：character_seed 永不进 relationship.* / 无关系禁词');

// ════════════════ #8 🔴 青梅竹马双向（无 shared_memory 不支持 / 有则放行·别写死永远禁）═══════
const utCMZM = '我们是青梅竹马吧';
const tCMZM = detectFactTopics(utCMZM);
const compNoShare = { name: 'test_companion_a', age: 22, safe_mode: 0, shared_memory: '' };
const withSeed = buildCanonicalFactSnapshot(compNoShare, { userText: utCMZM, factTopics: tCMZM, selfSeedFacts: seedMetaToFactItems(normalMeta) });
const noSeed = buildCanonicalFactSnapshot(compNoShare, { userText: utCMZM, factTopics: tCMZM });
ok(withSeed.sharedHistoryStatus && /没有真实经历记录/.test(withSeed.sharedHistoryStatus) && /青梅竹马/.test(withSeed.sharedHistoryStatus), '#8a 无 shared_memory：青梅竹马→"没有真实经历记录"(seed 不能凭空支持)');
ok(withSeed.sharedHistoryStatus === noSeed.sharedHistoryStatus, '#8a seed 对共同经历状态中性：加 selfSeedFacts 不改变 sharedHistoryStatus(不凭空造支持·也不抹掉)');
// 有合法 shared_memory 时放行(同校)——seed 在场也不破坏 PR-3.1 放行
const utSchool = '我们小时候一个学校的，一起上学';
const tSchool = detectFactTopics(utSchool);
const snapSup = buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 22, safe_mode: 0, shared_memory: '我们高中同班、一起上学' }, { userText: utSchool, factTopics: tSchool, selfSeedFacts: seedMetaToFactItems(normalMeta) });
ok(scrubUnsupportedSharedTopicConfirmation('对呀那时候确实同班', tSchool, snapSup) === '对呀那时候确实同班', '#8b 有 shared_memory：同班确认放行(不写死永远禁·seed 在场不破坏放行)');

// ════════════════ #9 预算 1400/1600 不超·identity/triggered 必保 ═══════════════════════════
const bigMeta = {
  character_core: { inner_summary: '内核'.repeat(40), formative_chain: '长成长叙事'.repeat(200) },
  self_facts: { family: [{ who: '爸爸', detail: '出租车司机，常年跑夜班见多识广' }], growth: [{ event: '成长'.repeat(120) }] },
  values_core: { life_attitude: { text: '态度'.repeat(120) }, boundaries: { text: '边界'.repeat(120) } },
};
const snap9 = buildCanonicalFactSnapshot(comp, { userText: utDad, factTopics: tDad, selfSeedFacts: seedMetaToFactItems(bigMeta) });
const r9 = renderFactSnapshot(snap9);
ok(r9.length <= 1600, `#9 预算硬顶：渲染 ≤1600(实际 ${r9.length})`);
ok(snap9.facts.some((f) => f.bucket === 'identity_pins'), '#9 超预算 identity_pins 仍保');
ok(snap9.facts.some((f) => f.bucket === 'triggered_facts'), '#9 超预算 triggered_facts 仍保(seed 长 backstory 灌不爆必保桶)');

// ════════════════ #10 proactive/playground 结构性不受影响（C2 只动 reply 路径）═════════════════
const proSrc = readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
const pgSrc = readFileSync(new URL('../src/playground.mjs', import.meta.url), 'utf8');
ok(!/buildCanonicalFactSnapshot\s*\(/.test(proSrc), '#10 proactive.mjs 不调 buildCanonicalFactSnapshot(零风险)');
ok(!/buildCanonicalFactSnapshot\s*\(/.test(pgSrc), '#10 playground.mjs 不调 buildCanonicalFactSnapshot');

// ════════════════ #11 C2 不新增 LLM·不 wire 创建链（C3 才做）═══════════════════════════════
const fgSrc = readFileSync(new URL('../src/fact_guard.mjs', import.meta.url), 'utf8');
const botSrc = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
ok(!/generateSelfFacts/.test(fgSrc) && !/from '\.\/(ai|chat)\.mjs'/.test(fgSrc), '#11 fact_guard 无 LLM import·不调 generateSelfFacts(C2 不新增 LLM)');
ok(/seedMetaToFactItems\(companion\.character_seed_meta[,)]/.test(botSrc) && !/generateSelfFacts/.test(botSrc), '#11 bot.mjs C2 caller 只消费已有 meta(seedMetaToFactItems·可带 friendNick 统一 opts)·不在 reply 链生成(创建链=C3)');

console.log(`\nfact_self_seed_recall_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
