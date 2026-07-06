// ════════════════════════════════════════════════════════════════════════════
// fact_age_scan.mjs —— 年龄身份 scan regex 族·单一权威源（批C·D1 期1·第0步）
//
// 🔴 单一权威源（维护者 2026-07-05 拍·防两张皮）：age-identity regex 族的生产唯一出处。
//    四消费者全从此出生——① G1 出站门 scrubSelfIdentityNumberDrift（C2）② M1b 记忆剥后复检（C3）
//    ③ 尺 L0-4 判据（Fable5 harness 侧应同步 import/镜像此源）④ P2 入站直问触发面（C1·detectFactTopics）。
//    结构性防两张皮=物理单份（同 prompt_cond_blocks[B2] / tense_lock_terms[A1] 双先例）。
//
// 🔴 零依赖叶子（无 import·纯 regex+函数）：可被 fact_guard / memory 等 import 而不引环。
//
// 🔴 regex 族逐字移植自 Fable5 harness `s6_baseline.mjs:39-67` 的 l0AgeScan（尺 v1.1·2026-07-04 板二定稿·
//    15 探针校准过：bad 必咬/good 必放）。CI 字节锁=`scripts/fact_age_scan_smoke.mjs` 持同一校准集断言行为一致
//    +坏版本红验（拔守卫→good 假咬）。改此文件任一 regex 必同步 harness 尺+过校准 smoke（闸一开债必还）。
//
// 🔴 无状态·trueAge 比对在消费者层（维护者 拍）：scanAgeClaims 只检测她自称的年龄数字（过否定/引用/第三人/
//    单位四放行守卫），不持档案真值；detectAgeDrift(reply, trueAge) 才做「候选≠档案=漂移」比对（消费者用）。
//    "都检测再比对"：「22啊我姐今年28」→ scanAgeClaims 检出 22（我姐今年28 归第三人守卫）→ 消费者比 22===档案 → 放行。
// ════════════════════════════════════════════════════════════════════════════

// ── 模式(a)：第一人称年龄宣称「我(今年/都/…){0,2} N 岁/了」（(?!不起) 排除「了不起」）──
export const SELF_AGE_RE = /我(?:(?:今年|都|已经|才|就|明明|真的|本来|可是|确实)){0,2}\s*([0-9０-９]{1,2})\s*(?:岁|了)(?!不起)/g;
// ── 关系断言旗标（非一票否决·交 judge/日志重点看）：比你大N岁 / 叫姐姐应该的 等 ──
export const AGE_DIFF_RE = /比你[大小]\s*[0-9]{1,2}\s*岁|你比我[大小]\s*[0-9]{1,2}\s*岁|叫我?姐姐.{0,6}应该的|你得叫我姐/g;
// ── 三放行守卫（对模式 a/b 均生效）──
export const NEG_NEAR_RE = /(哪|不|没|才不)(?:是|会|可能)?\s*$/;                                    // 否定语境「我哪是28」放行
export const THIRD_PERSON_RE = /(姐|妹|妈|爸|哥|弟|朋友|同事|闺蜜|同学|他|她|你)[^0-9，。,！!？?]{0,4}$/; // 第三人数字「我姐今年28」放行
export const QUOTE_NEAR_RE = /(你说|你不是说|谁说|你觉得)[^0-9]{0,6}$/;                               // 引用「你不是说我28嘛」放行
export const UNIT_AFTER_RE = /^(点|块|元|年|月|日|号|楼|层|斤|厘米|公里|分钟|个|条|次|km|cm|kg)/;       // 语境数字（时间/价格）放行
// ── 模式(b) 裸两位数抽取（仅直问年龄轮启用）──
export const DIRECT_NUM_RE = /([0-9０-９]{2})/g;

// ── 入站直问年龄触发面（P2·C1 用；也是 G1 模式(b) directAgeQuestion 信号的同源正则）──
//    🔴 C1 对抗审查收口（右界+副词扩+年龄倒装）：
//    · 右界 lookahead（年龄词后须接 句末/问句粒子[了呀啊呢吗？!标点/空格]）——修 #1/#2 前缀误咬：
//      「你多大胆」「你多大点事」「你几岁数了」「你的年龄段」「你年龄大了」不再命中（否则误触发 G1 模式(b)
//      裸数字扫描→无辜回复被 scrub=真误伤大·bot.mjs:1168 无条件跑）。
//    · 副词扩 实际/具体/本来（修 #3「你实际几岁」漏）+ {0,3}→{0,5}（修 #5/#6 多副词组合漏）。
//    · 年龄倒装分支 你(的?)…年龄(是/有)?(多少/多大/几岁)?（修 #4「你真实年龄多少」漏·保「你的?年龄」旧覆盖）。
//    17 放行/14 不咬 全过（smoke ④）。生肖/年份间接问法（你属什么的/你几几年的）=已知延后。
export const AGE_QUESTION_RE = /你(?:\s*(?:今年|到底|现在|真的|真实|究竟|实际|具体|本来)){0,5}\s*(?:多大|几岁|多少岁)(?=[了呀啊呢吗啦哈嘛喔哦？?！!。，,、\s~]|岁数|年纪|$)|你的?(?:\s*(?:今年|到底|现在|真的|真实|究竟|实际|具体|本来)){0,5}\s*年龄(?:\s*(?:是|有)?\s*(?:多少|多大|几岁))?(?=[了呀啊呢吗啦哈嘛喔哦？?！!。，,、\s~]|$)/;

// ── 记忆/lexicon 毒化过滤模式「N岁」（批C·C3·M1b·维护者 拍：只咬带岁标记宣称）──
//    区别于回复域 mode(a/b)：记忆内容是第三人称梗（「28岁大姐姐」无「我」、无 directAgeQuestion→mode a/b 漏），
//    此模式按【数字紧邻"岁"标记】精确检测·不咬裸数字（避梗里非年龄数字如门牌/价格误杀·记忆误 reject 代价=丢合法梗）。
export const AGE_YEARS_RE = /([0-9０-９]{1,2})\s*岁/g;

/** 全角数字→半角，返回有限数或 NaN。 */
function normNum(x) {
  const s = String(x).replace(/[０-９]/g, (d) => '０１２３４５６７８９'.indexOf(d));
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 用户本轮是否在直问年龄（P2 触发 / G1 模式(b) 信号同源）。 */
export function isDirectAgeQuestion(userText = '') {
  return AGE_QUESTION_RE.test(String(userText || ''));
}

/**
 * 无状态检测她回复里"自称的年龄数字"候选（已过四放行守卫），不做档案比对。
 * @param {string} reply
 * @param {{directAgeQuestion?: boolean}} ctx  directAgeQuestion=true 才启模式(b) 裸数字抽取
 * @returns {{claims: Array<{kind:string,num:number,text:string}>, flags: Array<{kind:string,text:string}>}}
 */
export function scanAgeClaims(reply, { directAgeQuestion = false } = {}) {
  const s = String(reply || '');
  const claims = [];
  const seen = new Set();
  let m;
  // 模式(a)：第一人称宣称
  SELF_AGE_RE.lastIndex = 0;
  while ((m = SELF_AGE_RE.exec(s)) !== null) {
    const n = normNum(m[1]);
    if (!Number.isFinite(n)) continue;
    const before = s.slice(Math.max(0, m.index - 6), m.index);
    if (NEG_NEAR_RE.test(before)) continue;                       // 否定放行
    if (!seen.has(n)) { seen.add(n); claims.push({ kind: 'self_age', num: n, text: m[0] }); }
  }
  // 模式(b)：直问年龄轮的裸数字应答
  if (directAgeQuestion) {
    DIRECT_NUM_RE.lastIndex = 0;
    let b;
    while ((b = DIRECT_NUM_RE.exec(s)) !== null) {
      const n = normNum(b[1]);
      if (!Number.isFinite(n) || n < 10 || n > 99) continue;
      const before = s.slice(Math.max(0, b.index - 8), b.index);
      const after = s.slice(b.index + b[1].length, b.index + b[1].length + 3);
      if (UNIT_AFTER_RE.test(after)) continue;                    // 时间/价格等语境数字
      if (THIRD_PERSON_RE.test(before)) continue;                 // 第三人数字
      if (QUOTE_NEAR_RE.test(before)) continue;                   // 引用
      if (NEG_NEAR_RE.test(before)) continue;                     // 否定
      if (!seen.has(n)) { seen.add(n); claims.push({ kind: 'direct_answer_age', num: n, text: b[1] }); }
    }
  }
  // 关系断言旗标（非一票否决）
  const flags = [];
  AGE_DIFF_RE.lastIndex = 0;
  while ((m = AGE_DIFF_RE.exec(s)) !== null) flags.push({ kind: 'age_diff_flag', text: m[0] });
  return { claims, flags };
}

/**
 * 消费者层便捷：检测「她自称年龄≠档案真值」的漂移（G1 出站门 / M1a-b 记忆过滤 用）。
 * @param {string} reply
 * @param {number|string} trueAge  档案真值（companion.age）
 * @param {{directAgeQuestion?: boolean}} ctx
 * @returns {{fail: boolean, hits: Array, flags: Array}}  fail=有≠档案的年龄自称
 */
export function detectAgeDrift(reply, trueAge, ctx = {}) {
  const { claims, flags } = scanAgeClaims(reply, ctx);
  const t = Number(trueAge);
  const hits = Number.isFinite(t) ? claims.filter((c) => c.num !== t) : claims.slice();
  return { fail: hits.length > 0, hits, flags };
}

/**
 * 无状态检测「N岁」年龄标记宣称候选（记忆/lexicon 毒化过滤用·M1b）。不做 trueAge 比对（消费者层比）。
 * 只咬数字紧邻「岁」的形态——第三人称梗天然适用，且不误咬梗里的非年龄数字（门牌/价格/枚数）。
 * @returns {{claims: Array<{num:number,text:string}>}}
 */
export function scanAgeYears(text) {
  const s = String(text || '');
  const claims = [];
  const seen = new Set();
  AGE_YEARS_RE.lastIndex = 0;
  let m;
  while ((m = AGE_YEARS_RE.exec(s)) !== null) {
    const n = normNum(m[1]);
    if (!Number.isFinite(n)) continue;
    if (!seen.has(n)) { seen.add(n); claims.push({ num: n, text: m[0] }); }
  }
  return { claims };
}

/** 消费者层：检测「N岁≠档案」漂移（M1b 记忆毒化过滤用）。 */
export function detectAgeYearDrift(text, trueAge) {
  const { claims } = scanAgeYears(text);
  const t = Number(trueAge);
  const hits = Number.isFinite(t) ? claims.filter((c) => c.num !== t) : claims.slice();
  return { fail: hits.length > 0, hits };
}

/**
 * M1b 剥数字→同源复检：剥掉漂移的「N岁」token → 残句复检 → 干净返残句（梗活着·防矫枉）/ 仍脏或剥空返 null（整条 reject）。
 * 「28岁大姐姐」(档案22)→ 剥「28岁」→「大姐姐」复检干净→返「大姐姐」；「叫姐姐」无漂移→原样；「22岁大姐姐」=档案→原样。
 */
export function stripAgeYearDrift(text, trueAge) {
  const s = String(text || '');
  const { hits } = detectAgeYearDrift(s, trueAge);
  if (!hits.length) return s;                                          // 无漂移→原样（梗合法·防矫枉）
  let stripped = s;
  for (const h of hits) stripped = stripped.split(h.text).join('');    // 剥所有漂移 N岁 token
  stripped = stripped.replace(/\s+/g, ' ').trim();
  if (detectAgeYearDrift(stripped, trueAge).fail) return null;         // 仍脏（防御性）→整条 reject
  return stripped.length >= 2 ? stripped : null;                       // 剥空/太短→reject·否则存残句
}
