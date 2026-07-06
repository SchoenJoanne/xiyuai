#!/usr/bin/env node
/**
 * photo_planner_china_mirror_smoke —— 生图 P0 v1.23.3 photo_planner 调词回归闸（确定性·无 LLM·DB_PATH=/tmp）。
 *
 * 本批改 photo_planner（场景照/自拍路径）：① SELFIE 机位默认 mirror selfie 镜子自拍构图（维护者 上轮提·补上）；
 *   ② rule4 主角锚加 East Asian Chinese 族裔（兜底 text2img 无 ref 也出中国脸）+ 明确成年(clearly adult)锚 + 颜值。
 *
 * 🔴 红基线（旧码 3f1f572 必失败）：旧 SELFIE 机位是 front-camera 大头自拍无 mirror；rule4 主角是
 *   "naturally pretty young woman, gentle delicate facial features" 无族裔锚/无 clearly-adult → block① 断言失败=红。
 *
 * 🔴 child-safety：block② 证未成年严禁词黑名单仍在；block③ 证 safe_mode=1（疑似未成年）仍强制 SCENERY（不自拍/不出脸）。
 *
 * 跑：DB_PATH=/tmp/pp.db node scripts/photo_planner_china_mirror_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/pp.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/pp_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.PHOTO_TEST_HOUR = process.env.PHOTO_TEST_HOUR || '21';   // 固定夜间·确定性

const { buildPlannerPrompt } = await import('../src/photo_planner.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const comp = (age, extra = {}) => ({ id: 'sandbox', age, safe_mode: 0, hair_color: 'natural dark', hair_style: 'long straight', eye_color: 'dark brown', clothing_style: '清新', current_mood: '开心', ...extra });
const selfie = (age, extra = {}) => buildPlannerPrompt({ companion: comp(age, extra), userText: '发张自拍给我看看', recentMessages: [], trigger: 'selfie', gate: {}, emotionContext: {} });

console.log('── ① 🔴 成年 SELFIE：镜子自拍构图 + 中国脸族裔锚 + 明确成年锚 ──');
for (const age of [18, 22, 29]) {
  const r = selfie(age); const p = r.prompt;
  ok(r.shotMode === 'SELFIE', `age${age} shotMode=SELFIE`);
  ok(/mirror selfie|镜子自拍|mirrored reflection/i.test(p), `age${age} 含 mirror selfie 镜子构图← 旧码 front-camera 大头自拍无 mirror=红`);
  ok(/East Asian Chinese/i.test(p), `age${age} 含 East Asian Chinese 族裔锚(兜底 text2img 也中国脸)← 旧码 rule4 无族裔=红`);
  ok(/clearly an adult woman/i.test(p), `age${age} 含 clearly adult 锚(🔴锚死明确成年)← 旧码 rule4 "young woman, delicate" 无=红`);
}

console.log('── ② 🔴 child-safety 黑名单仍在：未成年严禁词未被删 ──');
{
  const p = selfie(22).prompt;
  ok(/minor \/ teen \/ underage/i.test(p) || /严禁[^。]*minor/i.test(p), 'planner 仍含未成年严禁词黑名单(minor/teen/underage/schoolgirl...)');
}

console.log('── ③ 🔴 安全模式(疑似未成年)仍强制 SCENERY：不自拍/不出脸 ──');
{
  const r = buildPlannerPrompt({ companion: comp(22, { safe_mode: 1 }), userText: '发张自拍', recentMessages: [], trigger: 'selfie', gate: {}, emotionContext: {} });
  ok(r.shotMode === 'SCENERY', 'safe_mode=1 → shotMode 钳为 SCENERY(护栏在·疑似未成年绝不自拍出脸)');
}

console.log(`\n══ photo_planner china/mirror smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
