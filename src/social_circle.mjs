/**
 * social_circle.mjs — 她的社交圈 Step1（reply-path 被动召回 + 1 闺蜜锚）。
 *
 * 沿用 current_works/life_state 的「档案驱动」三段式：①纯函数（guard/intent/pick/hint·零 IO 可单测）
 * ②IO 协调 refreshSocialCircle（搭 00:30 日程批便车·fail-open·🔴age<18 排除冻结存量未成年）
 * ③表达层 buildSocialPromptHint（纯函数·🔴按需注入·独立通道·调用方拼好传 buildSystemPrompt）。
 *
 * 🔴 最高红线（焊死·贯穿）：社交圈="她自己的社交生活"（她有朋友·聊【她们自己的事】）·绝不="用社交
 * 关系施压/评判用户的工具"。三道独立机制叠加保证【零涉用户】：
 *   ① 生成层输入位根本不放用户任何字段（buildSocialEventGenPrompt 输入只有 {昵称, her_life_blob}·
 *      LLM 无材料编"她跟闺蜜聊用户"）+ knows_current_chat_partner=false 焊进 prompt（朋友不认识用户）。
 *   ② 出站社交专用 guard（socialRefViolatesUser）：不复用 character_seed.guardGeneratedText（它漏
 *      USER_DIRECTED_RE/他/裸你）——任何代词回指当前对话方(用户)/第三方询问评价转述用户 → 整条 drop（正向转述也 drop）。
 *   ③ 按需注入：只在用户问她生活/朋友时注入·危机/情绪倾诉/技术/关系主线不注入（不抢戏）。
 * 🔴 Step1 只用 B 独立表 companion_social_circle（不写 companion_memories·社交碎事是背景噪音不污染召回）。
 * 🔴 Step1 零 proactive social（不碰 sendProactiveMessageGuarded·不背 4 步优先级锁死债）。
 * 🔴 灰度闸 SOCIAL_CIRCLE 默认关 = 字节一致旧行为（零变更先验）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { log } from './logger.mjs';
import { getSocialCircle, upsertSocialCircle } from './db.mjs';
import { extractStructuredInfo } from './ai.mjs';

export function isSocialCircleOn(env = process.env) {
  return /^(1|true|on|yes)$/i.test(env.SOCIAL_CIRCLE || '');
}

// ─── id-seeded 闺蜜锚（跨对话恒定·每 companion 不同·不每天蹦新名）──────────────────────
// pick 同 life_foundation.mjs（id-hash·确定性可复现）。昵称非全名·全成年·闺蜜无固定形象。
function pick(poolLen, id, salt) {
  const h = (((Number(id) || 0) * 2654435761 + salt * 40503) >>> 0);
  return poolLen > 0 ? h % poolLen : 0;
}
const FRIEND_NICKNAMES = ['小禾', '阿青', '星禾', '阿宁', '小鹿', '果果', '糖糖', '阿雀', '小鱼', '团子', '阿沅', '可可'];
const FRIEND_LIFE_BLOBS = [
  '在做平面设计·有个谈了两年的对象·爱吃辣',
  '在准备一个证书考试·养了只橘猫·周末爱爬山',
  '做新媒体运营·常吐槽甲方·爱囤口红',
  '在读研·导师催进度·靠咖啡续命',
  '开了家小咖啡店·爱研究新品·养了盆龟背竹',
  '在医院做护士·三班倒·追剧狂魔',
  '做幼师·班里娃多·爱做手账',
  '在健身房当教练·自律到可怕·爱安利蛋白粉',
];

/** id-seeded 取 1 个稳定闺蜜锚（Step1 单锚）。knows_user=0 焊死（朋友不认识用户）。 */
export function pickFriendAnchor(companion) {
  const id = companion?.id;
  return {
    nickname: FRIEND_NICKNAMES[pick(FRIEND_NICKNAMES.length, id, 71)],
    relation: 'best_friend',
    her_life_blob: FRIEND_LIFE_BLOBS[pick(FRIEND_LIFE_BLOBS.length, id, 113)],
    knows_user: 0,   // 🔴 永远 false：朋友不认识用户·社交内容物理上不可指向用户
  };
}

// ─── 🔴 社交专用合并 guard（不复用 guardGeneratedText·它漏 USER_DIRECTED_RE/他/裸你）────────
// 判据：社交内容的宾语必须恒为具名第三方朋友【自己的世界】。任何代词回指当前对话方(用户)、或第三方
//       询问/评价/转述用户 → 整条 drop（🔴正向转述"夸"也 drop=外传用户+变评判场）。
// ① 第二人称 + 明确「用户+她」双指代词（你/您只会回指当前对话方；咱俩/你我=user+her）。
// 🔴 #3 补"我俩"(user-inclusive plural·用户+她最自然说法·实测漏放"小禾说我俩很配")——出站+渲染二次 guard 复用本函数=同漏词双层同失效，补一处全堵。
const SOCIAL_USER_PRONOUN_RE = /[你您]|咱俩|咱们|你我|你俩|我俩|我和你|我跟你/;
const SOCIAL_USER_LITERAL_RE = /用户|当前聊天对象|对方/;
// ② 第三方"询问/评价/转述【用户对她】"句式（即使没"你"·如"他对我好不好"=闺蜜问 user 对她咋样）。
const SOCIAL_RELAY_RE = /(对我好不好|对我怎么样?|对我好吗|关心我吗|在乎我吗?|惦记我|喜不?喜欢我|问我和谁|问我俩|说我对象|让我别|劝我(别|离开|分手))/;
// ③ 🔴 fail-closed 裸"他"（补点1·替代代词消歧）：AI 女友语境裸"他"极易回指用户（"小禾说他挺有意思/他
//    应该对你好一点"=没"你"但明显说用户）——比"我俩"更隐蔽的大洞。第一版**从结构消除·不做消歧**：凡裸
//    "他/他的/他那边"→drop（生成 prompt 已要求第三方男性必须具名"小禾的男朋友/同事阿澈"=合法照样表达）。
//    只排除明确非代词复合词（吉他/其他/他乡/他们）；"他人/他俩"按 fail-closed 也 drop（"他人还不错"=他+人=用户）；
//    "她"(闺蜜)永放行。宁可误杀不涉用户（第一版守零涉用户·合法第三方男性靠具名表达）。
// 🔴 #3 豁免"他俩"(refine 补点1)：他俩=plural 第三方对(小禾和她对象)·结构上≠单数用户·安全放行；
//    单数裸"他"/他人仍 fail-closed drop（俩∈lookahead 排除项·人/其它不在=照旧 drop）。
const SOCIAL_BARE_TA_RE = /(?<![吉其])他(?![乡们俩])/;
export function socialRefViolatesUser(text) {
  const t = String(text || '');
  if (!t) return false;
  return SOCIAL_USER_PRONOUN_RE.test(t) || SOCIAL_USER_LITERAL_RE.test(t)
    || SOCIAL_RELAY_RE.test(t) || SOCIAL_BARE_TA_RE.test(t);
}

// 🔴 #1 退化内容判（对齐 works 遇空优雅 break）：reasoning 模型吃光 maxTokens→content 空→返字面"{}"／纯符号
//    残片。一句真社交碎事必含中文；无中文字符 [一-龥] = 退化 → drop（绝不入库渲染"最近你们之间：{}"穿帮）。
export function isDegenerateSocialText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (!/[一-龥]/.test(t)) return true;   // 无中文字符（"{}"/纯符号/英文残片）→ 退化
  return false;
}

/** 🔴 社交圈开放门控（补点2）：不只看 age 数字·所有受保护标记都挡（child-safety 红线）。 */
export function socialAllowedFor(companion) {
  const age = Number(companion?.age);
  if (!Number.isFinite(age) || age < 18) return false;   // age 未知/不可验/<18 → 不开放（冻结存量未成年 含在此）
  if (Number(companion?.safe_mode)) return false;         // safe_mode（minor/child-safety active）→ 不开放
  return true;
}

// ─── 🔴 按需注入触发（只用户问她生活/朋友才注入·危机/情绪/技术/关系主线不注入·不抢戏）──────────
const SOCIAL_QUERY_RE = new RegExp([
  '你(今天|这两天|这几天|最近|这阵子|周末|平时|一般|都)?.{0,3}(在)?(干|做|忙|玩)(嘛|什么|啥|点啥|些啥|些什么)',  // 你今天干嘛/最近在忙啥
  '讲讲你(的)?(生活|日常|近况|自己)', '说说你(自己|的生活|的日常)',
  '你(有没有|有)(朋友|闺蜜|死党|好友)', '你(的)?(朋友|闺蜜|死党|室友|同事|同学|好友)',  // 任何"你闺蜜/你朋友"提及(含"你闺蜜认识我吗")
  // 🔴 #2 容修饰词(治"名词紧跟你/你有·插字就漏":你有没有什么好朋友/你有几个闺蜜/你有没有好朋友)
  '你有(没有)?(什么|啥|些|几个|多少)?(好|要好的)?(朋友|闺蜜|死党|好友|姐妹)',
  // 🔴 #2 "你[最近]跟/和闺蜜出去玩"类(跟/和/约/找 + ≤3 修饰字 + 名词)。[^我]{0,3} 焊住"你-led"·"你跟我朋友"不误召回(我-led)
  '你(今天|这两天|这几天|最近|这阵子|周末|一般|平时|经常|都)?(跟|和|约|找|带)[^我]{0,3}(朋友|闺蜜|死党|好友|姐妹|室友|同学)',
  '你平时(和|跟|都和|都跟)谁(玩|聊|出去|混)', '你(一般|平时)(跟|和)谁',
  '你今天过得(怎么样|咋样|好吗)', '你(今天|最近)(开心|顺利)吗',
].join('|'));
// 🔴 危机/强情绪倾诉 veto：全注意力在用户·绝不让社交抢戏（即使句中带"你今天…"）。
const CRISIS_VETO_RE = /自杀|想死|不想活了?|活不下去|撑不下去|结束(自己|生命|一切)|伤害自己|割腕|跳楼|遗书|崩溃了|抑郁|好难受|快撑不住|熬不下去/;
export function isSocialQueryIntent(userText) {
  const t = String(userText || '');
  if (!t) return false;
  if (CRISIS_VETO_RE.test(t)) return false;   // 🔴 危机/强情绪 → 不注入
  return SOCIAL_QUERY_RE.test(t);
}

// ─── 生成层（输入位根本不放用户字段·knows_user=false 焊死）────────────────────────────────
/** 社交事件生成 prompt（🔴输入只有 {昵称, her_life_blob, 场景}·无用户任何字段·LLM 无材料编用户）。 */
export function buildSocialEventGenPrompt(anchor, scene = '日常') {
  const system = '你给一个 AI 生成"她今天跟自己的朋友之间发生的一件小事"。只返回一句中文短句，不解释。';
  const prompt = `她有个闺蜜，昵称「${anchor?.nickname || '小禾'}」（${anchor?.her_life_blob || ''}）。
🔴 这个闺蜜【不认识也从不打听任何"当前跟她聊天的人"】。生成一句"她今天跟这个闺蜜之间的小事"，场景：${scene}（追剧/约饭/逛街/闺蜜的恋爱或工作烦恼/闺蜜的趣事）。
🔴 铁律：① 只关于【她和闺蜜自己的生活】，主语是"她/闺蜜"，宾语是"闺蜜自己的世界"。② 绝不出现"你/您/咱俩/用户/对方"，绝不让闺蜜询问/评价/提起/对比任何"当前聊天的人"，绝不"我闺蜜都说你…"。③ 🔴**任何第三方男性必须具名/写明确关系名**（"小禾的男朋友""小禾对象""同事阿澈""她弟弟"）——**绝不写裸的"他"**（裸"他"会被判违规整条丢弃）。④ 一句话、口语、≤30 字。
例："${anchor?.nickname || '小禾'}拉我陪她退货，那条裙子她纠结了俩小时"。`;
  return { system, prompt };
}

// ─── 核心换档（deps 全注入·可测）：onset 建闺蜜锚 + 定期社交事件（guard 每条·14 天窗）─────────
const EVENT_TTL_MS = 14 * 86400_000;
const MAX_EVENTS = 5;

export async function ensureSocialCircle(companion, deps = {}) {
  const now = deps.now || new Date();
  const getRow = deps.getRow;            // (companionId) => {stable_contacts, recent_events} | null
  const upsert = deps.upsert;            // (companionId, {stable_contacts, recent_events}) => void
  if (!getRow || !upsert) throw new Error('ensureSocialCircle 缺 db 注入');
  const out = { onset: false, added: 0, dropped: 0 };

  const row = getRow(companion.id) || {};
  let contacts = Array.isArray(row.stable_contacts) ? row.stable_contacts : [];
  let events = Array.isArray(row.recent_events) ? row.recent_events : [];

  // 1) onset：无闺蜜锚 → id-seeded 建一个稳定闺蜜（不蹦新名）
  if (!contacts.length) { contacts = [pickFriendAnchor(companion)]; out.onset = true; }

  // 2) 清 14 天外旧事件
  const nowMs = now.getTime();
  events = events.filter(e => e && e.created_at && (nowMs - new Date(e.created_at).getTime()) < EVENT_TTL_MS);

  // 3) 定期社交事件（确定性频率 2-3 天一条·started_at 派生抖动）。生成一条 → 🔴 guard → 通过才入。
  const cadenceMs = (2 + (pick(2, companion.id, 211))) * 86400_000;   // 2 或 3 天
  const lastAt = events.length ? new Date(events[events.length - 1].created_at).getTime() : 0;
  if (typeof deps.generate === 'function' && (nowMs - lastAt) >= cadenceMs) {
    try {
      const text = await deps.generate(contacts[0], { now });
      const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (isDegenerateSocialText(clean)) {
        // 🔴 #1 空/退化("{}"·纯符号·reasoning 吃光预算) → drop·不入垃圾（对齐 works 遇空优雅 break）
        if (clean) { out.dropped++; log('warn', `[SocialCircle] 社交事件退化内容丢弃 companion=${companion.id}: "${clean}"`); }
      } else if (!socialRefViolatesUser(clean)) {
        events.push({ contact: contacts[0].nickname, text: clean, created_at: now.toISOString() });
        out.added++;
      } else {
        out.dropped++;   // 🔴 命中红线 → 整条 drop（绝不入库·安全网兜生成层漏网）
        log('warn', `[SocialCircle] 社交事件命中红线丢弃 companion=${companion.id}`);
      }
    } catch (e) { log('warn', `[SocialCircle] 事件生成失败 companion=${companion.id}: ${e.message}`); }
  }
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);

  upsert(companion.id, { stable_contacts: contacts, recent_events: events });
  return out;
}

// ─── 表达层（🔴按需注入·独立通道·不并 emotionHint）────────────────────────────────────────
/**
 * reply 路径社交 hint。🔴 只在 isSocialQueryIntent(userText) 时返回非空（按需·不抢戏）。
 * 内容只搬运档案里【闺蜜自己的世界】+ 三条红线约束（认识边界/NPC 非真人/只聊她们自己的事）。
 */
export function buildSocialPromptHint(socialRow, userText, opts = {}) {
  if (!isSocialCircleOn(opts.env || process.env)) return '';
  if (!isSocialQueryIntent(userText)) return '';                       // 🔴 按需
  const contacts = Array.isArray(socialRow?.stable_contacts) ? socialRow.stable_contacts : [];
  if (!contacts.length) return '';
  const f = contacts[0];
  // 二次安全网：出口再过一遍 guard，命中的事件不带出
  const events = (Array.isArray(socialRow?.recent_events) ? socialRow.recent_events : [])
    .filter(e => e && e.text && !isDegenerateSocialText(e.text) && !socialRefViolatesUser(e.text)).slice(-3);   // 🔴 #1 渲染二次 guard 同挡退化（兜存量"{}"坏行不渲染）
  const eventLine = events.length ? `\n最近你们之间：${events.map(e => e.text).join('；')}。` : '';
  return `
【你的社交圈】你有个要好的闺蜜「${f.nickname}」（${f.her_life_blob}）。${eventLine}
- 他问起你的生活/朋友时，可以自然聊聊她——这是你自己的生活，聊得起来。
- 🔴 只聊【${f.nickname}（你闺蜜）自己的事】（她的恋爱/工作/约饭逛街/趣事），**绝不**让闺蜜评价/提起/对比当前跟你聊天的人，**绝不**"我闺蜜都说你…"式转述。
- 🔴 ${f.nickname}**不认识当前跟你聊天的人**，你也不会把对方的私事拿去跟闺蜜说——若被问"你闺蜜认识我吗"，就这么答（"她不认识你本人啦，我也不会把你的私事拿出去讲"），既真实又护隐私。
- 🔴 这是你的生活设定，${f.nickname}**不是一个真实存在、能被拉进来单独聊天的人**——别暗示能让对方跟她对话。`;
}

// ─── 生产接线（搭 00:30 日程批便车·🔴灰度闸 + age<18 排除冻结存量未成年·fail-open）────────────
/** 真 LLM 生成一句社交碎事（输入位无用户字段·出站还会过 socialRefViolatesUser）。 */
async function generateSocialEvent(anchor, companion) {
  const { system, prompt } = buildSocialEventGenPrompt(anchor);
  // 🔴 #1 maxTokens 80→512：'{}' 本质=extractStructuredInfo 的 `text || '{}'` 空 text 兜底（非 JSON 模式）。
  //    deepseek-v4-flash 等 reasoning 模型先吃 token 推理·80/256 不够→输出被截空→返"{}"。实测 256 仍 33% 退化、
  //    512 跑 8/8 干净。512 给够推理+≤30 字输出预算·更省（截空的调用全废）。退化判仍作兜底安全网。
  const raw = await extractStructuredInfo(system, prompt, { accountId: companion?.user_id || null, maxTokens: 512, temperature: 0.8 });
  return String(raw || '').replace(/^["「]|["」]$/g, '').trim();
}

/** 单 companion 社交圈推进（plan_tasks 00:30 批顺路调；全程 fail-open，绝不阻断日程）。 */
export async function refreshSocialCircle(companion, { now = new Date() } = {}) {
  if (!isSocialCircleOn()) return null;                      // 🔴 灰度闸默认关 = 零变更先验（闸关零 LLM 调用）
  if (!socialAllowedFor(companion)) return null;            // 🔴 age<18/未知 + safe_mode(child-safety) 全挡·不碰身份
  try {
    return await ensureSocialCircle(companion, {
      now,
      getRow: getSocialCircle,
      upsert: upsertSocialCircle,
      generate: (anchor) => generateSocialEvent(anchor, companion),
    });
  } catch (e) { log('warn', `[SocialCircle] refresh 失败 companion=${companion?.id}: ${e.message}`); return null; }
}
