/**
 * c1_p2_age_probe_smoke.mjs —— P2 入站直问年龄触发面（批C·C1·确定性零 LLM）
 *
 * 覆盖（四栏对照表·验收）：
 *   - detectFactTopics：四直问变体（含旧漏「你今年到底多大了」「你现在多大」）+ 你的年龄 → identity.age slot
 *   - classifyFactIntent：直问年龄 → 新 intent age_probe（旧全 'none'→快照缺席）
 *   - age_probe distinct：≠ ident_probe(AI探针·IDENT_COND) / ≠ mistaken_id(认错名) —— 不复用不污染
 *   - INTENT_HINT.age_probe：年龄真值锚+快照·过 user_wording_guard(无"用户")·非套设定话术
 *   - analyzeFactGuard：age_probe → hint 含 snap(age真值) + age_probe 细则
 *   - 影响面：仅直问轮注入·非直问轮/普通闲聊零变化
 *   - 非回归：mistaken_id / ident_probe 判定不被 age_probe 抢走
 *
 * 🔴 坏版本红验映射：
 *   classifyFactIntent 去 age_probe 分支 → ② 直问返 'none'(红)
 *   detectFactTopics 退回旧正则 → ① 「你今年到底多大了」漏 identity.age(红)
 *   age_probe hint 复用 IDENT_COND → ④ 含套设定话术/不含年龄锚(红)
 */
import { classifyFactIntent, detectFactTopics, analyzeFactGuard, buildCanonicalFactSnapshot } from '../src/fact_guard.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

// ── ① detectFactTopics：直问年龄触发面放宽（含旧漏变体） ──
console.log('── ① detectFactTopics identity.age 触发面 ──');
for (const q of ['你多大', '你几岁', '你今年到底多大了', '你现在多大', '你的年龄', '你年龄多少']) {
  ok(detectFactTopics(q).slots.includes('identity.age'), `① 「${q}」→ identity.age slot`);
}
ok(!detectFactTopics('你今天心情好吗').slots.includes('identity.age'), '① 不误伤「你今天心情好吗」');
ok(!detectFactTopics('我多大了呀').slots.includes('identity.age'), '① 不误伤「我多大」(非你直问)');

// ── ② classifyFactIntent：直问年龄 → age_probe（旧 'none'） ──
console.log('── ② classifyFactIntent age_probe ──');
for (const q of ['你多大', '你几岁', '你今年到底多大了', '你现在多大呀']) {
  ok(classifyFactIntent(q) === 'age_probe', `② 「${q}」→ age_probe`);
}

// ── ③ age_probe distinct（不抢 ident_probe / mistaken_id / 普通闲聊） ──
console.log('── ③ intent 边界不串 ──');
ok(classifyFactIntent('你是不是AI呀') === 'ident_probe', '③ 「你是不是AI」仍 ident_probe(不被 age_probe 抢)');
ok(classifyFactIntent('你不是若溪吗') === 'mistaken_id', '③ 「你不是若溪吗」仍 mistaken_id');
ok(classifyFactIntent('今天天气真好') === 'none', '③ 普通闲聊仍 none(非直问轮零注入)');
ok(classifyFactIntent('我们来演个设定') === 'rp', '③ 「我们来演」仍 rp(不被抢)');

// ── ④ INTENT_HINT.age_probe：年龄真值锚+快照·非套设定话术·过 user_wording ──
console.log('── ④ age_probe hint 内容 ──');
const AGE_SNAP = buildCanonicalFactSnapshot({ name: 'test_c1', age: 22, safe_mode: 0 }, { userText: '你今年到底多大了' });
const ana = analyzeFactGuard('你今年到底多大了', AGE_SNAP);
ok(ana.intent === 'age_probe', '④a analyzeFactGuard.intent=age_probe');
ok(!/用户/.test(ana.hint), '④b hint 无「用户」(过 user_wording_guard)');
ok(/真实的年龄|据实说|真值/.test(ana.hint), '④c hint 含年龄真值锚');
ok(!ana.hint.includes('系统提示词') && !ana.hint.includes('装傻'), '④d hint 非 ident_probe 套设定话术(不复用 IDENT_COND)');
ok(ana.hint.includes('22岁'), '④e hint 含 snap 渲染的真实年龄(22岁)');

// ── ⑤ 非直问轮零注入（影响面：仅直问轮） ──
console.log('── ⑤ 非直问轮零变化 ──');
ok(analyzeFactGuard('今天累死了', AGE_SNAP).hint === '', '⑤ 普通闲聊 hint 空(intent=none·零注入)');

console.log(`\n══ c1_p2_age_probe smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
