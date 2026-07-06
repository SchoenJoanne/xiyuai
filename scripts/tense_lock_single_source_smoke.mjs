#!/usr/bin/env node
/**
 * tense_lock_single_source_smoke —— A1（停板B·D3 批1 条目9·维护者 拍(A)）时态锁单源·防漂 CI 锁·坏版本验红（确定性·进 CI）。
 *
 * 三处时态锁「别说和时间/此刻矛盾的即时态」曾散落漂移→单源=权威模块 `tense_lock_terms.mjs`：
 *   · current_works.mjs → `import { WORKS_TENSE_LOCK }`（真物理单源）。
 *   · companion.mjs（presence/coherence 两处）→ 守「零依赖(无 import)」硬不变量·**保留本地副本**，
 *     与权威模块导出**字节一致由本 smoke 强制**（谁漂谁红=防漂结构强制·物理单份的等价）。
 *
 * 🔴 坏版本验红：改 companion 本地副本任一字 → 与权威模块字节不等 → 红；companion 若被加 import → 零依赖断言红。
 * 🔴 DB_PATH 硬闸。跑：DB_PATH=/tmp/tl.db node scripts/tense_lock_single_source_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/tl.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/tl_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
import { readFileSync } from 'node:fs';
import * as mod from '../src/tense_lock_terms.mjs';
import { buildPresenceTenseLock as compPresence, buildCoherenceTenseLock as compCoherence } from '../src/companion.mjs';
import { buildWorksPromptHint } from '../src/current_works.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// 样本输入（覆盖两处插值位）
const BODY = '- 你今天 09:00 就说过吃早饭了——那是 3 小时前的事';
const POS = '你此刻大概在「教室」。';

console.log('── 🔴 CI 锁：companion 本地副本 === 权威模块导出（逐字节·谁漂谁红=防漂结构强制）──');
ok(compPresence(BODY) === mod.buildPresenceTenseLock(BODY), '🔴 presence 本地副本 === tense_lock_terms（字节一致）');
ok(compCoherence(POS) === mod.buildCoherenceTenseLock(POS), '🔴 coherence 本地副本 === tense_lock_terms（字节一致）');

console.log('── golden：权威模块渲染=规范原文（防两边同时漂）──');
ok(mod.buildPresenceTenseLock(BODY).startsWith('\n\n【★ 此刻连贯·别说和时间或今天已发生的事矛盾的即时状态】\n' + BODY), 'presence 框头+body 原文');
ok(mod.buildPresenceTenseLock(BODY).endsWith('（这只是别自相矛盾，不是规定你必须说什么——任何不矛盾的话都自由发挥。）'), 'presence 框尾原文');
ok(mod.buildCoherenceTenseLock(POS).startsWith('\n\n【★ 开场连贯·别编和此刻矛盾的"刚做完X"】' + POS), 'coherence 框头+posLine 原文');
ok(mod.buildCoherenceTenseLock(POS).endsWith('这只是别穿帮。'), 'coherence 框尾原文');
ok(mod.WORKS_TENSE_LOCK.includes('别把它们说成"刚看完/已读完/已经做好了"'), 'works 进行态锁原文');

console.log('── 单源消费：current_works 真 import 权威模块（lockTense 走 WORKS_TENSE_LOCK）──');
const worksHint = buildWorksPromptHint([{ title: '《活着》', kind: 'book' }], { lockTense: true });
ok(worksHint.includes(mod.WORKS_TENSE_LOCK), '🔴 buildWorksPromptHint(lockTense=true) 含权威 WORKS_TENSE_LOCK（真单源）');
const worksHintNoLock = buildWorksPromptHint([{ title: '《活着》', kind: 'book' }], {});
ok(!worksHintNoLock.includes(mod.WORKS_TENSE_LOCK), 'lockTense=false 不拼（reply 路径字节一致）');
const cwSrc = readFileSync(new URL('../src/current_works.mjs', import.meta.url), 'utf8');
ok(cwSrc.includes("from './tense_lock_terms.mjs'"), 'current_works.mjs import 权威模块');

console.log('── 🔴 companion.mjs 零依赖硬不变量守住（本地副本·非 import）──');
const compSrc = readFileSync(new URL('../src/companion.mjs', import.meta.url), 'utf8');
ok(!/^import\s/m.test(compSrc), '🔴 companion.mjs 仍无 import 语句（零依赖不变量·A1 用本地副本守住）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} A1 时态锁单源验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
