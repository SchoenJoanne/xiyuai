/**
 * proactive_opening_smoke —— P1 开场多样化红色验证（开场由头跨会话记账·只存 type 不存内容）。
 * DB_PATH=/tmp 临时库（recordOpeningHook 真写）；classify/buildHint 纯函数零网络。
 *
 * 治"我刚看到个段子"开场雷同：deterministic 分类开场由头 type→跨会话记账最近 N 次→prompt"换一种"。
 *
 * 红验（烧坏版本必须红）：
 *   ① classifyOpeningHook 各类 + 🔴必改4 优先级(memory_echo 提前·首命中胜) + 无命中→other
 *   ② buildRecentHooksHint 空/单/多 + 🔴只喂描述符不泄漏 type token + 必改5 软 guard("不要为了换而生硬")
 *   ③ 🔴必改1：recordOpeningHook 对 'other'/空 不持久化
 *   ④ 🔴必改3：JSON array·trim N=4·坏 JSON 回退[]不崩·last_hook_types 不在 ALLOWED_FIELDS
 *   ⑤ 🔴必改2：recordOpeningHook 唯一调用点 gate on sentAnySegment（真实送达后才记·drop/失败路径绝不记）
 *   ⑥ reply 即便传 recentHooksHint 也不渲染；静态钉死 bot/playground(reply) 不传
 */
process.env.DB_PATH = '/tmp/p1_opening_smoke.db';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(process.env.DB_PATH + s); } catch { /* clean */ } }

// 🔴 src 模块走动态 import：db.mjs import 期 `const DB_PATH = process.env.DB_PATH` 锁定路径，
// 静态 import 会被 ESM 提升到上面 DB_PATH 赋值之前 → 误连默认 data/bot.db（pr3_llm_redteam 同款做法）。
const { classifyOpeningHook, buildRecentHooksHint } = await import('../src/proactive_engine.mjs');
const { buildSystemPrompt } = await import('../src/companion.mjs');
const { getDb, recordOpeningHook, getCompanionById, ALLOWED_FIELDS } = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// ── 1. classifyOpeningHook 各类 + 优先级 + 无命中→other ──────────────────────
ok(classifyOpeningHook('刷到个视频笑死') === 'share_seen', '① share_seen');
ok(classifyOpeningHook('刚吃到个超好吃的') === 'share_food', '① share_food');
ok(classifyOpeningHook('你今天还好吗') === 'care_check', '① care_check');
ok(classifyOpeningHook('在干嘛呢') === 'ask_plan', '① ask_plan');
ok(classifyOpeningHook('突然想到一个问题') === 'random_thought', '① random_thought');
ok(classifyOpeningHook('今天好累啊') === 'share_mood', '① share_mood');
ok(classifyOpeningHook('之前你说想去爬山 还记得吗') === 'memory_echo', '① memory_echo');
ok(classifyOpeningHook('emmm') === 'other', '① 无命中→other');
// 🔴 必改4 优先级：多关键词首命中胜·memory_echo 提前
ok(classifyOpeningHook('还记得你说的那事吗 我今天好累') === 'memory_echo', '🔴① 多关键词：memory_echo 优先于 share_mood(累)');
ok(classifyOpeningHook('刷到个视频 好无聊') === 'share_seen', '① 多关键词：share_seen 优先于 share_mood(无聊)');

// ── 2. buildRecentHooksHint 空/单/多 + 只喂描述符 + 软 guard ──────────────────
ok(buildRecentHooksHint('[]') === '', '② 空数组→不注入');
ok(buildRecentHooksHint(null) === '', '② null→不注入');
ok(buildRecentHooksHint('坏json{') === '', '② parse 失败→[]→不注入');
ok(buildRecentHooksHint('["other","other"]') === '', '② 全 other→无 recognized→不注入');
const single = buildRecentHooksHint('["share_seen"]');
ok(single.includes('分享看到/刷到的东西') && single.includes('换个由头'), '② 单→描述符+换由头');
const multi = buildRecentHooksHint('["share_seen","ask_plan"]');
ok(multi.includes('分享看到/刷到的东西') && multi.includes('问他在做什么/今天安排'), '② 多→列出描述符');
ok(multi.includes('不要为了换而生硬'), '🔴② 必改5 软 guard：不要为了换而生硬');
ok(!/share_seen|ask_plan/.test(single + multi), '🔴② 只喂中文描述符·绝不泄漏 type token/内容');

// ── 3+4. recordOpeningHook（DB）：必改1 other 不记 / 必改3 JSON array·trim N=4·坏 JSON 回退 ──
const db = getDb();
db.pragma('foreign_keys = OFF');   // 合成 companion·临时库无 users/bot 行（pr3 同款）
const CID = 9001;   // 非冲突 id（默认库已 seed id=1）
db.prepare(`INSERT INTO companions (id,user_id,bot_id,name,age,safe_mode,relationship_stage) VALUES (?,1,'p1smoke','测试角色',22,0,'恋人')`).run(CID);
recordOpeningHook(CID, 'share_seen');
ok(JSON.parse(getCompanionById(CID).last_hook_types)[0] === 'share_seen', '③ 记一次→入库(JSON array)');
recordOpeningHook(CID, 'other');
ok(JSON.parse(getCompanionById(CID).last_hook_types).length === 1, '🔴③ 必改1：other 不持久化');
recordOpeningHook(CID, '');
ok(JSON.parse(getCompanionById(CID).last_hook_types).length === 1, '③ 空 hookType 不记');
// trim N=4：推 5 个 → 留最近 4·丢最老
db.prepare('UPDATE companions SET last_hook_types=NULL WHERE id=?').run(CID);
for (const t of ['share_seen', 'share_food', 'care_check', 'ask_plan', 'random_thought']) recordOpeningHook(CID, t);
const arr = JSON.parse(getCompanionById(CID).last_hook_types);
ok(arr.length === 4, '🔴④ 必改3：trim 到 N=4');
ok(arr[0] === 'share_food' && arr[3] === 'random_thought', '④ 保最近4·丢最老(share_seen)');
// 坏 JSON 回退[]不崩
db.prepare("UPDATE companions SET last_hook_types='坏json{' WHERE id=?").run(CID);
recordOpeningHook(CID, 'share_mood');
ok(JSON.parse(getCompanionById(CID).last_hook_types)[0] === 'share_mood', '🔴④ 必改3：坏 JSON→回退[]→不崩');
// last_hook_types 不在 ALLOWED_FIELDS（dashboard/通用 PATCH 改不了）
ok(!ALLOWED_FIELDS.has('last_hook_types'), '🔴④ 必改3：last_hook_types 不在 ALLOWED_FIELDS');

// ── 5. 🔴必改2 静态钉死：recordOpeningHook 唯一调用点·gate on sentAnySegment·真实送达后才记 ──
const proSrc = readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
const botSrc = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
const pgSrc = readFileSync(new URL('../src/playground.mjs', import.meta.url), 'utf8');
ok((proSrc.match(/recordOpeningHook\(/g) || []).length === 1, '🔴⑤ 必改2：recordOpeningHook 唯一调用点(只记一次)');
ok(/if\s*\(\s*sentAnySegment\s*\)\s*\{[\s\S]{0,160}recordOpeningHook\(/.test(proSrc), '🔴⑤ 必改2：调用点 gate on sentAnySegment（drop/失败路径绝不记·防幽灵记录）');

// ── 6. reply 不渲染 + 静态钉死 bot/playground 不传 ──────────────────────────────
const baseC = { id: 1, name: '测试角色', age: 22, relationship_stage: '恋人', affection_level: 70 };
const hint = buildRecentHooksHint('["share_seen","ask_plan"]');
const proSys = buildSystemPrompt(baseC, { promptMode: 'proactive', recentHooksHint: hint });
ok(proSys.includes('换个没用过的由头'), '⑥ proactive 渲染 recentHooksHint');
const replySys = buildSystemPrompt(baseC, { promptMode: 'reply', recentHooksHint: hint });
ok(!replySys.includes('换个没用过的由头') && !replySys.includes('分享看到/刷到的东西'), '🔴⑥ reply 即便传 recentHooksHint 也不渲染（gate 在 proactive 块内）');
ok(/recentHooksHint/.test(proSrc) && /buildRecentHooksHint/.test(proSrc), '⑥ proactive.mjs 算并传 recentHooksHint');
ok(!/recentHooksHint/.test(botSrc), '⑥ bot.mjs(reply) 不传 recentHooksHint');
ok(!/recentHooksHint/.test(pgSrc), '⑥ playground.mjs(reply) 不传 recentHooksHint');

console.log(`\nproactive_opening_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
