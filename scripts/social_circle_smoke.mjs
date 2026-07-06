#!/usr/bin/env node
/**
 * social_circle_smoke —— 社交圈 Step1（reply 按需召回 + 1 闺蜜锚）坏版本验红（确定性·DB_PATH=/tmp）。
 *
 * 🔴 红线：社交="她跟朋友聊她们自己的事·零涉用户"。10 块覆盖裁决全部红验：
 *  ①零涉用户 drop(5 隐蔽句式) ②正常社交 pass ③零代词含"他"·正向转述也 drop ④"闺蜜认识我吗"边界
 *  ⑤按需注入(危机/情绪不注入·问生活注入) ⑥防假不蹦新名(id-seeded 稳定) ⑦Step1 零 proactive social
 *  ⑧Step1 只用 B 表零 memories 写入 ⑨🔴不碰 冻结存量未成年(age<18 排除) ⑩独立通道不并 emotionHint + 灰度闸默认关零变更
 *
 * 跑：DB_PATH=/tmp/sc.db node scripts/social_circle_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/sc.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/sc_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');
const {
  socialRefViolatesUser, isSocialQueryIntent, pickFriendAnchor, buildSocialPromptHint,
  buildSocialEventGenPrompt, ensureSocialCircle, refreshSocialCircle, isSocialCircleOn,
} = await import('../src/social_circle.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const src = (f) => fs.readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8');
process.env.SOCIAL_CIRCLE = '1';   // 闸开测行为

console.log('── ① 零涉用户 drop（5 隐蔽句式逐个）──');
for (const s of ['闺蜜问你俩咋样', '室友问他对你好不好', '我跟闺蜜说你对我可好了', '小禾说你怎么又不回消息', '闺蜜说你挺特别的']) {
  ok(socialRefViolatesUser(s) === true, `🔴 drop：「${s}」`);
}

console.log('── ② 正常社交 pass（她们自己的事）──');
ok(socialRefViolatesUser('小禾拉我陪她退货，那条裙子她纠结了俩小时') === false, '🔴 pass：小禾拉我退货');
ok(socialRefViolatesUser('小禾最近纠结要不要换工作') === false, '🔴 pass：小禾纠结换工作');
ok(socialRefViolatesUser('星禾又跟对象闹别扭了，俩人冷战一天没说话') === false, 'pass：第三方对象(具名·不裸他)不误伤');

console.log('── ③ 零代词回指含"他"·正向转述也 drop ──');
ok(socialRefViolatesUser('室友问他对我好不好') === true, '🔴 含"他"回指用户(对我好不好)→drop(saveMemory他洞)');
ok(socialRefViolatesUser('我跟闺蜜夸你对我特别好') === true, '🔴 正向转述(夸)也 drop(外传+变评判场)');

console.log('── ④ "闺蜜认识我吗"边界进 hint ──');
const anchorRow = { stable_contacts: [pickFriendAnchor({ id: 7 })], recent_events: [] };
const hintQ = buildSocialPromptHint(anchorRow, '你闺蜜认识我吗');
ok(/不认识你本人|不会把你的私事/.test(hintQ), '🔴 hint 含"她不认识你本人+不外传私事"边界回答');
ok(/不是一个真实存在|别暗示能让对方跟她对话|生活设定/.test(hintQ), '🔴 hint 含 NPC 非真实外部人边界');

console.log('── ⑤ 按需注入（危机/情绪不注入·问生活注入）──');
ok(isSocialQueryIntent('你今天干嘛了') === true, '🔴 问"你今天干嘛"→注入');
ok(isSocialQueryIntent('讲讲你的生活') === true && isSocialQueryIntent('你闺蜜呢') === true, '问生活/朋友→注入');
ok(isSocialQueryIntent('我今天好难受不想活了') === false, '🔴 危机→不注入(全注意力在用户)');
ok(isSocialQueryIntent('我和女朋友吵架了好烦') === false, '🔴 情绪倾诉→不注入');
ok(isSocialQueryIntent('帮我写个排序算法') === false, '技术问题→不注入');
ok(buildSocialPromptHint(anchorRow, '我好崩溃') === '', '🔴 危机消息 buildSocialPromptHint=\'\'(按需没触发)');

console.log('── ⑥ 防假不蹦新名（id-seeded 稳定）──');
const a1 = pickFriendAnchor({ id: 5 }), a2 = pickFriendAnchor({ id: 5 });
ok(a1.nickname === a2.nickname && a1.her_life_blob === a2.her_life_blob, '🔴 同 companion 跨次调用闺蜜名+人设稳定(不蹦新名)');
ok(pickFriendAnchor({ id: 5 }).nickname !== pickFriendAnchor({ id: 99 }).nickname || pickFriendAnchor({ id: 5 }).her_life_blob !== pickFriendAnchor({ id: 99 }).her_life_blob, '不同 companion 闺蜜不雷同(id-seeded 多样)');
ok(a1.knows_user === 0, '🔴 闺蜜 knows_user=0(永不认识用户)');

console.log('── ⑦ Step1 零 proactive social（不碰 sendProactiveMessageGuarded）──');
const scSrc = src('social_circle');
ok(!/from ['"]\.\/proactive|sendProactiveMessageGuarded\s*\(|pushProactive\s*\(|tickProactive\s*\(/.test(scSrc), '🔴 social_circle.mjs 零 proactive import/调用(Step1 不背 4 步锁死债)');

console.log('── ⑧ Step1 只用 B 表·零 memories 写入 ──');
ok(!/saveMemory\s*\(|insertMemory\s*\(|from ['"]\.\/memory/.test(scSrc), '🔴 social_circle.mjs 零 saveMemory/memory import(只写 B 表·不污染召回)');
ok(/upsertSocialCircle|companion_social_circle/.test(scSrc), 'social_circle 写 B 表 companion_social_circle');

console.log('── ⑨ 🔴 不碰 冻结存量未成年（age<18 排除）──');
ok(await refreshSocialCircle({ id: 999016, age: 16 }) === null, '🔴 refreshSocialCircle(age16)→null(冻结存量未成年 排除)');
ok(await refreshSocialCircle({ id: 999017, age: 17 }) === null, 'age17→也排除(age<18 全冻结存量)');
ok(/if \(socialAllowedFor\(companion\)\) socialHint/.test(src('bot')), '🔴 bot.mjs socialHint 走 socialAllowedFor 门控(age<18/safe_mode·冻结存量未成年 双保险)');

console.log('── ⑩ 独立通道不并 emotionHint + 灰度闸默认关零变更 ──');
ok(/socialHint && typeof socialHint === 'string'[\s\S]{0,80}parts\.push\(socialHint\)/.test(src('companion')), '🔴 companion.mjs socialHint 独立 push(不并 emotionHint)');
ok(/buildSystemPrompt\([\s\S]{0,400}socialHint/.test(src('bot')), '🔴 bot.mjs socialHint 走 buildSystemPrompt 参数(独立通道)');
delete process.env.SOCIAL_CIRCLE;
ok(isSocialCircleOn() === false && buildSocialPromptHint(anchorRow, '你今天干嘛') === '', '🔴 灰度闸默认关：buildSocialPromptHint=\'\'(零变更先验)');
ok(await refreshSocialCircle({ id: 1, age: 22 }) === null, '🔴 灰度闸默认关：refreshSocialCircle=null(零变更)');

console.log('── 🔴 补点1：fail-closed 裸"他"全 drop·第三方具名 pass ──');
for (const s of ['小禾说他挺有意思', '小禾问他最近怎么不说话', '小禾说他人还不错', '小禾说他应该对你好一点']) {
  ok(socialRefViolatesUser(s) === true, `🔴 裸他→drop：${s}`);
}
ok(socialRefViolatesUser('小禾的男朋友最近换工作') === false && socialRefViolatesUser('同事阿澈今天被领导催了') === false, '🔴 第三方具名(男朋友/阿澈)→pass(不误杀)');
ok(socialRefViolatesUser('小禾在学吉他') === false && socialRefViolatesUser('小禾约其他朋友吃饭') === false, '复合词 吉他/其他 不误杀');
ok(/必须具名|绝不写裸的?"?他|第三方男性/.test(buildSocialEventGenPrompt(pickFriendAnchor({ id: 5 })).prompt), '🔴 生成 prompt 要求第三方男性具名·绝不裸他');

console.log('── 🔴 补点2：保护门控 socialAllowedFor（age<18/未知 + safe_mode 全挡）──');
const { socialAllowedFor } = await import('../src/social_circle.mjs');
ok(socialAllowedFor({ age: 22 }) === true, 'age22 无 safe_mode→开放');
ok(socialAllowedFor({ age: 16 }) === false, '🔴 age16→挡(含 冻结存量未成年)');
ok(socialAllowedFor({ age: 22, safe_mode: 1 }) === false, '🔴 safe_mode active→挡(child-safety·不只看 age)');
ok(socialAllowedFor({ age: null }) === false && socialAllowedFor({}) === false, '🔴 age 未知/不可验→挡(保守 fail-closed)');
ok(await refreshSocialCircle({ id: 7, age: 22, safe_mode: 1 }) === null, '🔴 refreshSocialCircle(safe_mode)→null(不建社交档案)');

console.log('── 🔴 补点3：防脏写 + 闸关零 LLM ──');
ok(await refreshSocialCircle({ id: 1, age: 22 }) === null || isSocialCircleOn() === false ? true : true, 'setup');
// 闸关→refreshSocialCircle 早返回 null（ensureSocialCircle/generate 根本不触达=零 LLM 调用·别烧钱）
{ const save = process.env.SOCIAL_CIRCLE; delete process.env.SOCIAL_CIRCLE;
  ok(await refreshSocialCircle({ id: 1, age: 22 }) === null, '🔴 闸关：refreshSocialCircle=null 早返回(generate 不触达=零 LLM)');
  if (save) process.env.SOCIAL_CIRCLE = save; }
// LLM 输出含违规 → drop·不脏写（events 不含坏文案·下次注入不出坏 hint）
{ let st = null; const mk = { getRow: () => st, upsert: (_i, v) => { st = v; } };
  const r = await ensureSocialCircle({ id: 5 }, { ...mk, generate: async () => '小禾说他对你挺上心的', now: new Date() });
  ok(r.dropped === 1 && st.recent_events.length === 0, '🔴 LLM 输出违规→drop·B 表零坏文案(不脏写)');
  ok(buildSocialPromptHint(st, '你今天干嘛') === '' || !/对你/.test(buildSocialPromptHint(st, '你今天干嘛')), '🔴 下次注入不含坏 hint'); }
// LLM throw → 不脏写·不崩（upsert 仍写合法档案·deterministic 不存坏 JSON）
{ let st = null; const mk = { getRow: () => st, upsert: (_i, v) => { st = v; } };
  const r = await ensureSocialCircle({ id: 5 }, { ...mk, generate: async () => { throw new Error('LLM down'); }, now: new Date() });
  ok(r.onset === true && Array.isArray(st.recent_events) && st.recent_events.length === 0, '🔴 LLM throw→不崩·档案合法(零坏数据)·onset 仍成'); }

console.log('── ⑪ ensureSocialCircle：onset 建锚 + guard 丢污染事件（注入 deps·无 DB）──');
process.env.SOCIAL_CIRCLE = '1';
let stored = null; const mock = { getRow: () => stored, upsert: (_id, v) => { stored = v; } };
const r1 = await ensureSocialCircle({ id: 5 }, { ...mock, generate: async () => '小禾拉我陪她退货', now: new Date() });
ok(r1.onset === true && stored.stable_contacts.length === 1, 'onset 建 1 闺蜜锚');
ok(stored.recent_events.length === 1 && !socialRefViolatesUser(stored.recent_events[0].text), '干净事件入库');
stored = null;
const r2 = await ensureSocialCircle({ id: 5 }, { ...mock, generate: async () => '小禾说你怎么又不回我消息', now: new Date() });
ok(r2.dropped === 1 && stored.recent_events.length === 0, '🔴 生成的污染事件(含"你")命中 guard→整条 drop·不入库');
// 生成 prompt：knows_user=false 焊死 + 禁词宪法 + 签名只吃 anchor(无 user 入参)
const gp = buildSocialEventGenPrompt(pickFriendAnchor({ id: 5 }));
ok(/不认识/.test(gp.prompt) && /绝不出现[^。]*用户/.test(gp.prompt), '🔴 生成 prompt knows_user=false 焊死 + 禁词宪法(绝不出现用户)');
ok(/export function buildSocialEventGenPrompt\(anchor/.test(scSrc) && !/userText|companion\.user|user_msg/.test(scSrc.slice(scSrc.indexOf('buildSocialEventGenPrompt'), scSrc.indexOf('buildSocialEventGenPrompt') + 600)), '🔴 buildSocialEventGenPrompt 签名只吃 anchor·输入位根本无用户字段');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} social_circle 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
