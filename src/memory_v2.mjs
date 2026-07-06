/**
 * memory_v2.mjs
 * Memory v3 utilities: layer normalization, sensitivity filter,
 * decay scoring, recall ranking, and deduplication.
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { log } from './logger.mjs';
import { patchMemory, touchMemory, getDb } from './db.mjs';
import { embedText } from './ai.mjs';
// 🔴 批D·件③b(维护者 拍 A)：computeMemoryDecay + D2-1 打分公式迁到零依赖叶子 memory_decay.mjs
//   （破 db↔memory_v2 成环·单源无环）。本地 import 供夜批/rank 用·并 re-export 保既有 caller 零改动。
import { computeMemoryDecay, scoreMemoryForRecall } from './memory_decay.mjs';

// ─── Allowed enumerations ──────────────────────────────────────────────────────

export const MEMORY_LAYERS = [
  'core_persona', 'relationship_rule', 'user_fact',
  'preference', 'event', 'emotion', 'summary',
];

export const MEMORY_STATUSES = ['active', 'archived', 'contradicted', 'deleted'];

export const MEMORY_SOURCES = ['auto', 'user', 'system', 'summary', 'reflection', 'imported'];

// Map legacy memory_type → memory_layer for backward compat display
const LEGACY_TYPE_TO_LAYER = {
  fact:            'user_fact',
  preference:      'preference',
  event:           'event',
  emotion:         'emotion',
  image:           'event',
  daily_summary:   'summary',
  weekly_summary:  'summary',
  monthly_summary: 'summary',
};

export function normalizeMemoryLayer(layer) {
  if (MEMORY_LAYERS.includes(layer)) return layer;
  if (LEGACY_TYPE_TO_LAYER[layer]) return LEGACY_TYPE_TO_LAYER[layer];
  return 'event';
}

export function normalizeMemoryWeight(weight) {
  const n = Number(weight);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(0, Math.round(n)));
}

// ─── Sensitive content filter ─────────────────────────────────────────────────
// v1.20 (PR2): 单一真源迁移到 src/privacy_filter.mjs（身份证 GB 校验 / 银行卡
// Luhn / 手机号·住址·学校班级脱敏），这里 re-export 保持既有调用方
// （diary / relational_diary / thoughts / reflection）零改动。
export { isSensitiveMemoryContent, sanitizeMemoryContent } from './privacy_filter.mjs';

// ─── Decay score ──────────────────────────────────────────────────────────────
// 🔴 批D·件③b(维护者 拍 A)：computeMemoryDecay 迁到零依赖叶子 src/memory_decay.mjs（破环·单源）。
//   此处 re-export 保既有 caller 零改动（夜批 applyMemoryDecayBatch:189 / rank / d2_autopin_decay_smoke /
//   p0_regression_check「memory_v2 exportiert computeMemoryDecay」）。本地 import 见顶部·此处 re-export。
export { computeMemoryDecay, scoreMemoryForRecall };

// ─── Recall ranking ───────────────────────────────────────────────────────────

/**
 * Re-rank a list of recalled memories using the D2-1 decay score (单源=memory_decay.scoreMemoryForRecall)。
 * Returns sorted array (highest relevance first).
 * 🔴 死代码留观（零 caller·rank 留二级期迁移·见决议 297「rank 标注释留二级」）：真活路 recallMemories(db.mjs)
 *   已直接 import scoreMemoryForRecall 就地评分；此函数保持导出仅为 p0_regression + 二级期消费者接线预留。
 */
export function rankMemoriesForRecall(memories, context = '') {
  const ctxWords = (context || '')
    .replace(/[^一-龥a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2);

  return memories
    .filter(m => {
      if (m.memory_status && m.memory_status !== 'active') return false;
      if (m.do_not_mention) return false;
      return true;
    })
    .map(m => ({ ...m, _recall_score: scoreMemoryForRecall(m, ctxWords) }))
    .sort((a, b) => b._recall_score - a._recall_score);
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/**
 * Simple deduplication: returns a subset where content is not "too similar".
 * For same companion_id + same memory_layer, strings sharing > 70% of tokens
 * count as duplicate. Keeps the higher-weight one.
 */
export function dedupeMemories(memories) {
  const keep = [];
  for (const m of memories) {
    const isDup = keep.some(k => {
      if (k.memory_layer !== m.memory_layer) return false;
      return tokenSimilarity(k.content || '', m.content || '') > 0.7;
    });
    if (!isDup) keep.push(m);
  }
  return keep;
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  const ta = new Set(a.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean));
  const tb = new Set(b.replace(/[^一-龥a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let common = 0;
  for (const t of ta) { if (tb.has(t)) common++; }
  return common / Math.max(ta.size, tb.size);
}

// ─── Decay writeback ──────────────────────────────────────────────────────────

/**
 * Returns true if the new decay score differs enough to be worth writing back.
 */
export function shouldWriteBackDecay(memory, newDecay) {
  if (memory.locked || memory.pinned) return false;
  const stored = typeof memory.decay_score === 'number' ? memory.decay_score : 1.0;
  return Math.abs(stored - newDecay) >= 0.02;
}

/**
 * Batch-compute and write back decay scores to the DB.
 * Processes up to batchSize active, non-locked, non-pinned memories at a time.
 */
export function applyMemoryDecayBatch(db, options = {}) {
  const batchSize = options.batchSize ?? 200;
  const now = options.now ?? new Date();

  const rows = db.prepare(`
    SELECT id, companion_id, memory_weight, memory_status, locked, pinned,
           last_used_at, created_at, decay_score
    FROM companion_memories
    WHERE memory_status = 'active'
      AND (locked IS NULL OR locked = 0)
      AND (pinned IS NULL OR pinned = 0)
    ORDER BY last_used_at ASC
    LIMIT ?
  `).all(batchSize);

  const update = db.prepare(`
    UPDATE companion_memories SET decay_score = ?, updated_at = ? WHERE id = ?
  `);

  const runBatch = db.transaction((rows) => {
    let written = 0;
    for (const row of rows) {
      const newDecay = computeMemoryDecay(row, now);
      if (shouldWriteBackDecay(row, newDecay)) {
        update.run(newDecay, now.toISOString(), row.id);
        written++;
      }
    }
    return written;
  });

  try {
    const written = runBatch(rows);
    log('info', `[MemoryDecay] 批次衰减写回 checked=${rows.length} written=${written}`);
    return { checked: rows.length, written };
  } catch (e) {
    log('error', `[MemoryDecay] 批次写回失败: ${e.message}`);
    return { checked: 0, written: 0 };
  }
}

// ─── Semantic dedup ───────────────────────────────────────────────────────────

const EMBEDDING_SIM_THRESHOLD = Number(process.env.MEMORY_EMBEDDING_SIM_THRESHOLD) || 0.86;

/**
 * Cosine similarity between two float arrays.
 */
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function parseEmbeddingBlob(buf) {
  if (!buf) return null;
  try {
    if (Buffer.isBuffer(buf)) {
      return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
    }
    if (typeof buf === 'string') return JSON.parse(buf);
    if (Array.isArray(buf)) return buf;
  } catch { /* ignore */ }
  return null;
}

/**
 * Find an existing memory whose embedding is cosine-similar to the given content.
 * Falls back to token similarity if embedding unavailable.
 * Returns the matching memory row or null.
 */
export async function findSimilarMemoryByEmbedding(companionId, content, options = {}) {
  const layer = options.layer;
  const threshold = options.threshold ?? EMBEDDING_SIM_THRESHOLD;
  const db = options.db ?? getDb();

  if (!content || !companionId) return null;

  let queryEmb = null;
  try {
    queryEmb = await embedText(content);
  } catch { /* embedding unavailable → use token fallback */ }

  const whereLayer = layer ? `AND memory_layer = ?` : '';
  const params = [companionId, ...(layer ? [layer] : [])];
  const candidates = db.prepare(`
    SELECT id, companion_id, memory_layer, memory_weight, content, embedding, memory_status
    FROM companion_memories
    WHERE companion_id = ?
      AND memory_status = 'active'
      ${whereLayer}
    ORDER BY created_at DESC
    LIMIT 500
  `).all(...params);

  if (candidates.length === 0) return null;

  if (queryEmb) {
    let bestSim = -1, bestRow = null;
    for (const row of candidates) {
      const rowEmb = parseEmbeddingBlob(row.embedding);
      if (!rowEmb) continue;
      const sim = cosineSim(queryEmb, rowEmb);
      if (sim > bestSim) { bestSim = sim; bestRow = row; }
    }
    if (bestSim >= threshold) return bestRow;
  }

  // Token fallback
  for (const row of candidates) {
    if (tokenSimilarity(row.content || '', content) > 0.7) return row;
  }
  return null;
}

/**
 * Add a new memory or merge into an existing similar one.
 * If a similar memory is found: bump its weight and update content note.
 * If not: insert the new memory row.
 */
export async function addOrMergeMemory(companionId, memoryInput, options = {}) {
  const db = options.db ?? getDb();
  const layer = normalizeMemoryLayer(memoryInput.memory_layer || memoryInput.memoryType || 'event');
  const content = memoryInput.content;

  if (!content) return { action: 'skip', reason: 'empty_content' };

  const similar = await findSimilarMemoryByEmbedding(companionId, content, { layer, db });

  if (similar) {
    const newWeight = Math.min(5, (similar.memory_weight ?? 3) + 1);
    try {
      patchMemory(similar.id, companionId, { memory_weight: newWeight });
      touchMemory(similar.id, companionId);
      log('info', `[MemoryDedup] companion=${companionId} merged into id=${similar.id} layer=${layer}`);
    } catch (e) {
      log('warn', `[MemoryDedup] merge 失败 id=${similar.id}: ${e.message}`);
    }
    return { action: 'merged', existingId: similar.id };
  }

  return { action: 'insert', memory: { ...memoryInput, memory_layer: layer } };
}

/**
 * Given a list of newly extracted memories and existing memories for a companion,
 * filter out near-duplicates. If duplicate found, bumps weight of existing instead.
 */
export function filterNewMemoriesAgainstExisting(newMemories, existingMemories, db, companionId) {
  const toInsert = [];
  for (const nm of newMemories) {
    const dup = existingMemories.find(em => {
      if (em.memory_status === 'deleted') return false;
      if (em.memory_layer !== normalizeMemoryLayer(nm.memoryType || nm.memory_layer || 'event')) return false;
      return tokenSimilarity(em.content || '', nm.content || '') > 0.65;
    });
    if (dup) {
      // Bump weight and use_count of existing rather than inserting
      try {
        const newWeight = Math.min(5, (dup.memory_weight ?? 3) + 1);
        patchMemory(dup.id, companionId, { memory_weight: newWeight });
        touchMemory(dup.id, companionId);
      } catch (e) {
        log('warn', `[MemoryV2] 更新重复记忆权重失败: ${e.message}`);
      }
    } else {
      toInsert.push(nm);
    }
  }
  return toInsert;
}
