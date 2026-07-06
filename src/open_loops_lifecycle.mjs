/**
 * open_loops_lifecycle.mjs —— open_loops 生命周期状态机·N-day 过期分层单一权威源（零依赖叶子·批D·件⑤）
 *
 * 只依赖 Math / Number / Date.parse —— **不 import 任何 src 模块**（db.mjs 与 open_loops.mjs 皆 import·破环）。
 * 状态图（决议 267/269/297·考试案四环同一张图）：
 *   open →（答中/兑现）closed(resolved) →（due 后 N 天·分层）expired → 注入计数上限强制冷却。
 *
 * 🔴 三处同源（决议 297②「三处同源单一导出」）：本叶子的 EXPIRE_DAYS/EXPIRE_TIMELY_KINDS 被
 *   ① dueStatus 封顶（open_loops.mjs·读侧不再"越过期越催"）
 *   ② markStaleOpenLoops 分层→expired（db.mjs·夜批）
 *   ③ listDueOpenLoops 下界+精滤（db.mjs·recall 路不再捞起远期过期 loop）
 *   共同引用——改一处即三处同步（防两张皮）。
 */

// N-day 过期分层（决议 297② 逐字）：
//   时效类 exam/deadline/meeting/date = 2 天（🔴 当前提取器未产这些 kind·休眠待 finer kind·期2）
//   her_promise/user_said/todo/appointment（有 due_at）= 7 天
//   无 due_at = 14 天（自创建起）· 兜底 7 天
//   判据="再提起是关心还是翻旧账"（过 N 天=翻旧账·停）。
export const EXPIRE_TIMELY_KINDS = ['exam', 'deadline', 'meeting', 'date'];
export const EXPIRE_DAYS = {
  timely: 2,     // 时效类（休眠·待 finer kind 提取）
  standard: 7,   // 4 个现役 kind（有 due_at）
  noDue: 14,     // 无 due_at·按 created_at
};

// 注入计数上限（决议 297⑦）：同一 loop 主动问满 CAP 次 → 强制 expired（提醒三次松手·同防沉迷 CAP 美学）。
export const FOLLOWUP_CAP = 3;

// 单条 loop 两次 follow-up 的最小间隔（6h·单源·修 proactive.mjs:992 注释"14天"↔代码 6h 两张皮）。
export const LOOP_FOLLOWUP_COOLDOWN_MS = 6 * 3600_000;

/** 有 due_at 的 loop：按 kind 返回过期天数（时效类 2 / 其余 7）。 */
export function expireDaysForKind(loopKind) {
  return EXPIRE_TIMELY_KINDS.includes(loopKind) ? EXPIRE_DAYS.timely : EXPIRE_DAYS.standard;
}

/**
 * 读时判定：due_at 过期是否超过其 kind 的 N 天（真·封顶·不依赖夜批活着）。
 * @returns {boolean} true=已 expired（超 N 天·该停止催问）
 */
export function isDueExpired(dueAt, todayKey, loopKind) {
  const dd = String(dueAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dd)) return false;               // 无/脏 due_at → 不由此判 expired
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(todayKey || ''))) return false;
  const d = Date.parse(dd + 'T00:00:00+08:00');
  const t = Date.parse(todayKey + 'T00:00:00+08:00');
  if (Number.isNaN(d) || Number.isNaN(t)) return false;           // fail-open：不误判 expired
  const overdue = Math.round((t - d) / 86_400_000);               // 今天 - due（正=已过期天数）
  return overdue > expireDaysForKind(loopKind);
}
