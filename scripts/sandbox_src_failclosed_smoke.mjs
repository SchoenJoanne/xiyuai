#!/usr/bin/env node
/**
 * sandbox_src_failclosed_smoke — chip① 坏版本验红（确定性·无 DB·无网络）。
 *
 * 验 resolveSandboxSrcDb 的 fail-closed 契约：无显式源必抛 SandboxSrcError·绝不默认生产；
 *   显式 SANDBOX_SRC_DB（sandbox 亦接受 DB_PATH）正常返回；模块源无"|| 默认生产路径"兜底（reverse-pin）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import fs from 'node:fs';
import { resolveSandboxSrcDb, SandboxSrcError } from './sandbox_src_db.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const throwsSbx = (fn) => { try { fn(); return false; } catch (e) { return e instanceof SandboxSrcError; } };

console.log('── fail-closed：无显式源必抛（绝不默认生产）·坏版本验红 ──');
ok(throwsSbx(() => resolveSandboxSrcDb({}, {})), '🔴 空 env → 抛 SandboxSrcError（不返回生产路径）');
ok(throwsSbx(() => resolveSandboxSrcDb({ DB_PATH: '/tmp/x.db' }, { allowDbPath: false })), '🔴 allowDbPath=false 时 DB_PATH 不算源 → 抛（burst_eval/stress_chat 语义）');
ok(throwsSbx(() => resolveSandboxSrcDb({ FOO: 'bar' }, { allowDbPath: true })), '🔴 无关 env → 抛');
ok(throwsSbx(() => resolveSandboxSrcDb({ DB_PATH: '/opt/xiyu-ai-new/data/bot.db' }, { allowDbPath: true })), '🔴 DB_PATH=生产库(非/tmp/) + allowDbPath → 抛（Fable5 坑口：.env 的 DB_PATH 不得成隐式兜底）');

console.log('── 显式源正常返回 ──');
ok(resolveSandboxSrcDb({ SANDBOX_SRC_DB: '/tmp/syn.db' }, {}) === '/tmp/syn.db', 'SANDBOX_SRC_DB → 原样返回');
ok(resolveSandboxSrcDb({ DB_PATH: '/tmp/y.db' }, { allowDbPath: true }) === '/tmp/y.db', 'allowDbPath=true 时 DB_PATH → 返回（sandbox.mjs 语义·保 D1 DB_PATH 用法）');
ok(resolveSandboxSrcDb({ SANDBOX_SRC_DB: '/opt/xiyu-ai-new/data/bot.db' }, {}) === '/opt/xiyu-ai-new/data/bot.db', '显式指生产 → 允许（deliberate·非默认兜底）');

console.log('── 🔴 模块源无"默认生产路径"字面兜底（reverse-pin·守 fail-closed 永不回归）──');
const src = fs.readFileSync(new URL('./sandbox_src_db.mjs', import.meta.url), 'utf8');
ok(!/\|\|\s*['"`]\/opt\/xiyu-ai-new\/data\/bot\.db['"`]/.test(src), '🔴 无 `|| \'/opt/.../bot.db\'` 兜底（生产路径只在报错文案里出现·非默认值）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} sandbox_src_failclosed 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
