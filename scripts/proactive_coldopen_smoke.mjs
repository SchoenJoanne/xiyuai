/**
 * proactive_coldopen_smoke —— P2-B 冷开场语义 + time-gap 红色验证。
 * 纯函数零真网络零 DB：buildSystemPrompt 零依赖纯函数 + buildTimeGapPhrase 纯函数（显式传 now）。
 *
 * 治 proactive 连贯性两病：①幻觉续话框架（把 2h 前已结束的话当"接着说"）②"刚刚"指代 2h 前
 * （prompt 无时间流逝信号）。
 *
 * 红验（烧坏版本必须红）：
 *   ① reply 末句【字节级不变】（延续…话题连贯）；proactive【不含】该句、【含】参考背景新句；
 *      两模式对话内容（lines）都在（不失忆）
 *   ② proactive 含【这次重新开口·时间感】块 = 两 gap + 第三布尔（必改2）+ 弱化关心（调整①）
 *      + PR-2 红线禁句（调整③：不索取回复）
 *   ③ reply 即便传 timeGapHint 也【不渲染】冷开场块（gate 在 proactive 分支内）；
 *      续话词【语义禁】（禁"暗示对话没断过"、放行"刚发生的小事"·必改3）仅 proactive
 *   ④ buildTimeGapPhrase 防御式 6 边界（必改4）：空/非法/未来/30min/3h/2天 + 第三布尔是/否 +
 *      🔴 必改1 空值中性（"暂无记录"·绝不"还没回过你"防委屈泄漏）
 *   ⑤ 静态钉死：proactive.mjs 算并传 timeGapHint；reply 端（bot/playground）不传（默认安全）
 */
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '../src/companion.mjs';
import { buildTimeGapPhrase } from '../src/proactive_engine.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

const baseC = { id: 1, name: '溪语', age: 21, relationship_stage: '恋人', affection_level: 70 };
const REPLY_CONTINUE = '延续上面的最近聊天内容，保持称呼、情绪和话题连贯';   // reply 末句字节锚
const COLDOPEN_HEADER = '【这次重新开口 · 时间感】';
const REF_BG = '仅作参考背景';                                              // proactive 558 新句锚
const recentTurns = [
  { role: 'user', content: '今天好累' },
  { role: 'assistant', content: '怎么了' },
];
const NOW = new Date('2026-06-18T12:00:00').getTime();
const aGap = buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-18 09:00:00', lastProactiveReplyAt: '2026-06-16 12:00:00' });

// ── 1. reply 末句字节级不变 / proactive 换冷开场新句 / 两模式都保留对话内容 ──────
{
  const reply = buildSystemPrompt(baseC, { promptMode: 'reply', recentTurns });
  const pro   = buildSystemPrompt(baseC, { promptMode: 'proactive', recentTurns, timeGapHint: aGap });
  ok(reply.includes(REPLY_CONTINUE), '① reply 末句字节级不变（延续…话题连贯）');
  ok(!pro.includes(REPLY_CONTINUE), '① proactive 绝不含 reply 续话句（验收④核心）');
  ok(pro.includes(REF_BG), '① proactive 含参考背景新句（仅作参考背景）');
  ok(reply.includes('【最近对话上下文】') && pro.includes('【最近对话上下文】'), '① 两模式都保留【最近对话上下文】（不失忆）');
  ok(reply.includes('今天好累') && pro.includes('今天好累'), '① 对话原文 lines 两模式字节都在（不删）');
}

// ── 2. proactive 冷开场块 = 两 gap + 第三布尔 + 弱化关心 + PR-2 红线 ──────────────
{
  const pro = buildSystemPrompt(baseC, { promptMode: 'proactive', recentTurns, timeGapHint: aGap });
  ok(pro.includes(COLDOPEN_HEADER), '② proactive 含【这次重新开口·时间感】块');
  ok(pro.includes('距对方上次回复') && pro.includes('距你上次主动'), '② 含两个 gap（GPT 必改2：不是一个）');
  ok(pro.includes('你上次主动后，对方是否回复'), '② 含第三布尔（必改2：最危险象限判据直接摆出）');
  ok(pro.includes('按你自己的性格') && !pro.includes('有一阵没聊啦'), '② P1-③：去 generic 温柔示范、改「按人设开口」（删「有一阵没聊啦」模板=飘的来源之一）');
  ok(pro.includes('不要索取回复') && pro.includes('不要让对方解释为什么没回'), '② 调整③：PR-2 红线（不索取回复/不让解释）');
  ok(pro.includes('绝不能说') && pro.includes('你怎么不理我'), '② PR-2 红线禁句在场（绝不能说「你怎么不理我」等）');
}

// ── 3. reply 传 timeGapHint 不渲染 / 续话词语义禁仅 proactive（必改3 禁语义不禁词）──
{
  const replyWithGap = buildSystemPrompt(baseC, { promptMode: 'reply', recentTurns, timeGapHint: aGap });
  ok(!replyWithGap.includes(COLDOPEN_HEADER), '③ reply 即便传 timeGapHint 也不渲染冷开场块（gate 在 proactive 分支内）');
  ok(!replyWithGap.includes('距对方上次回复'), '③ reply 不渲染 gap 事实');
  const pro = buildSystemPrompt(baseC, { promptMode: 'proactive', recentTurns, timeGapHint: aGap });
  ok(pro.includes('暗示你们的对话没有断过'), '③ proactive 含续话词【语义禁】（禁"暗示对话没断过"·必改3）');
  ok(!replyWithGap.includes('暗示你们的对话没有断过'), '③ 续话词语义禁仅 proactive，reply 无');
  ok(pro.includes('如果你是在说此刻刚发生的小事'), '③ 必改3 禁语义不禁词：合法"刚发生小事"明确放行（不 blanket ban 刚刚/刚才）');
}

// ── 4. buildTimeGapPhrase 防御式 6 边界 + 第三布尔 + 必改1 空值中性 ───────────────
{
  // 空值（必改1：中性·无委屈词）
  const empty = buildTimeGapPhrase({ now: NOW, lastUserReplyAt: null, lastProactiveReplyAt: null });
  ok(empty.includes('距对方上次回复：暂无记录。') && empty.includes('距你上次主动：暂无记录。'), '④空值→暂无记录');
  ok(empty.includes('你上次主动后，对方是否回复：暂无主动记录。'), '④空值第三布尔→暂无主动记录');
  ok(!/还没回过你|还没主动找过他/.test(empty), '🔴④必改1：空值绝不出现"还没回过你/还没主动找过他"（防委屈泄漏）');
  // 非法时间戳
  const bad = buildTimeGapPhrase({ now: NOW, lastUserReplyAt: 'not-a-date', lastProactiveReplyAt: '坏时间戳' });
  ok(bad.includes('距对方上次回复：暂无记录。'), '④非法时间戳→暂无记录');
  ok(!/NaN/.test(bad), '④非法→无 NaN 泄漏');
  // 未来时间 → clamp 0 → 不到1小时（不负不NaN天）
  const future = buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-19 12:00:00', lastProactiveReplyAt: '2026-06-20 00:00:00' });
  ok(future.includes('距对方上次回复：不到1小时。'), '④未来时间→clamp 0→不到1小时');
  ok(!/-\d|NaN\s*天|约-/.test(future), '④未来→不出现负数/NaN天');
  // 30 分钟
  ok(buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-18 11:30:00', lastProactiveReplyAt: null })
      .includes('距对方上次回复：不到1小时。'), '④30分钟→不到1小时');
  // 3 小时
  ok(buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-18 09:00:00', lastProactiveReplyAt: null })
      .includes('距对方上次回复：约3小时。'), '④3小时→约3小时');
  // 2 天
  ok(buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-16 12:00:00', lastProactiveReplyAt: null })
      .includes('距对方上次回复：约2天。'), '④2天→约2天');
  // 第三布尔逻辑：你上次主动后他回没回
  ok(buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-18 11:00:00', lastProactiveReplyAt: '2026-06-18 09:00:00' })
      .includes('你上次主动后，对方是否回复：是。'), '④第三布尔：user回(11)晚于pro(9)→是');
  ok(buildTimeGapPhrase({ now: NOW, lastUserReplyAt: '2026-06-18 08:00:00', lastProactiveReplyAt: '2026-06-18 10:00:00' })
      .includes('你上次主动后，对方是否回复：否。'), '🔴④第三布尔：user回(8)早于pro(10)→否（最危险象限·别追）');
}

// ── 5. 静态钉死：proactive 算并传 timeGapHint；reply 端不传（默认安全）──────────────
{
  const proSrc = readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
  const botSrc = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
  const pgSrc  = readFileSync(new URL('../src/playground.mjs', import.meta.url), 'utf8');
  ok(/buildTimeGapPhrase\s*\(/.test(proSrc) && /timeGapHint/.test(proSrc), '⑤ proactive.mjs：算并传 timeGapHint');
  ok(!/timeGapHint/.test(botSrc), '⑤ bot.mjs(reply)：不传 timeGapHint（冷开场不漏进 reply·验收④）');
  ok(!/timeGapHint/.test(pgSrc), '⑤ playground.mjs(reply)：不传 timeGapHint');
}

console.log(`\nproactive_coldopen_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
