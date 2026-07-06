/**
 * 表情包管理器
 *
 * 读取 assets/stickers/manifest.json，按 tag/emotion 查图。
 * 启动时一次加载，文件变更需要 systemctl restart 才会重读。
  *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './logger.mjs';

const STICKERS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'assets',
  'stickers',
);
const MANIFEST_PATH = path.join(STICKERS_DIR, 'manifest.json');

let cache = null;

/**
 * 纯函数：从启用 sticker 列表建 tag→stickers 索引（tags 中文别名 + emotion 都进，
 * 供 pickSticker 直查 / 模糊兜底）。抽出来便于单测。
 */
export function buildByTagFromList(stickers) {
  const byTag = new Map();
  for (const s of Array.isArray(stickers) ? stickers : []) {
    const tags = [
      ...(Array.isArray(s.tags) ? s.tags : []),
      s.emotion,
    ].filter(Boolean).map(t => String(t).toLowerCase());
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(s);
    }
  }
  return byTag;
}

/**
 * S-A（40-cap 修复）：LLM 词表 = 每张启用图的 canonical emotion（英文情绪），去重保序。
 * 🔴 中文别名 + retag 场景词只进 byTag 给 pickSticker 模糊兜底，绝不塞 LLM 列表——否则
 * distinct tag 远超 40、旧 listAvailableTags(40) 截断 + 噪声词诱导，维护者特意做的图 LLM
 * 永远选不到（合并 52 张里曾 9 张因此不可达）。emotion 全英文 → LLM 列表干净、全可达。
 * 🔴 只读 emotion 字段，不读 opensource 等元数据 → 加 opensource 字段对选图行为零影响。
 */
export function emotionVocabFromList(stickers) {
  const seen = new Set();
  const vocab = [];
  for (const s of Array.isArray(stickers) ? stickers : []) {
    const e = s && s.emotion ? String(s.emotion).toLowerCase().trim() : '';
    if (e && !seen.has(e)) { seen.add(e); vocab.push(e); }
  }
  return vocab;
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    log('info', '[Stickers] Sticker manifest not found, sticker replies disabled.');
    return { stickers: [], byTag: new Map() };
  }
  try {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    const list = Array.isArray(raw.stickers) ? raw.stickers : [];
    let disabledCount = 0;
    const filtered = list.filter(s => {
      if (!s?.file) return false;
      // v1.10.25: 支持 disabled:true 跳过不合人设的 sticker（如儿童形象 BQB
      // 被 16 岁高中生人设 [STICKER:shy] 选中显然别扭）。manifest 里给整组
      // 加 "disabled": true 即可全跳。
      if (s.disabled === true) { disabledCount++; return false; }
      const full = path.join(STICKERS_DIR, s.file);
      const ok = existsSync(full);
      if (!ok) log('warn', `[Stickers] missing file: ${s.file}`);
      return ok;
    });
    const byTag = buildByTagFromList(filtered);
    log('info', `[Stickers] loaded count=${filtered.length} tags=${byTag.size} disabled=${disabledCount}`);
    return { stickers: filtered, byTag };
  } catch (err) {
    log('warn', `[Stickers] manifest 解析失败: ${err.message}`);
    return { stickers: [], byTag: new Map() };
  }
}

function getCache() {
  if (!cache) cache = loadManifest();
  return cache;
}

export function reloadStickers() {
  cache = loadManifest();
  return cache;
}

export function hasStickers() {
  return getCache().stickers.length > 0;
}

export function listAvailableTags(maxTags = 30) {
  const { byTag } = getCache();
  return [...byTag.keys()].slice(0, maxTags);
}

/**
 * S-A：当前启用 sticker 的 canonical emotion 词表（喂 LLM 用）。
 */
export function listEmotionVocab() {
  return emotionVocabFromList(getCache().stickers);
}

/**
 * 按 tag 挑一张。多个匹配时随机选。找不到返回 null。
 */
export function pickSticker(tag) {
  if (!tag) return null;
  const { byTag } = getCache();
  const key = String(tag).toLowerCase().trim();
  let pool = byTag.get(key) || [];
  // 退一步：模糊匹配（tag 包含关系）
  if (pool.length === 0) {
    for (const [k, list] of byTag.entries()) {
      if (k.includes(key) || key.includes(k)) {
        pool = pool.concat(list);
      }
    }
  }
  if (pool.length === 0) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  return {
    id: picked.id,
    file: picked.file,
    fullPath: path.join(STICKERS_DIR, picked.file),
    tags: picked.tags || [],
    emotion: picked.emotion || null,
    description: picked.description || null,
  };
}

/**
 * 从 AI 回复里抽取 [STICKER:tag] 标记。
 * 返回 { text: 剥离后的纯文本, stickers: [{tag, picked}] }
 * 同时支持中文中括号【STICKER:xx】。
 */
const STICKER_RE = /[\[【]STICKER:\s*([\w一-龥]+)\s*[\]】]/gi;
// 缺口④（宽松兜底）：任何 [STICKER:…] / 【STICKER:…】 形态（含连字符/空格/非法字符——严格 RE 的
// [\w一-龥]+ 覆盖不到的）都视作她想发的标记。严格 RE 负责挑图，宽松 RE 负责清残，
// 绝不把 [STICKER:...] 原文当文字漏发给用户。
const STICKER_ANY_RE = /[\[【]\s*STICKER\s*:[^\]】]*[\]】]/gi;

/**
 * 从 AI 回复里抽取 [STICKER:tag] 标记。
 * @param {string} reply
 * @param {{max?: number, enabled?: boolean}} [opts]
 *   - enabled=false（贴纸开关关 / D2 冷却中）→ 一律剥离不挑图（出口硬 drop·缺口①/D2）。
 *   - max（默认 Infinity；reply/proactive 传 1）→ 至多保留 max 张，多余标记只剥不发（D1 焊「一条最多一个」）。
 * 返回 { text: 剥离后的纯文本, stickers: [{tag, picked}] }。同时支持中文中括号【STICKER:xx】。
 */
export function parseStickerMarkers(reply, opts = {}) {
  if (typeof reply !== 'string' || !reply) return { text: reply || '', stickers: [] };
  const { max = Infinity, enabled = true } = opts;
  const stickers = [];
  let text = reply.replace(STICKER_RE, (_, tag) => {
    // enabled=false → 不挑图（出口硬 drop）；enabled=true → 挑到 max 为止，超额只剥不发。
    if (enabled && stickers.length < max) {
      const picked = pickSticker(tag);
      if (picked) stickers.push({ tag, picked });
    }
    return '';   // 匹配到的标记一律从文本剥离（picked 与否、超额与否都不外漏）
  });
  // 缺口④：清掉严格 RE 没覆盖的畸形标记（连字符/空格等），杜绝原文漏给用户。
  text = text.replace(STICKER_ANY_RE, '').replace(/\s+/g, ' ').trim();
  return { text, stickers };
}

/**
 * 剥掉文本里所有贴纸标记（不挑图）。D3 断棘轮用：渲染最近对话上下文 / 喂 LLM 历史前，
 * 把她自己近期用过的 [STICKER:x] 清掉，别让她看见自己的贴纸密度而模仿固化。
 */
export function stripStickerMarkers(text) {
  if (typeof text !== 'string' || !text) return text || '';
  return text.replace(STICKER_RE, '').replace(STICKER_ANY_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * 质/情境门控闸（缺口②·v1.28·dark-then-enable·默认 OFF）：控制「吵架(冲突态)/危机轮不注入贴纸」。
 * 关=字节等价旧行为（v1.27 量节流单独生效）。照 isSocialCircleOn 范式：空/未设→false→旧行为。
 */
export function isStickerContextGateOn() {
  return /^(1|true|on|yes)$/i.test(process.env.STICKER_CONTEXT_GATE || '');
}

/**
 * 质/情境门控判定（缺口②·v1.28·纯函数·可单测·单一来源）：给定本轮情境，是否应【抑制】贴纸。
 * - reply 侧：传 { crisisLevel, arcState, escLevel }（三维全给）。
 * - proactive 侧：只传 { arcState }（无当轮用户输入→无 crisis 维度·escLevel 默认 0）。
 * 闸关（STICKER_CONTEXT_GATE 默认 OFF）→ 恒 false → 字节等价旧行为（v1.27 量节流单独生效）。
 * 🔴 危机极性：crisis 存在则挡（与 bot.mjs 888-893 记忆过滤【相反】，那边 crisis≥medium 反而放行）；
 *    high 危机已由 buildCrisisReply 结构挡（不带 systemPrompt），此处对 high 是纵深。
 */
export function stickerContextBlocked({ crisisLevel = 'none', arcState = 'normal', escLevel = 0 } = {}) {
  if (!isStickerContextGateOn()) return false;
  if (crisisLevel !== 'none') return true;                                                     // 危机全档(medium/low+high纵深)
  if (arcState === 'hurt' || arcState === 'cold' || arcState === 'withdrawing') return true;   // 冲突三态(repairing 破冰不禁)
  if (escLevel >= 2) return true;                                                              // 施压升窗(dogfood 若伤斗嘴→退阈值 3)
  return false;
}

/**
 * 给 system prompt 用：告诉 AI 当前可用的 tag 集合。
 */
export function buildStickerPromptHint(enabled) {
  if (!enabled || !hasStickers()) return '';
  // S-A（40-cap 修复）：用 canonical emotion（英文）当 LLM 词表，不再用 listAvailableTags(40)
  // ——中文别名 / 场景词混入 + 40 截断会埋掉大量维护者特意做的图。examples 从真实 vocab 取
  // 交集，绝不广告池为空的死 tag（如 night/eyeroll 不在则不展示）。
  const emotions = listEmotionVocab();
  if (emotions.length === 0) return '';
  const pick = (cands) => cands.filter(e => emotions.includes(e));
  const ex = (arr) => arr.map(e => `[STICKER:${e}]`).join('、');
  const pos = pick(['happy', 'love', 'shy', 'cute']);
  const snark = pick(['mock', 'dismissive', 'smug', 'speechless', 'huff', 'eyeroll']);
  const scene = pick(['morning', 'sleepy', 'night', 'hug', 'ping']);
  const lines = [
    '',
    '【可用表情包】',
    '- 在合适的场景可以用 [STICKER:情绪] 表情标记（情绪只能用下面列出的英文词）',
  ];
  if (pos.length) lines.push(`- 正面例子：${ex(pos)}`);
  if (snark.length) lines.push(`- 反讽吐槽：${ex(snark)} · 用在他得意忘形 / 说傻话 / 自恋 / 吹牛 / 找事时（"你又觉得你配了"这类反应）`);
  if (scene.length) lines.push(`- 场景：${ex(scene)}`);
  lines.push(`- 可用情绪（只能用这些）：${emotions.join('、')}`);
  lines.push('- 情绪起伏明显的时候用表情更自然、也更像真人——开心 / 害羞 / 撒娇 / 吐槽他 / 晚安早安 / 想他 这些场景都挺贴');
  lines.push('- 频率别太密：平均他发来 3-5 条消息带一个就够；一条消息最多一个表情，放开头或结尾；情绪平淡时不加也很自然');
  lines.push('- **表情包不是照片**——说"拍了/发你看"这类话时，要么系统真的在发照片，要么别这么说；想给他看你看到的东西时，用文字描述画面就行');
  return lines.join('\n');
}
