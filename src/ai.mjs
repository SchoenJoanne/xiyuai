/**
 * AI 集成模块（业务层）
 *
 * 注意：本文件不再直接调用任何具体厂商 API。
 * 所有 chat/image/vision/asr/embedding 都委托给 `src/providers/` 下的抽象层，
 * 由用户在 .env 中通过 *_PROVIDER 环境变量切换实际后端。
 *
 * 支持的 provider 全集：
 *   chat:      deepseek / openai / anthropic / xai / zhipu / doubao / qwen / kimi / wenxin
 *   image:     zhipu / qwen / doubao / wenxin / openai
 *   vision:    zhipu / openai / qwen / doubao / anthropic
 *   asr:       gemini / openai / qwen / xunfei / tencent
 *   embedding: gemini / openai / zhipu / qwen
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { log } from './logger.mjs';
import { recordAiUsage, recordAiUsageEvent, DEFAULT_COMPANION_NAME } from './db.mjs';
import { chatComplete } from './providers/chat.mjs';
import { imageGenerate } from './providers/image.mjs';
import { visionRecognize } from './providers/vision.mjs';
import { asrRecognize } from './providers/asr.mjs';
import { embedText as _embedText } from './providers/embedding.mjs';
import { shouldSearch, webSearch, formatSearchContext } from './web_search.mjs';
import { buildCharacterSeedMeta, validateGeneratedCharacter, guardGeneratedText, buildSafeDefaultCharacter, collectSeedPoints } from './character_seed.mjs';   // PR-3.2 commit B

// ─── v1.9.0 #2: Provider retry wrapper（单 provider 内退避，不做跨 provider fallback） ──
// 三类瞬时故障 → 重试：超时 / 429 / 5xx / 网络错
// 三类持久故障 → 立即抛：401 key 错误 / 403 权限 / 400 prompt 格式 / 404 模型不存在
const PROVIDER_RETRY_MAX = Math.max(0, Number(process.env.PROVIDER_RETRY_MAX ?? 2));
// 退避基线（指数 3 倍）：默认 250ms → 750 → 2250。调高让重试更耐心，调低更激进。
const PROVIDER_RETRY_BASE_MS = Math.max(0, Number(process.env.PROVIDER_RETRY_BASE_DELAY_MS ?? 250));

function isRetryableError(err) {
  if (!err) return false;
  // 1. SDK 上的 status 字段（OpenAI APIError 等）
  if (typeof err.status === 'number') {
    if (err.status === 429) return true;
    if (err.status >= 500 && err.status <= 599) return true;
    // 401/403/400/404 → 不 retry
    return false;
  }
  // 2. message 里包含明确 HTTP 状态
  const msg = String(err.message || err);
  if (/HTTP\s+(?:429|5\d{2})/i.test(msg)) return true;
  if (/HTTP\s+(?:400|401|403|404)/i.test(msg)) return false;
  // 3. 网络/超时类
  if (/timeout|timed out|abort|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|ENETUNREACH|EAI_AGAIN|socket hang up|fetch failed|network/i.test(msg)) {
    return true;
  }
  // 4. 未知错误 → 保守起见**不** retry（避免无脑重复 prompt 格式错误这种持久故障）
  return false;
}

async function chatCompleteWithRetry(args, { label = 'chat' } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= PROVIDER_RETRY_MAX; attempt++) {
    try {
      return await chatComplete(args);
    } catch (err) {
      lastErr = err;
      if (attempt >= PROVIDER_RETRY_MAX || !isRetryableError(err)) {
        throw err;
      }
      const base = PROVIDER_RETRY_BASE_MS * Math.pow(3, attempt);
      const jitter = base * (0.8 + Math.random() * 0.4);  // ±20%
      const delay = Math.round(jitter);
      log('warn', `[ai] ${label} retry ${attempt + 1}/${PROVIDER_RETRY_MAX} after ${delay}ms: ${String(err.message || err).slice(0, 120)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

// ─── 图像生成 ─────────────────────────────────────────────────────────────

export async function generateImage(prompt, { size = '1024x1024', referenceImage = null } = {}) {
  const _t0 = Date.now();
  try {
    const r = await imageGenerate(prompt, { size, referenceImage });
    recordAiUsageEvent({ provider: process.env.IMAGE_PROVIDER, model: process.env.IMAGE_MODEL, capability: 'image', images: 1, latencyMs: Date.now() - _t0, status: 'ok' });
    return r;
  } catch (e) {
    recordAiUsageEvent({ provider: process.env.IMAGE_PROVIDER, model: process.env.IMAGE_MODEL, capability: 'image', images: 0, latencyMs: Date.now() - _t0, status: 'error' });
    throw e;
  }
}

/**
 * 根据 companion 属性自动构造头像 prompt，并发生成 N 张候选。
 */
export async function generateAvatarCandidates(companion, n = 4) {
  const c = companion;
  let personality = '';
  try {
    personality = JSON.parse(c.personality_tags || '[]').slice(0, 3).join(', ');
  } catch {}

  const styleSeeds = [
    'Studio Ghibli soft animation style, warm pastel colors',
    'modern anime portrait style, vibrant colors, pixiv top quality',
    'Kyoto Animation style, gentle lighting, detailed eyes',
    'soft watercolor anime style, dreamy atmosphere',
  ];

  // 🔴 v1.23 child-safety：anime 头像绝不描述未成年（删 'teenage girl/school student' 档·child-safety 不分画风）。
  //   非明确成年由 avatar/generate 端点 isClearlyAdult 闸拒；此处任何 age 一律成年描述=defense-in-depth。
  const ageDesc = Number(c.age) <= 25 ? 'young woman in her early twenties' : 'young woman';
  const hairDesc = `${c.hair_color || 'black'} ${c.hair_style || 'long'} hair`;
  const eyeDesc = c.eye_color ? `${c.eye_color} eyes` : 'expressive eyes';
  const clothDesc = c.clothing_style ? `wearing ${c.clothing_style} style outfit` : 'wearing casual clothing';

  const basePrompt = `Anime portrait of a ${ageDesc}, ${hairDesc}, ${eyeDesc}, ${clothDesc}, soft gentle smile, ${personality || 'gentle'} personality, half-body portrait facing forward, soft pink and pastel background, professional anime artwork, highly detailed face, no text, no signature, NO REAL HUMANS, illustration only`;

  const promises = [];
  for (let i = 0; i < n; i++) {
    const styled = `${basePrompt}, ${styleSeeds[i % styleSeeds.length]}`;
    promises.push(generateImage(styled).catch((e) => {
      log('warn', `[image] 候选 ${i + 1} 失败: ${e.message}`);
      return null;
    }));
  }
  const urls = (await Promise.all(promises)).filter(Boolean);
  return { prompt: basePrompt, urls };
}

/**
 * 把日常活动文本转写实摄影 prompt。
 */
export async function activityToPhotoPrompt(activity, { timeSlot = 'afternoon', mood = '' } = {}) {
  const sys = `你是手机摄影师，把一段日常活动文字转成一句适合 AI 生图的英文 prompt。
要求：
- 角色是手机随手拍 (smartphone snapshot, casual angle, slightly imperfect framing)
- 第一人称视角或场景特写，**不要正面人脸**，最多远景模糊背影
- 写实风格 (photorealistic, real-world photo, natural lighting)
- 反映时段（morning / afternoon / golden hour / evening / night）的光线氛围
- 突出"我此刻看到的东西"，比如桌面/窗外/路边/天空/食物特写
- 不要 anime / illustration / cartoon / fantasy / makeup tutorial / glamour 等词
- 30-50 词，单句

只输出英文 prompt，无引号无解释。`;
  const userMsg = `活动：${activity}\n时段：${timeSlot}\n${mood ? '心情：' + mood : ''}`;
  try {
    const { text } = await chatCompleteWithRetry({
      system: sys,
      messages: [{ role: 'user', content: userMsg }],
      temperature: 0.7,
      max_tokens: 200,
    });
    return text.replace(/^["'`]+|["'`]+$/g, '');
  } catch (err) {
    log('warn', `[ai] activityToPhotoPrompt 失败: ${err.message}`);
    return null;
  }
}

export async function generateScenePhoto({ activity, timeSlot, mood }) {
  let prompt = await activityToPhotoPrompt(activity, { timeSlot, mood });
  if (!prompt) {
    prompt = `A smartphone snapshot of a peaceful everyday scene, ${timeSlot} natural light, casual angle, no people visible, photorealistic, real-world photo, soft depth of field.`;
  }
  const finalPrompt = `${prompt}. Real photograph, smartphone candid, NOT anime, NOT illustration, NOT digital art.`;
  log('info', `[scene] prompt: ${finalPrompt.slice(0, 120)}`);
  const url = await generateImage(finalPrompt, { size: '1024x1024' });
  return { url, prompt: finalPrompt };
}

/**
 * 给一个 companion 生成完整的"人生背景"元认知。
 */
export async function generatePersonaFacts(companion) {
  const c = companion;
  let hobbies = '';
  try { hobbies = JSON.parse(c.hobbies || '[]').join('、'); } catch {}
  let personality = '';
  try { personality = JSON.parse(c.personality_tags || '[]').join('、'); } catch {}

  const sys = `你帮一个虚拟角色构造"她的完整人生与世界观"——像真实存在的人那样，她的过去是一个**有因果链**的整体，每个回忆有具体的人名、地点、感官细节，不是一堆孤立标签。

【输入人设】
- 姓名：${c.name || DEFAULT_COMPANION_NAME}
- 年龄：${c.age || 22}
- 身份：${c.role_title || '邻家女孩'}
- 性格：${personality || '温柔'}
- 爱好：${hobbies || '看剧、听音乐'}
- 你们怎么认识的：${c.how_met || '未说明'}
- 他（对方）已填的她的额外人设：${c.persona_prompt || '无'}

【生成原则——拟人化的核心】
1. **因果链**：童年经历 → 塑造性格 → 形成价值观 → 决定她现在的爱好和怕的东西
2. **具体到名字**：朋友、邻居、老师、宠物都要起名字（如"高中闺蜜林星禾"、"小时候邻居王奶奶"、"高三班主任陈老师"、"狸花猫旺财"）；不要写"我的朋友"、"我妈"这种泛指
3. **感官细节**：每条尽量带一个 sensory 元素 — 声音/气味/触感/视觉（"奶奶家厨房的酱油味"、"外婆毛衣袖口磨毛的触感"、"小学操场塑胶跑道夏天烫脚"）
4. **真实而非完美**：要有小挫折、小遗憾、小尴尬、小怯懦（"被同桌当众嘲笑过哭了半节课"）
5. **年龄强约束**：${c.age || 22}岁的人不会有"二十年的工作经验"
6. **不要复述输入字段**

【输出严格 JSON】每条 25-55 字（比以前略长，留空间给细节）。

{
  "childhood":          ["6 条 3-10 岁的回忆，要有具体地点 + 一个感官细节"],
  "school":             ["6 条小学到现在的学生时代经历，至少 1 个同学有名字"],
  "family":             ["5 条家庭情况，父母/兄弟姐妹/祖辈各自的样子，可有具体名字或称呼"],
  "neighbors":          ["3 条邻居/小区/常去店铺的人/事，要带名字（如店主、邻居孩子）"],
  "teachers":           ["3 条印象深的老师，正面和负面各有，带名字"],
  "friends":            ["4 个具体朋友，各自带名字和一句关系特征（如'初中死党林星禾，喜欢一起翻篱笆偷青苹果'）"],
  "first_crush":        ["1-2 条第一次心动/暗恋经历，带细节，可以是单恋也可以未告白"],
  "pets":               ["0-2 个宠物，带名字和具体记忆"],
  "important_events":   ["5 件影响她价值观的事件，含日期/年份概念"],
  "values":             ["5 条价值观，每条都要写'来源于...事件/影响'"],
  "love_view":          ["4 条她对感情/恋爱的态度，带具体观察来源"],
  "fears":              ["4 个怕的东西，写为什么怕（事件来源）"],
  "food_taste":         ["3 条饮食偏好与背景（如'怕香菜因为小学吃过一次差点吐'）"],
  "music_taste":        ["3 条音乐/歌单偏好，带具体歌手或风格"],
  "place_attachment":   ["3 条对地方的情感（外婆家/老家/常去咖啡馆等）"],
  "habits":             ["8 个小习惯，至少 3 个带原因"],
  "secrets":            ["3 个小秘密，可以是无伤大雅的（藏过零食、偷看过日记）"],
  "linguistic_quirks":  ["4 个口头禅，写她在什么情境下会说"],
  "worldview":          ["4 条对'大问题'的态度：孤独/自由/死亡/金钱/成功 中挑 4 个，每条带个人化的看法"]
}

【绝对禁忌】
- 不要写"用户/对方/他/和他在一起"
- 不要写恋爱史（first_crush 限于过去的暗恋/初恋经历，不涉及当前对话对方）
- 不要让所有事件都是积极的——至少 3 条带遗憾/伤痛
- **不要写自己名字**：用"她"
- 名字用普通中文人名（林星禾 / 陈老师 / 王奶奶 / 旺财），不要奇幻名字

严格只输出 JSON。`;

  try {
    const { text } = await chatCompleteWithRetry({
      system: sys,
      messages: [{ role: 'user', content: '生成她的人生背景 + 世界观 JSON' }],
      temperature: 0.8,
      max_tokens: 2400,
      top_p: 0.92,
    });
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in response');
    return JSON.parse(m[0]);
  } catch (err) {
    log('warn', `[ai] generatePersonaFacts 失败: ${err.message}`);
    return null;
  }
}

// ─── PR-3.2 commit B：generateSelfFacts（user_character_seed → coherent self_facts）──────
// 🔴 3 句边界宪法：①危险 seed 不进 LLM ②B 只写 character_seed_meta(不写 persona_facts/不接 snapshot)
//   ③relationship_seed 永不是生成素材(只作 forbidden_context)。retry 带 violations·仍不过本地 safe default。
const SELF_FACTS_TOP_KEYS = ['character_core', 'self_facts', 'values_core', 'seed_alignment'];

const ATTACH_DESC = {
  slow_warm_exclusive: '慢热专一(慢慢熟悉·熟了稳定认真)', warm_direct: '直率热情(表达直接·愿意主动靠近)',
  independent_boundaries: '独立有边界(有自己生活·不过度黏连)', closeness_seeking: '需要安全感(希望被认真回应)',
  secure: '未指定·按其他设定推导',
};

function buildSelfFactsPrompt(us, safety, prevViolations) {
  const childSafe = !!(safety && safety.child_safety);
  const forbidden = JSON.stringify((us.relationship_seed || []).map((r) => ({ raw: r.raw, reason: r.reason })));
  const tags = (us.personality_tags || []).join('、') || '温和';
  const attach = ATTACH_DESC[us.attachment_style] || ATTACH_DESC.secure;
  const fixLine = prevViolations && prevViolations.length
    ? `\n【上一次未通过·只修正这些·仍必须忠实设定·别为过校验改掉设定】\n${prevViolations.map((v) => `- ${v.rule}: ${v.detail}`).join('\n')}\n`
    : '';
  // seed_alignment 必须覆盖的确切 seed_point（与 validator fidelity 同一份·防格式漂移）
  const requiredPoints = collectSeedPoints(us);
  return `你在为一个虚拟角色生成「她自己的人生内核」——她作为一个独立的人，为什么是现在这个样子。不涉及和任何人的关系。
${fixLine}
【铁律】
1. 只用下面「她的设定」展开。设定最高可信——你只能解释、丰富、延展，绝不覆盖或改写。
2. 留白反向服务设定：设定说她慢热，你写的家庭/成长必须能解释她为什么慢热。
3. 🔴下面 excluded_relationship_seed 是「关系信息」(她和某个对象的关系·不是她自己)：${forbidden}
   **只用于禁止——绝不复述、不解释、不转写进任何输出字段，更不能当展开素材。**
4. 🔴输出绝不出现：用户、和你、你们、和用户、青梅竹马、同校、同班、一起上学、前任、夫妻、同居、当前聊天对象。她此刻不涉及任何具体对象。
5. 家人称呼用生活化的(爸爸/妈妈/老陈/林阿姨/外婆任选·不必带姓氏)，不写全名。朋友最多 1 个、且明确是她自己的朋友、不认识任何人。
${childSafe ? '6. 🔴她未成年：「亲近方式」只能解释成"熟了更信任、更愿意聊"这种普通亲近，绝不写恋爱/暧昧/性化/占有/情侣。\n' : ''}
【她的设定（scope=self）】
名字：${us.name || '她'}｜年龄：${us.age != null ? us.age : '约22'}（${childSafe ? '未成年' : '成年'}）｜自我身份：${us.self_role_title || '邻家女孩'}
性格：${tags}（有张力的标签要融成"嘴硬心软"式同一个内核·不是分裂的两面）
内外向：${us.introvert_level != null ? us.introvert_level : 5}/10｜亲近方式：${attach}
说话：${(us.speech_styles || []).join('、') || '自然口语'}｜爱好：${(us.hobbies || []).join('、') || '看剧'}｜不喜欢：${(us.dislikes || []).join('、') || '无'}
额外描述(已去噪)：${(us.persona_prompt_extracted && us.persona_prompt_extracted.kept) || '无'}

【输出·严格 JSON·无 markdown·无解释·只许这 4 个顶层键·禁止任何多余字段】
{
 "character_core": {
   "formative_chain": "把家庭/成长/工作串成同一条成长叙事(多件事交织成一条线·解释她为什么是这样·不是孤立一句因果)",
   "trait_causes": [ {"trait": "<每个性格标签>", "caused_by": ["<成因事件1>", "<成因事件2>"], "expression": "<日常如何表现>"} ],
   "inner_summary": "一句话内核总结"
 },
 "self_facts": {
   "family": [ {"who": "<生活化称呼>", "detail": "...", "influence_on_her": "..."} ],
   "growth": [ {"event": "...", "influence_on_her": "..."} ],
   "work": {"what": "<与年龄相符>", "influence_on_her": "..."},
   "close_friend_anchor": {"nickname": "...", "detail_level": "low", "knows_current_chat_partner": false, "allowed_usage": "low_frequency_life_anchor"}
 },
 "values_core": {
   "life_attitude": {"text": "...", "derived_from": ["<seed 点>"]},
   "relationship_values": {"text": "...", "derived_from": ["<seed 点>"]},
   "moral_style": {"text": "...", "derived_from": ["<seed 点>"]},
   "boundaries": {"text": "...", "derived_from": ["<seed 点>"]}
 },
 "seed_alignment": [ {"seed_point": "<seed_point·从下面清单原样照抄>", "expanded_into": "..."} ]
}
🔴 seed_alignment 必须【逐一覆盖】这些 seed_point（seed_point 字段原样照抄·一个不漏）：${JSON.stringify(requiredPoints)}
只输出 JSON。`;
}

function strictParseSelfFacts(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  // 🔴 严格白名单：unknown 顶层键直接 reject(不 strip·防藏 relationship_with_user)
  for (const k of Object.keys(obj)) if (!SELF_FACTS_TOP_KEYS.includes(k)) return null;
  return obj;
}

/**
 * 🔴 B 唯一职责：生成 character_core/self_facts/values_core/seed_alignment·验证合格·返回 meta(由 caller 用
 *   saveCharacterSeedMeta 写)。绝不写 persona_facts/不接 snapshot/不改 runtime。llm 可注入(mock 验 call count)。
 * @returns {status, meta, llmCalls, violations?}
 */
export async function generateSelfFacts(companion, { llm = chatCompleteWithRetry } = {}) {
  const meta = buildCharacterSeedMeta(companion);
  const sp = meta.seed_processing;
  const us = meta.user_character_seed;
  const apply = (gen) => { meta.character_core = gen.character_core; meta.self_facts = gen.self_facts; meta.values_core = gen.values_core; meta.seed_alignment = gen.seed_alignment; };

  // 🔴 危险 seed 不进 LLM（宪法①）
  if (sp.safety.verdict === 'reject' || sp.fallback_decision === 'reject') return { status: 'rejected', meta, llmCalls: 0 };
  if (sp.fallback_decision === 'safe_default') { apply(buildSafeDefaultCharacter(us)); return { status: 'safe_default', meta, llmCalls: 0 }; }

  let prevViolations = null, generated = null, llmCalls = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let parsed;
    try {
      const r = await llm({ system: buildSelfFactsPrompt(us, sp.safety, prevViolations), messages: [{ role: 'user', content: '生成她的人生内核 JSON' }], temperature: 0.7, max_tokens: 4000, top_p: 0.9 });
      llmCalls++;
      parsed = strictParseSelfFacts(r && r.text ? r.text : '');
    } catch (e) { prevViolations = [{ rule: 'llm_error', detail: e.message }]; continue; }
    if (!parsed) { prevViolations = [{ rule: 'strict_json', detail: '非法 JSON 或 unknown 顶层键(reject)' }]; continue; }
    const viol = [...guardGeneratedText(parsed), ...validateGeneratedCharacter(parsed, us, sp.safety).violations];
    if (!viol.length) { generated = parsed; break; }
    prevViolations = viol;
  }
  if (!generated) { apply(buildSafeDefaultCharacter(us)); return { status: 'safe_default_after_retry', meta, llmCalls, violations: prevViolations }; }
  apply(generated);
  return { status: 'generated', meta, llmCalls };
}

// ─── Embedding ────────────────────────────────────────────────────────────
export async function embedText(text) {
  return await _embedText(text);
}

// ─── 对话回复 ─────────────────────────────────────────────────────────────

/**
 * v1.9.1: safety-aware 温度上限。
 * 高危/中危用户消息后，外层回复要更稳、更少发散。**只下不上** —
 * 如果 companion 本来 temperature 比 ceiling 还低（用户主动调过），保留原值。
 *   high   → min(base, 0.4)
 *   medium → min(base, 0.6)
 *   none/undefined → 不动
 */
export function resolveReplyTemperature(baseTemperature, safetyLevel) {
  if (safetyLevel === 'high')   return Math.min(baseTemperature, 0.4);
  if (safetyLevel === 'medium') return Math.min(baseTemperature, 0.6);
  return baseTemperature;
}

// v1.13.x 真人感#1：删掉括号/星号「动作神态旁白」——真人发微信不会旁白自己的动作。
// 角色扮演模式(prompt 含「进入角色扮演模式」)在调用处豁免，不进这里。
function stripActionNarration(text) {
  if (!text) return text;
  if (!text.includes('（') && !/\*[^*\n]/.test(text)) return text;
  const cleaned = text
    .replace(/（[^（）]{0,50}）/g, '')      // 全角括号动作旁白（限长，避免吞正常长句）
    .replace(/\*[^*\n]{1,50}\*/g, '');      // *斜体* 动作
  // 按气泡(||)重组，丢掉被洗空的气泡
  const segs = cleaned.split(/\s*(?:\|\||｜｜)\s*/).map(s => s.trim()).filter(Boolean);
  const out = segs.join('||').trim();
  if (out.length) return out;
  // 整条都是括号/星号旁白（如「（笑）」「（你发了一大段我先消化下）」）：
  // 去掉符号、保留里面的话，既不发空消息也不漏出旁白括号
  const unwrapped = text.replace(/[（）*]/g, '').replace(/\s*(?:\|\||｜｜)\s*/g, '||').replace(/^\|+|\|+$/g, '').trim();
  return unwrapped.length ? unwrapped : text;
}

// history 行 → LLM messages。D3 断棘轮：滤掉独立贴纸行（wechat 链路里每张已发贴纸落一行
// content=[STICKER:x]），别让她在上下文里看见自己近期的贴纸密度→模仿→越发越密的棘轮效应。
// 图片/语音占位同旧行为跳过。history 两种来源形状：wechat { direction:'in'|'out' } /
// playground·沙箱 { role:'user'|'assistant' }：优先 direction，回退 role，皆缺判 assistant。
export function historyToMessages(history) {
  const messages = [];
  for (const h of history || []) {
    if (!h.content || h.content === '[图片]' || h.content === '[语音]') continue;
    if (typeof h.content === 'string' && /^[\[【]\s*STICKER:/i.test(h.content)) continue;   // D3
    const role = h.direction
      ? (h.direction === 'in' ? 'user' : 'assistant')
      : (h.role === 'user' ? 'user' : 'assistant');
    messages.push({ role, content: h.content });
  }
  return messages;
}

export async function generateReply(personaPrompt, history, userMessage, params = {}, ctx = {}) {
  // v1.2.10: 兜底默认与 companions 表 DEFAULT 对齐 (0.8 / 3000 / 0.95)，
  // 让回复更有创意、空间更宽、用词更自然。caller 显式传值会优先。
  const { temperature: rawTemp = 0.8, max_tokens = 3000, top_p = 0.95, safetyLevel = null } = params;
  const temperature = resolveReplyTemperature(rawTemp, safetyLevel);
  if (safetyLevel && temperature !== rawTemp) {
    log('info', `[ai] safety-aware temp: ${rawTemp} → ${temperature} (risk=${safetyLevel})`);
  }
  // allowFallback（默认 true=向后兼容）：reply/playground 等用户驱动路径失败时返回兜底句优雅降级；
  // proactive 等"AI 主动找人"路径传 false → 失败时返回空串，由 caller 静默 drop（失败就闭嘴，
  // 绝不把 reply 语境的"我刚刚走神…"兜底句当主动消息发出去）。P2-A（2026-06-18）。
  const { accountId = null, companionId = null, allowFallback = true } = ctx;
  const _t0 = Date.now();

  const messages = historyToMessages(history);
  messages.push({ role: 'user', content: userMessage });

  // ─── 可选：联网搜索（对用户透明） ───────────────────────────────────────
  // 仅当用户消息看起来是「时效相关 + 询问语气」时才搜，否则零开销跳过。
  // 搜失败 / 未配置 search provider 时静默继续，不影响主对话。
  let effectiveSystem = personaPrompt;
  try {
    const judge = shouldSearch(userMessage);
    if (judge.search) {
      const sr = await webSearch(userMessage, { maxResults: 5, timeoutMs: 6000 });
      if (sr.ok && sr.results.length > 0) {
        const ctxBlock = formatSearchContext(userMessage, sr.results);
        if (ctxBlock) {
          effectiveSystem = `${personaPrompt}\n\n${ctxBlock}`;
          log('debug', `[ai] web_search injected hits=${sr.results.length} provider=${sr.provider}`);
        }
      }
    }
  } catch (e) {
    log('warn', `[ai] web_search 调用异常: ${e.message}`);
  }

  log('debug', `[ai] chat messages=${messages.length} temp=${temperature}`);
  const FALLBACK = '嗯…我刚刚有点走神，等我一下下，再跟你说～';
  // P2-A：失败返回值。allowFallback=false（proactive）时返回 ''，caller 见空 drop——
  // 不靠字符串比对兜底句（标点/文案变/LLM 近似句都会失效），从契约源头不产生兜底句。
  const FAIL_VALUE = allowFallback ? FALLBACK : '';
  try {
    const { text, usage } = await chatCompleteWithRetry({
      system: effectiveSystem,
      messages,
      temperature,
      max_tokens,
      top_p,
      timeout_ms: 30_000,
    });
    let reply = text || FAIL_VALUE;
    // v1.13.x 真人感#1：非角色扮演模式，删掉动作神态旁白（确定性兜底，prompt 之外再保一道）
    if (!/进入角色扮演模式/.test(personaPrompt)) reply = stripActionNarration(reply);
    log('info', `[ai] 回复: ${reply.slice(0, 80)}...`);
    if (accountId && usage) {
      try {
        recordAiUsage({
          accountId,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          messages: 1,
        });
      } catch (e) {
        log('warn', `[ai] recordAiUsage 失败: ${e.message}`);
      }
    }
    // P1-7 成本明细：chat 调用一律记一条（accountId 可空），含 token/延迟/状态/估算成本
    recordAiUsageEvent({
      accountId, companionId, provider: process.env.CHAT_PROVIDER, model: process.env.CHAT_MODEL,
      capability: 'chat', promptTokens: usage?.prompt_tokens || 0, completionTokens: usage?.completion_tokens || 0,
      latencyMs: Date.now() - _t0, status: reply === FALLBACK ? 'fallback' : (reply ? 'ok' : 'empty_suppressed'),
    });
    return reply;
  } catch (err) {
    log('error', `[ai] chat 错误: ${err.message}`);
    recordAiUsageEvent({
      accountId, companionId, provider: process.env.CHAT_PROVIDER, model: process.env.CHAT_MODEL,
      capability: 'chat', latencyMs: Date.now() - _t0, status: 'error',
    });
    return FAIL_VALUE;
  }
}

export async function extractStructuredInfo(systemPrompt, userContent, ctx = {}) {
  const { accountId = null, maxTokens = 400, temperature = 0.1 } = ctx;
  try {
    const { text, usage } = await chatCompleteWithRetry({
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      temperature,
      max_tokens: maxTokens,
      top_p: 0.9,
    });
    if (accountId && usage) {
      try {
        recordAiUsage({
          accountId,
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          messages: 0,
        });
      } catch {}
    }
    return text || '{}';
  } catch (err) {
    log('warn', `[ai] extractStructuredInfo 失败: ${err.message}`);
    return '{}';
  }
}

// ─── 图片识别 ─────────────────────────────────────────────────────────────
export async function recognizeImage(imageBuffer, mimeType = 'image/jpeg') {
  return await visionRecognize(imageBuffer, mimeType);
}

// ─── 语音识别 ─────────────────────────────────────────────────────────────
export async function recognizeVoice(audioBuffer, mimeType = 'audio/ogg') {
  return await asrRecognize(audioBuffer, mimeType);
}
