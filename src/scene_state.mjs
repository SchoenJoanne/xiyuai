/**
 * scene_state.mjs —— live scene 结构化状态（PR-3·B，B-min sidecar，2026-06-15）。
 *
 * #324 把 current_scene 做成「事件驱动持久的单字符串(裸 location)」，但拦不住「场景瞬移」：
 * 某存量案例 06-13 图书馆讲故事 → 突然「刚吃完麻辣香锅回来」= 无 eating 过渡 / 时间流逝就跨场景跳。
 *
 * ── B-min 拍板（修正前条③「current_scene 存 JSON」）──
 *  current_scene 已是跨模块公共**裸字符串契约**（photo_planner/photo_sender/api/export 默认裸
 *  location），改存 JSON 会污染出图链/UI/导出。故 B-min：
 *   · current_scene 保持裸 location 字符串（契约不变·旧消费方零改）。
 *   · 结构化状态（activity/food_state/transition_pending/established_at/last_confirmed_at/source）
 *     存 sidecar 字段 current_scene_meta（TEXT nullable JSON）。
 *   · 🔴 parseSceneState(current_scene, current_scene_meta) 是唯一结构化出口；
 *     buildSceneHint 只接结构化结果输出自然句·**绝不拼 JSON 原文进 prompt**。
 *   · 状态机拦 planning→finished 瞬移、跨地点无过渡瞬移（无 eating 过渡 / 时间流逝 / 他主动宣布时）。
 *
 * 注入串过 user_wording_guard（无「用户」一词·用「他」）。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

export const FOOD_STATES = Object.freeze(['none', 'planning', 'eating', 'finished']);
const NEUTRAL = new Set(['', '日常', '在家', '无']);
export function isNeutralLocation(loc) { return NEUTRAL.has(String(loc || '')); }

function clampStr(v, n) { return v ? String(v).slice(0, n) : null; }

/** 归一化一个（可能残缺的）结构化 state 对象。location 单列、其余进 meta。 */
function normalizeState(o) {
  o = o || {};
  return {
    location: String(o.location || '').trim().slice(0, 30),
    activity: clampStr(o.activity, 20),
    food_state: FOOD_STATES.includes(o.food_state) ? o.food_state : 'none',
    transition_pending: !!o.transition_pending,
    established_at: Number.isFinite(o.established_at) ? o.established_at : null,
    last_confirmed_at: Number.isFinite(o.last_confirmed_at) ? o.last_confirmed_at : null,
    source: o.source || 'dialog',
  };
}

/** 解析 sidecar meta（🔴 容空/容坏 JSON·fail-open）。不含 location。 */
function parseMeta(metaRaw) {
  const base = { activity: null, food_state: 'none', transition_pending: false, established_at: null, last_confirmed_at: null, source: 'dialog' };
  if (metaRaw == null || metaRaw === '') return base;
  let o = metaRaw;
  if (typeof metaRaw === 'string') {
    const s = metaRaw.trim();
    if (!s) return base;
    try { o = JSON.parse(s); } catch { return base; }   // 坏 JSON → 中性兜底
  }
  if (!o || typeof o !== 'object') return base;
  return {
    activity: clampStr(o.activity, 20),
    food_state: FOOD_STATES.includes(o.food_state) ? o.food_state : 'none',
    transition_pending: !!o.transition_pending,
    established_at: Number.isFinite(o.established_at) ? o.established_at : null,
    last_confirmed_at: Number.isFinite(o.last_confirmed_at) ? o.last_confirmed_at : null,
    source: o.source || 'dialog',
  };
}

/**
 * 🔴 唯一结构化 scene 出口：裸 current_scene(location) + sidecar current_scene_meta(JSON)。
 * @returns {location, activity, food_state, transition_pending, established_at, last_confirmed_at, source}
 */
export function parseSceneState(currentScene, currentSceneMeta) {
  const location = String(currentScene == null ? '' : currentScene).trim().slice(0, 30);
  return { location, ...parseMeta(currentSceneMeta) };
}

/**
 * 序列化 sidecar meta（🔴 不含 location——location 永远在裸 current_scene）。
 * 全中性（无 activity/食物/pending/时间锚）→ null：旧 current_scene='在家' 不背 meta 包袱。
 */
export function serializeSceneMeta(state) {
  const s = normalizeState(state);
  if (!s.activity && s.food_state === 'none' && !s.transition_pending && !s.established_at && !s.last_confirmed_at) return null;
  return JSON.stringify({
    v: 1,
    activity: s.activity,
    food_state: s.food_state,
    transition_pending: s.transition_pending,
    established_at: s.established_at,
    last_confirmed_at: s.last_confirmed_at,
    source: s.source,
  });
}

/**
 * scene 守卫提示（🔴 只输出自然句·不拼 JSON 原文）。location 由 companion §6 注入，
 * 此处只补结构化提示（进食态/待过渡），返回 '' 表示无需额外提示（普通场景不刻板）。
 */
export function buildSceneHint(currentScene, currentSceneMeta) {
  const s = parseSceneState(currentScene, currentSceneMeta);
  let h = '';
  if (s.activity && !NEUTRAL.has(s.location)) h += `（你正在${s.activity}。）`;
  if (s.food_state === 'planning') h += '（你们刚说要去吃东西、还没吃上——别说成「刚吃完」。）';
  else if (s.food_state === 'eating') h += '（正在吃东西、还没吃完。）';
  if (s.transition_pending) h += '（场景刚要变、还没真过去——没有自然过渡别突然跳到别处、或说成已经做完了。）';
  return h;
}

/**
 * 场景转换状态机：prevState → nextState。拦无过渡的瞬移（某存量案例 根因）。
 *  enoughTime（≥30min 时间流逝）或 userTransition（他自己说「吃完了/到了」·日程过渡）才允许跳。
 * @returns 合并后 state（被拦：保持旧态 + transition_pending=true）。
 *          caller 拆 location→current_scene、其余→serializeSceneMeta(meta)。
 */
const HALF_HOUR_MS = 30 * 60e3;
export function applySceneTransition(prevState, nextState, { nowMs = Date.now(), userTransition = false } = {}) {
  const prev = normalizeState(prevState);
  const next = normalizeState(nextState);
  // 本轮无新场景信号 → 保留现值（#324 跨轮持久＝修复要害）。注意「在家」是真实切换(到家了)不算无信号。
  if ((!next.location || next.location === '日常' || next.location === '无') && next.food_state === 'none' && !next.activity) {
    return prev;
  }
  const elapsedMs = prev.established_at ? (nowMs - prev.established_at) : Infinity;
  const enoughTime = elapsedMs >= HALF_HOUR_MS;
  const out = { ...next };

  // ① food_state planning→finished：无 eating 过渡 + 无足够时间 + 非他主动宣布 → 拦（保持 planning）
  if (prev.food_state === 'planning' && next.food_state === 'finished' && !userTransition && !enoughTime) {
    out.food_state = 'planning';
    out.transition_pending = true;
    if (!out.location) out.location = prev.location;
  }

  // ② 跨地点瞬移：location 从一个真实场景突变到另一个 + 无过渡 → 保持旧 location（标 pending）
  if (prev.location && !NEUTRAL.has(prev.location) && next.location && next.location !== prev.location
      && !userTransition && !enoughTime) {
    out.location = prev.location;
    out.activity = prev.activity;
    out.food_state = prev.food_state;
    out.transition_pending = true;
  }

  // established_at：真正发生切换（且没被拦）才刷新计时锚点
  const realChange = (out.location !== prev.location || out.food_state !== prev.food_state) && !out.transition_pending;
  out.established_at = realChange ? nowMs : (prev.established_at || nowMs);
  return normalizeState(out);
}

/**
 * 出站闭环兜底：current_scene 已确立时，禁 reply 凭空宣布「刚吃完/回来了」等未过渡的场景完成。
 *  仅当 location 非中性 或 food_state ∈ {planning,eating}（即「还没吃完/在某固定场景」）时才拦。
 */
const FINISH_JUMP_RE = /刚(?:吃完|喝完|吃过|搓了一顿)|(?:吃完|聚餐|搓)(?:饭|火锅|香锅|烧烤|串|大餐).{0,4}回来|刚从.{0,8}(?:回来|出来)/;
export function scrubSceneJump(reply, currentScene, currentSceneMeta) {
  if (typeof reply !== 'string' || !reply) return reply;
  const s = parseSceneState(currentScene, currentSceneMeta);
  const guarding = (!NEUTRAL.has(s.location) || s.food_state === 'planning' || s.food_state === 'eating');
  if (!guarding) return reply;                       // 中性场景不刻板拦
  if (s.food_state === 'finished') return reply;     // 已经是吃完态·放行
  const segs = reply.split('||');
  const kept = segs.filter((seg) => !FINISH_JUMP_RE.test(seg));
  if (kept.length === segs.length) return reply;
  return kept.length ? kept.join('||') : '嗯…我还在这边呢，没去哪';   // 全被剔(单段瞬移)→中性软兜底
}
