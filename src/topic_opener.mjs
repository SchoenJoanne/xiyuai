/**
 * topic_opener.mjs —— 对话中「她主动开新话头」（P2·停板B，2026-06-23）。
 *
 * 🔴 焊死红线：她开新话题 =【她有话想分享】(给予)，**绝不是**【怕你走/想拴住你/维持
 * engagement】(索取)。本模块只产「这是不是一个自然断点 + 该不该桥接式开个新话头」的**布尔/hint**，
 * 绝不读沉默、绝不落库任何对话状态、禁 LLM、禁新数据源。
 *
 * ── 设计来源（grounded·proactive_topic_design_stopA.md）──
 * · OTTers (ACL 2021)：人类话题转移 79% 用桥接句（从刚聊的内容长出来），仅 2% 凭空硬转 → 桥接式。
 * · 在自然断点(breakpoint)开口成本最低；话题中段插入 = 打断 → 三重防打断 AND-gate。
 * · 可拒绝、低压力：他不接/转身忙都 OK，绝不追问绝不撒娇讨债。
 *
 * ── 复用（零新数据源·零新词表）──
 * · intent_dedup.mjs：isAck / trailingAckStreak（断点信号）+ isIntentCooled（同 intent 冷却）。
 * · moderation.mjs：出站反愧疚强制扫在 moderation 侧（scrubTopicOpenerRedline，复用 hitsConflictRedline
 *   词表 + _stripQuotedSeg，绕 !inConflict 早返回）——本模块不碰词表，只产 hint。
 *
 * ── 4 维护者决策（停板A 拍板）──
 * ① ack-streak 阈值 N=3（比 2 更保守防打断；env PROACTIVE_TOPIC_OPEN_ACK_STREAK 默认 3）。
 * ② 每会话开新话头上限 M=1（最克制；env PROACTIVE_TOPIC_OPEN_MAX 默认 1）。
 * ③ 止血优先：与 ack 止血闸同轮时止血在先，新话头作其替代/补充（挂点逻辑在 bot.mjs，本模块只产料）。
 * ④ life_state 门控：经期/私密 life_state 作主动话头料**只在恋人 affection 档且低频**；
 *    朋友/陌生档绝不把经期/私密作主动话头料（works/日程/open_loops 不受此限）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { isAck, trailingAckStreak } from './intent_dedup.mjs';

// 决策①：连续 ack 断点阈值。N=3（停板B 二轮 env 灰度·先保 3·主刀生效后再单独调 2·一次一变量）。
export const TOPIC_OPEN_ACK_STREAK = Math.max(1, Number(process.env.PROACTIVE_TOPIC_OPEN_ACK_STREAK || 3));
// 🔴 主刀（2026-06-25 停板B 二轮·治真根因）：开新话头上限从「每会话 M=1·进程级永不重置」(旧瓶颈=每进程
//   只开 1 次直到重启) 改「每日预算」。计数由 bot.mjs 走 db getTopicOpensToday/bumpTopicOpensToday——
//   🔴 日界重置（日历事实·非时间间隔/沉默时长·绝不逼近读沉默红线）。本模块只比 alreadyOpenedCount >= 每日预算。
//   默认 2/日（保守先 2·dogfood 观测再升 3·env PROACTIVE_TOPIC_OPEN_DAILY）。
export const TOPIC_OPEN_DAILY = Math.max(0, Number(process.env.PROACTIVE_TOPIC_OPEN_DAILY || 2));
// 决策④：经期/私密 life_state 作主动话头料的恋人门控（与 moderation LIFE_DISCLOSE_AFFECTION_GATE 同源默认）。
export const TOPIC_OPEN_LIFE_AFFECTION_GATE = Math.max(0, Number(process.env.LIFE_DISCLOSE_AFFECTION_GATE || 55));

// 净长「极短」上限：去标点后 ≤ 此字数才算「可能是断点的低内容回应」。
// 🔴 硬加固#3：gate② 不靠 12-token TOPIC_LEX 判新实体（绝大多数新实体漏检 → 误判打断）。
// 改「净长极短 AND 无 isAck 白名单外的实词」——一句新陈述（即便无疑问）净长就超阈值 → 不算断点（防误触打断）。
const TOPIC_OPEN_SHORT_LEN = Math.max(2, Number(process.env.PROACTIVE_TOPIC_OPEN_SHORT_LEN || 6));

// 🔴 dogfood 门控（per-companion·默认 OFF）：env PROACTIVE_TOPIC_OPENER_COMPANIONS = 逗号分隔 companion id 白名单。
// 空/未设 → 全员 OFF（部署是 no-op·dark）；只有 id 在白名单的 companion 才触发本特性 → 其他用户零行为变更、连出站扫都不跑（100% inert）。
// away_probe 同款 dark-then-enable 范式：先 dark 上生产·再 env 点亮维护者自己的 companion 做 dogfood。
export function topicOpenerEnabledFor(companionId) {
  const allow = String(process.env.PROACTIVE_TOPIC_OPENER_COMPANIONS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return allow.length > 0 && allow.includes(String(companionId));   // 默认 OFF：空白名单=全员不触发
}

// 与 isAck 同源的「净化」：剥空白/标点/语气/称呼，留实词。isAck 内部用同款清洗（保持判据一致）。
const _normBare = (s) => String(s || '')
  .replace(/\s+/g, '')
  .toLowerCase()
  .replace(/[~～!！。.、,，?？…·啦呀哦噢呐嘛呢吗宝贝亲爱的的]/g, '');

// 用户本轮是否「有新陈述/新实体」（= 不是断点）。
// 🔴 硬加固#3：不调 topicKey/TOPIC_LEX。判据：去标点净长 > 极短阈 → 视为带新内容（一句新陈述即便无疑问也不算断点）。
//   净长极短（≤阈）且过 isAck 白名单 → 纯低内容确认 = 断点候选。
function userBroughtNewContent(userText) {
  const bare = _normBare(userText);
  if (!bare) return false;                 // 纯标点/语气/称呼 = 无新内容
  if (bare.length > TOPIC_OPEN_SHORT_LEN) return true;   // 一句新陈述（净长超阈）= 带新内容 → 不是断点
  return false;                            // 极短 → 交给 isAck 白名单进一步判
}

/**
 * 话题是否聊到一个自然断点、可以桥接式开个新话头（确定性·只产布尔）。
 * AND-gate：任一不满足即 false。
 *   ① trailingAckStreak ≥ N（连续低内容 ack·决策①·防打断）
 *   ② 用户本轮无疑问 AND 无新陈述/新实体（硬加固#3：净长极短 AND 过 isAck 白名单，不靠 TOPIC_LEX）
 *   ③ 末尾 assistant 收束性结尾（同 intent 收敛——用现成的「末尾 assistant 是否还在自抛新钩子」近似）
 * 仅 isFirstTurn=false AND arcActive=false AND crisisLevel='none' 才评估。
 * 🔴 绝不读沉默：只在 userText 非空的同步 reply 路径调用（用户没发消息根本不进此码）。
 * 🔴 绝不落库任何对话状态（对症 BUG-P2「凭空造未说完状态」）。
 *
 * @param {Array} recentTurns getConversationContext 给的近 16 轮 [{role, content}]
 * @param {string} userText   本轮用户原话（非空·同步路径）
 * @param {object} ctx        { isFirstTurn, arcActive, crisisLevel }
 * @returns {boolean}
 */
export function topicClosureSignal(recentTurns, userText, { isFirstTurn = false, arcActive = false, crisisLevel = 'none' } = {}) {
  // 🔴 闸前置：首轮/冲突态/危机一律不评估（不抢破冰、不在冲突里硬开、危机绝对让位）。
  if (isFirstTurn || arcActive || crisisLevel !== 'none') return false;
  // 🔴 绝不读沉默：userText 必须非空（同步路径才有 userText；空 = 不在本路径）。
  if (!String(userText || '').trim()) return false;
  const turns = Array.isArray(recentTurns) ? recentTurns : [];

  // gate①：连续 ack 断点 ≥ N（trailingAckStreak 已含「疑问一律非 ack」语义 → 用户在问就断不了）。
  if (trailingAckStreak(turns) < TOPIC_OPEN_ACK_STREAK) return false;

  // gate②：用户本轮无疑问 AND 无新陈述/新实体（硬加固#3）。
  //   isAck 内部「含疑问一律非 ack」——非 ack 即直接不是断点（用户在问/在抛内容 = 该接不该转）。
  if (!isAck(userText)) return false;
  if (userBroughtNewContent(userText)) return false;   // 一句新陈述（净长超阈）= 打断风险 → 不开

  // gate③：末尾 assistant 收束性结尾——近似为「末尾 assistant 这条**没有自抛新疑问/新钩子**」
  //   （她上条还在追问/抛钩子 = 话题没收束，这时再开新话头 = 打断她自己的线）。收束 = 没问号没钩子词。
  const lastAsst = [...turns].reverse().find(t => t && t.role === 'assistant' && t.content);
  if (lastAsst && _assistantStillOpening(lastAsst.content)) return false;

  return true;
}

// 末尾 assistant 是否「还在开口/追问」（= 话题未收束）。带问号或明显追问/抛钩子词 → 未收束。
// 保守：只看强信号（问号 / 「吗呢吧」结尾追问），避免把收束性陈述误判为未收束。
const _ASST_OPENING_RE = /[?？]|(?:吗|呢|吧|哈)\s*$|要不要|你说呢|对吧|是不是/;
function _assistantStillOpening(content) {
  const segs = String(content || '').split('||');
  const last = segs[segs.length - 1] || content;
  return _ASST_OPENING_RE.test(String(last).trim());
}

/**
 * 构建「主动开新话头」的 prompt hint（桥接式·分享非挽留·只从已列档案挑·绝不新编）。
 * fail-silent：档案池全空 OR 已达每会话上限 M → 返回 ''（本轮不开·宁可不开也不编）。
 *
 * @param {Array} recentTurns 近 16 轮（仅用于「桥接式·从刚聊的长出来」的语气锚，不抽新实体）
 * @param {object} archives   { works, lifeStates, dailySchedule, openLoops, affectionLevel }
 *   - works: getActiveCurrentWorks() → [{ title, kind, progress_note }]
 *   - lifeStates: getActiveLifeStates() → [{ kind, note }]（period/minor_illness/injury）
 *   - dailySchedule: getDailySchedule() → { items: [...] } | null
 *   - openLoops: listOpenLoops()/buildOpenLoopsHint 同源 → [{ title, loop_kind }]
 *   - affectionLevel: companion.affection_level（决策④ life_state 门控用）
 * @param {object} opts       { alreadyOpenedCount }（决策②频控）
 * @returns {string} hint 串或 ''
 */
export function buildTopicOpenerHint(recentTurns, archives = {}, { alreadyOpenedCount = 0 } = {}) {
  // 🔴 主刀：每日预算——今日已开够 → 不再开（fail-silent）。alreadyOpenedCount 由 bot.mjs 走 db 每日计数传入（日界重置）。
  if (alreadyOpenedCount >= TOPIC_OPEN_DAILY) return '';

  const sources = collectTopicSources(archives);
  // fail-silent：档案池全空 → 返 ''（宁可不开也不编，对齐「档案空=不开」恒等于「我有真东西可给」）。
  if (!sources.length) return '';

  const menu = sources.slice(0, 6).map(s => `- ${s}`).join('\n');
  return `\n\n【★ 可以主动开个新话头（只在他刚刚简短收尾、聊到一个自然停顿时·可有可无）】`
    + `\n他这几句只是简短点头收尾，如果你**正好有真东西想分享**，可以从下面这些**你已经在记的事**里挑一个，**桥接式**地起个新话头（从刚聊的内容自然长出来，像"说到刚才那个，我想起……"）：\n${menu}`
    + `\n规则（必须守）：`
    + `\n· 这是【分享】不是【挽留】：你是有东西想给他，**绝不是**怕他走/想拴住他。`
    + `\n· 他不接、说在忙、转身走——**全都 OK**，绝不追问、绝不撒娇讨债、绝不说"你怎么不理我/我需要你/等你"之类。`
    + `\n· **只从上面这几条已记的事里挑**，绝不新编人/事/地，绝不声称"刚刚/还没说完/等我一下"之类不存在的状态。`
    + `\n· 起一句就好，轻、短、可拒绝；不想开就正常接他那句，别硬开。`;
}

// 从档案池收「可作话头料」的短串（只引用已存档字段·绝不新编）。决策④ life_state 门控在此落地。
function collectTopicSources(archives) {
  const { works, lifeStates, dailySchedule, openLoops, affectionLevel = 0 } = archives || {};
  const out = [];

  // works（书/剧/动漫/游戏/手作）：🔴 取料扩面（2026-06-25·只用 works 已有字段 kind+progress_note·零新数据源·空则 skip）：
  //   按 kind 给更贴切的话头框（在追的剧追到第几集 / 在做的手工半成品进度），让"更多可聊"=已有档案更易凑够料·非放松 fail-silent。
  for (const w of Array.isArray(works) ? works : []) {
    if (!w || !w.title) continue;
    const note = w.progress_note ? `（${String(w.progress_note).slice(0, 40)}）` : '';
    const verb = (w.kind === 'series' || w.kind === 'anime') ? '在追的'
      : w.kind === 'game' ? '在玩的'
      : w.kind === 'craft' ? '在做的手工'
      : '在看的';
    out.push(`${verb}：${String(w.title).slice(0, 40)}${note}`);
  }

  // open_loops（没了结的事/约定）：title。不受 life_state 门控。
  for (const l of Array.isArray(openLoops) ? openLoops : []) {
    if (!l || !l.title) continue;
    const tag = l.loop_kind === 'appointment' ? '（你俩的约定）' : '';
    out.push(`还没了结的事：${String(l.title).slice(0, 50)}${tag}`);
  }

  // dailySchedule（今日日程）：取一条非空 item 文案。不受 life_state 门控。
  const items = dailySchedule && Array.isArray(dailySchedule.items) ? dailySchedule.items : [];
  for (const it of items) {
    const label = typeof it === 'string' ? it : (it && (it.activity || it.text || it.title || it.label));
    if (label && String(label).trim()) { out.push(`今天的安排：${String(label).slice(0, 40)}`); break; }
  }

  // 🔴 决策④：life_state——经期/私密**只在恋人 affection 档且低频**作主动话头料；
  //   朋友/陌生档绝不把经期/私密作主动话头料（其他 life_state kind 如普通小病/伤可作）。
  const isLover = Number(affectionLevel) >= TOPIC_OPEN_LIFE_AFFECTION_GATE;
  for (const s of Array.isArray(lifeStates) ? lifeStates : []) {
    if (!s || !s.kind) continue;
    const isPrivate = s.kind === 'period';   // period = 经期/私密（life_state.mjs 唯一 adultOnly 私密 kind）
    if (isPrivate && !isLover) continue;      // 🔴 朋友/陌生档：经期/私密绝不作主动话头料（低频在 M=1 上限已天然限）
    const note = s.note ? `（${String(s.note).slice(0, 30)}）` : '';
    out.push(`身体/状态：${String(s.kind)}${note}`);
  }

  return out;
}
