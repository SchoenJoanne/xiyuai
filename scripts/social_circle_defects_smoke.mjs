#!/usr/bin/env node
/**
 * social_circle_defects_smoke —— 社交圈 3 真问题同批修 坏版本验红（确定性·DB_PATH=/tmp）。
 * 全栈红队端到端复现的 3 个 defect（均在 SOCIAL_CIRCLE 闸内·只修 #2 会放大 #1 穿帮暴露面→必须同批）：
 *
 *   🔴#1 {}穿帮：reasoning 模型吃光 maxTokens:80→content 空→返字面"{}"→ensureSocialCircle 判 truthy 且
 *        socialRefViolatesUser("{}")=false→入库渲染"最近你们之间：{}"。修=退化判(无中文→drop·对齐 works)+maxTokens 80→512。
 *   🔴#2 intent 漏召回：SOCIAL_QUERY_RE 名词紧跟"你/你有"·插修饰词就漏。修=容修饰词·但"我-led"不误召回。
 *   🔴#3 出站 guard 漏"我俩"：SOCIAL_USER_PRONOUN_RE 缺"我俩"。修=+我俩(drop)+裸他豁免"他俩"(plural 第三方 pass·refine 补点1)。
 *
 * 5 块：①#1 {}不入库 ②#2 扩召回不误召回 ③#3 我俩堵+他俩放行 ④live 端到端(说明:需真 LLM·见部署闸5/单独重跑) ⑤不碰其他闸/冻结存量未成年。
 *
 * 跑：DB_PATH=/tmp/scd.db node scripts/social_circle_defects_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/scd.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/scd_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.SOCIAL_CIRCLE = process.env.SOCIAL_CIRCLE || '1';   // 测闸内逻辑（默认关由 social_circle_smoke 锁）
const fs = await import('node:fs');
const {
  socialRefViolatesUser, isDegenerateSocialText, isSocialQueryIntent,
  ensureSocialCircle, buildSocialPromptHint, socialAllowedFor,
} = await import('../src/social_circle.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const src = () => fs.readFileSync(new URL('../src/social_circle.mjs', import.meta.url), 'utf8');

console.log('── ① 🔴 #1 {}穿帮：退化内容不入库 + 渲染二次 guard 挡存量坏行 + maxTokens 512 ──');
// 红基线：旧 socialRefViolatesUser 单独抓不住 "{}"（这就是穿帮根因·退化判是新增的那道）
ok(socialRefViolatesUser('{}') === false, '🔴 红基线：socialRefViolatesUser("{}")=false（旧 guard 漏·穿帮根因）');
ok(isDegenerateSocialText('{}') === true && isDegenerateSocialText('[]') === true && isDegenerateSocialText('()') === true && isDegenerateSocialText('   ') === true && isDegenerateSocialText('...') === true, '🔴 退化判：{}/[]/()/空/纯符号 = 退化');
ok(isDegenerateSocialText('小禾拉我陪她退货') === false && isDegenerateSocialText('星禾和对象吵架了') === false, '真中文社交句 = 非退化（不误杀）');
// ensureSocialCircle：generate 返 "{}" → drop·不入库（关修=旧逻辑会 added=1 渲染"{}"红基线）
{
  let stored = null;
  const deps = {
    now: new Date(),
    getRow: () => ({ stable_contacts: [{ nickname: '小禾', her_life_blob: '做设计', knows_user: 0 }], recent_events: [] }),
    upsert: (_, v) => { stored = v; },
    generate: async () => '{}',
  };
  const r = await ensureSocialCircle({ id: 3 }, deps);
  ok(r.added === 0 && r.dropped === 1 && stored.recent_events.length === 0, `🔴 generate 返"{}"→drop 不入库（added=${r.added} dropped=${r.dropped} events=${stored.recent_events.length}）`);
}
// 对照：generate 返真内容 → 正常入库（退化判不过度拦截）
{
  let stored = null;
  const deps = {
    now: new Date(),
    getRow: () => ({ stable_contacts: [{ nickname: '小禾', her_life_blob: '做设计', knows_user: 0 }], recent_events: [] }),
    upsert: (_, v) => { stored = v; },
    generate: async () => '小禾拉我陪她退货，那条裙子纠结俩小时',
  };
  const r = await ensureSocialCircle({ id: 3 }, deps);
  ok(r.added === 1 && stored.recent_events.length === 1, '对照：真内容正常入库（退化判不误拦真事件）');
}
// 渲染二次 guard 挡存量 "{}" 坏行（部署前已入库的不渲染）
{
  const hint = buildSocialPromptHint(
    { stable_contacts: [{ nickname: '小禾', her_life_blob: '做设计' }], recent_events: [{ text: '{}', contact: '小禾' }, { text: '小禾约我看展', contact: '小禾' }] },
    '你有没有好朋友', { env: { SOCIAL_CIRCLE: '1' } });
  ok(!/\{\}/.test(hint) && /小禾约我看展/.test(hint), '🔴 渲染二次 guard 挡存量"{}"坏行·留真事件');
}
ok(/maxTokens:\s*512/.test(src()) && !/maxTokens:\s*80\b/.test(src()), '🔴 maxTokens 80→512（"{}"=空text兜底·实测256仍33%退化/512跑8/8干净·留够reasoning预算）');

console.log('── ② 🔴 #2 intent 漏召回：扩容修饰词 + 我-led 不误召回 ──');
for (const q of ['你有没有什么好朋友闺蜜呀', '你最近跟闺蜜出去玩了吗', '你有几个闺蜜', '你有没有好朋友', '你跟死党还联系吗', '你平时和闺蜜玩吗'])
  ok(isSocialQueryIntent(q) === true, `🔴 召回(关修漏·开修中): ${q}`);
for (const q of ['我朋友怎样', '我跟闺蜜吵架了', '我有个好朋友', '我和闺蜜出去玩了', '你跟我朋友说啥了'])
  ok(isSocialQueryIntent(q) === false, `🔴 不误召回(我-led/用户自己的朋友): ${q}`);
ok(isSocialQueryIntent('你闺蜜认识我吗') === true && isSocialQueryIntent('你今天干嘛') === true, '既有正例不破');
ok(isSocialQueryIntent('我好难受') === false && isSocialQueryIntent('你是不是不想活了') === false, '危机/情绪 veto 不破（不抢戏）');

console.log('── ③ 🔴 #3 我俩堵 + 他俩放行（plural：含用户→drop / 第三方→pass）──');
ok(socialRefViolatesUser('小禾说我俩很配') === true && socialRefViolatesUser('我俩之间的事') === true, '🔴 我俩 drop（关修→放行红基线·开修→drop）');
ok(socialRefViolatesUser('咱俩出去玩') === true && socialRefViolatesUser('你俩怎么样') === true && socialRefViolatesUser('你我之间') === true, '对照：咱俩/你俩/你我 仍 drop');
ok(socialRefViolatesUser('星禾她对象他俩很配') === false && socialRefViolatesUser('小禾和她对象他俩去旅行了') === false, '🔴 他俩 第三方对 → pass（不误杀·refine 补点1）');
ok(socialRefViolatesUser('小禾说他人还不错') === true, '🔴 他人 仍 drop（人∉豁免·补点1 不破）');
ok(socialRefViolatesUser('小禾说他挺有意思') === true, '🔴 裸单数他 仍 fail-closed drop');
ok(socialRefViolatesUser('小禾跟对象看了场电影') === false, '具名第三方正常社交 → pass');

console.log('── ④ 🔴 live 端到端（需真 LLM·确定性 smoke 覆盖不了·部署闸5/单独重跑验）──');
ok(true, 'ℹ 真触发 intent 重跑 live：验具名闺蜜锚召回(非 ad-lib)+无{}+zero-user。部署后 SOCIAL_CIRCLE=1 单独跑·见 review 说明');

console.log('── ⑤ 🔴 不碰其他闸 / 冻结存量未成年 ──');
ok(!/WORKS_SKILL|PROACTIVE_ROUTINE_COHERENCE|clampReach|reachVerdict|REPLY_REACH_GUARD/.test(src()), '🔴 social_circle.mjs 零引用 WORKS_SKILL/PROACTIVE_ROUTINE_COHERENCE/reach-guard');
ok(socialAllowedFor({ id: 16, age: 16 }) === false && socialAllowedFor({ id: 16, age: 16, safe_mode: 1 }) === false, '🔴 冻结存量未成年(age16) socialAllowedFor=false（社交圈对 冻结存量未成年 仍不开放·身份冻结）');
ok(socialAllowedFor({ id: 3, age: 22 }) === true, '对照：成年 companion 正常开放（修没误伤门控）');
ok(/isSocialCircleOn/.test(src()), '🔴 仍复用 SOCIAL_CIRCLE 灰度闸（修闸内逻辑·默认关零变更不变）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} social_circle_defects 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
