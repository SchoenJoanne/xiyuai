/**
 * clock.mjs —— 可注入时钟（测试/沙箱用·生产零行为变化）。
 *
 * 动机：proactive 是时间驱动的（早安/晚安时段、24h 窗口、静默闸、photo 48h、想你冷却、
 * 依恋退场 24-72h）。真实时间跑太慢、时间边界手动几乎没法测。本模块让测试/沙箱注入假时钟、
 * 在几秒内高速模拟多天，验证 proactive 的时序触发逻辑。
 *
 * ── 死守纪律（决定生产零风险）──
 *  ① **生产永不调 setClock/advanceClock** → `_fake` 恒为 null → `now()` ≡ `Date.now()`，
 *     业务行为与改造前逐位一致。一旦有人在生产路径调 setClock 即视为测试态 bug。
 *  ② 仅 **业务时间**（早晚时段/窗口/冷却/退场判断、以及内容里的"今天"）走本时钟；
 *     msgId、setTimeout 真实延迟、日志时间戳等**实现细节**不走（它们不是业务时序）。
 *  ③ 时区：`new Date(clock.now()).getHours()` 仍走服务器本地时区——注入 fakeClock 时
 *     调用方须明确所设 ms 对应的目标时区（夜间静默/早安时段用 getHours、上海 key 用
 *     getUTCHours+8），本模块只提供 ms，不替调用方决定时区。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

let _fake = null;   // null = 真实时间（生产默认）；number(ms) = 注入的固定时刻

/** 当前业务时间（ms）。生产默认 = Date.now()。替换裸 `Date.now()`。 */
export function now() { return _fake == null ? Date.now() : _fake; }

/** 当前业务时间（Date 对象）。替换裸 `new Date()`。 */
export function nowDate() { return new Date(now()); }

/** 是否处于注入(假时钟)态——仅测试/断言用。 */
export function isFake() { return _fake != null; }

/** 设定假时钟（测试/沙箱）。接受 ms(number) / Date / 可解析时间字符串；传 null 还原真实时间。 */
export function setClock(t) {
  if (t == null) { _fake = null; return; }
  const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error(`clock.setClock: 无法解析时间 ${t}`);
  _fake = ms;
}

/** 快进 N 毫秒（测试/沙箱）。未设假时钟时以当前真实时间起步。返回快进后的 ms。 */
export function advanceClock(deltaMs) {
  if (!Number.isFinite(deltaMs)) throw new Error(`clock.advanceClock: 非法增量 ${deltaMs}`);
  _fake = (_fake == null ? Date.now() : _fake) + deltaMs;
  return _fake;
}

/** 重置回真实时间（测试 teardown 必调，防假时钟泄漏到别的用例/进程）。 */
export function resetClock() { _fake = null; }

export const HOUR_MS = 3600e3;
export const DAY_MS = 86400e3;
