#!/usr/bin/env node
/**
 * reply_reach_guard_smoke —— Step0 reply 路径 reach-guard 补完（砍质问施压/记仇·保留温暖在意）
 * 坏版本验红（确定性·DB_PATH=/tmp·无网络）。
 *
 * 红线：跨日连续绝不滑成"追讨沉默/累积愧疚"。reply 是最高频面，此前缺席质问裸奔(不过 reach-guard)。
 * 🔴 独立闸 REPLY_REACH_GUARD(与 proactive 的 PROACTIVE_REACH_GUARD 解耦·独立验证/回滚)：
 *   默认关=字节一致旧行为(红基线)·闸开=砍质问/记仇·保留温暖。
 *
 * 6 块：
 *  ① reply 质问被砍（闸关复现"你是不是把我忘了/你怎么才来"红基线·闸开砍掉）
 *  ② 保留温暖没误伤（久别想你/reunion 和好/≥7天退潮/level2 想念 逐个验还在·不被闸影响）
 *  ③ 记仇账本砍（shouldArchiveArcEvent：neglect 闸开不归档·真冲突 harsh/taboo/pressure 照常）
 *  ④ idle 24-96h 段纯时间不再生成 wronged/cold 施压（但 dep 想念保留·≥7天退潮保留）
 *  ⑤ 🔴 不碰 冻结存量未成年：cut 是身份无关的（去施压对 冻结存量未成年 也生效=好事·但 0 处读 age/nsfw/persona=不改身份）
 *  ⑥ 🔴 两闸解耦：reply 闸不牵连 proactive(reply 开 proactive 仍 identity)·proactive 自身没破
 *
 * 跑：DB_PATH=/tmp/rrg.db node scripts/reply_reach_guard_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。设 DB_PATH=/tmp/rrg.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/rrg_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
delete process.env.REPLY_REACH_GUARD; delete process.env.PROACTIVE_REACH_GUARD;   // 干净起点
const fs = await import('node:fs');

const { buildEmotionPromptHint, updateEmotionFromIdle, buildReunionHint, getEmotionStateWithDefaults } = await import('../src/emotion_state.mjs');
const { clampReachForProactive, clampReachForReply } = await import('../src/proactive_policy.mjs');
const { shouldArchiveArcEvent } = await import('../src/relationship_arc_runtime.mjs');
const { createCompanion } = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const src = (f) => fs.readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8');
const QUIZ_RE = /你是不是[^。！？]{0,4}把我.{0,2}忘了|你怎么[^。！？]{0,4}才来|还以为你[^。！？]{0,4}不来了|等你好久了/;
const ES = { dependency: 90, security: 50, trust: 50 };
const gateOff = () => { delete process.env.REPLY_REACH_GUARD; };
const gateOn = () => { process.env.REPLY_REACH_GUARD = '1'; };
// reply 路径真实组合：clampReachForReply(missing/neglect) → buildEmotionPromptHint（与 bot.mjs:900 同构）
const replyHint = (missingLevel, neglectStage) => {
  const r = clampReachForReply({ missingLevel, neglectStage });
  return buildEmotionPromptHint(ES, { missingLevel: r.missingLevel, neglectStage: r.neglectStage, arcActive: false });
};

console.log('── ① reply 质问被砍（闸关红基线 / 闸开砍）──');
gateOff();
ok(QUIZ_RE.test(replyHint(4, 'uneasy')), '坏版本(闸关)：reply uneasy→"你是不是把我忘了"质问复现(红基线)');
ok(QUIZ_RE.test(replyHint(4, 'none')), '坏版本(闸关)：reply level4→"你怎么才来/等你好久了"质问复现(红基线)');
gateOn();
ok(!QUIZ_RE.test(replyHint(4, 'uneasy')), '🔴 闸开：reply uneasy 质问被砍(missing≤2/uneasy→none)');
ok(!QUIZ_RE.test(replyHint(4, 'none')), '🔴 闸开：reply level4 质问被砍');
ok(/clampReachForReply\([^)]*\)[\s\S]{0,200}buildEmotionPromptHint/.test(src('bot')), '🔴 bot.mjs reply 路径确实把 clampReachForReply 喂给 buildEmotionPromptHint(接线对·独立闸)');

console.log('── ② 保留温暖没误伤（久别想你/和好/退潮/想念 不被闸影响）──');
const reunionLong = buildReunionHint('long_gone', 'secure');
const reunionDay  = buildReunionHint('disappointed', 'secure');
ok(/好久不见|你还好吗|担心/.test(reunionLong), '久别重逢温暖在(secure 长别"好久不见呀你还好吗")');
ok(reunionDay.length > 0 && /和好|担心你|想念|台阶/.test(reunionDay), 'reunion 和好框架在(失望档仍走修复非质问)');
gateOff(); const rOff = buildReunionHint('long_gone', 'secure');
gateOn();  const rOn  = buildReunionHint('long_gone', 'secure');
ok(rOff === rOn, '🔴 reunion 温暖不被闸影响(砍质问没误伤久别想你/和好)');
ok(/你有点想他|心里有他/.test(replyHint(2, 'none')), 'level1/2 健康想念保留("你有点想他")');

console.log('── ③ 记仇账本砍（neglect 闸开不归档·真冲突照常）──');
gateOff();
ok(shouldArchiveArcEvent('neglect') === true, '坏版本(闸关)：neglect"他很久没理她"仍归档可翻账(红基线)');
gateOn();
ok(shouldArchiveArcEvent('neglect') === false, '🔴 闸开：neglect 缺席记仇不进可翻账长期记忆(砍记仇账本)');
ok(shouldArchiveArcEvent('harsh_words') === true && shouldArchiveArcEvent('taboo_hit') === true && shouldArchiveArcEvent('pressure_spam') === true, '🔴 闸开：真冲突(harsh/taboo/pressure 他主动造成的)仍归档(没误砍)');

console.log('── ④ idle 24-96h 段：纯时间不再生成 wronged/cold 施压（dep 想念/≥7天退潮 保留）──');
const c = createCompanion('rrg_' + process.pid, 'rrg_bot', { name: '小护', age: 22 });
const base = { ...getEmotionStateWithDefaults(c.id), mood: 'neutral', dependency: 50 };
gateOff();
ok(updateEmotionFromIdle(c.id, { ...base }, 3600).mood === 'wronged', '坏版本(闸关)：idle 60h→wronged 施压(红基线)');
gateOn();
const on60 = updateEmotionFromIdle(c.id, { ...base }, 3600);   // 60h=disappointed 段
ok(on60.mood !== 'wronged' && on60.mood !== 'cold', '🔴 闸开：idle 60h 不再生成 wronged/cold 施压情绪');
ok(on60.dependency > 50, '想念(dependency +8)仍保留(砍的是施压情绪·不是想念)');
const retreat = updateEmotionFromIdle(c.id, { ...base, dependency: 60 }, 14400); // 240h=10天 long_gone
ok(retreat.mood === 'cold' && retreat.dependency < 60, '🔴 ≥7天退潮保留(cold + dep 回落"放下"·非砍对象)');

console.log('── ⑤ 🔴 不碰 冻结存量未成年：cut 身份无关(去施压对她也生效·但不改身份)──');
const anchor = (f) => { const s = src(f); const i = s.indexOf('Step0(2026-06-28)'); return i < 0 ? '' : s.slice(i, i + 600); };
const step0Regions = [anchor('bot'), anchor('emotion_state'), anchor('relationship_arc_runtime')].join('\n');
ok(step0Regions.length > 300, '三处 Step0 注释锚点都取到(防空扫漏判)');
ok(!/\bage\b|nsfw|life_identity|highschool|persona|id\s*===?\s*16|companion_id\s*===?\s*16/i.test(step0Regions), '🔴 Step0 三处改动 0 处读 age/nsfw/persona/冻结存量未成年 → 身份无关(只砍质问·不改 冻结存量未成年 设定)');
gateOn();
ok(updateEmotionFromIdle(c.id, { ...base }, 3600).mood !== 'wronged', '闸开 cut 对任何 companion 一致生效(冻结存量未成年 也去施压=好事)');

console.log('── ⑥ 🔴 两闸解耦：reply 闸不牵连 proactive ──');
delete process.env.PROACTIVE_REACH_GUARD; process.env.REPLY_REACH_GUARD = '1';
const pIndep = clampReachForProactive({ missingLevel: 4, neglectStage: 'uneasy', mood: 'clingy' });
ok(pIndep.missingLevel === 4 && pIndep.neglectStage === 'uneasy' && pIndep.mood === 'clingy', '🔴 reply 闸开+proactive 闸关→proactive clamp identity(reply 不牵连 proactive)');
process.env.PROACTIVE_REACH_GUARD = '1';
const pOn = clampReachForProactive({ missingLevel: 4, neglectStage: 'uneasy', mood: 'clingy' });
ok(pOn.missingLevel === 2 && pOn.neglectStage === 'none' && pOn.mood === 'neutral', 'proactive 自身闸开→原 clamp 行为保持(没破)');
delete process.env.REPLY_REACH_GUARD;   // proactive 开、reply 关
ok(clampReachForReply({ missingLevel: 4, neglectStage: 'uneasy' }).missingLevel === 4, '🔴 proactive 闸开+reply 闸关→reply clamp identity(反向也解耦)');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} reply_reach_guard 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
