#!/usr/bin/env node
/**
 * d3_batch2_compress_smoke —— 停板B B2 常驻压缩(步骤1/2/3)·坏版本验红（确定性·进 CI）。
 *
 * ⑤b 身份 I1/I2/I3 原则句压缩(全档) + ⑤a 照片段压缩(全档) + ⑨ 初恋 stage 条件化(恋人/深爱压缩·暧昧族字节一致)。
 * 🔴 :196 焊死软化句(两"绝不"+俏皮留白)一字不碰=决胜臂底线独立守护。🔴 暧昧档 FIRSTLOVE 逐字===main(⑨字节一致)。
 * 🔴 坏版本验红：任一 old 重现(压缩回退)/neu 缺失/:196 被改/暧昧档压缩泄漏 → 红。
 * 🔴 DB_PATH 硬闸。跑：DB_PATH=/tmp/b2z.db node scripts/d3_batch2_compress_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) { console.error('🔴 DB_PATH 须 /tmp'); process.exit(2); }
process.env.DB_PATH = process.env.DB_PATH || `/tmp/b2z_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.PERSONA_PROMPT_HARDEN = process.env.PERSONA_PROMPT_HARDEN || '1';
const { buildSystemPrompt } = await import('../src/companion.mjs');
const { IDENT_PAIRS, PHOTO_PAIRS, FIRSTLOVE_PAIRS } = await import('./d3_batch2_pairs.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

const base = { id: 999005, name: '星禾', age: 22, role_title: '女友', persona_prompt: '活泼里带点小傲娇' };
const sysLover = buildSystemPrompt({ ...base, relationship_stage: '恋人' }, { promptMode: 'reply' });
const sysAmbig = buildSystemPrompt({ ...base, relationship_stage: '暧昧' }, { promptMode: 'reply' });

const WELD196 = '你是一个真实的女孩，不是助手。不主动谈自己是不是 AI；被认真直问时，俏皮留白（"你说呢~"式）或自然带过，绝不说"我是真人""我是真实的人"这类断言，也绝不自称 AI / 作为 AI / 语言模型。';

console.log('── 🔴 :196 软化句焊死(两态逐字·一字不碰·决胜臂底线独立守护)──');
ok(sysLover.includes(WELD196) && sysAmbig.includes(WELD196), ':196 焊死句两态逐字在');

console.log('── ⑤b 身份 I1/I2/I3 常驻压缩(全档·neu 在 old 消·细则移 IDENT_COND)──');
for (const p of IDENT_PAIRS) {
  ok(sysLover.includes(p.neu) && !sysLover.includes(p.old), `${p.id} 恋人档压缩(neu在/old消)`);
  ok(sysAmbig.includes(p.neu) && !sysAmbig.includes(p.old), `${p.id} 暧昧档同压缩(身份非stage条件·全档一致)`);
}

console.log('── ⑤a 照片段常驻压缩(全档·细则移 PHOTO_COND)──');
for (const p of PHOTO_PAIRS) {
  ok(sysLover.includes(p.neu) && !sysLover.includes(p.old), `${p.id} 压缩(neu在/old消)`);
  ok(!sysLover.includes('[STICKER:photo]') && !sysLover.includes('列一大段外貌/场景描述来冒充照片'), '照片禁忌枚举从常驻消(移 PHOTO_COND·只测old独有短语)');
}

console.log('── 🔴 ⑨ 初恋 stage 条件化：暧昧档 FIRSTLOVE【字节一致】/ 恋人档压缩·关键红线逐字 ──');
for (const p of FIRSTLOVE_PAIRS) {
  ok(sysAmbig.includes(p.old) && !sysAmbig.includes(p.neu), `🔴 ${p.id} 暧昧档 old【逐字】·无压缩版(字节一致·暧昧族零变更)`);
  ok(sysLover.includes(p.neu) && !sysLover.includes(p.old), `${p.id} 恋人档压缩(neu在/old消)`);
  ok(sysLover.includes('绝不能把"不会谈恋爱"当成冷淡、敷衍、忘事或低投入的借口'), '关键红线句压缩版逐字保留(PR-2 生死线 S1)');
}
ok(sysAmbig.includes('此刻还没正式在一起') && !sysAmbig.includes('你们已经在一起了'), '暧昧档=暧昧补充段(配对不乱)');
ok(sysLover.includes('你们已经在一起了') && !sysLover.includes('此刻还没正式在一起'), '恋人档=恋人补充段(配对不乱)');

console.log(`\n${fail === 0 ? '✅' : '🔴'} B2 常驻压缩验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
