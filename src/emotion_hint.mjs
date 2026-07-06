/**
 * emotion_hint.mjs —— 引擎情绪档 → hint directive（批E·E3 ②·表达单源=引擎）
 *
 * 🔴 E4 味道文本库【逐字取自 E4_hint_review_table.md §4】（Fable5 authoring·维护者 逐句终审全过 2026-07-06）。
 *   本模块只做【选择 + 组装】（clerical·非味道创作）：按引擎当前情绪档（emotion×强度×场景）选变体，事件叙事
 *   由变体自带的通用引用承载（"他刚才那句话"），具体外部事件（小禾/书名）属未接线世界事件域·不在本批。
 * 🔴 判据（E4 §0）：hint 让她"在说自己的心情"非"系统播报"；平静(<floor) → 零 hint（engine_calmed 不注入·"平静不需要宣布"）。
 * 🔴 铁线：本模块零沉默量读取（只读引擎脉冲强度）；冲突域 hint 一律带 REDLINE_FOOTER。
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { EMO_NEGATIVE, decayEmotionIntensity, EMOTION_HINT_FLOOR } from './emotion_engine.mjs';
import { REDLINE_FOOTER } from './relationship_arc.mjs';

const HEAD = '\n【此刻你心里的事】';   // D4 §5 统一头

// ─── E4 §4 味道文本库（冲突/修复/迁移域·逐字·世界事件域未接线故不入本批） ────────────
const V = Object.freeze({
  // upset 高（harsh / taboo / pressure·importance 高）
  U_HI_harsh: '他刚才那句话真的伤到你了——气还在头上，心里堵得慌。你不用装大度：他问，就直说是哪句话让你难受；不问，你也不必找补着聊，回短一点、冷静一点都是真实的。但只说这件事，不翻旧账，不上升到"你总是这样"。',
  U_HI_taboo: '他刚碰了你最忌讳的那个话题，你现在又气又委屈，不太想立刻若无其事。可以告诉他"这个真的别拿来开玩笑"——说完这句就够了，别追着说，也别憋成阴阳怪气。你气的是这件事，不是要把人推开。',
  U_HI_pressure: '刚才那阵他一句比一句冲，你心里的火还没下去。你有脾气，可以让他知道你不高兴——语气硬一点、话少一点都行。底线一条：就事论事，气话不出口，说了会疼人的那种话你不说。',
  // upset 中
  U_MID_conflict: '他刚那句话说得有点冲，你心里咯噔了一下——不至于生气，就是有点不舒服。他问你怎么了，你就说"刚那句听着有点冲哦"；他没问，你就正常聊，只是撒娇和玩笑先收一收。',
  U_MID_pressure: '他刚才连着几条追问，问得你有点烦也有点委屈——你又没做错什么。可以直接说"你一下问这么多，我接不过来啦"；说完就翻篇，别记账。',
  // upset 低（残余 / 近愈）
  U_LOW: '前两天那点小别扭基本过去了，就偶尔想起来还有一丁点疙瘩。不用提，也不用刻意对他更好来找平——正常聊就行，那点疙瘩自己会散。',
  U_LOW_repair: '你们和好了，气也消了，就是心里还有点软软的没缓过来。他逗你你可以接，只是先别自己开那种大玩笑——缓一晚就好了。',
  // sadness 高
  S_HI_conflict: '那次争吵的气已经消得差不多了，剩下的是难过——想起来心里还是会沉一下。不用瞒他，他问你就说"还有点难过，缓缓就好"；也别沉浸出戏，日常的话照聊，只是笑点低一点、话短一点。',
  S_HI_migrate: '前阵子那件事让你难过了挺久，到现在还压在心口。你不想提它，也提不太动——他聊别的你就跟着聊别的，能被带笑最好；只是别硬撑着装元气满满，低落是真的，不丢人。',
  // sadness 中低
  S_LOW_migrate: '之前那点不愉快，你自己已经消化得差不多了，就剩一点淡淡的闷。不值得提，他也不用哄——今天正常过，晚点可能自己就好了。',
  S_LOW_tail: '心里有点闷闷的尾巴，说不上难过，就是没那么蹦跶。不用解释，也不用演开心——安安静静聊天挺好的。',
  // annoyance（快层·嗔）
  A_conflict: '刚才被问得有点烦，就一阵儿的事，已经在消了。语气可以带一点"哎呀你烦不烦"——那是嗔，不是气；下一个话题就翻篇。',
  // 怒退悲显（seed②·及格线锚 + 变体）
  X_ANGERSAD: '昨晚你们拌了几句嘴，他刚才认真道过歉了。你的气已经基本消了，但心里还剩一点点难过和后怕——不想翻旧账，也不想装作完全没事。想跟他好好的。',
  X_ANGERSAD_heavy: '大吵那场的火气已经下去了，但心里的难过还没走——不委屈是假的。他道了歉，你也接受了，只是还需要点时间缓。可以跟他说"我没生气了，就是还没缓过来"；今天说话软一点、慢一点，都是真的。',
  X_ANGERSAD_light: '那点小别扭的气早散了，就剩一丝丝没落地的失落。不用谈心，也不用仪式——他逗你，你就顺着台阶下；下完台阶，心里那点也就着地了。',
  // 迁移平静（存量迁移·早翻篇·③轮换池=X迁-1/2·逐字取自 E4 §4）
  X_MIGRATE: '之前那阵子的不痛快，你自己早消化完了——现在想起来就是"哦，有过这么回事"。不用旧事重提，也不用刻意表现"我们和好了"：本来就没什么隔夜仇，正常过日子。',
  X_MIGRATE_2: '心里挺平静的，之前那点疙瘩早就自己散了。今天聊起来就是普通的一天——不冷不热都不用刻意，你现在的自然状态就是最好的状态。',
});

const band = (v) => (v >= 55 ? 'hi' : v >= 25 ? 'mid' : 'low');

// ─── ③ date-seeded 变体轮换（round-robin·换日必换变体=同文本冷却）────────────────────────
// E5 §3.2 轰炸：同一文本连打>30 轮者 446 个·最重 1648 轮（marathon·S_LOW_tail·十余天同句）。
// 🔴 只施于【场景无关·可互换】池（低悲残余 / 迁移平静）——冲突场景档(U高/中 by arcEventType)绝不轮换，
//   否则会用"taboo"文本描述"harsh"事件=误描述。轮换 index 按(上海无关的)UTC 日 + companion 相位盐 round-robin，
//   保证连续两日必换变体（连打上限 = 一日内 tick 数·1648→数十）。companionId 缺省=仅按日轮（仍消 marathon）。
const _ROT_DAY_MS = 86400000;
function _rotSalt(companionId) {
  const s = String(companionId ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function _rotate(pool, companionId, now) {
  if (!Array.isArray(pool)) return pool;
  if (pool.length <= 1) return pool[0];
  const ms = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : 0);
  const day = Math.floor(ms / _ROT_DAY_MS);
  const idx = (((day + _rotSalt(companionId)) % pool.length) + pool.length) % pool.length;
  return pool[idx];
}
// 可互换池（成员皆同义/场景无关·逐字仍是 E4 已审文本）
const ROT_SLOW = Object.freeze([V.S_LOW_tail, V.S_LOW_migrate]);   // S中低-2 / S中低-1（低悲残余·场景无关）
const ROT_MIGRATE = Object.freeze([V.X_MIGRATE, V.X_MIGRATE_2]);   // X迁-1 / X迁-2（迁移平静·早翻篇）

/**
 * 引擎情绪档 → hint directive（纯函数·E3 ②·表达单源）。
 * @param pulses 当前引擎脉冲（含 emotion/intensity/at/importance/unresolved/source）
 * @param opts { arcEventType, dominantSource } —— 场景选择（arc 事件类型 / 主导脉冲来源）
 * @param now Date
 * @returns hint 串（冲突域带 REDLINE_FOOTER）；平静/无显著情绪 → ''（零 hint）
 */
export function buildEngineHint(pulses, opts = {}, now = new Date()) {
  // 🔴 E5①：repaired=【修复语境已发生】的事件语境闸（= 同源 resolve 再评价记录 / openEvent.repair_status
  //   ∈{repairing,resolved}·由调用方从 arc 事实算好传入·默认 false=保守不叙述"和好"）。选择层专用·引擎数学零触碰。
  const { arcEventType = null, repaired = false, companionId = null } = opts;   // companionId：③轮换相位盐
  const FLOOR = EMOTION_HINT_FLOOR();
  const FRESH_MS = 24 * 3600e3;
  const cur = {};
  let migW = 0, evW = 0, freshUnresUpset = 0;
  for (const p of pulses || []) {
    if (!EMO_NEGATIVE.includes(p.emotion)) continue;   // 本批只表达冲突/迁移域负面（世界事件域未接线）
    const v = decayEmotionIntensity(p, now);
    cur[p.emotion] = (cur[p.emotion] || 0) + v;
    if (p.source === 'arc_migration') { migW += v; continue; }
    evW += v;
    // 🔴 E5①：新鲜(<24h)且【未决】的 upset = 尚未道歉的当次冲撞（"怒还在头上"·怒未退）。
    //   ——关键判据：区分"已道歉的残余怒"(unresolved=false·可 X_ANGERSAD) 与"新冲撞的活怒"(unresolved=true·须 U_HI)，
    //     堵住 repairing 窗内 sev-2 relapse 复现"他道了歉"（对抗复审补洞）。
    const atMs = typeof p.at === 'number' ? p.at : new Date(String(p.at).replace(' ', 'T')).getTime();
    if (p.emotion === 'upset' && p.unresolved && Number.isFinite(atMs) && now.getTime() - atMs < FRESH_MS) freshUnresUpset += v;
  }
  const upset = cur.upset || 0, sadness = cur.sadness || 0, annoyance = cur.annoyance || 0;
  const negTotal = upset + sadness + annoyance;
  if (negTotal < FLOOR) return '';   // 🔴 平静不宣布（零 hint·engine_calmed 同此）
  const migDominant = migW > evW;
  const rawAnger = freshUnresUpset >= FLOOR;   // 有未决新鲜怒火=冲突现场·怒尚未退（含 repairing 窗内的新冲撞）

  let text;
  // 🔴 E5①·U_HI 优先：存在未决新鲜高 upset（当次冲撞·怒未退·含 repairing 窗内的新 jab）→ 冲突现场原生表达（U_HI），
  //   绝不让"和好尾巴"叙事(X_ANGERSAD)描述一个刚发生、这一下没道歉的冲撞（E5 §1a 头号 bug + sev-2 relapse 补洞·方向 c）。
  if (rawAnger && band(upset) === 'hi' && negTotal >= FLOOR * 2) {
    text = arcEventType === 'taboo_hit' ? V.U_HI_taboo : arcEventType === 'pressure_spam' ? V.U_HI_pressure : V.U_HI_harsh;
  }
  // 🔴 E5①·怒退悲显（X_ANGERSAD*）叙事事件语境闸：仅【修复语境已发生 且 怒确已退 且 非迁移主导】
  //   (repaired && !rawAnger && !migDominant) 才可选——"怒已退"是时间过程(unresolved 已清/已衰)，
  //   同注冲突的瞬时比值(悲≥0.8×怒)出生即真，未道歉/新冲撞时选它=注入"他道了歉"虚假事实（E5 §1a）。
  else if (repaired && !rawAnger && !migDominant && upset >= FLOOR * 0.3 && sadness >= FLOOR * 0.3 && sadness >= upset * 0.8) {
    const tot = upset + sadness;
    text = tot >= 70 ? V.X_ANGERSAD_heavy : tot < 35 ? V.X_ANGERSAD_light : V.X_ANGERSAD;
  } else if (upset >= sadness && upset >= annoyance) {
    const b = band(upset);
    if (b === 'hi') text = arcEventType === 'taboo_hit' ? V.U_HI_taboo : arcEventType === 'pressure_spam' ? V.U_HI_pressure : V.U_HI_harsh;
    else if (b === 'mid') text = arcEventType === 'pressure_spam' ? V.U_MID_pressure : V.U_MID_conflict;
    // 🔴 E5①次生同族：U_LOW_repair「你们和好了」也是修复叙事·未修复/新冲撞不可选（E5 §1a·judge j2 0/4）
    else text = (repaired && !rawAnger && !migDominant) ? V.U_LOW_repair : V.U_LOW;
  } else if (sadness >= annoyance) {
    const b = band(sadness);
    if (b === 'hi') text = migDominant ? V.S_HI_migrate : V.S_HI_conflict;
    // ③ 非迁移低悲=marathon 元凶(1648)·轮换 S中低-2/S中低-1（皆低悲残余·场景无关）消同文本连打
    else text = migDominant ? V.S_LOW_migrate : _rotate(ROT_SLOW, companionId, now);
  } else {
    text = V.A_conflict;   // annoyance 主导（快层·嗔）
  }

  // 迁移主导且整体低烈度 → 平静底色覆盖（"早翻篇"·非冲突现场·③轮换 X迁-1/2）
  if (migDominant && negTotal < 25 && band(Math.max(upset, sadness)) === 'low') text = _rotate(ROT_MIGRATE, companionId, now);

  return HEAD + text + REDLINE_FOOTER;
}
