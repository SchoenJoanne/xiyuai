#!/usr/bin/env node
/**
 * diary_config_source_smoke —— A3（停板B·D5 日记「配置级」）日记长度/maxTokens 抽配置·单源·坏版本验红（确定性·进 CI）。
 *
 * A3=把散落两模板的日记长度描述 + maxTokens 抽成 `diary_config.mjs` 单源·**默认=现值**（渲染字节一致·纯 DRY 零行为变更）。
 * 🔴 长度描述保各自原 dash：自我日记 en-dash「80–180」/ 关系日记 hyphen「80-200」——照搬不统一（统一=改文本，非本机械批）。
 * 🔴「50 字」类改默认长度=单独行为档，本 smoke 锁"默认=现值"即锁住「机械批不改行为」。
 *
 * 构造器 buildDiaryPrompt/buildRelationalPrompt 为内部函数（不 export）→无 LLM·纯常量 golden + fs 单源断言。
 * 坏版本验红：①改配置默认值→golden 红；②模板里重新 inline 字面量（80–180 / maxTokens:700）→单源红。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { readFileSync } from 'node:fs';
import {
  DIARY_LENGTH_DESC, DIARY_MAX_TOKENS,
  RELATIONAL_DIARY_LENGTH_DESC, RELATIONAL_DIARY_MAX_TOKENS,
} from '../src/diary_config.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

console.log('── 🔴 golden：配置默认=现值（改任一→红·「50字」类改默认走单独行为档）──');
ok(DIARY_LENGTH_DESC.startsWith('80') && DIARY_LENGTH_DESC.endsWith('180 字') && DIARY_LENGTH_DESC.charCodeAt(2) === 0x2013,
   `自我日记长度=「80–180 字」en-dash(U+2013)·实得「${DIARY_LENGTH_DESC}」dash 码点 0x${DIARY_LENGTH_DESC.charCodeAt(2).toString(16)}`);
ok(DIARY_MAX_TOKENS === 700, `自我日记 maxTokens=700·实得 ${DIARY_MAX_TOKENS}`);
ok(RELATIONAL_DIARY_LENGTH_DESC.startsWith('80') && RELATIONAL_DIARY_LENGTH_DESC.endsWith('200 字') && RELATIONAL_DIARY_LENGTH_DESC.charCodeAt(2) === 0x2D,
   `关系日记长度=「80-200 字」hyphen(U+002D)·实得「${RELATIONAL_DIARY_LENGTH_DESC}」dash 码点 0x${RELATIONAL_DIARY_LENGTH_DESC.charCodeAt(2).toString(16)}`);
ok(RELATIONAL_DIARY_MAX_TOKENS === 600, `关系日记 maxTokens=600·实得 ${RELATIONAL_DIARY_MAX_TOKENS}`);

console.log('── 🔴 单源：两模板改引用配置·散落字面量已移除（重新 inline→红）──');
const diarySrc = readFileSync(new URL('../src/diary.mjs', import.meta.url), 'utf8');
const relSrc = readFileSync(new URL('../src/relational_diary.mjs', import.meta.url), 'utf8');

ok(diarySrc.includes("from './diary_config.mjs'"), 'diary.mjs import diary_config');
ok(diarySrc.includes('${DIARY_LENGTH_DESC}') && diarySrc.includes('maxTokens: DIARY_MAX_TOKENS'), 'diary.mjs 长度/tokens 引用配置');
ok(!diarySrc.includes('长度 ' + DIARY_LENGTH_DESC), '🔴 diary.mjs 无 inline 长度字面量（单源·重新 inline 则红）');
ok(!/maxTokens:\s*700\b/.test(diarySrc), '🔴 diary.mjs 无 inline maxTokens:700');

ok(relSrc.includes("from './diary_config.mjs'"), 'relational_diary.mjs import diary_config');
ok(relSrc.includes('${RELATIONAL_DIARY_LENGTH_DESC}') && relSrc.includes('maxTokens: RELATIONAL_DIARY_MAX_TOKENS'), 'relational_diary.mjs 长度/tokens 引用配置');
ok(!relSrc.includes('——' + RELATIONAL_DIARY_LENGTH_DESC), '🔴 relational_diary.mjs 无 inline 长度字面量');
ok(!/maxTokens:\s*600\b/.test(relSrc), '🔴 relational_diary.mjs 无 inline maxTokens:600');

console.log(`\n${fail === 0 ? '✅' : '🔴'} A3 日记配置单源验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
