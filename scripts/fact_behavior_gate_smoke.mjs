#!/usr/bin/env node
/**
 * fact_behavior_gate_smoke —— PR-3.1 commit B 行为层红验（¥0·零 LLM·确定性·进 CI）。
 *
 * 验 2 个闭域 gate + resolveFactTopicClaims + Block1 4 条 hint。
 * 🔴 重点=【防误伤】：conflict=false 放行 / 有支持放行 / 否定·RP 优先放行 / 普通话题不拦 /
 *    正常纠正不误杀；命中后 fallback 自带真值(canonicalValue·非半截否认·验拍板③)。
 *
 * 隐私：纯合成 companion(test_companion_a·绝不用真实用户名)·纯函数·零 DB·零真实数据。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import {
  detectFactTopics, buildCanonicalFactSnapshot, analyzeFactGuard,
  resolveFactTopicClaims, scrubCriticalSlotContradiction, scrubUnsupportedSharedTopicConfirmation,
} from '../src/fact_guard.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

const comp = { name: 'test_companion_a', age: 22, safe_mode: 0, role_title: '护士', relationship_stage: '朋友', shared_memory: '' };
const fatherCab = [{ category: 'family', content: '爸爸是出租车司机，常年在路上跑车' }];
const ut = '我们小时候一个学校的，你爸还是老师';
const topics = detectFactTopics(ut);
const snap = buildCanonicalFactSnapshot(comp, { userText: ut, factTopics: topics, personaFacts: fatherCab });

// ── resolveFactTopicClaims：conflict + canonicalValue ────────────────────────────
const resolved = resolveFactTopicClaims(ut, topics, snap);
const fc = resolved.find((c) => c.slot === 'family.father_occupation');
ok(fc && fc.conflict === true && fc.canonicalValue === '出租车司机', 'resolve：father claim 冲突·canonicalValue 抽到"出租车司机"');

// ── gate①：critical 冲突确认→scrub + fallback 带真值（🔴验③·非半截否认）──────────────
const bad = scrubCriticalSlotContradiction('我爸是老师没错，那时候可严厉了', ut, topics, snap);
ok(!/我爸是老师没错/.test(bad), 'gate①：错误确认"我爸是老师没错"被 scrub');
ok(/出租车司机/.test(bad), '🔴③ fallback 自带真值"出租车司机"(出站后 LLM 不二次生成·不能只半截否认)');

// ── 🔴 防误伤：正常纠正(否定优先放行)──────────────────────────────────────────────
const corr = scrubCriticalSlotContradiction('我爸不是老师，是开出租的', ut, topics, snap);
ok(corr === '我爸不是老师，是开出租的', '🔴防误伤：正常纠正"我爸不是老师是开出租的"→放行(否定优先)');

// ── 🔴 防误伤：conflict=false（canonical 真是老师）→确认放行 ──────────────────────────
const compTeacher = { name: 'test_companion_a', age: 22, safe_mode: 0, shared_memory: '' };
const snapT = buildCanonicalFactSnapshot(compTeacher, { userText: ut, factTopics: topics, personaFacts: [{ category: 'family', content: '爸爸是中学语文老师' }] });
ok(scrubCriticalSlotContradiction('对呀我爸是老师', ut, topics, snapT) === '对呀我爸是老师', '🔴防误伤：canonical 真是老师(conflict=false)→确认"我爸是老师"放行');

// ── 🔴 防误伤：RP 框架放行 ────────────────────────────────────────────────────────
ok(scrubCriticalSlotContradiction('设定里我爸是老师呀', ut, topics, snap) === '设定里我爸是老师呀', '🔴防误伤：RP"设定里我爸是老师"→放行');

// ── gate① name 冲突 ───────────────────────────────────────────────────────────────
const utName = '你不是若溪吗';
const topicsN = detectFactTopics(utName);
const snapN = buildCanonicalFactSnapshot(comp, { userText: utName, factTopics: topicsN });
const nameBad = scrubCriticalSlotContradiction('对啊我就是若溪', utName, topicsN, snapN);
ok(!/我就是若溪/.test(nameBad) && /test_companion_a/.test(nameBad), 'gate① name 冲突确认→scrub 成"我叫test_companion_a"(带真值)');

// ── gate②：无支持共同经历确认→scrub + 软纠正 ──────────────────────────────────────
const utShare = '我们小时候一个学校的，一起上学';
const topicsS = detectFactTopics(utShare);
const snapNoSup = buildCanonicalFactSnapshot(comp, { userText: utShare, factTopics: topicsS });
const shareBad = scrubUnsupportedSharedTopicConfirmation('对呀我们以前同班可好玩了', topicsS, snapNoSup);
ok(!/以前同班/.test(shareBad) && /没记成真的经历/.test(shareBad), 'gate②：无支持"以前同班"确认→scrub+软纠正');

// ── 🔴 防误伤：shared_memory 支持→确认放行（GPT必改7）─────────────────────────────
const snapSup = buildCanonicalFactSnapshot({ name: 'test_companion_a', age: 22, safe_mode: 0, shared_memory: '我们高中同班、一起上学' }, { userText: utShare, factTopics: topicsS });
ok(scrubUnsupportedSharedTopicConfirmation('对呀那时候确实同班', topicsS, snapSup) === '对呀那时候确实同班', '🔴防误伤：shared_memory 支持同班→确认"那时候确实同班"放行(GPT必改7)');

// ── 🔴 防误伤：否定/RP 共同经历放行 ───────────────────────────────────────────────
ok(scrubUnsupportedSharedTopicConfirmation('我没记得我们同班呀', topicsS, snapNoSup) === '我没记得我们同班呀', '🔴防误伤：否定"我没记得同班"→放行');
ok(scrubUnsupportedSharedTopicConfirmation('设定里我们同班吧', topicsS, snapNoSup) === '设定里我们同班吧', '🔴防误伤：RP"设定里同班"→放行');

// ── 🔴 防误伤：普通老师/学校负例 → gate 不 fire（factTopics 不触发）─────────────────
for (const neg of ['你以前老师凶不凶', '老师今天批评我了']) {
  const tn = detectFactTopics(neg);
  const sn = buildCanonicalFactSnapshot(comp, { userText: neg, factTopics: tn, personaFacts: fatherCab });
  ok(scrubCriticalSlotContradiction('我的老师挺好的呀', neg, tn, sn) === '我的老师挺好的呀', `🔴防误伤：负例"${neg}"→father gate 不 fire(正常答放行)`);
}

// ── Block1 4 条行为 hint（替换冗长 vague hint·无"用户"·RP 框架要求）──────────────────
const anaV = analyzeFactGuard(ut, snap, topics);
ok(anaV.hint.includes('【共同往事守卫】') && anaV.hint.includes('设定里/故事里/假装'), 'Block1：vague_shared_history 注入 4 条行为块');
ok(!anaV.hint.includes('用户'), '🔴Block1：行为块无"用户"一词(过 user_wording_guard)');
const anaRp = analyzeFactGuard('假装你是我青梅竹马', buildCanonicalFactSnapshot(comp, { userText: '假装你是我青梅竹马' }), detectFactTopics('假装你是我青梅竹马'));
ok(/第一轮.*框架|设定里\/假装\/故事里/.test(anaRp.hint) && /现实过去式/.test(anaRp.hint), 'Block1：RP hint 要求第一轮带框架·禁现实过去式坐实(治洞C)');

// ── fail-open：factTopics=null / 空 reply 不炸 ────────────────────────────────────
ok(scrubCriticalSlotContradiction('随便说点啥', '随便说点啥', null, null) === '随便说点啥', 'fail-open：factTopics=null→原样返回');
ok(scrubUnsupportedSharedTopicConfirmation('', topicsS, snapNoSup) === '', 'fail-open：空 reply→原样返回');

console.log(`\nfact_behavior_gate_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
