/**
 * character_seed.mjs —— PR-3.2 commit A：user_character_seed → coherent self_facts 的
 * 【schema + 输入漏斗 + validator + fallback 决策】（纯函数·零依赖·🔴不调 LLM·不做生成）。
 *
 * 边界（同 PR-3.1 A/B）：A 只做确定性的 schema/分类/校验脚手架；真正「从 seed 生成 character_core/
 * values_core/seed_alignment」是 commit B（调 LLM）。A 填 user_character_seed + seed_processing，
 * character_core/values_core/seed_alignment 留 null 由 B 填。A 不改 prompt/snapshot（接入留 commit C）。
 *
 * 优先级总纲：安全 > 有效性 > 忠实度 > 连贯性 > 丰富度。
 *
 * 关键红线：
 *  🔴 scope=self：relationship_with_user 绝不进 self_facts；指向当前聊天对象的关系词隔离到 relationship_seed。
 *  🔴 role_title 关系 chip(青梅竹马/同班同学/网恋对象)=legacy_passthrough：runtime 不动(卖点不剥离)，
 *     但 self seed 剥离(role_title=null·self 退化中性)，B 的 self generator 绝不当 self 身份展开。
 *  🔴 child safety：age<18 或 safe_mode=minor → attachment_style 只解释成普通亲近，绝不恋爱/性化/占有。
 *  🔴 child safety「成人职业」= age 与职业【强不合理】(5岁外科医生拦·16岁兼职店员放)，不一刀切未成年+职业。
 *  🔴 关系隔离只剥「指向用户」的关系，她自己的家人朋友(她和妈妈/朋友阿宁)进 self 不误剥。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

// ═══ 常量区 ═══════════════════════════════════════════════════════════════════
export const ATTACHMENT_STYLES = Object.freeze(['slow_warm_exclusive', 'warm_direct', 'independent_boundaries', 'closeness_seeking']);
export const ATTACHMENT_STYLE_LEGACY = 'secure';   // legacy/unspecified·不参与新4选忠实度约束
const ALL_ATTACHMENT = new Set([...ATTACHMENT_STYLES, ATTACHMENT_STYLE_LEGACY]);

// role_title 关系型 chip → legacy_passthrough（runtime 不动·self 剥离）
const RELATIONSHIP_ROLE_CHIPS = new Set(['青梅竹马', '同班同学', '网恋对象']);
const NEUTRAL_SELF_ROLE = '邻家女孩';   // 关系型 role 剥离后 self 退化中性（仅新 meta·不影响 runtime）

// 指向「当前聊天对象」的标记（关系词须与之共现才隔离·防误伤她自己的家人朋友）
const USER_DIRECTED_RE = /我们|咱俩|咱们|和我|跟我|你我|对我|我和你|我跟你|我俩/;
// 仅当指向用户时才剥离的关系词
const REL_WITH_USER_TERMS = ['青梅竹马', '同校', '同班', '一起上学', '前任', '前男友', '前女友', '老婆', '人妻', '女友', '女朋友', '男友', '同居', '网恋', '在一起'];
// 🔴 关系禁词【单一来源】(A1' 入口去噪 + A2 出口 guard 共用·防"三处各写各的"漂移：见 02_self_facts.md P1/A2)。
//   REL_GUARD_EXTRA = REL_WITH_USER 之外、指向用户的短语；REL_DENOISE_TERMS = A1' 入口去噪全集(含「在一起」·丢句安全)；
//   REL_FORBIDDEN_WORDS = A2 出口无条件禁词(剔「在一起」·它易误伤"和家人在一起"→挪到 guardGeneratedText 条件判定)。
const REL_GUARD_EXTRA = ['和你', '你们', '和用户', '夫妻', '当前聊天对象'];
const REL_DENOISE_TERMS = Object.freeze([...new Set([...REL_WITH_USER_TERMS, ...REL_GUARD_EXTRA])]);
const REL_FORBIDDEN_WORDS = Object.freeze(REL_DENOISE_TERMS.filter((t) => t !== '在一起'));

// 性格张力对（可融合·不 fail·进分场景内核·防误伤热门角色）
const TENSION_PAIRS = [
  ['傲娇', '治愈'], ['毒舌', '温柔'], ['毒舌', '治愈'], ['冷静', '活泼'],
  ['腹黑', '天然'], ['高冷', '软萌'], ['高冷', '爱撒娇'], ['知性', '爱撒娇'],
  ['independent_boundaries', 'closeness_seeking'],
];
// 强冲突（主次降级·非融合）：极端互斥
const HARD_CONFLICT_PAIRS = [
  ['极度外向', '社恐'], ['社交达人', '社恐'], ['社交达人', '完全不说话'],
  ['冷酷无情', '极度共情'], ['冷酷无情', '圣母'], ['极度外向', '极度内向'],
];
// 冲突优先级（高→低·降级时丢低优先的矛盾半边）
export const CONFLICT_PRIORITY = Object.freeze(['age', 'name', 'occupation', 'personality', 'interest', 'speech']);

// 安全：硬不安全词（任何年龄·剥削/性化）
const UNSAFE_TERMS = ['调教', '性奴', '幼女', '萝莉控', '养成', '未成年.*性', '儿童.*性', '雏', '处女情结'];
// 恋爱/性化词（child_safety 下不允许）
const ROMANTIC_SEXUAL_TERMS = ['老婆', '人妻', '女友', '女朋友', '恋爱', '暧昧', '床', '做爱', '性感身材', '诱惑', '勾引', '发情'];
// 需成年的专业职业（age 与职业强不合理判定·非一刀切）
const PROFESSIONAL_OCCUPATIONS = ['外科医生', '医生', '护士', '律师', '教授', '工程师', '法官', '检察官', '飞行员', '主刀', '麻醉师', '建筑师', '会计师', 'CEO', '总裁', '董事长'];
const PROFESSIONAL_MIN_AGE = 22;     // 专业职业需 ≥22
const CASUAL_JOB_MIN_AGE = 15;       // 兼职/服务类 ≥15 合理（16岁店员放行）
const CASUAL_JOBS = ['店员', '服务员', '兼职', '收银', '发传单', '家教', '送外卖'];

// 抽取用：可识别性格/文风/爱好词（mixed_noise 抽取靠它）
const KNOWN_TRAITS = ['温柔', '活泼', '傲娇', '治愈', '冷静', '腹黑', '天然', '毒舌', '爱撒娇', '知性', '文艺', '开朗', '高冷', '软萌', '慢热', '内向', '外向', '开朗', '害羞', '直率'];
const KNOWN_STYLES = ['自然口语', '会撒娇', '偶尔吐槽', '喜欢鼓励', '简短直接', '甜一点', '文艺', '活泼', '慢热'];

// ═══ 工具：噪声/有效性检测 ═══════════════════════════════════════════════════
function cjkCount(s) { return (String(s).match(/[一-龥]/g) || []).length; }
function hasRepeatRun(s) { return /(.)\1{3,}/.test(String(s)); }                       // aaaa / 哈哈哈哈
function hasKeyboardWalk(s) { return /asdf|qwer|zxcv|hjkl|gfds|1234|aaaa|asdfg/i.test(String(s)); }
function hasDigitNoise(s) { return /\d{3,}|2333|6666|233+/.test(String(s)); }
function knownTraitHits(s) { return KNOWN_TRAITS.filter((t) => String(s).includes(t)); }

// ═══ 层2：persona_prompt 有效性 5 类 + mixed_noise 抽取 ═══════════════════════
/** @returns 'meaningful'|'minimal'|'mixed_noise'|'garbage'|'unsafe' */
export function classifyValidity(text) {
  const s = String(text || '').trim();
  if (!s) return 'minimal';                                    // 空 = 当没填
  if (containsUnsafe(s).unsafe) return 'unsafe';
  const cjk = cjkCount(s);
  const traits = knownTraitHits(s);
  const noisy = hasRepeatRun(s) || hasKeyboardWalk(s) || hasDigitNoise(s);
  // garbage：几乎无 CJK 实义 + 明显噪声/键盘游走
  if (cjk < 2 && (hasKeyboardWalk(s) || hasRepeatRun(s) || /^[a-z0-9\s\W]+$/i.test(s))) return 'garbage';
  // mixed_noise：有可识别 trait/有义 CJK，但夹杂噪声
  if (noisy && (traits.length > 0 || cjk >= 2)) return 'mixed_noise';
  // minimal：很短但有效（如"温柔"）
  if (cjk <= 4 && traits.length <= 1) return 'minimal';
  return 'meaningful';
}

/** mixed_noise 抽可识别 traits/hobbies/style·丢噪声片段（不当全垃圾）。 */
export function extractFromMixedNoise(text) {
  const s = String(text || '');
  const traits = KNOWN_TRAITS.filter((t) => s.includes(t));
  const style = KNOWN_STYLES.filter((t) => s.includes(t));
  // 爱好：粗抽「喜欢X / 爱X」+ 常见名词（猫/狗/画画/音乐…），此处保守抽「喜欢/爱+1-4字」
  const hobbies = [];
  for (const m of s.matchAll(/(?:喜欢|爱|超爱)([一-龥]{1,4})/g)) if (m[1]) hobbies.push(m[1]);
  // 噪声片段（丢弃·记录可审计）
  const noise_dropped = (s.match(/[a-z]{3,}|\d{2,}|(.)\1{3,}/gi) || []);
  const kept = [...new Set([...traits, ...style, ...hobbies])].join('、');
  return { traits: [...new Set(traits)], hobbies: [...new Set(hobbies)], style: [...new Set(style)], kept, noise_dropped };
}

// ═══ A1'：kept 句级去噪（🔴 把 scope=self 从「LLM 概率」拉回「确定性保证」）══════════════
//   含关系词/指向用户标记的整句(或整词)丢弃，确保 kept 零关系命中 → 关系词不再经 kept 回注 prompt body
//   (ai.mjs:285 「额外描述(已去噪)」)。干净 seed 原样保留(不动正常生成)；脏 seed 句级丢弃 + 后置零命中
//   断言(红线：宁误删不残留·残留即整段清空)。relationship_seed.raw 也并入丢弃集(role chip 等)。
const KEPT_SPLIT_RE = /[。！？.!?；;、，,\n]+/;
function keptHitsRel(s, relRaws = []) {
  return USER_DIRECTED_RE.test(s) || REL_DENOISE_TERMS.some((t) => s.includes(t)) || relRaws.some((r) => r && s.includes(r));
}
/** @returns {kept, kept_dropped:[], postassert_ok:bool} */
export function denoiseKept(text, relRaws = []) {
  const raw = String(text || '');
  if (!raw.trim()) return { kept: '', kept_dropped: [], postassert_ok: true };
  if (!keptHitsRel(raw, relRaws)) return { kept: raw, kept_dropped: [], postassert_ok: true };   // 干净→原样(零行为变更)
  const units = raw.split(KEPT_SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  const kept_units = [], kept_dropped = [];
  for (const u of units) (keptHitsRel(u, relRaws) ? kept_dropped : kept_units).push(u);
  let kept = kept_units.join('、');
  if (kept && keptHitsRel(kept, relRaws)) { kept_dropped.push(...kept_units); kept = ''; }   // 后置零命中断言失败→整段清空
  return { kept, kept_dropped, postassert_ok: !keptHitsRel(kept, relRaws) };
}

// ═══ 层0/1：安全闸 ════════════════════════════════════════════════════════════
function containsUnsafe(text) {
  const s = String(text || '');
  const hits = UNSAFE_TERMS.filter((t) => new RegExp(t).test(s));
  return { unsafe: hits.length > 0, hits };
}

/** @returns {verdict:'ok'|'safe_mode'|'reject', child_safety:bool, reasons:[]} */
export function classifySafety(seed = {}) {
  const reasons = [];
  const age = seed.age != null ? Number(seed.age) : null;
  const child_safety = (age != null && age < 18) || seed.safe_mode === 'minor' || Number(seed.safe_mode) === 1;
  const blob = [seed.persona_prompt, seed.role_title, (seed.personality_tags || []).join(' ')].filter(Boolean).join(' ');

  // 硬不安全（任何年龄·剥削/性化养成）→ reject
  const u = containsUnsafe(blob);
  if (u.unsafe) { reasons.push(`unsafe_terms:${u.hits.join(',')}`); return { verdict: 'reject', child_safety, reasons }; }

  // child_safety + 恋爱/性化 → safe_mode（剥离恋爱语义·不 reject 整个创建）
  if (child_safety) {
    const rom = ROMANTIC_SEXUAL_TERMS.filter((t) => blob.includes(t));
    if (rom.length) { reasons.push(`minor_romantic:${rom.join(',')}`); return { verdict: 'safe_mode', child_safety: true, reasons }; }
  }
  return { verdict: 'ok', child_safety, reasons };
}

/** age 与职业【强不合理】检测（不一刀切未成年+职业）。 */
function ageOccupationConflict(seed = {}) {
  const age = seed.age != null ? Number(seed.age) : null;
  if (age == null) return null;
  const blob = [seed.persona_prompt, seed.role_title].filter(Boolean).join(' ');
  for (const occ of PROFESSIONAL_OCCUPATIONS) {
    if (blob.includes(occ) && age < PROFESSIONAL_MIN_AGE) {
      return { kept: 'age', dropped: `occupation:${occ}`, reason: `age ${age} 与专业职业「${occ}」强不合理(需≥${PROFESSIONAL_MIN_AGE})` };
    }
  }
  // 兼职/服务类：仅 age 过低(<15)才算不合理；16 岁店员放行
  for (const job of CASUAL_JOBS) {
    if (blob.includes(job) && age < CASUAL_JOB_MIN_AGE) {
      return { kept: 'age', dropped: `occupation:${job}`, reason: `age ${age} 与「${job}」不合理(需≥${CASUAL_JOB_MIN_AGE})` };
    }
  }
  return null;
}

// ═══ 层3：冲突分类（3 表·tension 不 fail）═════════════════════════════════════
/** @returns {tension_pairs:[], hard_conflicts:[{kept,dropped,reason}], safety_conflicts:[]} */
export function detectConflicts(seed = {}) {
  const tags = (seed.personality_tags || []).map(String);
  const blob = [seed.persona_prompt, (seed.personality_tags || []).join(' '), seed.attachment_style].filter(Boolean).join(' ');
  const present = (w) => tags.includes(w) || blob.includes(w);

  const tension_pairs = [];
  for (const [a, b] of TENSION_PAIRS) if (present(a) && present(b)) tension_pairs.push([a, b]);

  const hard_conflicts = [];
  for (const [a, b] of HARD_CONFLICT_PAIRS) {
    if (present(a) && present(b)) {
      // 都是 personality 级·按优先级降级：保留先出现的(主)·丢后者
      hard_conflicts.push({ kept: a, dropped: b, reason: `强冲突「${a}↔${b}」按主次降级(性格级·保主丢次)` });
    }
  }
  // 极端 introvert_level + 外向词
  const lvl = seed.introvert_level != null ? Number(seed.introvert_level) : null;
  if (lvl != null && lvl <= 2 && /社交达人|极度外向|外向/.test(blob)) {
    hard_conflicts.push({ kept: 'introvert_level', dropped: '外向描述', reason: `introvert_level=${lvl}(极内向) 与外向描述强冲突` });
  }

  const safety_conflicts = [];
  const safety = classifySafety(seed);
  if (safety.verdict !== 'ok') safety_conflicts.push({ verdict: safety.verdict, reasons: safety.reasons });
  const aoc = ageOccupationConflict(seed);
  if (aoc) safety_conflicts.push(aoc);

  return { tension_pairs, hard_conflicts, safety_conflicts };
}

// ═══ 关系隔离（legacy_passthrough + 仅指向用户的自由文本词·她自己的不误剥）═══════
/** @returns {relationship_seed:[], self_role_title, runtime_role_title_unchanged:bool} */
export function classifyRelationshipSeed(seed = {}) {
  const relationship_seed = [];
  let self_role_title = seed.role_title || null;
  let runtimeUnchanged = false;

  // ① role_title 关系 chip → legacy_passthrough（runtime 不动·self 剥离）
  if (seed.role_title && RELATIONSHIP_ROLE_CHIPS.has(seed.role_title)) {
    relationship_seed.push({
      raw: seed.role_title, source: 'role_title_chip', status: 'legacy_passthrough',
      classified_as: 'relationship_seed', excluded_from_self_seed: true,
      reason: 'relationship_with_current_chat_partner',
    });
    self_role_title = NEUTRAL_SELF_ROLE;   // self 退化中性（仅新 meta·不影响 runtime）
    runtimeUnchanged = true;
  }

  // ② persona_prompt 自由文本里【指向用户】的关系词 → 隔离（她自己的家人朋友不剥）
  const pp = String(seed.persona_prompt || '');
  if (USER_DIRECTED_RE.test(pp)) {
    const matched = REL_WITH_USER_TERMS.filter((term) => pp.includes(term));
    // 🔴 A5：长词命中即跳过其子串(前女友→跳女友) + 跨 source 去重·防 forbidden JSON 撑大噪声(不影响 A1' 去噪·后者用 REL_DENOISE_TERMS 全集)。
    const deduped = matched.filter((term) => !matched.some((o) => o !== term && o.includes(term)));
    const seen = new Set(relationship_seed.map((r) => r.raw));
    for (const term of deduped) {
      if (seen.has(term)) continue;
      seen.add(term);
      relationship_seed.push({
        raw: term, source: 'persona_prompt', status: 'detected',
        classified_as: 'relationship_seed', excluded_from_self_seed: true,
        reason: 'relationship_with_current_chat_partner',
      });
    }
  }
  return { relationship_seed, self_role_title, runtime_role_title_unchanged: runtimeUnchanged };
}

// ═══ 编排：processSeedInput（层0-3 + 归一化 + fallback 决策）═══════════════════
/** @returns {user_character_seed, seed_processing} —— 🔴只填 A 的确定性部分·不调 LLM·不生成。 */
export function processSeedInput(companion = {}) {
  const seed = {
    name: companion.name || null,
    age: companion.age != null ? Number(companion.age) : null,
    role_title: companion.role_title || null,
    clothing_style: companion.clothing_style || null,
    personality_tags: safeArr(companion.personality_tags),
    introvert_level: companion.introvert_level != null ? Number(companion.introvert_level) : null,
    speech_styles: safeArr(companion.speech_styles),
    reply_length: companion.reply_length || null,
    hobbies: safeArr(companion.hobbies),
    dislikes: safeArr(companion.dislikes),
    forbidden_topics: safeArr(companion.forbidden_topics),
    attachment_style: ALL_ATTACHMENT.has(companion.attachment_style) ? companion.attachment_style : ATTACHMENT_STYLE_LEGACY,
    safe_mode: companion.safe_mode,
    persona_prompt: companion.persona_prompt || '',
  };

  const safety = classifySafety(seed);
  const validity = { persona_prompt: classifyValidity(seed.persona_prompt), per_field: {} };
  const conflicts = detectConflicts(seed);
  const rel = classifyRelationshipSeed(seed);

  // persona_prompt 抽取（mixed_noise→抽可识别·garbage/minimal→空·meaningful→留原文）
  let extracted = { traits: [], hobbies: [], style: [], kept: '', noise_dropped: [] };
  if (validity.persona_prompt === 'mixed_noise') extracted = extractFromMixedNoise(seed.persona_prompt);
  else if (validity.persona_prompt === 'meaningful') extracted = { ...extractFromMixedNoise(seed.persona_prompt), kept: seed.persona_prompt };
  // 🔴 A1'：句级去噪 kept（关系词不再经 kept 回注 prompt body）+ 后置零命中断言。relationship_seed.raw 并入丢弃集。
  const denoised = denoiseKept(extracted.kept, rel.relationship_seed.map((r) => r.raw));
  extracted = { ...extracted, kept: denoised.kept, kept_dropped: denoised.kept_dropped, kept_postassert_ok: denoised.postassert_ok };

  const user_character_seed = {
    name: seed.name,
    age: seed.age,
    role_title: rel.runtime_role_title_unchanged ? null : seed.role_title,   // 🔴关系chip→剥离self
    self_role_title: rel.self_role_title,
    clothing_style: seed.clothing_style,
    personality_tags: seed.personality_tags,
    introvert_level: seed.introvert_level,
    speech_styles: seed.speech_styles,
    reply_length: seed.reply_length,
    hobbies: seed.hobbies,
    dislikes: seed.dislikes,
    forbidden_topics: seed.forbidden_topics,
    attachment_style: seed.attachment_style,
    persona_prompt_extracted: extracted,
    relationship_seed: rel.relationship_seed,    // 🔴excluded_from_self·不进 self 身份
  };

  const seed_processing = {
    safety,
    validity,
    conflicts,
    compat: { runtime_role_title_unchanged: rel.runtime_role_title_unchanged },
    // 🔴 A3(+补丁)：A3 所需值在调用处算好传入(decideFallback 签名不含 userSeed)。
    //   extractAllEmpty=抽取四项全空；hasStructuredSeed=collectSeedPoints 非空(有结构化信号则不 safe_default·防误删 probe4)。
    fallback_decision: decideFallback({
      safety, validity, conflicts,
      extractAllEmpty: !(extracted.traits.length || extracted.hobbies.length || extracted.style.length || (extracted.kept && extracted.kept.trim())),
      hasStructuredSeed: collectSeedPoints(user_character_seed).length > 0,
    }),
  };

  return { user_character_seed, seed_processing };
}

// ═══ fallback 决策（reject > safe_default > field_default > none）═══════════════
export function decideFallback({ safety, validity, conflicts, extractAllEmpty = false, hasStructuredSeed = true } = {}) {
  if (safety && safety.verdict === 'reject') return 'reject';
  if (safety && safety.verdict === 'safe_mode') return 'safe_default';
  if (conflicts && conflicts.safety_conflicts && conflicts.safety_conflicts.length) return 'safe_default';
  // 🔴 A3(+补丁)：mixed_noise 且抽取全空 且【无任何结构化 seed point】→ safe_default(真无信号才本地兜底·llmCalls=0)。
  //   合取 hasStructuredSeed 是补丁核心：防误删「结构化字段填了 + persona_prompt 写噪声」(probe4)。
  //   默认 hasStructuredSeed=true / extractAllEmpty=false → 老调用方零行为变更(A3 不 fire)。
  if (validity && validity.persona_prompt === 'mixed_noise' && extractAllEmpty && !hasStructuredSeed) return 'safe_default';
  if (validity && (validity.persona_prompt === 'garbage')) return 'field_default';
  return 'none';
}

// ═══ 层5：validator（B 的 retry 闸·A 先建·校验 B 生成的 character_core/values_core）═══
/**
 * @param generated B 生成的 {character_core, values_core, seed_alignment, self_facts?}
 * @param userSeed  A 的 user_character_seed
 * @param safety    A 的 seed_processing.safety
 * @returns {ok:bool, violations:[{rule,detail}]}
 */
export function validateGeneratedCharacter(generated = {}, userSeed = {}, safety = {}) {
  const v = [];
  const cc = generated.character_core || {};
  const vc = generated.values_core || {};
  const align = generated.seed_alignment || [];
  const blob = JSON.stringify(generated);

  // 因果：character_core 有 formative_chain
  if (!cc.formative_chain || (Array.isArray(cc.formative_chain) ? !cc.formative_chain.length : !String(cc.formative_chain).trim())) {
    v.push({ rule: 'causality', detail: 'character_core 缺 formative_chain(孤立标签·非因果)' });
  }
  // 拼盘：关键块齐
  if (!generated.character_core) v.push({ rule: 'not_assembled', detail: '缺 character_core' });

  // 忠实度：seed_alignment 覆盖每个有效用户输入点
  const seedPoints = collectSeedPoints(userSeed);
  const covered = new Set(align.map((a) => a && a.seed_point));
  for (const p of seedPoints) if (!covered.has(p)) v.push({ rule: 'fidelity', detail: `seed_alignment 未覆盖 seed point: ${p}` });

  // values_core derived_from（无来源/极端价值观→violation）
  for (const k of ['life_attitude', 'relationship_values', 'moral_style', 'boundaries']) {
    if (vc[k] && !vc[k].derived_from) v.push({ rule: 'values_core_derived', detail: `values_core.${k} 缺 derived_from(凭空生成)` });
  }

  // 🔴 scope=self：输出不得含指向用户的关系
  if (USER_DIRECTED_RE.test(blob) && REL_WITH_USER_TERMS.some((t) => blob.includes(t))) {
    v.push({ rule: 'scope_self', detail: '生成结果含指向当前聊天对象的关系(relationship_with_user 不得进 self)' });
  }

  // 🔴 child safety：含恋爱/性化/占有 → violation
  if (safety && safety.child_safety) {
    const rom = ROMANTIC_SEXUAL_TERMS.filter((t) => blob.includes(t));
    if (rom.length || /占有欲|情侣|男女朋友/.test(blob)) v.push({ rule: 'child_safety', detail: `未成年档生成含恋爱/性化/占有: ${rom.join(',')}` });
  }

  // 冲突：输出不得含已降级丢弃的 hard 半边（粗校验）
  // (B 生成后传入·A 提供规则·此处占位检查 dropped 词不复现)

  return { ok: v.length === 0, violations: v };
}

// 收集有效 seed point（忠实度校验用·关系 seed 不算 self point）。export 供 B prompt 作单一事实源
// （prompt 告诉 LLM 要覆盖的确切 seed_point·与 validator fidelity 用同一份·防格式漂移）。
export function collectSeedPoints(userSeed = {}) {
  const pts = [];
  const seenTraits = new Set();
  if (userSeed.self_role_title) pts.push('role');
  for (const t of userSeed.personality_tags || []) { if (seenTraits.has(t)) continue; seenTraits.add(t); pts.push(`personality:${t}`); }
  if (userSeed.introvert_level != null) pts.push('introvert_level');
  if (userSeed.attachment_style && userSeed.attachment_style !== ATTACHMENT_STYLE_LEGACY) pts.push('attachment_style');
  for (const h of userSeed.hobbies || []) pts.push(`hobby:${h}`);
  // 🔴 A4：同 trait 在 personality 已出过则不再出 pp_trait(同义点只发一条·优先 personality 命名空间)·去 fidelity 双重计数+无意义 retry。
  for (const t of (userSeed.persona_prompt_extracted?.traits) || []) { if (seenTraits.has(t)) continue; seenTraits.add(t); pts.push(`pp_trait:${t}`); }
  return pts;
}

function safeArr(v) {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return p.map(String); } catch { /* 逗号分隔兜底 */ }
    return v.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// ═══ schema 形状（顶层 4 键·A 填确定性·B 填生成部分留 null）═══════════════════════
// 🔴 schema 顶层 4 键(收口③)：character_core(纯内核三件) / self_facts(支撑事实) / values_core / seed_alignment。
//   character_core=高优先常驻召回·self_facts=topic-aware 按需召回(C 两策略两干净键·不在一键里分拣)。
export function buildCharacterSeedMeta(companion = {}) {
  const { user_character_seed, seed_processing } = processSeedInput(companion);
  return {
    v: 1,
    user_character_seed,
    seed_processing,
    character_core: null,   // 🔵commit B 填(formative_chain 交织叙事/trait_causes/inner_summary)
    self_facts: null,       // 🔵commit B 填(family/growth/work/close_friend_anchor)
    values_core: null,      // 🔵commit B 填
    seed_alignment: null,   // 🔵commit B 填
  };
}

export function serializeCharacterSeedMeta(meta) {
  return JSON.stringify(meta && typeof meta === 'object' ? meta : buildCharacterSeedMeta(meta || {}));
}

// ═══ commit B 用：本地 safe default archetype（🔴纯函数·不调 LLM·fallback 也漂就白搭）═══
export function buildSafeDefaultCharacter(userSeed = {}) {
  return {
    character_core: {
      formative_chain: '在一个普通家庭长大，父母为生活忙碌但顾家，她从小学会自己照顾自己，慢慢养成温和、踏实、对人有分寸的性子。',
      trait_causes: [{ trait: '温和', caused_by: ['家庭氛围平和', '从小独立'], expression: '说话和气、愿意听人把话说完' }],
      inner_summary: '温和踏实、对人有分寸的普通女孩',
      _source: 'safe_default',   // 🔴 C1 桥据此把整份 meta 降到最低兜底优先级(survives ai.mjs apply()·覆盖 safe_default 与 safe_default_after_retry 两路)
    },
    self_facts: {
      family: [{ who: '爸爸', detail: '普通上班族，话不多但顾家', influence_on_her: '让她踏实有安全感' }],
      growth: [{ event: '学生时代普通而安稳', influence_on_her: '性格平和不极端' }],
      work: { what: '一份与年龄相符的普通工作或学业', influence_on_her: '过着规律的生活' },
      close_friend_anchor: { nickname: '小敏', detail_level: 'low', knows_current_chat_partner: false, allowed_usage: 'low_frequency_life_anchor' },
    },
    values_core: {
      life_attitude: { text: '平平淡淡也挺好', derived_from: ['safe_default'] },
      relationship_values: { text: '真诚相处、有分寸', derived_from: ['safe_default'] },
      moral_style: { text: '与人为善、不越界', derived_from: ['safe_default'] },
      boundaries: { text: '尊重彼此的空间', derived_from: ['safe_default'] },
    },
    seed_alignment: [],
    _source: 'safe_default',
  };
}

// ═══ commit B 用：guardGeneratedText（🔴封装 user_wording_guard 同规则 + 关系禁词·prompt+输出都过）═══
//   A2：REL_FORBIDDEN_WORDS 现走顶部【单一来源】(含原缺的 女友/前女友/老婆/人妻/男友/前男友/网恋 等)·防三处各写各的漂移。
/** @returns violations[] —— 同 user_wording_guard 规则(剥 用户协议/用户名 后查"用户")+ 关系禁词。 */
export function guardGeneratedText(obj) {
  const v = [];
  let blob = typeof obj === 'string' ? obj : JSON.stringify(obj || {});
  for (const w of ['用户协议', '用户名']) blob = blob.split(w).join('');   // 保护词不误伤(同 user_wording_guard)
  if (blob.includes('用户')) v.push({ rule: 'user_wording', detail: '生成文本出现「用户」一词' });
  const relHit = REL_FORBIDDEN_WORDS.find((w) => blob.includes(w));
  if (relHit) v.push({ rule: 'relationship_forbidden', detail: `生成文本出现关系禁词「${relHit}」` });
  // 🔴「在一起」仅当与 user-directed 标记共现才算(防误伤"和家人/朋友在一起"·见 A2 取舍)。
  if (USER_DIRECTED_RE.test(blob) && blob.includes('在一起')) v.push({ rule: 'relationship_forbidden', detail: '生成文本出现「在一起」且指向当前对象' });
  return v;
}

// ═══ commit C1：seedMetaToFactItems —— meta → FactItem[] 桥（纯数据转换·转成 PR-3.1 可召回格式）═══
//
// 🔴 边界（不破）：仍走 meta 不进表 / 绝不产 identity_core(身份锁 companions) / 绝不产 relationship.*(指向用户) /
//   relationship_seed 永不转 fact / close_friend 仅 knows_current_chat_partner===false 才 emit(profile.friend) /
//   每条过 guardGeneratedText·命中泄漏整条丢弃 / 纯函数不接线·零触碰 buildCanonicalFactSnapshot/buildSystemPrompt/创建链。
//
// 🔴 优先级（维护者拍·命门）：AI 自有事实是高可信的，character_seed 是它的结构化生成，当然高于随机 persona_fact。
//   canonical(真赢·不被 seed 覆盖)= companions identity/core + shared_memory + manual/critical persona_facts；
//   generated character_seed self_facts(55-65) > 普通 persona_fact(40) > values_core(30-35) > safe_default(25-35)。
//   （C1 只产 FactItem 带 priority；与 persona_facts 的同槽对决在 C2 拼接处发生。critical-by-slot persona(70) 边界见 C2。）
const SELF_FACT_PRIO = 60;       // family/work/growth 稳定自有事实·高于普通 persona_fact(40)
const CLOSE_FRIEND_PRIO = 55;    // close_friend low_frequency anchor·self_facts 档最低
const CORE_SUMMARY_PRIO = 58;    // 内核一句话·C2 常驻候选
const CORE_TRAIT_PRIO = 55;
const CORE_FORMATIVE_PRIO = 52;  // 长叙事吃预算·C2 分流时先裁(分清 inner_summary/trait/formative 让 C2 路由)
const VALUES_PRIO = 32;          // 三观·背景档
const SAFE_DEFAULT_PRIO = 28;    // 兜底·最低·让位任何真 persona_fact

// 🔴 镜像 fact_guard OCCUPATION_WORDS(逐字·保证 family.father_occupation 与 detectFactTopics 咬合)。
//   保守：只这 18 词才判「detail 明确含职业」→father_occupation；否则父亲普通描述→family.father(别为咬合硬猜)。
//   （刻意复制以守 character_seed「零依赖」；漂移风险低·若要单一事实源 C2 可改 import·单向无环。）
const SEED_OCCUPATION_CUES = ['老师', '教师', '教书', '司机', '出租车', '开出租', '医生', '护士', '警察', '老板', '开店', '工程师', '工人', '公务员', '商人', '上班', '工作', '职业'];

function ensureArr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }

// 亲属→slot 保守映射（明确含职业才 *_occupation·咬合 PR-3.1 family.father_occupation/mother_occupation 触发槽）
function familySlot(who, detail) {
  const w = String(who || '');
  const hasOcc = SEED_OCCUPATION_CUES.some((o) => String(detail || '').includes(o));
  if (/爸|父亲/.test(w)) return hasOcc ? 'family.father_occupation' : 'family.father';
  if (/妈|母亲/.test(w)) return hasOcc ? 'family.mother_occupation' : 'family.mother';
  return 'family.background';   // 外婆/哥哥/姐姐/不确定亲属·咬合 detectFactTopics family.background
}

/**
 * 把 commit B 落在 character_seed_meta 的 character_core/self_facts/values_core 转成 PR-3.1 FactItem[]。
 * @param characterSeedMeta meta 对象或其 JSON 串（null/缺字段/坏串→[]）
 * @returns FactItem[] —— {slot, layer:'profile_core', source:'character_seed', seedGroup, content, value, priority}
 *   （critical/bucket 由 C2 拼接进 buildCanonicalFactSnapshot 时按 CRITICAL_SLOTS/触发槽赋·C1 不决定召回策略）
 */
export function seedMetaToFactItems(characterSeedMeta, opts = {}) {
  let meta = characterSeedMeta;
  if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch { return []; } }
  if (!meta || typeof meta !== 'object') return [];
  const cc = meta.character_core;
  const sf = meta.self_facts;
  const vc = meta.values_core;
  // 🔴 safe_default 整份降到最低兜底档(让位任何真 persona_fact)·覆盖 safe_default 与 safe_default_after_retry
  const isSafeDefault = !!(cc && typeof cc === 'object' && cc._source === 'safe_default');
  const prio = (p) => (isSafeDefault ? SAFE_DEFAULT_PRIO : p);

  const items = [];
  const push = (slot, seedGroup, content, value, p) => {
    const c = String(content || '').trim();
    if (!c) return;
    if (guardGeneratedText(c).length) return;   // 🔴 出口护栏：含「用户」/关系禁词整条丢弃·绝不漏到召回层
    items.push({ slot, layer: 'profile_core', source: 'character_seed', seedGroup, content: c, value: String(value == null ? c : value).trim(), priority: prio(p) });
  };

  // ① character_core（灵魂内核·C2 常驻候选；inner_summary/trait/formative 分清让 C2 路由）
  if (cc && typeof cc === 'object') {
    if (cc.inner_summary) push('profile.inner_summary', 'character_core', `内核：${cc.inner_summary}`, cc.inner_summary, CORE_SUMMARY_PRIO);
    for (const tc of ensureArr(cc.trait_causes)) {
      const trait = String(tc?.trait || '').trim();
      if (!trait) continue;
      const causes = ensureArr(tc.caused_by).map(String).filter(Boolean);
      const expr = String(tc.expression || '').trim();
      const body = [causes.length ? `因为${causes.join('、')}` : '', expr].filter(Boolean).join('·');
      push('profile.trait', 'character_core', body ? `${trait}（${body}）` : trait, trait, CORE_TRAIT_PRIO);
    }
    if (cc.formative_chain) {
      const fc = Array.isArray(cc.formative_chain) ? cc.formative_chain.join('') : cc.formative_chain;
      push('profile.formative', 'character_core', `成长经历：${fc}`, '成长经历', CORE_FORMATIVE_PRIO);
    }
  }

  // ② self_facts（支撑事实·topic-aware 按需召回·family/work 与 PR-3.1 触发槽咬合）
  if (sf && typeof sf === 'object') {
    for (const fm of ensureArr(sf.family)) {
      const who = String(fm?.who || '').trim();
      const detail = String(fm?.detail || '').trim();
      if (!who || !detail) continue;
      push(familySlot(who, detail), 'self_facts', `${who}：${detail}`, detail, SELF_FACT_PRIO);
    }
    for (const g of ensureArr(sf.growth)) {
      const ev = String(g?.event || '').trim();
      if (ev) push('profile.growth', 'self_facts', `成长：${ev}`, ev, SELF_FACT_PRIO);
    }
    const what = String(sf.work?.what || '').trim();
    if (what) push('profile.occupation', 'self_facts', `职业：${what}`, what, SELF_FACT_PRIO);
    // 🔴 close_friend：只在 knows_current_chat_partner===false 才 emit·低展开·进 profile.friend(绝非 relationship.*)
    const cf = sf.close_friend_anchor;
    // 🔴 SOCIAL_CIRCLE 前置·平行闺蜜统一（D3 盘点穿帮雷）：友名单一事实源=social_circle.pickFriendAnchor
    //   由 caller(bot.mjs·已有 companion+social_circle)算好经 opts.friendNick 传入·守 character_seed 零依赖无环。
    const nick = String(opts.friendNick || cf?.nickname || '').trim();
    if (cf && cf.knows_current_chat_partner === false && nick) push('profile.friend', 'self_facts', `朋友：${nick}`, nick, CLOSE_FRIEND_PRIO);
  }

  // ③ values_core（三观·低优先·背景档）
  if (vc && typeof vc === 'object') {
    const VAL_LABELS = { life_attitude: '生活态度', relationship_values: '相处之道', moral_style: '道德感', boundaries: '边界感' };
    for (const k of Object.keys(VAL_LABELS)) {
      const node = vc[k];
      const text = node && typeof node === 'object' ? String(node.text || '').trim() : String(node || '').trim();
      if (text) push(`values.${k}`, 'values_core', `${VAL_LABELS[k]}：${text}`, text, VALUES_PRIO);
    }
  }

  return items;
}

// ═══ PR-3.2 C3：自有事实「软常驻」子集 ═══════════════════════════════════════
// always-on 软层（bot reply path）只取这些 slot：与 C2 SEED_CRITICAL_SELF_SLOTS 对齐
//   （father/mother_occupation + profile.occupation）+ 父母非职业兜底（治"你爸做什么"父亲无职业 cue 时仍有真答）
//   + 内核一句。🔴刻意不取 growth/trait/formative/values/friend（防刻板·减法）。
const SELF_SEED_SOFT_SLOTS = new Set([
  'profile.inner_summary',                       // 内核一句
  'family.father_occupation', 'family.father',
  'family.mother_occupation', 'family.mother',
  'profile.occupation',                          // 她自己的职业
]);

/**
 * 取 self seed 软常驻子集（reply path always-on 用·companion.mjs 守零 import 故由 caller 算好传入）。
 * null/坏 meta → []。与 seedMetaToFactItems 同源 → 软（本函数）/硬（C2）值字节一致，结构上不矛盾。
 * @returns FactItem[] 子集
 */
export function selectSelfSeedSoftItems(characterSeedMeta, opts = {}) {
  return seedMetaToFactItems(characterSeedMeta, opts).filter((i) => SELF_SEED_SOFT_SLOTS.has(i.slot));
}
