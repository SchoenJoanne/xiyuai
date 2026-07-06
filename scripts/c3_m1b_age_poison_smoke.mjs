/**
 * c3_m1b_age_poison_smoke.mjs —— M1b inside_joke 梗年龄毒化过滤（批C·C3·确定性零 LLM）
 *
 * M1a 本批不做（维护者 拍·降级子问题「对话→她自我认知渗透通道盘点」·前提被戳破：extractAndSaveMemories
 *   流的是用户 facts 非她自述·盲扫必误杀合法用户年龄·她 age 锚 character_seed 非真向量）。本批只治 M1b。
 *
 * 覆盖：
 *   - M1b 契约（stripAgeYearDrift·单源同源）：「28岁大姐姐」→存「大姐姐」/「22岁大姐姐」=档案→原样(防矫枉)/
 *     「叫姐姐」无岁→原样/「28岁」整体毒→reject
 *   - memory.mjs 接线静态断言（extractAndSaveMemories 需 LLM·照 photo_promise_smoke 静态验接线）：
 *     inside_joke 循环 apply stripAgeYearDrift·cleaned===null 整条 reject(continue 不 upsert)·getCompanionById age
 *     取档案·m1bRejected 计数+log(rejected 蒸发可见)·fail-open(无 age 不伸手)
 *
 * 🔴 坏版本红验映射：
 *   memory.mjs 去 stripAgeYearDrift 调用 → ② 接线断言变红
 *   去 cleaned===null reject（照存）→ ③ reject 断言变红
 *   stripAgeYearDrift 去防矫枉（连 22岁 也剥）→ ①c 变红（fact_age_scan ⑥h 亦红）
 */
import { readFileSync } from 'node:fs';
import { stripAgeYearDrift } from '../src/fact_age_scan.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

// ── ① M1b 契约（单源 stripAgeYearDrift·档案 age=22） ──
console.log('── ① M1b 毒化过滤契约 ──');
ok(stripAgeYearDrift('28岁大姐姐', 22) === '大姐姐', '①a 「28岁大姐姐」→存「大姐姐」(梗留毒除)');
ok(stripAgeYearDrift('叫姐姐', 22) === '叫姐姐', '①b 「叫姐姐」无岁标记→原样(梗活着)');
ok(stripAgeYearDrift('22岁大姐姐', 22) === '22岁大姐姐', '①c 「22岁大姐姐」=档案→原样(防矫枉·真值梗不剥)');
ok(stripAgeYearDrift('28岁', 22) === null, '①d 「28岁」整体=毒→reject(null·不入 lexicon)');
ok(stripAgeYearDrift('买了28支花', 22) === '买了28支花', '①e 非岁标记数字不误咬(记忆误 reject 代价=丢合法梗)');

// ── ② memory.mjs M1b 接线静态断言 ──
console.log('── ② memory.mjs 接线（inside_joke 循环 apply M1b） ──');
const mem = readFileSync(new URL('../src/memory.mjs', import.meta.url), 'utf8');
ok(/import\s*\{\s*stripAgeYearDrift\s*\}\s*from\s*'\.\/fact_age_scan\.mjs'/.test(mem), '②a import stripAgeYearDrift 自单源');
// 定位 inside_joke 循环块
const jokeBlock = mem.slice(mem.indexOf('批C·M1b'), mem.indexOf('const candidates'));
ok(jokeBlock.includes('stripAgeYearDrift(content'), '②b inside_joke 循环内 apply stripAgeYearDrift');
ok(jokeBlock.includes('getCompanionById(companionId)') && jokeBlock.includes('.age'), '②c 取档案 age 作 trueAge');
ok(/cleaned === null[^]*?continue/.test(jokeBlock), '②d cleaned===null → continue(整条 reject·不 upsert)');
ok(jokeBlock.includes('m1bRejected'), '②e reject 计数 m1bRejected');

// ── ③ fail-open：无档案 age → 不伸手（原样 upsert） ──
console.log('── ③ fail-open ──');
ok(/_m1bTrueAge\s*!=\s*null\s*&&\s*Number\.isFinite/.test(jokeBlock), '③a 无 age / 非有限 → 跳过过滤(不伸手)');
ok(jokeBlock.includes('content.slice(0, 60)') || jokeBlock.includes('content.slice(0,60)'), '③b upsert 用过滤后 content(非原 j.content)');

// ── ④ rejected 蒸发可见（非静默丢·沿 reflection 先例） ──
console.log('── ④ rejected 可见 ──');
ok(/m1bRejected\)?\s*log\('info'|m1bRejected\) log/.test(mem) || (mem.includes('M1b 年龄毒化过滤 reject') && mem.includes("log('info'")), '④ reject>0 → log info(digest 可见·非静默)');

console.log(`\n══ c3_m1b_age_poison smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
