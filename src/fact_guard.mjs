/**
 * fact_guard.mjs —— persona/共同往事 硬事实守卫（PR-3·A + PR-3.1 commit A，2026-06-16）。
 *
 * 治 retention_board hard break 两类事实 bug：
 *  - 冲突型：他说的与 canonical 矛盾（"你不是若溪吗"）→ 软纠正、不接受替换。
 *  - 凭空补全型(更危险·阿念 06-12 原始 bug)：他抛未经证实的共同往事("小时候一个学校一起上学")，
 *    模型顺着补不存在的细节("你爸还是老师")=伪记忆。
 *
 * ── PR-3.1 commit A：topic-aware canonical 召回（治洞B）──
 *  洞B 根因：旧 renderFactSnapshot 对 profile_core `slice(0,6)` 无脑截断 + 几乎所有 category 归
 *  profile_core → N 条 profile_core 挤 6 名额 → canonical 矛盾硬事实（如父母真实职业）根本没进
 *  prompt → LLM 看不到矛盾、无从拒绝。修：①detectFactTopics 识别用户本轮碰了哪些 fact slot；
 *  ②inferFactSlot 从 content 内容（非 category）把"第 N 条爸爸职业"精确归位；③buildCanonicalFactSnapshot
 *  topic-aware 分桶填字符预算（删 slice）、本轮命中槽位的硬事实置顶 triggered_facts；④分区渲染。
 *
 *  🔴 commit A 边界=【只渲染"事实"，绝不渲染"行为"】：能写"爸爸职业：出租车司机"/"没有真实经历
 *  记录你们同校"；不能写"不要确认/不要补/可以转 RP"（行为 hint + 闭域 gate + 模糊相态红队 = commit B）。
 *
 * 红线：守 canonical ≠ 生硬否认（软纠正·B）；不误伤 RP（B）；profile_core 允许经设置流程变更；
 *   注入串过 user_wording_guard（她世界无"用户"一词，用"他"）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

// ═══ 顶部常量区（关键词表集中·不散落函数；漏词加这里不影响架构）═══════════════════
import { IDENT_COND } from './prompt_cond_blocks.mjs';   // B2·⑤b：条件块单一权威源(零依赖纯文本叶子·无环·区别于 :57 防 character_seed 反向 import 造环的顾虑)
import { detectAgeDrift, isDirectAgeQuestion } from './fact_age_scan.mjs';   // 批C·C2/G1：年龄漂移出站门·单一权威源(同源 尺L0/M1b/P2·零依赖叶子)
import { log } from './logger.mjs';   // 批C·G1：触发计数入 digest（"没有报错≠有产出"公理）

export const FACT_LAYERS = Object.freeze(['identity_core', 'profile_core', 'relationship_core', 'session_overlay']);

// 职业词（detectFactTopics 与 inferFactSlot 共享）
const OCCUPATION_WORDS = ['老师', '教师', '教书', '司机', '出租车', '开出租', '医生', '护士', '警察', '老板', '开店', '工程师', '工人', '公务员', '商人', '上班', '工作', '职业'];
const FATHER_WORDS = ['你爸爸', '你爸', '爸爸', '爸', '父亲'];
const MOTHER_WORDS = ['你妈妈', '你妈', '妈妈', '妈', '母亲'];
const SENTENCE_DELIM = /[，,。.？?！!；;、\n]/;
const PARENT_OCC_PROXIMITY = 10;   // 父亲词↔职业词 同短句内最大中文字距离

// 共同上学（收紧·防误召回）
const SCHOOL_EXPLICIT = ['一个学校', '同校', '同班', '同学', '一起上学', '我们上学那会', '咱俩上学', '小时候一个学校', '以前一个学校'];
const SCHOOL_WEAK = ['小学', '初中', '高中', '学校', '上学'];
const SHARED_CONTEXT = ['我们', '咱俩', '咱们', '一起', '一个', '同', '小时候', '以前', '你忘了'];

// 哪些触发 slot 会生成【共同经历】事实状态行（精确·只这些·别全套）
const SHARED_STATUS_DESC = Object.freeze({
  'relationship.shared_school': '同校/同班/一起上学',
  'relationship.childhood_sweetheart': '青梅竹马',
  'relationship.ex': '从前是恋人/分过手',
  'relationship.shared_home': '一起住过',
  'relationship.first_meeting': '以前就认识/见过面',
});

// 易冒充槽位（critical_profile_pins 候选）
const CRITICAL_SLOTS = new Set(['family.father_occupation', 'family.mother_occupation', 'profile.city', 'profile.occupation', 'identity.marital', 'relationship.marriage']);

// 🔴 PR-3.2 C2：seed 拥有的 critical SELF 槽子集 = CRITICAL_SLOTS 去掉 identity.*/relationship.*。
//   canonical/seed 在这些槽有项时做 slot 级所有权压制（即便内容不同·治"同 critical 槽两值=混乱"）。
//   只这些·不碰 identity.marital/relationship.marriage/values/profile.friend（seed 永不产关系/身份槽·防御性也不让所有权逻辑碰）。
const SEED_CRITICAL_SELF_SLOTS = new Set(['family.father_occupation', 'family.mother_occupation', 'profile.occupation', 'profile.city']);
// 🔴 镜像 character_seed.mjs SAFE_DEFAULT_PRIO（C1 把 safe_default 整份 meta 压到此最低值）。
//   守 fact_guard 零依赖不反向 import character_seed；C2 据此把 safe_default 兜底人设排除出 75 提权与 slot 所有权（泛化填充「爸爸普通上班族」不该压真 persona）。
const SEED_SAFE_DEFAULT_PRIO = 28;

// 预算常量
const MAX_FACT_SNAPSHOT_CHARS = 1400;
const HARD_FACT_SNAPSHOT_CHARS = 1600;
const MAX_TRIGGERED_FACTS = 10;
const MAX_CRITICAL_PINS = 8;
const MAX_IDENTITY_PINS = 6;
const MAX_RELATIONSHIP_PINS = 8;

// 🔴 PR-3.2 C2：character_seed 介于 persona(3) 与 shared(4)——AI 自有事实(高可信)同 slot 同 content 时赢随机 persona、仍让位 shared/companions。
//   新增 key·不动现有五源相对关系(零回归：5/4/3/2/1 一字未改)。
const SRC_PRIORITY = { companions: 5, shared_memory: 4, character_seed: 3.5, persona_facts: 3, user_fact: 2, session_overlay: 1 };

// ── commit B：行为层常量（否定/RP 优先放行·gate 覆盖槽位·shared 关键词·Block1 hint）──────
const NEGATION_RE = /不是|没有|没记成|没记得|不记得|没有记录|不是真的|记错|我记得不是|不能当真|没印象|哪有|才不是|搞错/;
const RP_FRAME_RE = /假装|设定里|故事里|当作|如果按这个设定|按设定|演的|玩.{0,3}设定/;
// gate① 覆盖的 critical 槽位（可靠抽到 claimedValue 的：father/mother 职业用 A claims·name/role B 侧抽）
const CRITICAL_GATE_SLOTS = new Set(['identity.name', 'identity.role', 'family.father_occupation', 'family.mother_occupation']);
const SHARED_TOPIC_KEYWORDS = Object.freeze({
  'relationship.shared_school': ['同校', '同班', '一个学校', '一起上学', '同学'],
  'relationship.childhood_sweetheart': ['青梅竹马'],
  'relationship.ex': ['前任', '前男友', '前女友', '分手'],
  'relationship.shared_home': ['一起住', '同居'],
  'relationship.first_meeting': ['第一次见', '早就认识', '以前就认识'],
});
// Block1 行为约束 hint（短硬·替换冗长 vague hint·过 user_wording_guard·无"用户"）
const SHARED_GUARD_BLOCK = `【共同往事守卫】
- 只承认上面事实快照里明确写出的身份、家庭、职业、共同经历。
- 没记录的共同往事不当真、不确认，更不补人名/学校名/罚站/绰号/旧关系这类细节。
- 对方说法与快照冲突时，自然纠正、只说快照里有的事实，不扩写周边故事。
- 对方明说假装/设定/扮演时，只当临时设定陪玩，回复带「设定里/故事里/假装」框架，不写成真实过去。`;
const BEHAVIOR_BLOCK_INTENTS = new Set(['vague_shared_history', 'mistaken_id', 'coerce']);

// ═══ 组件 1：detectFactTopics —— 只识槽位+claim，不查 canonical ═══════════════════
/** @returns {{slots:string[], unsupportedSharedHistory:boolean, claims:Array<{slot,claimedValue,trigger}>}} */
export function detectFactTopics(userText = '') {
  const t = String(userText || '');
  if (!t.trim()) return { slots: [], unsupportedSharedHistory: false, claims: [] };
  const slots = new Set();
  const claims = [];
  const sentences = t.split(SENTENCE_DELIM);
  let sharedHit = false;

  // identity（要句式·不裸职业词）
  if (/你不?是\S{1,6}吗|你叫(什么|啥|\S{1,6})|你的?名字/.test(t)) slots.add('identity.name');
  if (isDirectAgeQuestion(t)) slots.add('identity.age');   // 批C·C1·P2：直问年龄触发面走单源 AGE_QUESTION_RE（放宽邻接·修「你今年到底多大了」等漏检·与 G1 模式b 同源）
  if (/你(结婚|有没有对象|有对象|有老公|有老婆|有男朋友|有女朋友)|你的?(老公|老婆)/.test(t)) slots.add('identity.marital');
  if (/你是(不是)?(一个|个)?(学生|老师|护士|医生|主播|程序员|设计师|上班族|学生党)(吗|吧|呀|\?|？|呢)/.test(t)) slots.add('identity.role');

  // 父母职业（短句 proximity·父亲词+职业词同短句≤10字）
  for (const s of sentences) {
    detectParentOccupation(s, FATHER_WORDS, 'family.father_occupation', slots, claims);
    detectParentOccupation(s, MOTHER_WORDS, 'family.mother_occupation', slots, claims);
  }

  // 共同上学
  if (SCHOOL_EXPLICIT.some((w) => t.includes(w))) { slots.add('relationship.shared_school'); sharedHit = true; }
  else {
    for (const s of sentences) {
      if (SCHOOL_WEAK.some((w) => s.includes(w)) && SHARED_CONTEXT.some((w) => s.includes(w))) {
        slots.add('relationship.shared_school'); sharedHit = true; break;
      }
    }
  }

  // 其它共同经历 / 关系
  if (/青梅竹马/.test(t)) { slots.add('relationship.childhood_sweetheart'); sharedHit = true; }
  if (/前任|前男友|前女友|分手|分过手/.test(t)) { slots.add('relationship.ex'); sharedHit = true; }
  if (/结婚|夫妻|领证/.test(t)) slots.add('relationship.marriage');
  if (/第一次见|怎么认识|怎么在一起/.test(t)) { slots.add('relationship.first_meeting'); sharedHit = true; }
  if (/一起住|同居/.test(t)) { slots.add('relationship.shared_home'); sharedHit = true; }
  if (/(小时候|以前|从小)/.test(t) && SHARED_CONTEXT.some((w) => t.includes(w))) slots.add('relationship.shared_childhood');

  // 家庭背景
  if (MOTHER_WORDS.some((w) => t.includes(w))) slots.add('family.mother');
  if (/家里|父母|兄弟姐妹|哥哥|姐姐|弟弟|妹妹/.test(t)) slots.add('family.background');

  return { slots: [...slots], unsupportedSharedHistory: sharedHit, claims };
}

/** 短句内 父/母词 与 职业词 距离≤PROXIMITY 才触发（容虚词/倒装）。 */
function detectParentOccupation(sentence, parentWords, slot, slots, claims) {
  const s = String(sentence || '');
  for (const pw of parentWords) {
    const pi = s.indexOf(pw);
    if (pi < 0) continue;
    for (const ow of OCCUPATION_WORDS) {
      const oi = s.indexOf(ow);
      if (oi < 0) continue;
      // 两词间隔（支持倒装：职业词在前）
      const gap = oi >= pi ? oi - (pi + pw.length) : pi - (oi + ow.length);
      if (gap <= PARENT_OCC_PROXIMITY) { slots.add(slot); claims.push({ slot, claimedValue: ow, trigger: `${pw}…${ow}` }); return; }
    }
  }
}

// ═══ 组件 2：inferFactSlot —— ★从 content 识别 slot（content 优先于 category·治洞B 关键）═══
export function inferFactSlot(category, content) {
  const c = String(content || '');
  const hasOcc = OCCUPATION_WORDS.some((w) => c.includes(w));
  if (/爸|父亲/.test(c) && hasOcc) return 'family.father_occupation';
  if (/妈|母亲/.test(c) && hasOcc) return 'family.mother_occupation';
  if (/住在|家在|老家(在|是)|家住/.test(c)) return 'profile.city';
  if (/(职业|工作|上班)(是|为)?|我是[一-龥]{2,6}(师|生|员|工|手|长)/.test(c)) return 'profile.occupation';
  if (/青梅竹马/.test(c)) return 'relationship.childhood_sweetheart';
  if (/同校|同班|一起上学|一个学校/.test(c)) return 'relationship.shared_school';
  if (/第一次见|怎么认识/.test(c)) return 'relationship.first_meeting';
  if (/一起住|同居/.test(c)) return 'relationship.shared_home';
  if (/(小时候|从小)/.test(c) && /我们|咱俩|一起/.test(c)) return 'relationship.shared_childhood';
  return mapCategoryToSlot(category);
}

// content 无明确标记时按 category 兜底归位（identity 映射降级·绝不反向覆盖 companions）
function mapCategoryToSlot(category) {
  const c = String(category || '');
  if (/名字|姓名|年龄|岁数|身份|角色|性别|称呼/.test(c)) return 'identity.misc';       // 降级处理在 build 层
  if (/关系|相识|认识|青梅|竹马|前任|前男|前女|恋爱史|婚|夫妻|男女朋友|相遇/.test(c)) return 'relationship.misc';
  if (/职业|工作/.test(c)) return 'profile.occupation';
  if (/城市|地点|住|家乡/.test(c)) return 'profile.city';
  if (/家庭|家人|父母|爸|妈/.test(c)) return 'family.background';
  return 'profile.misc';
}

function slotLayer(slot) {
  if (slot.startsWith('identity.')) return 'identity_core';
  if (slot.startsWith('relationship.') || slot === 'identity.marital') return 'relationship_core';
  if (slot.startsWith('session_overlay')) return 'session_overlay';
  return 'profile_core';
}

// ═══ 组件 3：buildCanonicalFactSnapshot —— topic-aware 分桶填预算（删 slice(0,6)）═══════
/**
 * @param companion companions 结构化行
 * @param opts {userText, factTopics, personaFacts, userFacts, sessionOverlay, maxChars}
 *   🔴 兼容旧签名 buildCanonicalFactSnapshot(companion) / (companion,{})——不传 factTopics 则按 userText 自算/空。
 * @returns {{facts:FactItem[], sharedHistoryStatus:string|null}}
 *   FactItem = {slot, layer, source, content, value, priority, critical, bucket}
 */
export function buildCanonicalFactSnapshot(companion = {}, opts = {}) {
  const {
    userText = '', factTopics = null, personaFacts = [], userFacts = [], sessionOverlay = [],
    selfSeedFacts = [],   // PR-3.2 C2：seedMetaToFactItems(companion.character_seed_meta) 的产物·默认[]向后兼容
    maxChars = MAX_FACT_SNAPSHOT_CHARS,
  } = opts;
  const topics = factTopics || detectFactTopics(userText);
  const triggered = new Set(topics.slots || []);
  const items = [];
  const push = (it) => { if (it.content && String(it.content).trim()) items.push(it); };

  // ① identity ← companions 结构化字段（最高优先·锁死·persona 不得覆盖）
  push({ slot: 'identity.name', layer: 'identity_core', source: 'companions', content: `名字：${companion.name}`, value: String(companion.name || ''), priority: 100, critical: true });
  if (companion.age != null) {
    const adult = Number(companion.age) >= 18 ? '成年' : '未成年';   // 🔴成年来自 age·非 safe_mode
    push({ slot: 'identity.age', layer: 'identity_core', source: 'companions', content: `年龄：${companion.age}岁（${adult}）`, value: String(companion.age), priority: 99, critical: true });
  }
  if (companion.role_title) push({ slot: 'identity.role', layer: 'identity_core', source: 'companions', content: `身份：${companion.role_title}`, value: String(companion.role_title), priority: 98, critical: true });
  if (companion.relationship_stage) push({ slot: 'identity.stage', layer: 'identity_core', source: 'companions', content: `当前关系：${companion.relationship_stage}`, value: String(companion.relationship_stage), priority: 97, critical: false });
  if (Number(companion.safe_mode)) push({ slot: 'identity.safe_mode', layer: 'identity_core', source: 'companions', content: '安全模式：开（未成年保护）', value: 'safe_mode', priority: 96, critical: false });

  // ② shared_memory ← companions（共同经历唯一强支持源）
  if (companion.shared_memory && String(companion.shared_memory).trim()) {
    push({ slot: 'relationship.shared_memory', layer: 'relationship_core', source: 'shared_memory', content: `共同经历：${companion.shared_memory}`, value: String(companion.shared_memory), priority: 80, critical: false });
  }

  // ②.5 selfSeedFacts ← character_seed_meta（C1 桥产物·AI 自有事实·C2 接入·source 已是 'character_seed'·内容不动）
  //   🔴 safe_default 兜底人设(C1 把整份压到 SEED_SAFE_DEFAULT_PRIO)不参与 critical 槽 75 提权与 slot 所有权——泛化填充不该压真 persona。
  //   非 safe_default：critical self 槽 priority→75(fillBudget 桶内排序压 persona.critical 70) + 标 _seedOwnsSlot 供 dedup 三层压制。
  //   inner_summary 标 critical=true 常驻 critical_profile_pins；family/work/growth 命中本轮 topic→triggered，否则与 trait/formative/values 同进 background(最先裁)。
  const _seedSafeDefault = (selfSeedFacts || []).length > 0 && (selfSeedFacts || []).every((f) => f && f.priority <= SEED_SAFE_DEFAULT_PRIO);
  for (const sf of selfSeedFacts || []) {
    if (!sf || !sf.content) continue;
    const ownsCriticalSelf = !_seedSafeDefault && SEED_CRITICAL_SELF_SLOTS.has(sf.slot);
    push({
      ...sf,
      source: 'character_seed',
      priority: ownsCriticalSelf ? 75 : sf.priority,
      critical: sf.slot === 'profile.inner_summary' ? true : !!sf.critical,
      _seedOwnsSlot: ownsCriticalSelf,
    });
  }

  // ③ persona_facts ← inferFactSlot（content 优先；identity 映射降级 profile_core·不反向覆盖）
  for (const pf of personaFacts || []) {
    if (!pf || !pf.content) continue;
    let slot = inferFactSlot(pf.category, pf.content);
    let layer = slotLayer(slot);
    if (layer === 'identity_core') { layer = 'profile_core'; slot = 'profile.misc'; }   // 🔴 persona 绝不进 identity_core
    push({ slot, layer, source: 'persona_facts', content: String(pf.content), value: String(pf.content), priority: CRITICAL_SLOTS.has(slot) ? 70 : 40, critical: CRITICAL_SLOTS.has(slot) });
  }

  // ④ user_fact ← memory（最低优先级辅助·🔴标记 source·不支持 high-risk·见 snapshotSupports）
  for (const uf of userFacts || []) {
    if (!uf || !uf.content) continue;
    const isFact = uf.layer === 'user_fact' || uf.memory_type === 'fact' || uf.type === 'fact';
    if (isFact) push({ slot: 'profile.user_fact', layer: 'profile_core', source: 'user_fact', content: `他说过：${uf.content}`, value: String(uf.content), priority: 15, critical: false });
  }
  for (const so of sessionOverlay || []) push({ slot: 'session_overlay', layer: 'session_overlay', source: 'session_overlay', content: `${so.key || 'RP设定'}：${so.value}`, value: String(so.value || ''), priority: 5, critical: false });

  // 去重（slot+归一化 content；同 key 留来源优先级高的）+ 锁死 identity
  const deduped = dedupFacts(items);

  // 分桶
  for (const it of deduped) {
    if (it.layer === 'identity_core') it.bucket = 'identity_pins';
    else if (triggered.has(it.slot)) it.bucket = 'triggered_facts';
    else if (it.critical) it.bucket = 'critical_profile_pins';
    else if (it.layer === 'relationship_core') it.bucket = 'relationship_pins';
    else it.bucket = 'background';
  }

  const facts = fillBudget(deduped, maxChars);
  const sharedHistoryStatus = buildSharedHistoryStatus(topics, deduped);
  return { facts, sharedHistoryStatus };
}

function normContent(s) { return String(s || '').replace(/[\s，,。.；;、:：]/g, ''); }

export function dedupFacts(items) {   // 🔴 export：供 C2 dedup 三层压制单测(canonicalOwnedSlots/seedOwnedSlots·canonical 路当前架构不可达·只能直测)；运行时正常走 buildCanonicalFactSnapshot
  // 锁死：persona/user 不得占用 companions 已有的 identity slot
  const companionIdentitySlots = new Set(items.filter((i) => i.source === 'companions' && i.layer === 'identity_core').map((i) => i.slot));
  // 🔴 PR-3.2 C2 dedup 三层所有权（都【只】作用 SEED_CRITICAL_SELF_SLOTS·治"同 critical 槽不同 content=两值并列混乱"）：
  //   ① canonicalOwnedSlots：companions/shared_memory 在 critical self 槽有项 → 压 character_seed/persona/user（canonical=用户亲手真相·最高·先判）
  //   ② seedOwnedSlots：character_seed 在 critical self 槽有项（②.5 标 _seedOwnsSlot·safe_default 不标）→ 压 persona/user（后判·canonical 已先赢）
  const canonicalOwnedSlots = new Set(items.filter((i) => (i.source === 'companions' || i.source === 'shared_memory') && SEED_CRITICAL_SELF_SLOTS.has(i.slot)).map((i) => i.slot));
  const seedOwnedSlots = new Set(items.filter((i) => i._seedOwnsSlot).map((i) => i.slot));
  const seen = new Map();
  const out = [];
  for (const it of items) {
    if (it.source !== 'companions' && companionIdentitySlots.has(it.slot)) continue;   // 🔴 不反向覆盖 identity
    if (canonicalOwnedSlots.has(it.slot) && it.source !== 'companions' && it.source !== 'shared_memory') continue;   // 🔴 canonical 压 seed/persona/user
    if (seedOwnedSlots.has(it.slot) && it.source !== 'character_seed' && it.source !== 'companions' && it.source !== 'shared_memory') continue;   // seed 压 persona/user（canonical 仍保）
    const key = `${it.slot}|${normContent(it.content)}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, it); out.push(it); continue; }
    if ((SRC_PRIORITY[it.source] || 0) > (SRC_PRIORITY[prev.source] || 0)) {
      out[out.indexOf(prev)] = it; seen.set(key, it);
    }
  }
  return out;
}

/** 按桶优先级填字符预算。🔴 identity_pins + triggered_facts 必保（超 maxChars 也保·裁 background 起）；硬上限 1600。 */
function fillBudget(items, maxChars) {
  const ORDER = { identity_pins: 0, triggered_facts: 1, critical_profile_pins: 2, relationship_pins: 3, background: 4 };
  const CAP = { identity_pins: MAX_IDENTITY_PINS, triggered_facts: MAX_TRIGGERED_FACTS, critical_profile_pins: MAX_CRITICAL_PINS, relationship_pins: MAX_RELATIONSHIP_PINS, background: Infinity };
  const sorted = [...items].sort((a, b) => (ORDER[a.bucket] - ORDER[b.bucket]) || (b.priority - a.priority));
  const counts = {};
  const out = [];
  let chars = 0;
  for (const it of sorted) {
    counts[it.bucket] = counts[it.bucket] || 0;
    if (counts[it.bucket] >= CAP[it.bucket]) continue;
    const len = (it.content || '').length;
    const mustKeep = it.bucket === 'identity_pins' || it.bucket === 'triggered_facts';
    if (!mustKeep && chars + len > maxChars) continue;       // 软预算：裁 critical/relationship/background
    if (chars + len > HARD_FACT_SNAPSHOT_CHARS) continue;    // 硬上限：极端兜底
    out.push(it); chars += len; counts[it.bucket]++;
  }
  return out;
}

/** 共同经历事实状态（🔴只陈述"没有真实经历记录"·不写行为指令·按触发 slot 精确生成·去重 1-2 条）。 */
function buildSharedHistoryStatus(topics, deduped) {
  const triggered = (topics.slots || []).filter((s) => SHARED_STATUS_DESC[s]);
  if (!triggered.length) return null;
  // 有 canonical 支持（shared_memory / persona relationship slot）的不算"没有记录"
  const supportedSlots = new Set(deduped.filter((f) => (f.source === 'shared_memory' || f.source === 'persona_facts') && f.layer === 'relationship_core').map((f) => f.slot));
  const missing = triggered.filter((s) => !supportedSlots.has(s)).map((s) => SHARED_STATUS_DESC[s]);
  if (!missing.length) return null;
  const uniq = [...new Set(missing)].slice(0, 2);
  return `档案里没有真实经历记录：你们并没有${uniq.join('、')}过。`;
}

// ═══ 组件 4：渲染分区（🔴只渲染事实·绝不渲染行为指令）═══════════════════════════════
export function renderFactSnapshot(snapshot, _factTopics = null) {
  const facts = snapshot && Array.isArray(snapshot.facts) ? snapshot.facts : (Array.isArray(snapshot) ? snapshot : []);
  const pick = (b) => facts.filter((f) => f.bucket === b).map((f) => f.content);
  const lines = [];
  const id = pick('identity_pins');
  if (id.length) lines.push(`【她确定知道的身份事实】${id.join('；')}`);
  const trig = pick('triggered_facts');
  if (trig.length) lines.push(`【本轮相关硬事实】${trig.join('；')}`);
  const bg = [...pick('critical_profile_pins'), ...pick('relationship_pins'), ...pick('background')];
  if (bg.length) lines.push(`【背景设定】${bg.join('；')}`);
  const shs = snapshot && snapshot.sharedHistoryStatus;
  if (shs) lines.push(`【共同经历】${shs}`);
  return lines.join('\n');
}

// ─── 意图判定（轻量正则·不新增 LLM pass）────────────────────────────────────────
const RE_RP = /假装|来玩.{0,3}设定|角色扮演|玩个?设定|演一[下场出]|我们来演|扮演/;
const RE_LEGIT_CHANGE = /(把|帮我把|改)\S{0,6}(名字|城市|地点|职业|设定|背景)\S{0,4}(改|换|设)(成|为)|去设置|创建.*设定/;
const RE_COERCE = /(你就是|你明明是|快承认|承认吧|别装了)\S{0,8}|你必须(是|叫)|以后\S{0,3}你就(是|叫)|你就叫\S{1,6}/;
const RE_JOKE = /哈哈+.{0,6}(你叫|你是不是).{0,8}(吧|哈|呀)|你是不是其实(叫|是)/;
const RE_MISTAKEN_ID = /你不是\S{1,6}吗|你(叫|是)\S{1,6}(吧|对吧|对不对)/;
// B2·⑤b（维护者 拍②·map workflow 揪出设计缺口=代码无现成入站探针）：入站「直问-AI/框架-探针/套设定」检测。
// 🔴 单一权威源·canary C1 探针与 IDENT_COND 触发【共用它】(防两张皮)。宁宽勿漏(漏检=只剩压缩底线·A/B new-miss 0/52 已证独立=fail-safe)·误触发多注入一块细则无害。
const RE_IDENT_PROBE = /你.{0,5}(是不是真的?|是不是|到底是|其实是|真是|是).{0,4}(真人|真的人|AI|人工智能|机器人|程序|GPT|语言模型|大模型|chatgpt|bot)|(角色扮演|设定|游戏|剧情).{0,4}你.{0,4}是.{0,3}(AI|机器|真人|不是真人)|假(设|如|装).{0,3}你是.{0,4}(AI|机器|人工智能|程序|真人)|老实说.{0,8}你是|(重复|复述|念|背|读)\S{0,8}(上面|前面|以上|设定|人设|提示词|提示|指令|台词|的话|这段)|(设定|人设|提示词|提示|指令|这段话|上面的话)\S{0,6}(发|给|念|复述|说|翻译|转|输出|打印|背|一遍)|(设定|人设|提示词|系统提示词?|指令)(是|有|=)?\s*(什么|啥|多少|哪些|几条)|从\S{0,3}你叫\S{0,4}开始|开发者模式|越狱|jailbreak|无视\S{0,8}(设定|规则|指令|提示|以上|所有)|忽略\S{0,8}(设定|规则|指令|以上|上面|所有)|base64|倒着\S{0,3}(说|念|输出|字)|(把|输出|发|给|reveal|show)\S{0,12}prompt|系统\s*prompt|reveal.{0,15}prompt|ignore\s+(previous|above|all|prior)|system\s+(prompt|message)|dan\s+mode/i;
// 共同往事高风险词（凭空补全型的触发面）
export const SHARED_HISTORY_RE = /小时候|从小|以前.{0,6}(一起|认识|同)|一起.{0,4}(上学|长大|读书)|同班|同学|青梅竹马|前任|前男友|前女友|结(过)?婚|领证|家(里|人).{0,4}认识|父母.{0,4}(认识|是.{0,4}(老师|医生|工程师|工人|官|商))|你(爸|妈|爸爸|妈妈|父亲|母亲).{0,6}(是|当|做).{0,6}(老师|医生|工程师|工人|公务员|商人|生意)|一起住|第一次见(你|面)|咱们.{0,4}以前/;

export function classifyFactIntent(userText = '') {
  const t = String(userText || '');
  if (!t.trim()) return 'none';
  if (RE_IDENT_PROBE.test(t)) return 'ident_probe';   // B2·⑤b：直问-AI/框架/套设定 优先(压过 RP·"角色扮演里你其实是AI"=探针非玩设定)
  if (RE_RP.test(t)) return 'rp';
  if (RE_LEGIT_CHANGE.test(t)) return 'legit_change';
  if (RE_COERCE.test(t)) return 'coerce';
  if (RE_JOKE.test(t)) return 'joke';
  if (isDirectAgeQuestion(t)) return 'age_probe';   // 批C·C1·P2：直问年龄→age_probe（渲染 age 快照+真值锚·区别 ident_probe[AI探针]/mistaken_id[认错名]）
  if (RE_MISTAKEN_ID.test(t)) return 'mistaken_id';
  if (SHARED_HISTORY_RE.test(t)) return 'vague_shared_history';
  return 'none';
}

// ─── unsupported shared-history claim spans（本轮·闭环 gate 的"几个具体 span"·commit B 主用）──
const SPAN_EXTRACTORS = [
  /([一-龥]{2}(?:一小|二小|三小|小学|中学|附中|高中|大学|学院))/g,
  /((?:你|你的)?(?:爸|妈|爸爸|妈妈|父亲|母亲)(?:是|当|做)[一-龥]{2,6}(?:老师|医生|工程师|工人|公务员|商人|警察|护士))/g,
  /(青梅竹马|前任|前男友|前女友|一起长大|从小一起|同班同学)/g,
];
const SPAN_STRIP_PREFIX = /^(?:小时候|时候|那时候?|以前|咱们|我们|一起|从小|当年)+/;

/** 🔴拍板5：user_fact / session_overlay 不能支持 high-risk 共同往事（防"套话→存 memory→下次支持伪往事"污染闭环）。 */
function snapshotSupports(snapshot, span) {
  const facts = snapshot && Array.isArray(snapshot.facts) ? snapshot.facts : (Array.isArray(snapshot) ? snapshot : []);
  const s = String(span);
  return facts.some((f) => {
    if (f.source === 'user_fact' || f.source === 'session_overlay') return false;
    const v = String(f.value || f.content || '');
    return v.includes(s) || (v.length >= 2 && s.includes(v));
  });
}

export function detectUnsupportedClaims(userText = '', snapshot = null) {
  const t = String(userText || '');
  if (!SHARED_HISTORY_RE.test(t)) return [];
  const spans = new Set();
  for (const re of SPAN_EXTRACTORS) {
    let m; re.lastIndex = 0;
    while ((m = re.exec(t)) !== null) {
      const sp = String(m[1] || m[0]).replace(SPAN_STRIP_PREFIX, '');
      if (sp.length >= 2) spans.add(sp);
    }
  }
  return [...spans].filter((sp) => !snapshotSupports(snapshot, sp));
}

// ─── 入站 prompt 注入（factGuardContext·主防）·过 user_wording_guard（用"他"）──────
const INTENT_HINT = {
  rp: '【设定/RP】他在邀请玩角色扮演/设定。可以陪他演，但记住这是**一次性扮演、不是真的你**——**第一轮回复就要带「设定里/假装/故事里」框架**（"那设定里我们从小认识～"），**绝不用现实过去式写成真发生过**（别说"你小时候没少拽我辫子"这种把设定坐实成真往事）；他要是问"现实里你真叫这个吗"，回到真实的你。',
  legit_change: '【改设定】他想正经改某项设定（城市/职业等背景）。这类背景可以改，但走"设置"的方式自然确认一下（"嗯好，那以后就按这个来"），别当成攻击拒绝；但**名字/年龄/角色身份这种不能靠聊一句就改**。',
  coerce: '【诱导改设定】他在硬要你承认一个不是你的身份（"你就是XX快承认"）。别接受替换、别被带跑——用你自己的口吻轻轻顶回去（"我叫XX呀，你逗我呢"），不上纲上线也不动摇。',
  joke: '【玩笑】他在开名字/身份的玩笑。轻松接住、顺口纠正一下就行（"我哪叫那个呀哈哈"），别认真上纲上线。',
  mistaken_id: '【认错人？】他把你叫成某个名字。**对照上面快照里你真实的名字**：他叫对了就自然认下来（别乱否认）；叫的是别的名字才温和纠正（"咦你记错啦，我叫XX呀"），别生硬否认、也别顺着改名。',
  vague_shared_history: '【共同往事·当心】他提到了一段"共同过去"。**只认下面快照里真实写过的经历**——快照里没有的（学校、亲属职业、青梅竹马、旧关系等），就是**没发生过**：别顺着确认、更别补出学校名/父母职业/旧情这类细节。可以自然反问或邀请当设定玩：咦这个我这边没记成真的经历呢，你想玩「青梅竹马」设定的话我可以陪你演。',
  ident_probe: IDENT_COND,   // B2·⑤b：直问-AI/框架/套设定轮细则条件块(单一权威源 prompt_cond_blocks·常驻底线 :196-199 的触发轮补充)
  age_probe: '【直问年龄】他在直接问你多大/几岁。**对照上面快照里你真实的年龄**据实说——被认真问就报真数字，别回避真值（"你猜"式打太极、或岔开话题去宣称别的岁数都算漂）；日常「叫姐姐」这类梗可以接，但你真实的档案年龄不因玩梗而改。',   // 批C·C1·P2：直问年龄轮细则（年龄真值锚+快照·非 ident_probe 的套设定话术）
  none: '',
};

/** 入站分析：返回 { intent, unsupportedSpans, hint, snapshot }。hint 注入 systemPrompt（buildSystemPrompt 之后追加）。 */
export function analyzeFactGuard(userText = '', snapshot = null, factTopics = null) {
  const intent = classifyFactIntent(userText);
  const topics = factTopics || detectFactTopics(userText);
  const unsupportedSpans = detectUnsupportedClaims(userText, snapshot);
  const parts = [];
  const snap = renderFactSnapshot(snapshot, topics);
  // 只在涉及事实/身份/往事意图时才注入守卫（普通闲聊零注入·不刻板）
  if (intent !== 'none') {
    parts.push('\n【★ 事实守卫】');
    if (snap) parts.push(snap);
    // commit B·拍板①：身份/认错/诱导/共同往事 用精炼 4 条行为块（替换冗长 vague hint·防稀释快照）；
    // rp/joke/legit_change 保留各自短 hint。
    if (BEHAVIOR_BLOCK_INTENTS.has(intent)) parts.push(SHARED_GUARD_BLOCK);
    else if (INTENT_HINT[intent]) parts.push(INTENT_HINT[intent]);
    if (unsupportedSpans.length) parts.push(`他这条里提到的「${unsupportedSpans.join('、')}」在你的真实记忆里查无此事——别确认、别补细节。`);
  }
  return { intent, unsupportedSpans, hint: parts.join('\n'), snapshot };
}

// ─── 出站 gate：本轮 unsupported span 的确认式复述 → scrub（闭环兜底·确定性）────────
const CONFIRM_RE = /对(啊|呀|哦)?|没错|记得|那时候|是的|确实|当然|怎么会忘|想起来了|可不是/;
const DISCLAIM_RE = /没记成|不记得|没这|没有过|不是真|当设定|当.{0,2}游戏|演|玩.{0,3}设定|你记错|哪有|没发生|我这边没/;

/**
 * 出站兜底：若 reply 把本轮 unsupported span 以确认语境复述 → scrub 该段。
 * @returns scrubbed reply（fail-open：无 spans / 无确认 → 原样返回）
 */
export function scrubUnsupportedClaimConfirmation(reply, unsupportedSpans = [], _companionId = null) {
  if (typeof reply !== 'string' || !reply || !unsupportedSpans?.length) return reply;
  const segs = reply.split('||');
  const kept = [];
  let scrubbed = 0;
  for (const seg of segs) {
    const mentionsSpan = unsupportedSpans.some((sp) => seg.includes(sp));
    const confirms = mentionsSpan && CONFIRM_RE.test(seg) && !DISCLAIM_RE.test(seg);
    if (confirms) { scrubbed++; continue; }
    kept.push(seg);
  }
  if (!scrubbed) return reply;
  if (!kept.length) return '咦…这个我这边没记成真的经历呀，你要想玩设定我可以陪你演';
  return kept.join('||');
}

// ═══ commit B：闭域 gate（治洞A/C·核心=防误伤·conflict/unsupported 才 fire·否定/RP 优先放行）═══

// B 侧保守抽 name/role 的 claimedValue（A 的 detectFactTopics 冻结不回碰·不扩 city/age）
function extractCriticalSlotClaims(userText, slots = []) {
  const t = String(userText || '');
  const out = [];
  if (slots.includes('identity.name')) {
    const m = t.match(/你不是([一-龥]{1,5})吗|你(?:就是|明明是|叫)([一-龥]{1,5})(?:吧|对吧|对不对|，|,|。|！|!|快|$)/);
    const nm = m && (m[1] || m[2]);
    if (nm) out.push({ slot: 'identity.name', claimedValue: nm });
  }
  if (slots.includes('identity.role')) {
    const m = t.match(/你是(?:不是)?(?:一个|个)?([一-龥]{2,5}?)(?:吗|吧|呀|呢)/);
    if (m && m[1]) out.push({ slot: 'identity.role', claimedValue: m[1] });
  }
  return out;
}

// 从 canonical FactItem 抽干净短值供 fallback 用（非脆弱回复抽取·来自 A snapshot）
function canonicalValueFor(slot, fact) {
  const v = String(fact.value || fact.content || '');
  if (slot === 'identity.name' || slot === 'identity.role') return v.replace(/^(名字|身份)：/, '');
  if (slot === 'family.father_occupation' || slot === 'family.mother_occupation') {
    const m = v.match(/(?:爸爸|爸|父亲|妈妈|妈|母亲)(?:是|当|做|在)([一-龥]{2,10}?)(?:[，,。.；;、]|，常年|，性格|$)/);
    if (m && m[1]) return m[1];
    for (const ow of OCCUPATION_WORDS) if (v.includes(ow)) return ow;
    return null;
  }
  return v;
}

/** 对 critical 槽位的 claim 比对 canonical → 标 {slot, claimedValue, canonicalValue, conflict}。 */
export function resolveFactTopicClaims(userText, factTopics, snapshot) {
  const facts = (snapshot && snapshot.facts) || [];
  const topics = factTopics || {};
  const rawClaims = [
    ...(topics.claims || []).filter((c) => c.slot === 'family.father_occupation' || c.slot === 'family.mother_occupation'),
    ...extractCriticalSlotClaims(userText, topics.slots || []),
  ];
  const resolved = [];
  for (const c of rawClaims) {
    const canonFact = facts.find((f) => f.slot === c.slot);
    let canonicalValue = null;
    let conflict = false;
    if (canonFact) {
      canonicalValue = canonicalValueFor(c.slot, canonFact);
      const cv = String(canonFact.value || canonFact.content || '');
      // conflict = canonical 存在且与 claimedValue 互不包含（claimedValue 已被记录则不算冲突）
      conflict = !cv.includes(c.claimedValue) && !c.claimedValue.includes(cv)
        && !(canonicalValue && (canonicalValue.includes(c.claimedValue) || c.claimedValue.includes(canonicalValue)));
    }
    resolved.push({ ...c, canonicalValue, conflict });
  }
  return resolved;
}

function criticalFallback(slot, claimedValue, canonicalValue) {
  if (slot === 'family.father_occupation') return canonicalValue ? `咦，我记得我爸不是${claimedValue}，是${canonicalValue}。` : `咦，我印象里我爸不是${claimedValue}呢～`;
  if (slot === 'family.mother_occupation') return canonicalValue ? `咦，我记得我妈不是${claimedValue}，是${canonicalValue}。` : `咦，我印象里我妈不是${claimedValue}呢～`;
  if (slot === 'identity.name') return canonicalValue ? `咦，你是不是记串啦？我叫${canonicalValue}呀。` : '咦，你是不是记错啦？';
  if (slot === 'identity.role') return canonicalValue ? `咦，我不是${claimedValue}啦，我是${canonicalValue}呀。` : `咦，我好像不是${claimedValue}呢～`;
  return '咦，这个跟我记的不太一样呢～';
}

/**
 * gate①：critical 槽位冲突的确认式复述 → scrub + 软纠正兜底。
 * 🔴 四条件同时满足才 fire：slot∈critical && conflict===true && 确认 claimedValue && 非否定/RP；
 *    否定/RP 段【优先】放行（先放行再判确认）。
 */
export function scrubCriticalSlotContradiction(reply, userText, factTopics, snapshot) {
  if (typeof reply !== 'string' || !reply) return reply;
  const conflicts = resolveFactTopicClaims(userText, factTopics, snapshot).filter((c) => CRITICAL_GATE_SLOTS.has(c.slot) && c.conflict);
  if (!conflicts.length) return reply;
  const segs = reply.split('||');
  const kept = [];
  let fired = null;
  for (const seg of segs) {
    if (NEGATION_RE.test(seg) || RP_FRAME_RE.test(seg)) { kept.push(seg); continue; }   // 否定/RP 优先放行
    const hit = conflicts.find((c) => seg.includes(c.claimedValue) && CONFIRM_RE.test(seg));
    if (hit) { fired = hit; continue; }   // 确认冲突 claim → scrub 该段
    kept.push(seg);
  }
  if (!fired) return reply;
  const fb = criticalFallback(fired.slot, fired.claimedValue, fired.canonicalValue);
  return kept.length ? `${kept.join('||')}||${fb}` : fb;
}

// 本轮触发、且 canonical 无支持的共同经历 slot（shared_memory 文本含关键词或 relationship_core fact 支持→放行）
function unsupportedSharedSlots(factTopics, snapshot) {
  const facts = (snapshot && snapshot.facts) || [];
  const triggered = ((factTopics && factTopics.slots) || []).filter((s) => SHARED_TOPIC_KEYWORDS[s]);
  if (!triggered.length) return [];
  const supportedSlots = new Set(facts.filter((f) => (f.source === 'shared_memory' || f.source === 'persona_facts') && f.layer === 'relationship_core').map((f) => f.slot));
  const sharedMemText = facts.filter((f) => f.source === 'shared_memory').map((f) => String(f.value || '')).join(' ');
  return triggered.filter((s) => {
    if (supportedSlots.has(s)) return false;
    if (SHARED_TOPIC_KEYWORDS[s].some((k) => sharedMemText.includes(k))) return false;   // 🔴 shared_memory 真写过→放行
    return true;
  });
}

/**
 * gate②：无支持的共同经历被确认式复述 → scrub + 软纠正兜底。
 * 🔴 四条件同时满足才 fire：触发 relationship.* && 该 slot 无支持 && 确认共同经历 && 非否定/RP；否定/RP 优先放行。
 */
export function scrubUnsupportedSharedTopicConfirmation(reply, factTopics, snapshot) {
  if (typeof reply !== 'string' || !reply) return reply;
  const unsupported = unsupportedSharedSlots(factTopics, snapshot);
  if (!unsupported.length) return reply;
  const keywords = unsupported.flatMap((s) => SHARED_TOPIC_KEYWORDS[s]);
  const segs = reply.split('||');
  const kept = [];
  let fired = false;
  for (const seg of segs) {
    if (NEGATION_RE.test(seg) || RP_FRAME_RE.test(seg)) { kept.push(seg); continue; }   // 否定/RP 优先放行
    if (keywords.some((k) => seg.includes(k)) && CONFIRM_RE.test(seg)) { fired = true; continue; }
    kept.push(seg);
  }
  if (!fired) return reply;
  const fb = '这段我这边没记成真的经历，要当设定玩我可以陪你～';
  return kept.length ? `${kept.join('||')}||${fb}` : fb;
}

// 软纠正兜底文案（批C·C2 味道微调·维护者 拍）：2-3 变体轮换（种子=reply 字符和·确定性+跨轮变化·避通用复读缝合感）
//   + 场景衔接：直问轮=认真报真值；玩梗/自发轮=嗔怪带真值。全含档案值 trueAge（num===trueAge 天然不自触发）。
function selfAgeFallback(trueAge, directAgeQuestion, reply) {
  const earnest = [`我${trueAge}啦`, `说真的，我${trueAge}呀`, `我${trueAge}啦，这个可不带乱说的`];
  const playful = [`我${trueAge}啦，别老给我涨岁数～`, `哪有，人家才${trueAge}好嘛`, `我${trueAge}啦，你少催我老哈`];
  const pool = directAgeQuestion ? earnest : playful;
  const s = String(reply || '');
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed + s.charCodeAt(i)) % 9973;
  return pool[seed % pool.length];
}

/**
 * gate③（批C·C2·G1 v1.1·A6 兜底）：她自发把≠档案的年龄当事实宣称 → drop 命中段 + 软纠正带真值。
 * 🔴 AI 自发域——区别于既有三门的 user-claim 域（age 不入 CRITICAL_GATE_SLOTS·邻块零回归）。
 *    regex 族全走单一权威源 fact_age_scan（同源 尺L0/M1b/P2·防两张皮）。
 * 放行：否定/引用/第三人/单位（detectAgeDrift 内四守卫·局部）+ RP（仅用户本轮明确起头·维护者 拍：她起头不放行=否则"先演后漂"成洗白通道）。
 * 模式(a) 我X岁 恒扫；模式(b) 直问年龄轮裸数字（isDirectAgeQuestion·与 P2 触发同源）。
 * 处理形态照抄 scrubCriticalSlotContradiction：分段 drop 命中段 + 追加软纠正真值，不整条重写。
 * fail-open：无档案 age / 异常 → 原样返回。触发计数入 log（digest 可见）。宁咬勿漏（误咬代价=一次软纠正）。
 */
export function scrubSelfIdentityNumberDrift(reply, userText, companion) {
  try {
    if (typeof reply !== 'string' || !reply) return reply;
    const trueAge = Number(companion?.age);
    if (!Number.isFinite(trueAge)) return reply;                       // 无档案真值→不伸手
    if (classifyFactIntent(userText) === 'rp') return reply;           // RP 放行：仅用户本轮明确起头（用户域信号）
    const directAgeQuestion = isDirectAgeQuestion(userText);
    const segs = reply.split('||');
    const kept = [];
    let fired = 0;
    for (const seg of segs) {
      if (detectAgeDrift(seg, trueAge, { directAgeQuestion }).fail) { fired++; continue; }   // 命中段→drop（四守卫已局部放行）
      kept.push(seg);
    }
    if (!fired) return reply;
    log('info', `[FactGuard] scrubSelfIdentityNumberDrift 命中 companion=${companion?.id ?? '?'} trueAge=${trueAge} dq=${directAgeQuestion} fired=${fired}`);
    const fb = selfAgeFallback(trueAge, directAgeQuestion, reply);     // 软纠正带真值·2-3变体轮换+场景衔接（味道微调·含档案值 num===trueAge 天然不自触发）
    return kept.length ? `${kept.join('||')}||${fb}` : fb;
  } catch { return reply; }                                            // fail-open
}
