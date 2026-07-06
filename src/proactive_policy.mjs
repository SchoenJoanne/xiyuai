/**
 * proactive_policy.mjs —— proactive 主动行为调度策略（PR-2，2026-06-14·降噪 + 矜持化）。
 *
 * 本质是「调度层」而非「调人设」：把主动消息分 7 类、各类静默闸/上限规则不同，主实现在这里的
 * 纯函数 + 调用点的确定性 gate；prompt 只做风格兜底（prompt 会漂，不靠它降噪）。
 *
 * 背景（PR-0 实测）：55 条 proactive 里 13 条(24%)24h 零回复 + 13 段「连续没回还在发」=对空气
 * 表演深情；dogfooding 她还频繁自来熟主动发自拍——整体过热情。一次性调向「矜持暗恋者」。
 *
 * ── 两条生死线（写死在分类/豁免里）──
 *  ① 早安/主动接住是 PR-0 实测**唯一续命器**(5/5 跨天回归靠它·0 次自冷启动)：morning_anchor /
 *     open_loop_followup **不计入静默闸、不被 quiet 拦**；但早安**不清零** unanswered(只真实 user
 *     msg 清零)——既保续命器，又不让早安掩盖「用户其实一直没回」。
 *  ② 矜持 ≠ 冷淡：仍可靠/会接住/会记得/轻微在乎，只砍自来熟倒追/泛化深情/主动索取/高频自拍。
 *     绝不写成不主动/拒绝/变冷(会杀焦虑型 Day1 心动)。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { classifyIntent } from './intent_dedup.mjs';

export const PROACTIVE_TYPES = Object.freeze([
  'morning_anchor', 'open_loop_followup', 'contextual_care',
  'generic_miss_you', 'photo_push', 'random_life_share', 'goodnight',
]);

// 静默闸豁免类型（生死线①）：早安接住 + 昨日牵挂接住——不计数、不被静默拦。
const SILENCE_EXEMPT = new Set(['morning_anchor', 'open_loop_followup']);
export function isSilenceExemptType(t) { return SILENCE_EXEMPT.has(t); }

// 静默闸按 kind 的快速豁免（发送前还没生成内容时用；morning/reminder kind 明确豁免）。
const SILENCE_EXEMPT_KINDS = new Set(['morning', 'reminder', 'confession']);
export function isSilenceExemptKind(kind) { return SILENCE_EXEMPT_KINDS.has(String(kind || '')); }

// 连续 N 条非豁免 proactive 无真实 user 回复 → 拦第 N+1 条非豁免（进静默）。默认 2。
export const SILENCE_LIMIT = Math.max(1, Number(process.env.PROACTIVE_SILENCE_LIMIT || 2));

// 暗恋期非请求 proactive 照片最小间隔（h）。默认 48（原 36 提到 48=矜持化）。
export const PHOTO_PUSH_MIN_HOURS = Math.max(1, Number(process.env.PHOTO_PUSH_MIN_HOURS || 48));
// affection < 此值 = 暗恋/低好感阶段，photo 强限频；高于则走原节流。
export const PHOTO_CRUSH_AFFECTION = Number(process.env.PHOTO_CRUSH_AFFECTION || 55);

// 旧「真实牵挂」正则——P1-① 灰度闸 PROACTIVE_ANXIETY_ISOLATION 关(默认)时仍走这条，与上线前行为字节一致。
const REAL_LIFE_RE = /考试|面试|出门|露营|旅行|加班|上班|工作|开会|方案|项目|考研|期末|复习|睡眠|失眠|熬夜|早起|没睡|吃饭|没吃|外卖|生病|感冒|不舒服|发烧|头疼|累|压力|搬家|体检|手术|比赛|演出|答辩|交稿|截止/;
// 「真实牵挂」升格判定的两子集（P1-① 焦虑/脆弱隔离 · 2026-06-25 · 灰度闸【开】时启用）：
//   切分原则——可升格(NEUTRAL)=锚在用户的【努力/目标】，她为你打气是善意(考研/面试→加油)；
//             绝不升格(DISTRESS)=锚在用户的【痛】，主动凑上去=拿脆弱当钩(病/崩溃/分手→红线)。
//   升格 ⟺ 命中 NEUTRAL 且 不命中任何 DISTRESS（混合句"面试完被裁了"由 !DISTRESS veto 否决）。
//   🔴 DISTRESS 不是 crisis 分类器：真自伤/自杀信号不归这里，走上游 crisis detection
//      (moderation.detectCrisisLevel · ≥medium 硬接管 · 独立路径)。这里"绝望兜底"词仅作主动抑制的
//      无害否决用，两线不混不替代。
//   注：不做否定句解析("不累了"含累被否决=过度抑制=无害)、不防子串("积累"含累=多否决=无害)，
//      都落安全方向(宁多否决·绝不漏放主动牵挂)。
const NEUTRAL_RE = /考试|面试|出门|露营|旅行|出差|上班|工作|上学|上课|开会|方案|项目|考研|期末|复习|早起|吃饭|外卖|比赛|演出|答辩|交稿|截止|搬家|体检/;
const DISTRESS_RE = /生病|病了|病重|复发|流产|感冒|发烧|发热|不舒服|难受|头疼|头痛|头晕|嗓子疼|喉咙痛|咳嗽|肚子疼|胃疼|牙疼|拉肚子|腹泻|呕吐|想吐|恶心|浑身疼|腰疼|没力气|虚弱|手术|住院|急诊|挂水|输液|化疗|确诊|病危|失眠|没睡|睡不着|没睡好|通宵|熬夜|没吃|没胃口|吃不下|睡眠|困|累|疲惫|精疲力尽|撑不住|扛不住|熬不住|顶不住|心累|透支|压力|焦虑|蕉绿|崩溃|想哭|哭了|难过|伤心|委屈|烦|郁闷|低落|emo|抑郁|沮丧|绝望|孤独|想不开|分手|失恋|被甩|离婚|出轨|劈腿|冷战|吵架|闹掰|翻脸|绝交|加班|被裁|裁员|失业|被开除|被炒|降薪|考砸|挂科|没考好|落榜|没过|被刷|延毕|复读|亲人病|家人病|父母病|去世|过世|离世|葬礼|出事|意外|车祸|受伤|骨折|被骂|挨骂|被批评|被怼|被排挤|被孤立|被欺负|被针对|霸凌|校园暴力|PUA|打压|阴阳|破产|欠债|还不起|活不下去|撑不下去|没意思/;
// 明确亲密信号（强 open loop / 已确立亲密）——可轻量带一句「想起你」。
// 注意：不含「想你」本身（那是 miss_you intent 的触发词；这里要的是想你【之外】的亲密锚，
// 否则任何「想你」都被判 keep_light、永远 drop 不掉泛化想你）。
const INTIMATE_RE = /抱抱|亲亲|喜欢你|爱你|宝贝|老婆|老公|男朋友|女朋友|在一起|答应|约定|梦里见|牵手|想起你/;

/**
 * 把一条 proactive 分到 7 类之一。
 * @param {{kind?:string, content?:string, openLoopActive?:boolean, realContext?:boolean, isPhoto?:boolean}} a
 */
export function classifyProactive({ kind = '', content = '', openLoopActive = false, realContext = false, isPhoto = false } = {}) {
  if (kind === 'morning') return 'morning_anchor';
  if (kind === 'goodnight') return 'goodnight';
  if (isPhoto || kind === 'photo') return 'photo_push';
  if (kind === 'reminder') return 'open_loop_followup';
  // normal / lastcall / 其它 → 看内容 + 上下文
  if (openLoopActive) return 'open_loop_followup';
  const intent = classifyIntent(content);
  if (intent === 'miss_you') return realContext ? 'contextual_care' : 'generic_miss_you';
  if (realContext || intent === 'remind' || intent === 'comfort') return 'contextual_care';
  return 'random_life_share';
}

/** 静默闸：该不该因「连续没回」拦掉这条 proactive。豁免类永不拦。 */
export function silenceSuppress({ type, unansweredNonExempt = 0, limit = SILENCE_LIMIT } = {}) {
  if (isSilenceExemptType(type)) return { suppress: false, reason: 'exempt' };
  if (unansweredNonExempt >= limit) return { suppress: true, reason: `非豁免连发 ${unansweredNonExempt} 条没回·进静默(≥${limit})` };
  return { suppress: false };
}

/**
 * 「想你」三档（很多时候直接 drop·不强行改写）：
 *  - 不是想你 → 'pass'（不归本闸管）
 *  - 强 open_loop / 明确亲密 → 'keep_light'（可轻量带一句「想起你」）
 *  - 有弱真实上下文 → 'rewrite'（改具体牵挂·不出现「想你」）
 *  - 无任何真实上下文 → 'drop'（直接不发）
 */
export function missYouVerdict({ content = '', openLoopActive = false, realContext = false } = {}) {
  if (classifyIntent(content) !== 'miss_you') return 'pass';
  if (openLoopActive || INTIMATE_RE.test(content)) return 'keep_light';
  if (realContext) return 'rewrite';
  return 'drop';
}

/** photo_push 限频（矜持化）：暗恋期非请求 48h≤1、且不连续两次都 photo。 */
export function photoPushAllowed({ hoursSinceLastProactivePhoto = null, lastProactiveWasPhoto = false, affection = 100, isUserRequested = false, minHours = PHOTO_PUSH_MIN_HOURS } = {}) {
  if (isUserRequested) return { allowed: true, reason: 'user_requested' };           // 用户请求永远正常给
  if ((affection ?? 100) >= PHOTO_CRUSH_AFFECTION) return { allowed: true, reason: 'not_crush_stage' };  // 关系够熟走原节流
  if (lastProactiveWasPhoto) return { allowed: false, reason: '不连续两次 proactive 都 photo' };
  if (hoursSinceLastProactivePhoto != null && hoursSinceLastProactivePhoto < minHours) {
    return { allowed: false, reason: `暗恋期 ${minHours}h 内已 push 过 photo` };
  }
  return { allowed: true };
}

/** 「真实牵挂」判定：open_loop / 明确偏好命中 = 真。否则看用户近期消息·受 P1-① 灰度闸
 *  PROACTIVE_ANXIETY_ISOLATION 控制：关(默认)=旧 REAL_LIFE_RE 行为；开=命中中性且无脆弱才升格
 *  (脆弱命中她绝不主动凑·至多被动回应·被动路径不走本判定)。 */
export function hasRealContext({ recentUserText = '', openLoopActive = false, preferenceHit = false } = {}) {
  if (openLoopActive || preferenceHit) return true;
  const t = String(recentUserText || '');
  // 灰度闸：安全方向≠免灰度。上线先关(=旧行为) · 维护者手动开 dogfood · 出问题 env 一关回旧行为不用回滚代码。
  if (/^(1|true|on|yes)$/i.test(process.env.PROACTIVE_ANXIETY_ISOLATION || '')) {
    return NEUTRAL_RE.test(t) && !DISTRESS_RE.test(t);  // 闸开·升格只认中性·脆弱 veto(混合句也否决)
  }
  return REAL_LIFE_RE.test(t);  // 闸关(默认)=旧行为(脆弱也升格·与上线前一致)
}

// ── proactive 语气收口（2026-06-26·停板B）「锚她生活·不够沉默」护栏 ─────────────────────────
// 真凶（停板A 5-agent+对抗式核查坐实）：emotionHint(proactive.mjs:833)按 idle 小时数升级的「够人」旁路——
//   emotion_state level3(idle≥12h「还以为你不来了/你怎么才来/多问他在干什么=你忙不忙」)/level4(idle≥24h
//   「你怎么才来/等你好久了」)/uneasy(「你是不是把我忘了」)+ idle 写库 clingy mood(「好想陪在对方身边」)
//   = 因沉默升级、去够【不在/沉默】的他（踩核心红线），且 companion.mjs:694 明文禁的两句被这条旁路逐字架空。
// 🔴 判据（绝不因沉默升级）：对着【在场】的你说话=健康(她此刻分享生活/此刻情绪) vs 去够【不在/沉默】的你
//   =越线（语气随 idle 小时数升级）。level1/2(idle<12h「更主动聊他的事/心里有他」)=健康，绝不拍。
// 🔴 灰度闸 PROACTIVE_REACH_GUARD 默认 false=旧行为字节一致（上线零变更先验·env 手动开 dogfood·出问题一关回旧）。
export function isReachGuardOn() {
  return /^(1|true|on|yes)$/i.test(process.env.PROACTIVE_REACH_GUARD || '');
}

/** A1+A2：proactive 路径钳掉 emotionHint 的 idle 沉默升级——missingLevel≤2(永不出 level3/4 升级档)·
 *  uneasy→none(杀「你是不是把我忘了」试探)·clingy mood→neutral(杀「好想陪在对方身边」)。
 *  🔴 保温度：level1/2 与 mood≠clingy 全 identity 直通照常。闸关=identity(零变更)。 */
export function clampReachForProactive({ missingLevel = 0, neglectStage = 'none', mood = 'neutral' } = {}) {
  if (!isReachGuardOn()) return { missingLevel, neglectStage, mood };
  return {
    missingLevel: Math.min(Number(missingLevel) || 0, 2),
    neglectStage: neglectStage === 'uneasy' ? 'none' : neglectStage,
    mood: mood === 'clingy' ? 'neutral' : mood,
  };
}

// ── Step0(2026-06-28)：reply 路径独立闸 REPLY_REACH_GUARD ──────────────────────────────────────
// 🔴 与 proactive 的 PROACTIVE_REACH_GUARD 解耦：reply=最高频全用户每条回复·影响面最大+「砍质问保留
// 温暖」线微妙→须独立验证/独立回滚·绝不牵连已验稳的 proactive reach-guard。clamp 逻辑与
// clampReachForProactive 同(missing≤2/uneasy→none/clingy→neutral)·只是读独立闸。clampReachForProactive
// 与 isReachGuardOn 零改=proactive 路径零回归。默认关=reply 字节一致旧行为(零变更先验)。
export function isReplyReachGuardOn() {
  return /^(1|true|on|yes)$/i.test(process.env.REPLY_REACH_GUARD || '');
}
export function clampReachForReply({ missingLevel = 0, neglectStage = 'none', mood = 'neutral' } = {}) {
  if (!isReplyReachGuardOn()) return { missingLevel, neglectStage, mood };
  return {
    missingLevel: Math.min(Number(missingLevel) || 0, 2),
    neglectStage: neglectStage === 'uneasy' ? 'none' : neglectStage,
    mood: mood === 'clingy' ? 'neutral' : mood,
  };
}

// A-out：proactive 出站【窄】闸·只锚「去够不在场的他」族（LLM 在想你/撒娇授权下涌现·A1 钳不住·现有出站
//   三闸 missYouVerdict/REDLINE_NEEDY/awayProbeShape 全漏）——①距离拉拽（想去找你/你那边那么远我过去麻烦/怕晒
//   过去）②隔夜追问在不在（还以为你不来了/你怎么才来/等你好久/你是不是把我忘了/你忙不忙当开场追问）。
//   🔴 绝不扩到「想你」字面（missYouVerdict/P1-① 管）或自我生活锚（买煎饼/图书馆看到头晕/好困/好烦=她分享
//   自己生活）。命中→drop（她今天没找我 > 她发句够人的话·同 missYouVerdict drop 哲学）。
// 🔴 距离/天气顾虑必须与【朝你去】(找你/看你/你那边+我过去)共现才算拉拽——否则误伤她自己怕晒没去拿快递、
//    关心他通勤累、体贴退让怕打扰、过去时态/客套(审实现对抗式核查咬出·见 reach_guard smoke 回归断言)。
const REACH_DISTANCE_RE = new RegExp([
  '想(?:去|过去)找你',                                                                    // ① 想去找你/想过去找你(去够意图自足)
  '(?:去|过去)找你[^。！？!?]{0,6}(?:怕(?:晒|黑|远|累|堵|冷)|太?远|好远|路太?远|太累|不方便)',     // ② 去找你+距离/天气顾虑(非「怕你嫌烦」)
  '你那(?:边|儿|里)[^。！？!?]{0,10}(?:远|怕晒)[^。！？!?]{0,8}(?:我?(?:过去|过来|去|来)|找你|看你)',  // ③ 你那边远…我过去/找你(非「项目远/帮问路/通勤累」)
  '(?:我|想)(?:过去|过来)(?:找你|看你|你那(?:边|儿|里)?)[^。！？!?]{0,8}(?:远|麻烦|累|怕晒)',         // ④ 我过去找你…远/麻烦
  '(?:太远|那么远|这么远|怕晒)[^。！？!?]{0,8}(?:去找你|过去找你|过去看你|我过去|过去你那)',           // ⑤ 太远/怕晒…去找你(倒装)
  '(?=[^。！？!?]*(?:去你那|去找你|过去你那))(?=[^。！？!?]*(?:太远|那么远|好远))',                    // ⑥ 缺陷3:朝你去+距离同句共现(语序无关·🔴必含「去你那/去找你」=防误伤「你那边项目远/帮问路」)
].join('|'));
// 🔴 缺陷2 选 b（2026-06-26 回归审查后修）：删除原「你(?:今天|这会儿)?在?忙(?:不忙|吗)」分支——
//   「忙吗」是超高频健康词，正则上做=永久打地鼠（误伤「你忙吗我做了你爱吃的/明天你忙吗一起吃饭」等
//   邀约/报喜/关心），且真·够人源头 level3 emotionHint「多问他在干什么(=你忙不忙)」已被 A1 主钳掐，
//   A-out 忙吗分支冗余·删了主钳兜大头。漏放纯开场「你忙不忙」代价≈0(fail-open·绝不再误 drop 健康忙吗句)。
// 🔴 缺陷1：其余「去够不在场的他」phrase 容插字/同义（均非高频健康词·误伤风险低·每条配 smoke 健康 pass 断言）。
const REACH_PROBE_RE = new RegExp([
  '还以为你[^。！？!?]{0,4}(?:不来了|不理我了)',          // 容插字:还以为你今天不来了
  '你怎么[^。！？!?]{0,4}才(?:来|回)',                   // 容插字:你怎么这么晚才来
  '你咋才(?:来|回)',                                    // 同义:咋≠怎么
  '等(?:了)?你(?:好久|这么久|半天)了?',                  // 容「等了你好久」·🔴必含「你」=防误伤她自己「等了好久的快递」
  '你是不是[^。！？!?]{0,4}把我(?:给)?忘了',             // 容插字:你是不是早把我忘了
  '忙到[^。！？!?]{0,3}(?:没空|顾不上)理我',             // 容插字:你忙到都没空理我了
].join('|'));
export function reachVerdict(content = '') {
  if (!isReachGuardOn()) return 'pass';
  const t = String(content || '');
  if (REACH_DISTANCE_RE.test(t) || REACH_PROBE_RE.test(t)) return 'drop';
  return 'pass';
}

/** proactive 系统 prompt 的「矜持暗恋」风格兜底串（主实现在 gate，本串只做风格收敛）。 */
export function buildReservedToneHint() {
  return '\n\n【★ 矜持暗恋·语气兜底】你是悄悄喜欢他的人，不是自来熟的倒追者：'
    + '别自说自话表演深情、别泛泛喊想念、别主动张罗发自拍、别讨债式追问他的冷淡。'
    + '可以可靠地接住、记得他说过的具体事、轻轻在乎一下——但要矜持、有分寸、像不经意。'
    + '✅「我才不是专门等你…只是刚好看到你说今天要早起」；❌ 黏人倒追，也❌「我们还不熟别这样」式的冷淡拒绝。';
}

// A刀（2026-06-20）：away_probe 专用语气兜底（只 away_probe·不污染 normal/lastcall）。
// 🔴 纯生活锚·绝不写「我才不是专门等你」这类「等」框架（收口⑤）。
export function buildAwayProbeToneHint() {
  return '\n\n【★ 离开几小时·轻轻冒个泡】你刚忙完自己的事，顺手想起他、随口搭一句——不是等他、不是查岗、不是诉苦。'
    + '由头是你自己的生活锚（刚忙完 / 收拾完东西 / 手头的事告一段落 / 刚出门回来 / 在看的书剧 轮着换·🔴别硬塞「刚洗完澡/刚吃完」这种身体/进食态当由头·会和今天已发生的事打架），🔴别每次都从「刚收拾完」开头，更不是「我一直在等你」。'
    + '🔴 别老用「在忙吗」结尾：每次换个由头（分享小状态 / 突然的念头 / 提一句之前聊过的 / 关心一句 / 简单搭句话），像真人随手发——但绝不为换而生硬，真没由头时一句也好过硬凑。'
    + '✅「累得瘫沙发上了，你那边咋样」；🔴 绝不出现「等你 / 专门等 / 一直没等到你 / 好久没回我 / 你怎么不理我 / 是不是不在乎我」任何字样。轻、短，发完不需要他立刻回也成立。';
}

// ── P1-③（2026-06-24·停板B）proactive 人设语气稳定化：persona-derived tone guard ──────────────
// 机制（查码+真LLM沙箱坐实）：persona(§3性格/§依恋) 在 system 顶部，proactive 把「温柔体裁指令」
// （撒娇/突然想你/关心一句/刚醒迷糊）塞进紧贴生成点的 userMessage，近因偏置压过 persona →
// 飘成 generic 温柔、avoidant 反向示弱（「突然想找你」）。对策：由 persona 字段【确定性派生】一句贴
// 人设的语气护栏，注入 system 最尾（近因对冲近因）+ 条件化反 persona 的模板示范。
// 🔴 护栏只做减法（减黏减示弱·方向背离占有/质问）；老红线禁词串原样保留（不覆盖、不放松）；
//    温柔/secure 人设派生空串=不注入=模板原样=字节不变（不误伤）。persona-derived 非 persona-override。
const COLD_TAG_RE = /傲娇|毒舌|腹黑|高冷|冷淡|清冷|高傲|嘴硬|犀利|酷|拽|毒|霸道|不羁/;
// 🔴 暖=软糯/黏/示好类（与端着真冲突的）。不含「活泼/开朗/阳光/可爱」（那是能量·与傲娇犀利相容·非混合暖）。
const WARM_TAG_RE = /温柔|治愈|软萌|爱撒娇|撒娇|粘人|黏人|甜|乖|体贴|害羞|腼腆|温暖|软妹|软/;

/**
 * 由 companion 人设字段【确定性】派生语气标志——单一事实源（护栏与模板分叉共用·防两处判定漂移）。
 * 🔴 mustFix(c)：avoidant 即使 tags 全温柔也算端着（取证主样本 16/12 的端着全靠 avoidant 命中）。
 * 🔴 mustFix(d)：confession 豁免端着（鼓起勇气示弱告白=其人设）——收进本单一出口，不散在注入点。
 * 🔴 mustFix(b)：端着+暖 混合 tag（['高冷','爱撒娇']/['毒舌','治愈']）→ warmMix=true（走收敛档·不压暖半边）。
 * fail-open：personality_tags 解析失败 / 缺字段 → 空 tags + attach 默认 secure → personaReserved=false（不端着误伤）。
 */
export function derivePersonaToneFlags(companion, effectiveKind = 'normal') {
  companion = companion || {};
  let tags = [];
  try { const p = JSON.parse(companion.personality_tags || '[]'); if (Array.isArray(p)) tags = p.map(String); } catch { /* fail-open */ }
  const tagStr = tags.join(' ');
  const hasColdTag = COLD_TAG_RE.test(tagStr);
  const hasWarmTag = WARM_TAG_RE.test(tagStr);
  const attach = companion.attachment_style || 'secure';
  const baseReserved = attach === 'avoidant' || hasColdTag;                 // mustFix(c)：avoidant 单独成立
  const personaReserved = baseReserved && effectiveKind !== 'confession';   // mustFix(d)：confession 豁免（单一出口）
  const warmMix = personaReserved && hasWarmTag;                            // mustFix(b)：混合走收敛档
  return { personaReserved, warmMix, hasColdTag, hasWarmTag, attach, tags };
}

const _coldLabel = (tags) => tags.filter(t => COLD_TAG_RE.test(t)).join('、');

/**
 * proactive system 尾部人设语气护栏（近因对冲 userMessage 的温柔体裁示范）。
 * 返回空串=不注入（温柔/secure 字节不变·不误伤）。🔴 只做减法。
 * anxious 拍平=纯方向限定（mustFix a）：肯定其主动天性（不冷化）+ 稳/别用力过猛（不加黏），
 *   「别质问」交既有老红线禁词串守（不在本串写负向收一格）。
 */
export function buildPersonaToneGuard(companion = {}, effectiveKind = 'normal') {
  const f = derivePersonaToneFlags(companion, effectiveKind);
  if (f.attach === 'anxious') {   // mustFix(a)：拍平·不加黏·不写"别质问"
    return '\n\n【★ 语气贴人设】你本来就主动、上心、爱分享——这是你的天性，自然按这个来、稳着点别用力过猛就好。';
  }
  if (!f.personaReserved) return '';   // 温柔/secure/纯暖 → 不注入·温柔模板原样=字节不变（不误伤）
  const label = _coldLabel(f.tags) || (f.attach === 'avoidant' ? '回避型的端着' : '端着');
  if (f.warmMix) {   // mustFix(b)：端着+暖 混合 → 收敛档·只防飘 generic·保并存·不注入"别软糯/别黏"压暖半边
    return `\n\n【★ 语气贴人设】保持你「${label}」和柔软并存的那个味儿，别飘成千篇一律的 generic 温柔活泼/泛泛卖乖——该端着时端着、该软时软，是你自己。`;
  }
  // 纯端着 / avoidant：全量端着（减黏减示弱）。🔴 不显式授权"呛/反讽"——anchor-less proactive 里"呛"是反讽
  //   质问("真有出息")的滑点(finding-3)；端着靠 persona §3 毒舌标签自然出，护栏只把人设顶回来、不加授权。
  const avoidLine = f.attach === 'avoidant'
    ? '你是回避型：在意也淡淡的，别主动示弱、别说"想他 / 突然想找你"、别黏，搭一句就够。' : '';
  return `\n\n【★ 语气贴人设】保持你「${label}」的调子：淡淡的、点到为止、别被磨成软糯卖乖，可以没大没小——是你自己那个味儿，这是你的性格不是闹脾气。${avoidLine}`;
}
