/**
 * scene_state_smoke —— #324 失忆修红验（current_scene 事件驱动持久 + open_loop 约定注入 + TTL；零 LLM）。
 *
 * 根因：current_scene 字段存在且已无条件注入(§6「你现在在：X」)却从不自动更新→stale"在家"反客为主，
 * 密聊下真场景滑出 16 行窗口后 LLM 凭空编场景。修法搭车 extractAndSaveMemories 的 LLM pass 自动更新。
 */
process.env.DB_PATH = '/tmp/scene_state_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, patchCompanion, getCompanionById, saveOpenLoop } = await import('../src/db.mjs');
const { applySceneUpdate, resetScenesForNewDay } = await import('../src/memory.mjs');
const { buildOpenLoopsHint } = await import('../src/open_loops.mjs');
const { buildSystemPrompt } = await import('../src/companion.mjs');
const { parseSceneState, buildSceneHint, applySceneTransition, scrubSceneJump, serializeSceneMeta } = await import('../src/scene_state.mjs');

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };
const db = getDb();
db.pragma('foreign_keys = OFF');
db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (1,1,'b','溪语')").run();
const comp = () => getCompanionById(1);

// ── ① applySceneUpdate：事件驱动 + 跨轮持久 + 失败回落 ──────────────────────────
applySceneUpdate(1, '图书馆');
ok(comp().current_scene === '图书馆', '①抓到场景→patch current_scene=图书馆');
applySceneUpdate(1, '');
ok(comp().current_scene === '图书馆', '①本轮无场景→保留现值（跨轮持久＝修复要害）');
applySceneUpdate(1, '日常');
ok(comp().current_scene === '图书馆', '①占位"日常"不覆盖真实场景');
applySceneUpdate(1, '咖啡馆');
ok(comp().current_scene === '咖啡馆', '①新场景→覆盖（场景切换）');
applySceneUpdate(1, '在家');
ok(comp().current_scene === '在家', '①"到家了"→"在家"是真实场景切换，不被当占位跳过');
applySceneUpdate(1, null, { extractionFailed: true });
ok(comp().current_scene === '日常', '①抽取失败→回落"日常"（fail-open 反转，不留过期值）');

// ── ② §6 注入：current_scene 进 prompt（本 bug 的注入点）─────────────────────────
patchCompanion(1, { current_scene: '图书馆' });
let p = buildSystemPrompt(comp(), { promptMode: 'reply' });
ok(/你现在在：图书馆/.test(p), '②current_scene=图书馆→prompt 注入"你现在在：图书馆"');
patchCompanion(1, { current_scene: '日常' });
p = buildSystemPrompt(comp(), { promptMode: 'reply' });
ok(/你现在在家/.test(p) && !/你现在在：/.test(p), '②"日常"→退回"你现在在家随意聊"（中性默认）');

// ── ②B open_loops 注入 + appointment 置顶 ────────────────────────────────────────
saveOpenLoop({ companionId: 1, title: '他周五考试', loopKind: 'user_said', emotionalWeight: 60 });
saveOpenLoop({ companionId: 1, title: '约了一起吃晚饭', loopKind: 'appointment', emotionalWeight: 50 });
const hint = buildOpenLoopsHint(1);
ok(/约了一起吃晚饭/.test(hint) && /你俩的约定/.test(hint), '②B约定注入串含"约了一起吃晚饭（你俩的约定）"');
ok(hint.indexOf('约了一起吃晚饭') < hint.indexOf('他周五考试'), '②B appointment 置顶（即便 weight 更低；最易被挤出）');
p = buildSystemPrompt(comp(), { promptMode: 'reply', openLoopsHint: hint });
ok(/约了一起吃晚饭/.test(p), '②B openLoopsHint 进 buildSystemPrompt（无条件注入）');
ok(!/约了一起吃晚饭/.test(buildSystemPrompt(comp(), { promptMode: 'reply' })), '②B红验：不传 openLoopsHint 则不注入（纯函数零依赖）');

// ── ③ TTL 次日清场 ──────────────────────────────────────────────────────────────
patchCompanion(1, { current_scene: '图书馆' });
db.prepare("INSERT INTO companions (id,user_id,bot_id,name,current_scene) VALUES (2,1,'b','x','在家')").run();
const changed = resetScenesForNewDay();
ok(comp().current_scene === '日常', '③次日清场：图书馆→日常');
ok(getCompanionById(2).current_scene === '在家', '③清场不动"在家"（本就中性）');
ok(changed >= 1, '③返回清场条数');

// ── #324 端到端回归：场景滑出 16 行窗口后仍不失忆（治本）────────────────────────────
patchCompanion(1, { current_scene: '图书馆' });
const farTurns = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '兔子狐狸的故事' + i }));
p = buildSystemPrompt(comp(), { promptMode: 'reply', recentTurns: farTurns });
ok(/你现在在：图书馆/.test(p), '#324回归：场景滑出 16 行窗口后 current_scene 仍注入图书馆（不再编"麻辣香锅"）');

// ── ④ PR-3·B（B-min sidecar）：裸 current_scene 契约不变 + sidecar meta 结构化 + 状态机（治 某存量案例）──
// ④a 裸串契约（红验①）：写入后 current_scene 仍是裸 location 字符串、不以 "{" 开头；结构化进 meta
applySceneUpdate(1, { location: '图书馆', food_state: 'planning' });
ok(comp().current_scene === '图书馆' && comp().current_scene[0] !== '{', '④a🔴current_scene 写后仍裸 location 字符串（不以 { 开头·契约不变）');
ok(parseSceneState(comp().current_scene, comp().current_scene_meta).food_state === 'planning', '④a sidecar current_scene_meta 存住 food_state=planning');

// ④b 旧数据兼容（红验②）：current_scene='在家' + meta=NULL 正常解析；坏 JSON fail-open
ok(parseSceneState('在家', null).location === '在家' && parseSceneState('在家', null).food_state === 'none', '④b 旧裸串 current_scene=在家 + meta=NULL → 中性兼容');
ok(parseSceneState('图书馆', '坏JSON{{').food_state === 'none', '④b 坏 JSON meta → fail-open 中性（不抛）');

// ④c parseSceneState 唯一结构化出口（裸 location + meta JSON 合并）
ok(parseSceneState('公园', '{"v":1,"food_state":"eating"}').food_state === 'eating', '④c parseSceneState 合并裸 location + meta JSON');
ok(parseSceneState('', null).location === '' && parseSceneState(null, null).food_state === 'none', '④c 空/null → 中性');

// ④d 状态机：planning→finished 瞬移拦（红验⑤）+ 跨地点瞬移拦；他主动宣布才放行
const _now = Date.now();
const t1 = applySceneTransition({ location: '饭店', food_state: 'planning', established_at: _now }, { location: '饭店', food_state: 'finished' }, { userTransition: false });
ok(t1.food_state === 'planning' && t1.transition_pending, '④d🔴planning→finished 无过渡(刚说去吃→刚吃完)→拦·保持 planning');
const t2 = applySceneTransition({ location: '饭店', food_state: 'planning', established_at: _now }, { location: '饭店', food_state: 'finished' }, { userTransition: true });
ok(t2.food_state === 'finished', '④d 他真说"吃完了"(userTransition)→放行 finished');
const t3 = applySceneTransition({ location: '图书馆', established_at: _now }, { location: '饭店' }, { userTransition: false });
ok(t3.location === '图书馆' && t3.transition_pending, '④d🔴跨地点无过渡瞬移→拦·保持图书馆');
const t4 = applySceneTransition({ location: '图书馆', established_at: _now }, { location: '咖啡馆' }, { userTransition: true });
ok(t4.location === '咖啡馆', '④d 他驱动场景切换(去咖啡馆)→放行(不误伤正常切换)');

// ④e buildSceneHint 渲染自然语言·绝不拼 JSON 原文（红验⑥）
const h2 = buildSceneHint('图书馆', '{"v":1,"food_state":"planning"}');
ok(/别说成.{0,3}刚吃完/.test(h2) && !/\{|"v":|food_state/.test(h2), '④e🔴buildSceneHint planning→自然句"别说成刚吃完"·零 JSON 原文');
ok(buildSceneHint('图书馆', null) === '', '④e 普通场景(无 meta)→空串（不刻板注入）');

// ④f scrubSceneJump 某存量案例（红验④）：固定场景下拦凭空"刚吃完X回来"，中性场景不刻板
ok(!/麻辣香锅/.test(scrubSceneJump('刚吃完麻辣香锅回来，撑得不想动', '图书馆', null)), '④f🔴某存量案例:图书馆场景下"刚吃完麻辣香锅回来"→拦(治 某存量案例 根因)');
ok(scrubSceneJump('刚吃完麻辣香锅回来', '日常', null) === '刚吃完麻辣香锅回来', '④f 中性场景(日常)不刻板拦"刚吃完"');
ok(scrubSceneJump('在图书馆看书呢，挺安静的', '图书馆', null) === '在图书馆看书呢，挺安静的', '④f 图书馆场景正常对话不误拦');

// ④g 端到端：连续对话里"模型自宣吃完"(他没说)被状态机拦；他本人说吃完才放行（治 某存量案例 持久化路径）
patchCompanion(1, { current_scene: '饭店', current_scene_meta: serializeSceneMeta({ location: '饭店', food_state: 'planning', established_at: Date.now() }) });
applySceneUpdate(1, { location: '饭店', food_state: 'finished' }, { userTransition: false });
ok(parseSceneState(comp().current_scene, comp().current_scene_meta).food_state === 'planning', '④g🔴端到端:他没说吃完·仅模型自宣 finished→状态机拦·meta 仍 planning');
applySceneUpdate(1, { location: '饭店', food_state: 'finished' }, { userTransition: true });
ok(parseSceneState(comp().current_scene, comp().current_scene_meta).food_state === 'finished', '④g 他本人说吃完(userTransition)→放行 finished');
ok(comp().current_scene === '饭店' && comp().current_scene[0] !== '{', '④g 全程 current_scene 仍裸串(不以 { 开头)');

for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
console.log(`scene_state_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
