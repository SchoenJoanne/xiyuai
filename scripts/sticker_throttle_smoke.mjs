/**
 * sticker_throttle_smoke.mjs —— 贴纸节流包（P1+D1+D2+D3）坏版本验红（确定性·进 CI）
 *
 * 停板B 拍板（2026-07-02·停板A 审过·四项拍板）：
 *   P1 密度回拨「每 3-5 条」（消歧为「他发来的消息轮次」·保留时机指引·删催量词）
 *   D1 parseStickerMarkers 加 {max, enabled}·整条至多 1 张（跨段预算）·enabled 修出口漏洞（缺口①）·
 *      非法标记剥离不外漏（缺口④）
 *   D2 轮次冷却 recentOutboundStickerActive（最近 4 条发出消息内已有贴纸→冷却·零时钟·CI 可断言）
 *   D3 断棘轮 historyToMessages 滤贴纸行 + buildSystemPrompt 渲染剥标记
 *
 * 🔴 坏版本验红映射（stash 本包改动 / neuter 各闸→对应断言变红）：
 *   D1 max      : 3 标记只发 1（关 max→3 全发=红）
 *   D1 enabled  : enabled=false→零挑图（忽略 enabled→仍挑=红·缺口①）
 *   缺口④        : 非法标记 [STICKER:...] 剥离不外漏（旧码→原文漏给用户=红）
 *   D2 冷却      : 最近 4 条内有贴纸→active（关冷却/window 错→红）
 *   D3a ai       : 历史贴纸行不进 LLM messages（关过滤→回流=红）
 *   D3b prompt   : 16 轮渲染无 [STICKER:（关剥离→标记进 prompt=红）
 *   P1 文案      : hint 含 3-5/他发来·无 别太吝啬/大方用/每 2-3（旧文案=红）
 */
import { getDb } from '../src/db.mjs';
import { existsSync } from 'node:fs';

// 🔴 发布工序②·manifest 在才跑守卫：公开仓/staging 无表情包资产（.gitignore `assets/stickers/*`）→
//   loadManifest 失败禁贴纸→依赖挑图的断言假红（archive #15 同族·实测 6 断言）。缺则优雅跳过非红
//   （本机 run_full_ci.sh cp 补料·manifest 在则照常全跑）。见 assets/stickers/PROVENANCE.md。
if (!existsSync(new URL('../assets/stickers/manifest.json', import.meta.url))) {
  console.log('⏭️  SKIP sticker-throttle：assets/stickers/manifest.json 缺（公开仓无表情包资产·优雅跳过非红）');
  process.exit(0);
}

const { parseStickerMarkers, stripStickerMarkers, buildStickerPromptHint } = await import('../src/stickers.mjs');
const { recentOutboundStickerActive } = await import('../src/db.mjs');
const { historyToMessages } = await import('../src/ai.mjs');
const { buildSystemPrompt } = await import('../src/companion.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const noMarker = (s) => !/[\[【]\s*STICKER\s*:/i.test(String(s));

console.log('── ① D1 max：整条至多 1（3 标记只挑 1·超额只剥不发） ──');
{
  const r = parseStickerMarkers('a[STICKER:happy]b[STICKER:love]c[STICKER:shy]d', { max: 1, enabled: true });
  ok(r.stickers.length === 1, `3 标记 max=1 → 只挑 1（实=${r.stickers.length}）← 关 max→3=红`);
  ok(noMarker(r.text), '超额标记从文本剥离（text 无 [STICKER:）');
  const r0 = parseStickerMarkers('x[STICKER:happy]y[STICKER:love]z', { max: 0, enabled: true });
  ok(r0.stickers.length === 0, 'max=0 → 零挑图（预算用尽的后续段）');
  ok(noMarker(r0.text), 'max=0 仍剥离标记不外漏');
}

console.log('── ② D1 enabled=false（缺口①/D2 出口硬 drop：幻觉标记一律剥离不挑图） ──');
{
  const r = parseStickerMarkers('嗨[STICKER:happy]你好[STICKER:love]', { max: 1, enabled: false });
  ok(r.stickers.length === 0, `enabled=false → 零挑图（实=${r.stickers.length}）← 忽略 enabled 仍挑=红`);
  ok(noMarker(r.text), 'enabled=false 仍剥离标记不外漏');
}

console.log('── ③ 缺口④：非法标记（连字符/空格·严格 RE 不匹配）剥离不外漏 ──');
{
  const r = parseStickerMarkers('哈哈[STICKER:good-vibes]你好', { max: 1, enabled: true });
  ok(noMarker(r.text), `半角非法标记 [STICKER:good-vibes] 不漏给用户（text="${r.text}"）← 旧码原文漏=红`);
  ok(!/good-vibes/.test(r.text), '畸形 tag 内容也不外漏');
  const r2 = parseStickerMarkers('看这个【STICKER:some thing】呀', { max: 1, enabled: true });
  ok(noMarker(r2.text) && !/some thing/.test(r2.text), '全角含空格畸形标记也剥离');
}

console.log('── ④ 向后兼容：无 opts 默认（max=∞·enabled=true）仍正常挑图 ──');
{
  const r = parseStickerMarkers('早啊[STICKER:morning]');
  ok(r.stickers.length === 1 && noMarker(r.text), '默认调用挑 1 张·文本剥净（三路旧调用不破）');
}

console.log('── ⑤ stripStickerMarkers（D3 渲染/历史剥离用） ──');
{
  ok(stripStickerMarkers('好呀[STICKER:happy]，晚安') === '好呀，晚安'.replace(/\s+/g, ' ').trim()
     || noMarker(stripStickerMarkers('好呀[STICKER:happy]，晚安')), '剥严格标记·保留正文');
  ok(noMarker(stripStickerMarkers('a【STICKER:some thing】b')), '剥畸形标记');
  ok(stripStickerMarkers('') === '' && stripStickerMarkers(null) === '', '空/null 安全');
}

console.log('── ⑥ D2 轮次冷却 recentOutboundStickerActive（temp DB·显式 created_at·零时钟） ──');
{
  const db = getDb();
  const BOT = 'bot_x', USR = 'user_x';
  const ins = db.prepare(`INSERT INTO wechat_messages (msg_id, from_user, to_user, msg_type, content, direction, created_at) VALUES (?,?,?,?,?,?,?)`);
  let t = 0;
  const outMsg = (content, type = 'text') => ins.run(`m${++t}`, BOT, USR, type, content, 'out', t);

  // 空账 → false
  ok(recentOutboundStickerActive(USR, BOT, 4) === false, '空账 → 不冷却');
  // 4 条发出·最新一条是贴纸 → true
  outMsg('段一'); outMsg('段二'); outMsg('段三'); outMsg('[STICKER:happy]', 'image');
  ok(recentOutboundStickerActive(USR, BOT, 4) === true, '最近 4 条含贴纸 → 冷却 active ← 关冷却/window→红');
  // 再发 4 条纯文本 → 贴纸滑出 window(4) → false
  outMsg('t1'); outMsg('t2'); outMsg('t3'); outMsg('t4');
  ok(recentOutboundStickerActive(USR, BOT, 4) === false, '贴纸滑出 4 条 window → 不冷却（轮次口径生效）');
  ok(recentOutboundStickerActive(USR, BOT, 8) === true, 'window=8 → 贴纸仍在窗内 → 冷却（window 参数真生效）');
  // 隔离：入站方向的贴纸不算（她没发·是别人发的）
  const BOT2 = 'bot_y', USR2 = 'user_y';
  ins.run('n1', USR2, BOT2, 'image', '[STICKER:love]', 'in', 100);   // direction=in
  ok(recentOutboundStickerActive(USR2, BOT2, 4) === false, '入站贴纸(direction=in)不计入·只看发出');
  // 缺 id → false（fail-open）
  ok(recentOutboundStickerActive('', BOT, 4) === false && recentOutboundStickerActive(USR, '', 4) === false, '缺 id → false（fail-open）');
}

console.log('── ⑦ D3a historyToMessages：独立贴纸行不进 LLM 上下文（断棘轮） ──');
{
  const hist = [
    { direction: 'in', content: '在吗' },
    { direction: 'out', content: '在呀' },
    { direction: 'out', content: '[STICKER:happy]' },      // 半角贴纸行
    { direction: 'out', content: '【STICKER:love】' },      // 全角贴纸行
    { direction: 'out', content: '[图片]' },                // 旧行为：图片占位跳过
    { role: 'assistant', content: '想你了' },
  ];
  const msgs = historyToMessages(hist);
  ok(msgs.every(m => noMarker(m.content)), 'LLM messages 里零 [STICKER: 行 ← 关过滤→回流=红');
  ok(msgs.some(m => m.content === '在呀') && msgs.some(m => m.content === '想你了'), '正常文本历史保留');
  ok(!msgs.some(m => m.content === '[图片]'), '图片占位仍跳过（旧行为不破）');
  ok(msgs.find(m => m.content === '在吗')?.role === 'user' && msgs.find(m => m.content === '在呀')?.role === 'assistant', 'direction→role 解析不破');
}

console.log('── ⑧ D3b buildSystemPrompt：16 轮渲染剥贴纸标记（断棘轮·渲染侧） ──');
{
  const comp = { id: 'sb', name: '小柔', age: 24, nsfw_level: 0, personality_tags: ['温柔'], relationship_stage: '恋人', can_joke: true };
  const recentTurns = [
    { role: 'user', content: '晚安' },
    { role: 'assistant', content: '晚安呀[STICKER:love]，做个好梦' },
  ];
  const p = buildSystemPrompt(comp, { promptMode: 'reply', recentTurns });
  // 🔴 精确断言：渲染注入的 [STICKER:love] 必须被剥；§18 教学禁令行 [STICKER:photo] 合法保留（别误判）。
  ok(!/STICKER\s*:\s*love/i.test(p), '渲染注入的 [STICKER:love] 被剥 ← 关剥离→标记进 prompt=红');
  // 定位【最近对话上下文】段·断言该段零标记（不受 §18 教学行干扰）
  const ctxBlock = (p.split('【最近对话上下文】')[1] || '').split('\n\n')[0];
  ok(noMarker(ctxBlock), '最近对话上下文段内零 [STICKER: 标记');
  ok(p.includes('晚安呀') && p.includes('做个好梦'), '正文保留（只剥标记不伤内容）');
  ok((await import('../src/prompt_cond_blocks.mjs')).PHOTO_COND.includes('[STICKER:photo]'), '§18 教学禁令 [STICKER:photo] 保留在 PHOTO_COND(B2 移索图轮·bot侧追加不经渲染剥离故天然不误伤)');
}

console.log('── ⑨ P1 文案回拨（3-5 条·他发来的消息·删催量词） ──');
{
  const hint = buildStickerPromptHint(true);
  ok(/3-5/.test(hint), 'hint 含「3-5」← 旧「每 2-3」=红');
  ok(/他发来/.test(hint), 'hint「条」消歧为「他发来的消息」');
  ok(/情绪起伏/.test(hint), '保留时机指引（情绪起伏处用更自然）');
  ok(/最多一个表情/.test(hint), '保留「一条消息最多一个」');
  ok(!/别太吝啬/.test(hint), '删催量词「别太吝啬」← 旧文案=红');
  ok(!/大方用/.test(hint), '删催量词「大方用」← 旧文案=红');
  ok(!/每\s*2-3|2-3\s*条/.test(hint), '无旧「每 2-3 条」');
  ok(!/更要用/.test(hint), '删催量词「更要用」');
  ok(buildStickerPromptHint(false) === '', 'enabled=false → 无 hint（隔离·开关关不注入）');
}

console.log(`\n══ sticker-throttle smoke：${pass} 通过 / ${fail} 失败 ══`);
for (const suf of ['', '-wal', '-shm']) { try { (await import('node:fs')).unlinkSync(process.env.DB_PATH + suf); } catch {} }
process.exit(fail ? 1 : 0);
