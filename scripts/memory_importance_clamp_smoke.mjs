#!/usr/bin/env node
/**
 * memory_importance_clamp_smoke — chip③ 坏版本验红（确定性·无网络）。
 *
 * 起因(2026-07-03)：月压缩批 plan_tasks 写 importance=15 撞 companion_memories 的
 *   CHECK(importance BETWEEN 1 AND 10) → INSERT throw → 吞进 WARN → 原条目永不压缩。
 * 修：写入点钳到合法域(15→10) + saveMemory/saveMemories 防御性 clampImportance（双层）。
 *
 * 验：① clampImportance 钳位正确 ② CHECK(1-10)=历史失败形态（raw INSERT 15 必 throw·clamp 后不 throw）
 *     ③ saveMemory/saveMemories 体内真调 clampImportance（源断言·防回退） ④ plan_tasks 写入点 ≤10（reverse-pin）
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { clampImportance } from '../src/db.mjs';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

console.log('── ① clampImportance 钳位 ──');
ok(clampImportance(15) === 10, '15 → 10（超上限钳顶）');
ok(clampImportance(0) === 1, '0 → 1（低于下限钳底）');
ok(clampImportance(-3) === 1, '-3 → 1');
ok(clampImportance(11) === 10, '11 → 10');
ok(clampImportance(1) === 1 && clampImportance(10) === 10, '边界 1/10 原样');
ok(clampImportance(5) === 5, '5 → 5（合法域原样）');
ok(clampImportance(7.6) === 8, '7.6 → 8（四舍五入后仍在域内）');
ok(clampImportance('abc') === 5 && clampImportance(null) === 5 && clampImportance(undefined) === 5, '非有限值 → 5 默认');

console.log('── ② CHECK(1-10)=历史失败形态·坏版本验红 ──');
const DB = `/tmp/mic_${Date.now()}.db`;
const db = new Database(DB);
db.exec('CREATE TABLE m (id INTEGER PRIMARY KEY, importance INTEGER DEFAULT 5 CHECK(importance BETWEEN 1 AND 10));');
const ins = db.prepare('INSERT INTO m (importance) VALUES (?)');
let threw = false;
try { ins.run(15); } catch { threw = true; }
ok(threw, '🔴 坏版本：raw INSERT importance=15 撞 CHECK → throw（= 月压缩批历史失败形态·吞进 WARN）');
let okRun = false;
try { ins.run(clampImportance(15)); okRun = true; } catch { /* okRun 保持 false */ }
ok(okRun, '🔴 修后：INSERT clampImportance(15)=10 → 成功（压缩产物正常落库）');
const row = db.prepare('SELECT importance FROM m ORDER BY id DESC LIMIT 1').get();
ok(row.importance === 10, '落库 importance = 10（在合法域 1-10 内）');
db.close(); fs.rmSync(DB, { force: true });

console.log('── ③ saveMemory/saveMemories 真调 clampImportance（源断言·防回退）──');
const dbSrc = fs.readFileSync(new URL('../src/db.mjs', import.meta.url), 'utf8');
ok(/const imp = clampImportance\(importance\)/.test(dbSrc), '🔴 saveMemory 定义 imp = clampImportance(importance)');
ok(/const imp = clampImportance\(m\.importance\)/.test(dbSrc), '🔴 saveMemories 定义 imp = clampImportance(m.importance)');
ok(/vals = \[companionId, userId, memoryType, content, imp,/.test(dbSrc), '🔴 saveMemory INSERT vals 用钳后的 imp（非原始 importance）');

console.log('── ④ plan_tasks 写入点 ≤10（reverse-pin·守 >10 永不回归）──');
const ptSrc = fs.readFileSync(new URL('../src/plan_tasks.mjs', import.meta.url), 'utf8');
ok(!/importance:\s*(1[1-9]|[2-9]\d)\b/.test(ptSrc), '🔴 plan_tasks 无 importance>10 的写入（月压缩用 10=合法域上限）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} memory_importance_clamp 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
