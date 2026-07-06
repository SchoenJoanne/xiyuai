#!/usr/bin/env node
/**
 * kaomoji_conditional_smoke —— A2（停板B·D3 批1 条目8）kaomoji 矛盾条件化·坏版本验红（确定性·进 CI）。
 *
 * 疑点1-7：§8 `use_kaomoji=1`「你喜欢用颜文字」允许 与 §18「绝对不要 kaomoji」禁令并存=自相矛盾。
 * 修：§18 禁令行仅 `!c.use_kaomoji` 渲染=解矛盾（无出站守卫，故规则保留只解矛盾）。
 *
 * 🔴 红验重心（维护者 备忘）=**use_kaomoji=0（默认）走 else 分支渲染字节一致**（防漂）；=1 时禁令不渲染。
 * 坏版本验红：
 *   ①去条件化(禁令恒渲染) → use_kaomoji=1 仍含"绝对不要 kaomoji" → 红。
 *   ②条件反转(`use_kaomoji ? 禁令 : ''`) → use_kaomoji=0 丢禁令 → 字节一致断言红。
 *   ③else 文本漂移(改一字) → BAN_BLOCK 字节锚定红。
 *
 * 🔴 DB_PATH 硬闸：显式非 /tmp→拒;未设→默认 /tmp。跑：DB_PATH=/tmp/km.db node scripts/kaomoji_conditional_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/km.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/km_cond_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');
const { buildSystemPrompt } = await import('../src/companion.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// §18 禁令行的**字节精确**副本（backtick 转义与 companion.mjs 源同形）。
const BAN_LINE = `- ❌ **绝对不要 kaomoji**：(。·ω·。)/♡、(≧∇≦)、(｡♥‿♥｡)、('´:_:\`)、ヾ(•ω•\`)o 这些一律禁止，一个都不能出现`;
// 前后行锚定块：证 else 分支不仅有禁令行、且拼接位置字节一致（前=【AI 味绝对禁忌】·后=不要连用感叹号）。
const BAN_BLOCK = `【AI 味绝对禁忌】\n${BAN_LINE}\n- ❌ **不要连用感叹号**`;

console.log('── 🔴 use_kaomoji=0（默认·falsy）=禁令块字节一致(else 防漂) ──');
const sysOff = buildSystemPrompt({ name: '小测' });
ok(sysOff.includes(BAN_BLOCK), '🔴 use_kaomoji 未设: §18 kaomoji 禁令块【字节一致】(前后行锚定·else 分支防漂)');
ok(!sysOff.includes('你喜欢用颜文字'), 'use_kaomoji 未设: §8 允许行不注入(无允许/禁止并存矛盾)');

const sysOff2 = buildSystemPrompt({ name: '小测', use_kaomoji: 0 });
ok(sysOff2.includes(BAN_BLOCK), 'use_kaomoji=0（显式）: 禁令块字节一致');

console.log('── 🔴 use_kaomoji=1 =禁令不渲染(解矛盾)·§8 允许在·邻行不误删 ──');
const sysOn = buildSystemPrompt({ name: '小测', use_kaomoji: 1 });
ok(!sysOn.includes('绝对不要 kaomoji'), '🔴 use_kaomoji=1: §18 kaomoji 禁令行不渲染(矛盾解除)');
ok(sysOn.includes('你喜欢用颜文字'), 'use_kaomoji=1: §8 允许行在(她真用颜文字=一致不矛盾)');
ok(sysOn.includes('【AI 味绝对禁忌】\n- ❌ **不要连用感叹号**'),
   'use_kaomoji=1: 只摘 kaomoji 整行(块无残留/空行错位·邻禁忌行全在)');
ok(sysOn.includes('不要"反应+夸+问+建议"四件套') && sysOn.includes('不要每条都问问题'),
   'use_kaomoji=1: §18 其余 AI 味禁忌行(四件套/每条问问题等)未被误删');

console.log('── 🔴 §18 差异隔离=纯 kaomoji 行（改非 no-op·邻行零牵动）──');
// 注：use_kaomoji=1 同时(a)移除 §18 禁令(b)新增 §8「你喜欢用颜文字」允许行→全局长度差被 §8 混淆，
// 故不比全局长度；改为隔离 §18：off 去掉整条 kaomoji 行(含前导\n)后应还原成 on 的「块头直接接下一禁忌行」形态。
ok(sysOff !== sysOn, '🔴 off≠on(条件化真生效)');
ok(sysOff.replace('\n' + BAN_LINE, '').includes('【AI 味绝对禁忌】\n- ❌ **不要连用感叹号**'),
   '🔴 off 去掉整条 kaomoji 行→§18 块头直接接下一禁忌行=on 形态(§18 差异纯该行·邻行零牵动)');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} A2 kaomoji 条件化验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
