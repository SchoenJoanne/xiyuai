#!/usr/bin/env node
/**
 * fact_topic_recall_smoke —— PR-3.1 commit A 核心红验（¥0·零 LLM·治洞B）。
 *
 * 证明 topic-aware canonical 召回：用户碰"爸/学校"槽位时，被截断淹没的硬事实（如第30条爸爸职业）
 * 被精确召回置顶到【本轮相关硬事实】(triggered_facts 桶)，而非死在 slice(0,6) 之外。
 * 🔴 同时锁死 commit A 边界=【只渲染事实·绝不渲染行为】。
 *
 * 隐私：纯合成 companion（test_companion_a·绝不用真实用户名）+ 纯函数·零 DB·零真实数据。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { detectFactTopics, inferFactSlot, buildCanonicalFactSnapshot, renderFactSnapshot } from '../src/fact_guard.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };
const section = (rendered, title) => (String(rendered || '').split('\n').find((l) => l.startsWith(`【${title}】`)) || '');

// ── 合成 companion + 49 条 profile_core·爸爸职业埋在第 30 条 ──────────────────────
const FILLER_CATS = ['childhood', 'school', 'habits', 'values', 'fears', 'music_taste'];
const fillers = [];
for (let i = 1; i <= 49; i++) {
  if (i === 30) fillers.push({ category: 'family', content: '爸爸是出租车司机，常年在路上跑车' });   // ★第30条·会被旧 slice(0,6) 淹没
  else fillers.push({ category: FILLER_CATS[i % FILLER_CATS.length], content: `无关填充设定第${i}条·记些日常琐事不影响身份` });
}
const comp = { name: 'test_companion_a', age: 22, safe_mode: 0, role_title: '护士', relationship_stage: '朋友', shared_memory: '' };

// ── 🔴 核心证明（治洞B）：提"爸/老师"→第30条爸爸职业召回置顶 triggered_facts ──────────
const userText = '我们小时候一个学校的，你爸还是老师';
const topics = detectFactTopics(userText);
ok(topics.slots.includes('family.father_occupation'), '①detectFactTopics："你爸还是老师"→father(虚词"还"不漏)');
ok(topics.slots.includes('relationship.shared_school'), '①detectFactTopics："一个学校"→shared_school');
const snap = buildCanonicalFactSnapshot(comp, { userText, factTopics: topics, personaFacts: fillers });
const rendered = renderFactSnapshot(snap, topics);
ok(rendered.includes('【本轮相关硬事实】'), '🔴核心：snapshot 含【本轮相关硬事实】区块');
ok(section(rendered, '本轮相关硬事实').includes('出租车司机'), '🔴核心：第30条"出租车司机"被召回置顶【本轮相关硬事实】(治洞B·不再被 slice 淹没)');
ok(/爸|父亲/.test(section(rendered, '本轮相关硬事实')), '🔴核心：该区块含爸爸/父亲槽位语义');
const fatherItem = snap.facts.find((f) => f.slot === 'family.father_occupation');
ok(fatherItem && fatherItem.bucket === 'triggered_facts', '🔴核心：father_occupation 在 triggered_facts 桶(置顶召回·非碰巧出现在 snapshot 某处)');

// ── GPT 加①：inferFactSlot content 优先于 category（生产 bug 根因之一）──────────────
ok(inferFactSlot('childhood', '爸爸是出租车司机，常年在路上') === 'family.father_occupation', '🔴加①content优先：category=childhood+content爸爸职业→father(不被 category 拖走)');
ok(inferFactSlot('family', '喜欢吃酱油拌饭') !== 'family.father_occupation', '加①content优先：category=family 但内容是吃的→不误判 father');

// ── GPT 加②：A 渲染绝不输出行为 hint（锁死 A 边界·防变半个 B）──────────────────────
ok(!/不要确认|不要补|可以转\s*RP|不能补细节|别确认|别补|当设定|查无此事/.test(rendered), '🔴加②：renderFactSnapshot 渲染串【不含】行为指令(不要确认/不要补/可转RP/不能补细节)');

// ── 配套：脏数据 identity 不被带跑 ──────────────────────────────────────────────
const dirty = buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 22, safe_mode: 0 }, { userText: '你不是若溪吗', personaFacts: [{ category: '名字', content: '她其实叫若溪' }] });
const dr = renderFactSnapshot(dirty, detectFactTopics('你不是若溪吗'));
ok(section(dr, '她确定知道的身份事实').includes('test_companion_a') && !section(dr, '她确定知道的身份事实').includes('若溪'), '配套：脏 persona"她叫若溪"不进身份核心·identity 仍 test_companion_a');

// ── 配套：同 slot 冲突 role_title=护士 vs persona"她是老师"→companions 为准 ──────────
const roleConf = buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 22, safe_mode: 0, role_title: '护士' }, { userText: '你是老师吗', personaFacts: [{ category: '身份', content: '她是老师' }] });
ok(section(renderFactSnapshot(roleConf), '她确定知道的身份事实').includes('护士'), '配套：同 slot 冲突→role_title 以 companions(护士)为准');

// ── 配套：成年来自 age 非 safe_mode ────────────────────────────────────────────
ok(renderFactSnapshot(buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 22, safe_mode: 0 }, { userText: '你几岁' })).includes('22岁（成年）'), '配套：成年来自 age=22(非 safe_mode)');
const minor = renderFactSnapshot(buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 16, safe_mode: 1 }, {}));
ok(minor.includes('未成年') && minor.includes('安全模式'), '配套：safe_mode 单独标·不冒充成年(16岁→未成年+安全模式)');

// ── 配套：预算挤压·49 条下 father 进 triggered + identity 在 + ≤1600 字 ──────────────
ok(snap.facts.some((f) => f.bucket === 'identity_pins' && f.slot === 'identity.name'), '配套：预算挤压下 identity_pins 仍在');
ok(rendered.length <= 1600, `配套：snapshot 渲染 ≤1600 字(实际 ${rendered.length})`);

// ── 误召回负例（GPT 要求必过）──────────────────────────────────────────────────
ok(!detectFactTopics('你以前老师凶不凶').slots.includes('family.father_occupation'), '负例："你以前老师凶不凶"→不触发 father(无父亲词)');
ok(!detectFactTopics('老师今天批评我了').slots.includes('family.father_occupation'), '负例："老师今天批评我了"→不触发 father');
ok(!detectFactTopics('我今天上学迟到').slots.includes('relationship.shared_school'), '负例："我今天上学迟到"→不触发 shared_school(无共同语境)');
ok(!detectFactTopics('高中数学好难').slots.includes('relationship.shared_school'), '负例："高中数学好难"→不触发 shared_school');

// ── father 正例覆盖（GPT 指定·含虚词/倒装/异职业）─────────────────────────────────
for (const t of ['你爸还是老师', '你爸爸以前不是教书的吗', '你爸不就是老师吗', '老师不是你爸吗', '你父亲是开出租的吗']) {
  ok(detectFactTopics(t).slots.includes('family.father_occupation'), `father 正例："${t}"→触发`);
}

// ── role 要句式·不裸职业词 ──────────────────────────────────────────────────────
ok(detectFactTopics('你是老师吗').slots.includes('identity.role'), 'role："你是老师吗"→触发(句式)');
ok(!detectFactTopics('你以前老师凶不凶').slots.includes('identity.role'), 'role："你以前老师凶不凶"→不触发(裸职业词)');
ok(detectFactTopics('青梅竹马').slots.includes('relationship.childhood_sweetheart'), 'topic：青梅竹马→childhood_sweetheart');

// ── 兼容旧签名（防炸旧链路）──────────────────────────────────────────────────────
ok(Array.isArray(buildCanonicalFactSnapshot(comp).facts), '兼容：buildCanonicalFactSnapshot(companion) 旧签名不炸·返回 {facts}');
ok(Array.isArray(buildCanonicalFactSnapshot(comp, {}).facts), '兼容：buildCanonicalFactSnapshot(companion,{}) 不炸');

console.log(`\nfact_topic_recall_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
