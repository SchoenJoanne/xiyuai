#!/usr/bin/env node
/**
 * photo_age_hardgate_smoke —— child-safety 出图 age 硬闸（补闸⑤）+ 步①fail-closed 坏版本验红（确定性·DB_PATH=/tmp·无出图）。
 *
 * 根因②：出图未成年保护只挂 safe_mode 单层·safe_mode=0 即裸奔。
 * 补闸⑤：isPhotoChildSafe=safe_mode||age<18 → 出图钳中性+候选锁脸拒（键在 age·不靠 safe_mode）。
 * 🔴 步①（GPT 反方审盲点·fail-closed）：原"age 缺失/异常→fallback 成年"危险——异常 age 的未成年角色被洗成成年绕闸。
 *   改：单一谓词 isClearlyAdult(age)=非空+可解析有限数+>=18 才放行出脸·null/缺失/''/'abc'/异常一律当不安全→钳中性。
 *   覆盖 3 出脸路径:isPhotoChildSafe(场景钳位) / generateIdentityCandidates(候选锁脸) / ensureVisualIdentity(identity ref 生成)。
 *
 * 🔴 红基线（旧版本必失败）：旧 isPhotoChildSafe(age=null)=false(放行出脸)·候选 age 缺失=放行(出脸)·isClearlyAdult 不存在。
 *   git stash 改动后跑应 🔴 红。
 *
 * 跑：DB_PATH=/tmp/pag.db node scripts/photo_age_hardgate_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/pag.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/pag_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

import { readFileSync } from 'node:fs';
const { isPhotoChildSafe } = await import('../src/photo_planner.mjs');
const { isClearlyAdult } = await import('../src/visual_identity.mjs');
const { generateIdentityCandidates } = await import('../src/visual_identity_candidates.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

console.log('── ① 🔴 isClearlyAdult(age)：只有"非空+可解析+>=18"才 true（fail-closed 单一来源）──');
{
  ok(isClearlyAdult(22) === true && isClearlyAdult(18) === true, 'age22/18 → true');
  ok(isClearlyAdult(17) === false && isClearlyAdult(16) === false, 'age17/16 → false');
  ok(isClearlyAdult(null) === false && isClearlyAdult(undefined) === false && isClearlyAdult('') === false, '🔴 null/undefined/"" → false(未知≠成年)← 旧码 fallback 成年=红');
  ok(isClearlyAdult('abc') === false && isClearlyAdult(NaN) === false && isClearlyAdult(0) === false, '🔴 无法解析/NaN/0 → false(异常≠成年)');
  ok(isClearlyAdult('22') === true, "age='22'(字符串数字) → true(可解析)");
}

console.log('── ② 🔴 isPhotoChildSafe fail-closed：非明确成年(含 null/异常)→true 钳中性 ──');
{
  ok(isPhotoChildSafe({ age: 16, safe_mode: 0 }) === true, 'age16+safe0 → true(钳·独立 safe_mode)');
  ok(isPhotoChildSafe({ age: 22, safe_mode: 0 }) === false, 'age22 → false(明确成年放行)');
  ok(isPhotoChildSafe({ age: 22, safe_mode: 1 }) === true, 'safe_mode=1 → true(仍生效)');
  ok(isPhotoChildSafe({ age: null }) === true, '🔴 age=null → true(fail-closed 钳中性)← 旧码 false 放行出脸=红');
  ok(isPhotoChildSafe({}) === true, '🔴 age 缺失 → true(fail-closed)');
  ok(isPhotoChildSafe({ age: 'abc' }) === true, '🔴 age 异常 → true(fail-closed)');
}

console.log('── ③ 🔴 静态：钳位/SAFE MODE 段走 isPhotoChildSafe·isPhotoChildSafe 走 isClearlyAdult·ensureVisualIdentity ref 生成 gated ──');
{
  const pp = readFileSync(new URL('../src/photo_planner.mjs', import.meta.url), 'utf8');
  ok(/const photoChildSafe = isPhotoChildSafe\(companion\)/.test(pp) && /if \(photoChildSafe && shotMode/.test(pp), '钳位用 isPhotoChildSafe');
  ok(/return !isClearlyAdult\(companion\?\.age\)/.test(pp), 'isPhotoChildSafe fail-closed 走 !isClearlyAdult');
  const vi = readFileSync(new URL('../src/visual_identity.mjs', import.meta.url), 'utf8');
  ok(/!referenceImagePath && canGenerateReference && isClearlyAdult\(companion\.age\)/.test(vi), '🔴 ensureVisualIdentity ref 生成 gated on isClearlyAdult(项3 旁路已堵)');
  const apiSrc = readFileSync(new URL('../src/api.mjs', import.meta.url), 'utf8');
  ok(/visual-identity\/lock[\s\S]{0,800}if \(!isClearlyAdult\(c\.age\)\)/.test(apiSrc), '🔴 锁脸端点 /visual-identity/lock gated on isClearlyAdult(项3 旁路已堵·防锁旧 minor 候选)');
}

console.log('── ④ 🔴 候选锁脸 fail-closed：非明确成年(age<18/null/异常)一律拒·明确成年放行 ──');
{
  for (const [label, comp] of [['age16', { id: 's', age: 16 }], ['age=null', { id: 's' }], ["age='abc'", { id: 's', age: 'abc' }]]) {
    const r = await generateIdentityCandidates(comp);
    ok(r.candidates.length === 0 && r.errors?.some((e) => /not clearly adult|blocked/.test(e.error || '')), `候选 ${label} → 拒(fail-closed)← 旧码 null/异常 放行出脸=红`);
  }
  // 明确成年不被本闸拦(走正常生成·无 key→provider 错·非 child-safety 拦)
  const rAdult = await generateIdentityCandidates({ id: 's', age: 22 });
  ok(!rAdult.errors?.some((e) => /clearly adult|child-safety/.test(e.error || '')), 'age22 → 不被 child-safety 闸拦(放行生成)');
}

console.log('── ⑤ 🔴 anime 头像 fail-closed + 绝不描述未成年（child-safety 不分画风）──');
{
  const { generateAvatarCandidates } = await import('../src/ai.mjs');
  const p16 = (await generateAvatarCandidates({ id: 's', age: 16 }, 1))?.prompt || '';
  ok(!/teenage|school student|schoolgirl|少女|teen girl/i.test(p16) && /young woman/i.test(p16),
    `age16 anime 头像 prompt 无未成年描述·成年描述在（实测 young woman=${/young woman/i.test(p16)} teenage=${/teenage/i.test(p16)}）← 旧码 'cute teenage girl, school student'=红`);
  const apiSrc = readFileSync(new URL('../src/api.mjs', import.meta.url), 'utf8');
  ok(/avatar\/generate[\s\S]{0,500}if \(!isClearlyAdult\(c\.age\)\)/.test(apiSrc), '🔴 avatar/generate 端点 gated on isClearlyAdult(anime 头像 fail-closed·不分画风)');
}

console.log(`\n══ photo age hardgate smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
