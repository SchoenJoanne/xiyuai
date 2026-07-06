/**
 * diary_config.mjs — 日记长度/生成配置·单源常量（停板B·A3·D5 日记「配置级」）。
 *
 * 现状（phase1_inventory D5）：日记长度与 maxTokens 写死散落在两模板——
 *   diary.mjs（自我日记）「80–180 字」+ maxTokens 700；relational_diary.mjs（关系日记）「80-200 字」+ maxTokens 600。
 * A3=把这四个散落字面量抽成配置项·**默认=现值**（渲染字节一致·纯 DRY 零行为变更）。
 *
 * 🔴 默认值=现值（不改行为）。「50 字」这类**改默认长度=单独行为档**，另开、不混本机械抽取。
 * 🔴 长度描述保各自原字节：自我日记用 en-dash「80–180」·关系日记用 hyphen「80-200」——照搬不统一（统一=改文本）。
 * 纯常量模块，零 IO、零依赖。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

// 自我日记（diary.mjs·buildDiaryPrompt / 生成 maxTokens）
export const DIARY_LENGTH_DESC = '80–180 字';   // 🔴 en-dash（U+2013）·原样
export const DIARY_MAX_TOKENS = 700;

// 关系日记（relational_diary.mjs·buildRelationalPrompt / 生成 maxTokens）
export const RELATIONAL_DIARY_LENGTH_DESC = '80-200 字';   // 🔴 hyphen（U+002D）·原样
export const RELATIONAL_DIARY_MAX_TOKENS = 600;
