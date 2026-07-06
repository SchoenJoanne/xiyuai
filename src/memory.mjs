/**
 * memory.mjs
 * 长期记忆 / 情绪状态 / 好感度 / 用户画像 自动处理
 *
 * 所有 extract* 函数调用 DeepSeek，应在回复发送后异步执行（非阻塞）。
 * 所有 update* 规则函数是同步的，可直接调用。
  *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { log } from './logger.mjs';
import { stripAgeYearDrift } from './fact_age_scan.mjs';   // 批C·C3·M1b：inside_joke 梗年龄毒化过滤（单一权威源·同源 G1/尺L0/P2）
import {
  saveMemories, recallMemories as upsertShaping,
  patchCompanion, getCompanionById, getUserProfile, upsertUserProfile,
  saveStageMilestone, shanghaiDateKey, getDb,
  mergeBodyEventsToday, clearBodyEventsTodayAll,   // P2→P1 即时状态锚定：今日已声明身体态
  clearTopicOpensTodayAll,                          // topic 主动话头每日预算·次日清
} from './db.mjs';
import { parseSceneState, applySceneTransition, serializeSceneMeta, FOOD_STATES } from './scene_state.mjs';  // PR-3·B sidecar scene
import { extractStructuredInfo, embedText } from './ai.mjs';
import { tryAchievement } from './achievements.mjs';
import { processMemoryForGraph } from './event_graph.mjs';

// ─── 关系阶段阈值 ─────────────────────────────────────────────────────────────
export function computeRelationshipStage(affection) {
  if (affection >= 80) return '深爱';
  if (affection >= 55) return '恋人';
  if (affection >= 30) return '暧昧';
  if (affection >= 15) return '朋友';
  return '陌生人';
}

// ─── 关系节奏（参考真实关系，偏真实/慢；env 可调）──────────────────────────
// 暧昧→恋人：affection≥LOVER + 已表白 + 认识≥DAYS_TO_LOVER 天
// 恋人→深爱：affection≥DEEP + 当恋人≥DAYS_AS_LOVER_TO_DEEP 天
// 好感每日上限 DAILY_CAP，55 分以上增幅衰减 —— 防一次聊天无脑刷到恋人/深爱。
export const AFFECTION_LOVER = Number(process.env.AFFECTION_LOVER) || 55;
export const AFFECTION_DEEP  = Number(process.env.AFFECTION_DEEP)  || 80;
export const DAYS_TO_LOVER         = Number(process.env.DAYS_TO_LOVER ?? 5);   // v1.16.x: 14→5（重度用户第一周能尝到恋人；仍需"已表白+好感≥55"防秒升）
export const DAYS_AS_LOVER_TO_DEEP = Number(process.env.DAYS_AS_LOVER_TO_DEEP ?? 30);
export const AFFECTION_DAILY_CAP   = Number(process.env.AFFECTION_DAILY_CAP ?? 8);  // 恋人段基准（env 兼容）

// v1.16.x: 好感日上限改为「按当前好感动态」—— 新人期升温快（热恋期效应），越接近恋人/深爱越慢
// （老夫老妻效应）。解决"重度用户聊几十条被固定 cap=8 压到陌生人、头一周没奔头就流失"。
// 仍防一天无脑刷到顶：一天最多 +25，到恋人需 5 天 + 表白 + 好感≥55。
export function affectionDailyCap(curAff = 0) {
  const a = Number(curAff) || 0;
  if (a < 30)              return Number(process.env.AFFECTION_DAILY_CAP_NEW  ?? 25); // 陌生→暧昧前：新人期最快
  if (a < AFFECTION_LOVER) return Number(process.env.AFFECTION_DAILY_CAP_AMBI ?? 15); // 暧昧→恋人前：还能较快
  if (a < AFFECTION_DEEP)  return AFFECTION_DAILY_CAP;                                 // 恋人：原值 8，放缓
  return Number(process.env.AFFECTION_DAILY_CAP_DEEP ?? 5);                            // 深爱：最慢、最珍贵
}

const STAGE_RANK = ['陌生人', '朋友', '暧昧', '恋人', '深爱'];
const stageRank = (s) => Math.max(0, STAGE_RANK.indexOf(s));

function daysFromTs(ts) {
  if (!ts) return 0;
  const d = new Date(String(ts).replace(' ', 'T') + (String(ts).includes('Z') ? '' : 'Z'));
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400_000));
}
export const daysSinceMeet = (c) => daysFromTs(c?.created_at);
export const daysAsLover   = (c) => daysFromTs(c?.became_lover_at);

/**
 * 用户表白时是否该"接住"升恋人：好感够 + 认识够久。
 * 不够 → bot 端走"端着婉拒"，关系不升级（见 bot.mjs）。
 */
export function canAcceptConfession(companion) {
  return (companion?.affection_level ?? 0) >= AFFECTION_LOVER && daysSinceMeet(companion) >= DAYS_TO_LOVER;
}

// ─── 心情关键词 ──────────────────────────────────────────────────────────────
const MOOD_MAP = [
  { mood: '兴奋', words: ['哇', '不会吧', '真的吗', '天啊', '居然', '牛', '超厉害', '！！', '!!', '🎉', '🤩', '😱'] },
  { mood: '开心', words: ['哈哈', '嘻嘻', '好耶', '太好了', '棒', '开心', '高兴', '喜欢', '爱', '可爱', '😊', '😁', '😄', '❤', '🥰'] },
  { mood: '想念', words: ['想你', '好想', '想念', '思念', '好久不见', '许久'] },
  { mood: '委屈', words: ['委屈', '难过', '伤心', '哭', '不开心', '难受', '😢', '😭', '🥺', '呜呜'] },
  { mood: '平静', words: [] }, // 默认
];

/**
 * 规则：根据对话内容推断新心情
 */
export function detectMood(userMsg, botReply) {
  const text = (userMsg + botReply).toLowerCase();
  for (const { mood, words } of MOOD_MAP) {
    if (words.length === 0) continue;
    if (words.some(w => text.includes(w))) return mood;
  }
  return null; // 无变化
}

/**
 * 规则：根据消息计算好感度增量
 */
export function calcAffectionDelta(userMsg) {
  if (!userMsg) return 1;
  let delta = 1; // 基础 +1（维持联系）

  if (userMsg.length > 50)  delta += 1; // 认真在聊
  if (userMsg.length > 150) delta += 1; // 说了很多

  const strong = ['很喜欢', '超喜欢', '爱你', '最爱', '太可爱了', '喜欢你', '爱死你'];
  const positive = ['喜欢', '谢谢', '感谢', '棒', '开心', '可爱', '好'];
  const negative = ['讨厌', '烦死', '滚', '差劲', '垃圾', '无聊', '笨'];

  for (const w of strong)    if (userMsg.includes(w)) { delta += 2; break; }  // v1.x: 3→2 降速
  for (const w of positive)  if (userMsg.includes(w)) { delta += 1; break; }
  for (const w of negative)  if (userMsg.includes(w)) { delta -= 2; break; }

  // v1.x: 单条封顶 +3（防强词+长消息叠加冲太快），负向仍可到 -3
  return Math.max(Math.min(delta, 3), -3);
}

/**
 * 同步更新好感度 + 心情 + 关系阶段
 * 关系阶段升级时记录里程碑（用于"我们的故事"展示 + CP 卡片）
 */
export function syncUpdateCompanionState(companion, userMsg, botReply) {
  const fields = {};

  // ── 好感度增量：基础规则 → 55+ 衰减 → 每日上限（防一次聊天无脑刷）──
  const curAff = companion.affection_level ?? 0;
  let delta = calcAffectionDelta(userMsg);
  if (delta > 0 && curAff >= AFFECTION_LOVER) delta = Math.max(1, Math.round(delta * 0.5)); // 恋人后增幅减半，深爱更慢
  const today = shanghaiDateKey();
  const gainedToday = (companion.affection_day === today) ? (companion.affection_today || 0) : 0; // 跨天自动重置
  const dailyCap = affectionDailyCap(curAff);                                                     // v1.16.x 动态上限：新人期快、亲密后慢
  if (delta > 0) delta = Math.min(delta, Math.max(0, dailyCap - gainedToday));                    // 每日上限只限正向
  fields.affection_day   = today;
  fields.affection_today = gainedToday + Math.max(0, delta);

  const newAff = Math.min(Math.max(curAff + delta, 0), 100);
  fields.affection_level = newAff;

  // ── 关系阶段：真实节奏闸门（表白 + 时间），只拦升级、不动存量 ──
  // 暧昧→恋人：affection≥55 + 已表白 + 认识≥14天；恋人→深爱：affection≥80 + 当恋人≥30天
  const oldStage = companion.relationship_stage || '陌生人';
  const rawStage = computeRelationshipStage(newAff);
  const hasConfession = Boolean(companion.confessed_at || companion.user_confessed_at);
  let newStage = rawStage;
  if (stageRank(rawStage) > stageRank(oldStage)) {            // 仅"想升级"时套闸门
    if (rawStage === '恋人' && !(hasConfession && daysSinceMeet(companion) >= DAYS_TO_LOVER)) {
      newStage = oldStage;                                   // 没表白 / 认识太短 → 卡住
    } else if (rawStage === '深爱' && !(daysAsLover(companion) >= DAYS_AS_LOVER_TO_DEEP)) {
      newStage = oldStage;                                   // 当恋人时间不够 → 卡住
    }
  }
  // 非升级（含掉好感的自然降级）按 rawStage，不因新闸门强制降级老用户（存量不动）
  // v1.20 安全收尾：安全模式下关系阶段钳到「朋友」封顶（DB 层硬钳，不只 prompt 层）
  if (Number(companion.safe_mode) && stageRank(newStage) > stageRank('朋友')) {
    newStage = '朋友';
  }
  fields.relationship_stage = newStage;
  if (newStage === '恋人' && oldStage !== '恋人' && !companion.became_lover_at) {
    fields.became_lover_at = new Date().toISOString();       // 升恋人时间戳 → 深爱时间门槛计时
  }

  // 心情（有变化才更新）
  const newMood = detectMood(userMsg, botReply);
  if (newMood && newMood !== companion.current_mood) {
    fields.current_mood    = newMood;
    fields.mood_updated_at = new Date().toISOString();
  }

  patchCompanion(companion.id, fields);

  // 阶段升级 → 记里程碑
  if (newStage !== oldStage) {
    try {
      // 算"认识"天数：用 companion.created_at 距今
      let daysSinceMeet = 0;
      if (companion.created_at) {
        const created = new Date(String(companion.created_at).replace(' ', 'T') + (String(companion.created_at).includes('Z') ? '' : 'Z'));
        daysSinceMeet = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86400_000));
      }
      saveStageMilestone({
        companionId: companion.id,
        fromStage: oldStage,
        toStage: newStage,
        affection: newAff,
        daysSinceMeet,
      });
      // 通知 bot 下条 reply 时带个庆祝
      pendingCelebration.set(companion.id, { from: oldStage, to: newStage, ts: Date.now() });
    } catch (e) { /* 不阻断主流程 */ }
  }
  return fields;
}

// ─── 表白意图检测 ─────────────────────────────────────────────────────────
const CONFESSION_PATTERNS = [
  // 直接告白（中文）
  /我(?:好|超|很|真的)?(?:喜欢|爱|心动|动心|想)(?:你|妳)/,
  /(?:做|当|是)我(?:的)?(?:女朋友|男朋友|对象|女友|男友|老婆|老公)/,
  /(?:和|跟)我在一起/,
  /我们(?:在一起|交往|谈恋爱)(?:吧|好不好|可以吗|怎么样)?/,
  // 暗示性表白
  /(?:我对你|对你)有(?:感觉|意思|好感)/,
  /(?:我)?喜欢上(?:你|妳)了?/,
  /(?:我)?爱上(?:你|妳)了?/,
  /我心(?:动|跳|里只有你)/,                              // 我心动了/我心跳了/我心里只有你
  /我离不开你/,
  /(?:可不可以|可以)做我(?:女朋友|对象|女友|男朋友|男友)/,
  /我爱你/, /愛你/,
  // 英文（不去空格保留单词边界）
  /\b(?:i\s*love\s*(?:you|u))\b/i,
];

/**
 * 检测用户消息是否是"表白"。返回 boolean。
 */
export function detectUserConfession(userMsg) {
  if (!userMsg || typeof userMsg !== 'string' || userMsg.length < 2) return false;
  const original = userMsg;
  const compact = userMsg.replace(/\s+/g, '');
  // 排除"我喜欢你画的画/你的猫/这个歌"这种非告白
  if (/喜欢你(?:发|画|说|做|的|那|这|@|分享)/.test(compact)) return false;
  for (const re of CONFESSION_PATTERNS) {
    if (re.test(compact) || re.test(original)) return true;
  }
  return false;
}

/**
 * v1.10.32: 检测 AI 回复是否含"她在表白"语义。返回 boolean。
 * 跟 detectUserConfession 同模式但排除常见"接住用户告白"的回应（"我也是" / "我等你"
 * 这种不算独立的告白事件 — 那是用户告白触发的）。
 */
export function detectCompanionConfession(botReply) {
  if (!botReply || typeof botReply !== 'string' || botReply.length < 2) return false;
  const original = botReply;
  const compact = botReply.replace(/\s+/g, '');
  // 排除"也"类回应（接住用户告白），不是独立告白事件
  if (/^(?:我)?也(?:喜欢|爱|是)/.test(compact)) return false;
  if (/喜欢你(?:发|画|说|做|的|那|这|@|分享)/.test(compact)) return false;
  for (const re of CONFESSION_PATTERNS) {
    if (re.test(compact) || re.test(original)) return true;
  }
  return false;
}

// ─── 亲密称呼检测（用户使用过早的亲密词）──────────────────────────────────
const INTIMATE_TERMS_RE = /(?:^|[^a-zA-Z])(宝宝|宝贝|宝儿|亲爱的|老婆|老公|baby|honey|sweetie|心肝|小可爱|乖乖)(?:[^a-zA-Z]|$)/i;
const FLIRT_PHRASES_RE = /(?:抱抱|抱一下|亲亲|亲一口|蹭蹭|摸摸头|想睡你|想亲你|想抱你|抱回家|带你回家)/;

/**
 * 检测用户消息中是否含 "过早的亲密词"。
 * 返回 { has, kind } 其中 kind = 'address'(称呼) | 'flirt'(肢体亲密) | null
 */
export function detectIntimacyOvereach(userMsg) {
  if (!userMsg || typeof userMsg !== 'string') return { has: false, kind: null };
  // 排除"我宝宝"作为反问/玩笑——简化先不处理 corner case
  if (INTIMATE_TERMS_RE.test(userMsg)) return { has: true, kind: 'address' };
  if (FLIRT_PHRASES_RE.test(userMsg)) return { has: true, kind: 'flirt' };
  return { has: false, kind: null };
}

// 阶段升级临时挂起的"庆祝"标记。bot.mjs 检查这个 map 决定要不要在 prompt 里加一句
// "你们刚刚升级了关系阶段，可以在这条回复里自然地体现这种变化"
const pendingCelebration = new Map();
export function consumePendingCelebration(companionId) {
  const v = pendingCelebration.get(companionId);
  if (!v) return null;
  // 30 分钟内才有效
  if (Date.now() - v.ts > 30 * 60_000) {
    pendingCelebration.delete(companionId);
    return null;
  }
  pendingCelebration.delete(companionId);
  return v;
}

// ─── 图片描述记忆提取（同步规则，不依赖视觉模型）──────────────────────────────
const PET_PATTERNS = [
  { word: '橘猫', memory: '他养了一只橘猫', pet: '橘猫' },
  { word: '猫', memory: '他家里有猫', pet: '猫' },
  { word: '小猫', memory: '他家里有猫', pet: '小猫' },
  { word: '狗', memory: '他家里有狗', pet: '狗' },
  { word: '小狗', memory: '他家里有狗', pet: '小狗' },
  { word: '宠物', memory: '他家里有宠物', pet: '宠物' },
];

const FOOD_WORDS = ['饭', '面', '火锅', '烧烤', '甜点', '蛋糕', '奶茶', '咖啡', '披萨', '寿司', '食物', '早餐', '午餐', '晚餐'];
const ROOM_WORDS = ['房间', '卧室', '客厅', '书桌', '阳台', '厨房', '家里'];

export function extractImageMemories(imageDescription, userMessage = '') {
  const desc = String(imageDescription || '').trim();
  const msg = String(userMessage || '').trim();
  const text = `${desc} ${msg}`;
  const memories = [];

  const add = (memoryType, content, importance) => {
    if (!content || memories.some(m => m.content === content)) return;
    memories.push({ memory_type: memoryType, content, importance });
  };

  const ownershipHint = /(我家|我的|家里|养了|养的|我养|这是我|我们家)/.test(msg);
  for (const pet of PET_PATTERNS) {
    if (!text.includes(pet.word)) continue;
    add('image', ownershipHint ? pet.memory : `他分享过${pet.pet}的照片`, ownershipHint ? 8 : 5);
    if (/(拍|照片|看看|分享|发你|给你看)/.test(msg)) {
      add('preference', `他喜欢拍${pet.pet}`, 6);
    }
    break;
  }

  const food = FOOD_WORDS.find(w => text.includes(w));
  if (food) {
    if (/(我做|自己做|我煮|我烤|我买|我点|我吃|想吃|爱吃|喜欢)/.test(msg)) {
      add('preference', `他对${food}感兴趣`, 5);
    } else {
      add('image', `他分享过${food}照片`, 4);
    }
  }

  const room = ROOM_WORDS.find(w => text.includes(w));
  if (room) {
    if (/(我家|我的|家里|房间|卧室|客厅)/.test(text)) {
      add('image', `他分享过自己的${room}`, 5);
    }
  }

  if (/(生日|聚会|旅行|约会|毕业|搬家|纪念日)/.test(text)) {
    add('event', `他分享过照片事件：${desc.slice(0, 30)}`, 6);
  }

  return memories.slice(0, 5);
}

export function buildImageReactionText(memories, imageDescription) {
  const first = memories[0];
  if (first?.content.includes('橘猫')) return '它看起来好乖呀，我记住啦，你家有一只橘猫。';
  if (first?.content.includes('猫')) return '这只猫看起来好可爱呀，我记住啦，你家里有猫。';
  if (first?.content.includes('狗')) return '它看起来很亲人呢，我记住啦，你家里有狗。';
  if (first?.content.includes('食') || first?.content.includes('饭') || first?.content.includes('奶茶')) {
    return '看起来很好吃呀，我记住啦，你也会把这些好吃的分享给我。';
  }
  if (first?.content.includes('房间') || first?.content.includes('客厅') || first?.content.includes('卧室')) {
    return '这个画面很有生活感，我记住啦，这是和你生活空间有关的小细节。';
  }
  return `我看到啦：${String(imageDescription || '').slice(0, 40)}。我会把这次照片里的重要信息记住。`;
}

// ─── 记忆提取（异步，调用 AI）────────────────────────────────────────────────
const MEMORY_SYSTEM_PROMPT = `你是记忆提取助手。分析他（对方）说的话，提取关于他本人的明确信息。
只提取他主动透露的真实信息，不要推测或虚构。

输出 JSON 对象：
{
  "current_scene": "他俩此刻所处的场景/地点（如：图书馆、咖啡馆、在路上、公园、电影院、在家）。**只在本轮对话明确表明当前场景或发生位置变化时才填**（如"去图书馆吧""到家了""在咖啡馆等你"）；本轮没有场景信息就留空字符串\"\"。这是'此刻在哪'的**当前状态**，**不是过去事件**——别把'昨天去过XX'写成当前场景。",
  "scene_food_state": "进食状态，只在本轮明确涉及吃饭时填，否则留空字符串\"\"：planning=刚说要去吃/点了还没上（如"去吃火锅吧""点了外卖"）；eating=正在吃；finished=吃完了（**只在他本人明确说吃完/吃饱了时才填 finished**，别替他宣布吃完）。",
  "her_body_events": "【从「AI回复」里抽她（女孩自己）本轮明确声明的自身身体/作息既成事件】数组，每项 {\"type\":...}，type ∈ showered(洗澡/洗完澡)|washed_hair(洗头/吹头发/擦头发/头发还湿)|woke(刚醒/起床/睡醒)|dreamed(做梦/梦到)。🔴 只抽她【第一人称、肯定语气、已经发生或正在收尾】的真实声明（"我刚洗完澡"→showered；"在擦头发头发还湿"→washed_hair）。🔴 绝不抽：否定（"还没洗澡/没睡醒"）、比喻（"像三天没洗澡一样懒"）、疑问、将来打算（"等下要洗澡"）、引用他的话。没有就 []。🔴 不抽吃饭（另有机制）。",
  "memories": [
    {
      "memory_type": "fact" | "preference" | "event" | "emotion" | "inside_joke",
      "content": "20字内简洁描述（第三人称一律用'他'指代对方：'他...'，绝不写'用户'）",
      "importance": 1-10,
      "keywords": ["核心词1","核心词2","核心词3"]
    }
  ]
}

importance 评分细则：
- 9-10：身份核心信息（生日 / 全名 / 家乡 / 重大病史 / 重要日期如纪念日）
- 7-8：稳定偏好或重要承诺（职业 / 家庭成员 / 长期爱好 / 答应的事 / 重大决定）
- 5-6：日常喜好（喜欢吃 / 常去的地方 / 看过的剧）
- 3-4：临时情绪 / 一次性事件（今天累 / 刚刚吃了什么）
- 1-2：闲聊噪音

特别地，inside_joke = 你们之间的**专属梗 / 黑话 / 自创词 / 只有你俩懂的暗号或称呼**（反复出现的内部笑点）；content 写这个梗本身，importance 给 6。普通聊天里没有就别硬凑。
只输出 JSON 对象。没有可记的 memories 就 []，没有场景就 current_scene 留空 ""。`;

// 阈值：< MEMORY_MIN_IMPORTANCE 直接丢弃（避免噪音）。importance >= 7 自动 pin
const MEMORY_MIN_IMPORTANCE = 4;

// PR-3·B：他本人明确宣布的「场景过渡」信号——只有他真说了吃完/到了/回来了，状态机才放行
// planning→finished / 跨地点跳转；否则（仅模型自宣"刚吃完麻辣香锅回来"）状态机拦住瞬移（某存量案例 根因）。
const USER_SCENE_TRANSITION_RE = /吃完|吃饱|喝完|吃好了|到家|到了|回来了|回家了|出来了|走了|结束了|散场|散了|下课了|下班了/;

// P2→P1（停板B）：把 her_body_events 数组（LLM 已过滤否定/比喻/引用）累积到 body_events_today。
function accumulateHerBodyEvents(companionId, herBodyEvents) {
  try {
    const arr = Array.isArray(herBodyEvents) ? herBodyEvents : [];
    if (!arr.length) return;
    const ev = {}; const now = Date.now();
    for (const e of arr) { const t = e && e.type; if (t) ev[t] = { at: now }; }
    mergeBodyEventsToday(companionId, ev);   // db 侧 ALLOW 白名单兜底（吃饭等不收=让位 food_state）
  } catch { /* fail-open */ }
}
// proactive 路径无 extractAndSaveMemories（无 userMsg）→ 单独抽她 proactive 文本里的身体态声明（低频·一次轻量调用·fail-open）。
const BODY_EVENTS_PROMPT = `你是身体状态提取助手。从她（一个女孩）说的这句话里，抽出她本轮明确声明的自身身体/作息既成事件。
输出 JSON：{ "her_body_events": [{ "type": "showered|washed_hair|woke|dreamed" }] }
🔴 只抽她【第一人称、肯定语气、已发生或正收尾】的真实声明（"我刚洗完澡"→showered；"在擦头发/头发还湿"→washed_hair；"刚醒/起床了"→woke；"做了个梦/梦到"→dreamed）。
🔴 绝不抽：否定（"还没洗/没睡醒"）、比喻（"像三天没洗澡"）、疑问、将来打算（"等下要洗"）、引用他的话。🔴 不抽吃饭。没有就 []。只输出 JSON。`;
// 🔴 极轻预筛（宁可多抽不可漏抽·线索词放宽）：proactive 文本无任何身体/作息线索词 → 跳过抽取调用，
// 省无意义 LLM 调用（大多 proactive 不涉身体态）。纯减法门=只跳明显非身体态·绝不跳过疑似（线索宽）。
export const BODY_HINT_RE = /洗|澡|头发|发型|擦头|吹头|睡|醒|梦|起床|起来|赖床|补觉|困|刚起|没睡|躺|起不来/;
export async function extractAndAccumulateBodyEvents(companionId, herText) {
  if (!herText || String(herText).length < 4) return;
  if (!BODY_HINT_RE.test(String(herText))) return;   // 预筛：无身体态线索→不抽（宽线索·绝不漏身体态）
  try {
    const raw = await extractStructuredInfo(BODY_EVENTS_PROMPT, `她说："${String(herText).slice(0, 200)}"`);
    const obj = safeParseObject(raw);
    accumulateHerBodyEvents(companionId, Array.isArray(obj.her_body_events) ? obj.her_body_events : (Array.isArray(obj) ? obj : []));
  } catch { /* fail-open */ }
}

export async function extractAndSaveMemories(companionId, userId, userMsg, botReply) {
  if (!userMsg || userMsg.length < 8) return 0;

  const userContent = `他说："${userMsg}"\nAI回复："${botReply?.slice(0, 100)}"`;

  try {
    const raw = await extractStructuredInfo(MEMORY_SYSTEM_PROMPT, userContent);
    const obj = safeParseObject(raw);
    // 兼容：LLM 偶尔回退成裸数组 → 当作 { memories: 数组, 无场景 }
    const list = Array.isArray(obj.memories) ? obj.memories : safeParseArray(raw);
    // #324 失忆修：场景搭车本 pass 自动更新（信息本就被提取，只是从前流错了地方）。
    // PR-3·B：带上进食态 + 他本人的过渡信号（状态机据此拦模型自宣的瞬移）。
    applySceneUpdate(companionId, { location: obj.current_scene, food_state: obj.scene_food_state },
      { userTransition: USER_SCENE_TRANSITION_RE.test(String(userMsg || '')) });
    accumulateHerBodyEvents(companionId, obj.her_body_events);   // P2→P1：她在 botReply 里声明的身体态（LLM 已过滤否定/比喻/引用）
    if (list.length === 0) return 0;

    // M2 专属梗：inside_joke 分流到 shaping lexicon（你们俩独有的梗，不进普通记忆库）
    // 🔴 批C·M1b 年龄毒化过滤：梗里她的错龄「N岁」宣称会随 lexicon 反复回灌固化(#15 形态)——落库前剥漂移 N岁→
    //    同源(fact_age_scan)复检→仍脏整条 reject+计数(rejected 蒸发可见·非静默丢)。梗是合法关系质感，只有假数字是毒；
    //    「叫姐姐」活着(防矫枉)、「22岁大姐姐」=档案值放行、「28岁大姐姐」→存「大姐姐」。fail-open：无档案 age 不伸手。
    const _m1bTrueAge = getCompanionById(companionId)?.age;
    let m1bRejected = 0;
    for (const j of list.filter(m => m.memory_type === 'inside_joke' && m.content && String(m.content).length >= 2)) {
      let content = String(j.content);
      if (_m1bTrueAge != null && Number.isFinite(Number(_m1bTrueAge))) {
        const cleaned = stripAgeYearDrift(content, _m1bTrueAge);
        if (cleaned === null) { m1bRejected++; continue; }   // 剥后仍脏/剥空→整条 reject（不入 lexicon）
        content = cleaned;
      }
      try { upsertShaping({ companionId, kind: 'lexicon', content: content.slice(0, 60), rawMsg: userMsg }); } catch (e) { /* 静默 */ }
    }
    if (m1bRejected) log('info', `[Memory] M1b 年龄毒化过滤 reject ${m1bRejected} 条梗 companion=${companionId} trueAge=${_m1bTrueAge}`);

    const candidates = list
      .filter(m => m.content && m.content.length >= 2 && m.memory_type && m.memory_type !== 'inside_joke')
      .map(m => ({
        companionId,
        userId,
        memoryType: ['fact','preference','event','emotion'].includes(m.memory_type) ? m.memory_type : 'fact',
        content:    m.content.slice(0, 50),
        importance: Math.min(Math.max(Number(m.importance) || 5, 1), 10),
        keywords:   Array.isArray(m.keywords) ? m.keywords.slice(0, 5).map(k => String(k).slice(0, 12)) : [],
      }))
      .filter(m => m.importance >= MEMORY_MIN_IMPORTANCE);

    if (candidates.length === 0) {
      log('debug', `[Memory] 提取到 ${list.length} 条但都低于阈值 importance>=${MEMORY_MIN_IMPORTANCE}`);
      return 0;
    }

    // 给每条记忆生成 embedding（并发但限制）
    await Promise.all(candidates.map(async m => {
      try {
        m.embedding = await embedText(m.content);
      } catch { m.embedding = null; }
    }));

    saveMemories(candidates);
    const pinnedCount = candidates.filter(m => m.importance >= 7).length;
    log('info', `[Memory] +${candidates.length} 记忆 (pinned=${pinnedCount}, with_embedding=${candidates.filter(m=>m.embedding).length}) companion=${companionId}`);

    // 首次记忆保存成就（静默）
    tryAchievement(companionId, 'first_memory_saved');

    // 轻量事件图谱：从新增记忆文本提取实体（静默，不阻塞）
    // 传入 memoryMeta 让守卫函数跳过 emotion 类型，无需额外 DB 查询
    for (const m of candidates) {
      try {
        processMemoryForGraph(companionId, m.content, null, { memoryType: m.memoryType });
      } catch { /* 非阻塞 */ }
    }

    return candidates.length;
  } catch (e) {
    log('warn', `[Memory] 记忆提取失败: ${e.message}`);
    applySceneUpdate(companionId, null, { extractionFailed: true });   // 抽取失败→回落"日常"，不留可能过期的旧场景
    return 0;
  }
}

/**
 * 更新 companion.current_scene —— #324 失忆修。
 *
 * current_scene 是「**可变当前态**」（patch、覆盖），与 episodic 记忆的"过去事件"措辞严格区分：
 * episodic 记"他提议去图书馆"(发生过的事)，current_scene 记"图书馆"(此刻在哪)。它被 §6 无条件
 * 注入 prompt（companion.mjs「你现在在：X」），所以必须**跨轮持久**——一旦设定就留住到下次场景
 * 切换，否则密聊下真场景滑出 16 行窗口后又回到注入"在家"的老 bug。
 *
 * 语义（拍板）：
 *   · 本轮抽到明确场景        → patch 覆盖（场景切换/确认）
 *   · 本轮无场景信号(空)      → **保留现值**（场景跨轮持久＝修复要害，别被非场景轮清掉）
 *   · 抽取失败(extractionFailed) → **回落「日常」**（fail-open 反转：过期值反客为主是本 bug 根因，
 *                                 旧值比空值危险；宁可退回§6"随意聊"也不留可能过期的旧场景）
 *   · 跨日陈旧 → 由 plan_tasks 次日 00:30 TTL 批清场（不在此处）
 *
 * PR-3·B（B-min sidecar）：current_scene 仍写**裸 location 字符串**（跨模块契约不变），结构化状态
 * （food_state/transition_pending/established_at...）写 sidecar current_scene_meta(JSON)；经状态机
 * applySceneTransition 拦无过渡的瞬移（planning→finished / 跨地点）——userTransition=false（他没明说
 * 吃完/到了，仅模型自宣）时拦住，保持旧态 + transition_pending。
 *
 * @param sceneInfo  {location, food_state} 对象；兼容旧调用裸字符串（当 location）。
 */
export function applySceneUpdate(companionId, sceneInfo, { extractionFailed = false, userTransition = true } = {}) {
  try {
    if (extractionFailed) {
      patchCompanion(companionId, { current_scene: '日常', current_scene_meta: null });   // fail-open 反转 + 清 sidecar
      return;
    }
    // 兼容旧调用（裸字符串）与新调用（{location, food_state}）
    const info = (sceneInfo && typeof sceneInfo === 'object') ? sceneInfo : { location: sceneInfo };
    const loc = String(info.location ?? '').trim().slice(0, 30);
    const food = FOOD_STATES.includes(info.food_state) ? info.food_state : 'none';
    // 本轮无明确场景信号（空/占位 location 且无进食态）→ 保留现值（场景跨轮持久）。注意"在家"是真实
    // 场景(到家了)不跳过；prompt 已约束"只在明确场景时才填"，防止把"图书馆"误覆盖成默认。
    if ((!loc || loc === '无' || loc === '日常') && food === 'none') return;
    const prev = getCompanionById(companionId);
    const prevState = parseSceneState(prev?.current_scene, prev?.current_scene_meta);
    const nowMs = Date.now();
    const merged = applySceneTransition(prevState, { location: loc, food_state: food }, { nowMs, userTransition });
    merged.last_confirmed_at = nowMs;
    patchCompanion(companionId, {
      current_scene: merged.location || '日常',           // 🔴 裸 location 字符串（旧消费方契约不变）
      current_scene_meta: serializeSceneMeta(merged),     // sidecar JSON（全中性 → null）
    });
  } catch (e) {
    log('debug', `[Scene] current_scene 更新跳过 companion=${companionId}: ${e.message}`);
  }
}

/**
 * #324 TTL：次日 00:30 批清场——把所有 companion 的 current_scene 回落"日常"，防"昨天的图书馆"
 * 漏到今天（场景是**当日态**，跨日必清）。纯批量 UPDATE、幂等。约定类(open_loop)靠其自身生命周期
 * （履约关闭 / markStaleOpenLoops），不在此清。
 */
export function resetScenesForNewDay() {
  try {
    const r = getDb().prepare(
      "UPDATE companions SET current_scene = '日常', current_scene_meta = NULL WHERE current_scene IS NOT NULL AND current_scene NOT IN ('日常','在家')",
    ).run();
    if (r.changes) log('info', `[Scene] 次日清场：${r.changes} 个 companion 的 current_scene 回落"日常"`);
    try { clearBodyEventsTodayAll(); } catch { /* 即时状态锚定：今日身体态同次日清·失败忽略 */ }   // P2→P1 停板B
    try { clearTopicOpensTodayAll(); } catch { /* topic 每日预算同次日清·失败忽略（读侧已日界自愈） */ }
    return r.changes;
  } catch (e) {
    log('warn', `[Scene] 次日清场失败（已忽略）: ${e.message}`);
    return 0;
  }
}

// ─── 用户画像提取（异步，调用 AI）───────────────────────────────────────────
const PROFILE_SYSTEM_PROMPT = `你是信息提取助手。从他（对方）的发言中提取他自身的个人信息。
只提取他明确说出的信息，不要推测。
以JSON对象返回（只包含能提取到的字段）：
{
  "user_name": "他的名字或昵称（如有）",
  "user_occupation": "职业或学生身份（如有）",
  "user_birthday": "生日，格式MM-DD或YYYY-MM-DD（如有）",
  "hobbies_to_add": ["新提到的爱好（如有）"],
  "important_date": {"label":"事件名","date":"日期"} 或null,
  "notes": "其他值得记录的重要信息（如有）"
}
没有任何个人信息时返回{}。只输出JSON，无其他内容。`;

export async function extractAndUpdateUserProfile(companionId, userId, userMsg) {
  if (!userMsg || userMsg.length < 5) return;

  try {
    const raw  = await extractStructuredInfo(PROFILE_SYSTEM_PROMPT, `他说："${userMsg}"`);
    const info = safeParseObject(raw);
    if (Object.keys(info).length === 0) return;

    const existing   = getUserProfile(userId, companionId);
    const patchData  = {};

    if (info.user_name)       patchData.user_name = info.user_name;
    if (info.user_occupation) patchData.user_occupation = info.user_occupation;
    if (info.user_birthday)   patchData.user_birthday = info.user_birthday;
    if (info.notes)           patchData.notes = info.notes;

    if (info.hobbies_to_add?.length > 0) {
      const cur = existing?.user_hobbies || [];
      patchData.user_hobbies = [...new Set([...cur, ...info.hobbies_to_add])];
    }

    if (info.important_date?.label && info.important_date?.date) {
      const cur = existing?.important_dates || [];
      const dup = cur.some(d => d.label === info.important_date.label);
      if (!dup) patchData.important_dates = [...cur, info.important_date];
    }

    if (Object.keys(patchData).length > 0) {
      upsertUserProfile(userId, companionId, patchData);
      log('info', `[Memory] 用户画像更新 user=${userId} keys=${Object.keys(patchData).join(',')}`);
    }
  } catch (e) {
    log('warn', `[Memory] 用户画像提取失败: ${e.message}`);
  }
}

// ─── 召回记忆（同步） ─────────────────────────────────────────────────────────
export { recallMemories } from './db.mjs';

// ─── 工具 ────────────────────────────────────────────────────────────────────
function safeParseArray(text) {
  if (!text) return [];
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const v = JSON.parse(m[0]); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

function safeParseObject(text) {
  if (!text) return {};
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { const v = JSON.parse(m[0]); return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  catch { return {}; }
}
