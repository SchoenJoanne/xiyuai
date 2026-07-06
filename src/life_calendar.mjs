/**
 * 生活日历（完整作息/日程系统 · 停板B）
 *
 * 整个缺失的日历轴：学期/寒暑假/法定节假日/星期几 + 考研倒计时。`getDayContext`
 * 同时喂 ①日程生成（plan_tasks）②即时态 anchor（companion.buildPresenceAnchor）——
 * 单一事实源，两处共享 → 天然一致，不会「日程说在家、anchor 说上班」。
 *
 * 🔴 单一事实源：法定节假日表也供 companion.mjs 时间感知块复用（合并原 :878 孤岛列表）。
 *
 * 学期/寒暑假边界用「全国主流近似」（维护者拍板：精确到每校校历没必要）。
 * 节假日日期为 2026 年（农历节日 ±1 天误差·见注），每年维护一次。
 *
 * 纯函数，零 db/io 依赖。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import { resolveIdentity } from './routine_profiles.mjs';

// 2026 法定节假日（区间·含调休放假日）。multiDay=长假(≥3天·位移态)。
// 🔴 农历节日(春节/端午/中秋)按 2026 公历近似，可能 ±1 天；维护者已接受近似。
const HOLIDAYS_2026 = Object.freeze([
  { name: '元旦', start: '2026-01-01', end: '2026-01-03', multiDay: true },
  { name: '春节', start: '2026-02-15', end: '2026-02-23', multiDay: true },
  { name: '清明', start: '2026-04-04', end: '2026-04-06', multiDay: true },
  { name: '劳动节', start: '2026-05-01', end: '2026-05-05', multiDay: true },
  { name: '端午', start: '2026-06-19', end: '2026-06-21', multiDay: true },
  { name: '中秋', start: '2026-09-25', end: '2026-09-27', multiDay: true },
  { name: '国庆', start: '2026-10-01', end: '2026-10-07', multiDay: true },
]);

// 调休补班日（周末却要上班/上学）。🔴 近似缺口：2026 精确补班日未逐一编码，
// 暂留扩展位——未编码的补班周末会被当普通周末（rest），低危近似，不静默冒充全覆盖。
const MAKEUP_WORKDAYS_2026 = Object.freeze([]);

function parseKey(dateKey) {
  const [Y, M, D] = String(dateKey).split('-').map(n => parseInt(n, 10));
  return { Y, M, D };
}
function dayOfWeek(dateKey) {
  const { Y, M, D } = parseKey(dateKey);
  return new Date(Date.UTC(Y, M - 1, D)).getUTCDay(); // 0=日 .. 6=六
}
function inRange(dateKey, start, end) { return dateKey >= start && dateKey <= end; }

/** 查节假日（供 getDayContext 与 companion.mjs 单一事实源复用）。 */
export function getHoliday(dateKey) {
  for (const h of HOLIDAYS_2026) if (inRange(dateKey, h.start, h.end)) return h;
  return null;
}
/** 节日名（companion.mjs 时间感知块用·替代原孤岛列表）。 */
export function holidayNameFor(dateKey) {
  const h = getHoliday(dateKey);
  return h ? h.name : null;
}

function isStudent(identity) { return identity === 'highschool' || identity === 'college'; }

/** 学生寒暑假（全国主流近似）。 */
function semesterBreak(M, D) {
  if ((M === 1 && D >= 15) || (M === 2)) return 'winter_break'; // 寒假≈1月中-2月底（春节锚）
  if (M === 7 || M === 8) return 'summer_break';                // 暑假≈7-8月
  return null;
}

// 考研默认锚：12月20日初试（近似）。考公省考春季另说，本版只锚考研。
function examCountdownFor(dateKey) {
  const { Y, M, D } = parseKey(dateKey);
  const toMs = (y) => Date.UTC(y, 11, 20); // 当年 12-20
  const todayMs = Date.UTC(Y, M - 1, D);
  let examY = Y;
  // 考完窗：12-21 ~ 次年 1-31 视为 post_exam
  if ((M === 12 && D >= 21) || (M === 1)) {
    return { phase: 'post_exam', daysLeft: 0 };
  }
  if (todayMs > toMs(Y)) examY = Y + 1;
  const daysLeft = Math.round((toMs(examY) - todayMs) / 86400000);
  const phase = daysLeft <= 30 ? 'sprint' : 'steady';
  return { phase, daysLeft };
}

/**
 * 某 companion 在某天的日历上下文。dayKind ∈ active|rest|break 直接选 profile 的
 * 睡眠基线/时段轴/生成 hint。
 * @param companion 含 life_identity/age
 * @param dateKey 'YYYY-MM-DD'（上海时区日）
 * @returns {{identity,dayKind,label,isWeekend,holidayName,academicPhase,examCountdown}}
 */
export function getDayContext(companion, dateKey) {
  const identity = resolveIdentity(companion);
  const { M, D } = parseKey(dateKey);
  const dow = dayOfWeek(dateKey);
  const isWeekend = dow === 0 || dow === 6;
  const holiday = getHoliday(dateKey);
  const isMakeup = MAKEUP_WORKDAYS_2026.includes(dateKey);

  let dayKind, label, academicPhase = null, examCountdown = null;

  if (identity === 'exam_prep') {
    // 备考无寒暑假；法定长假可松一档，平时周末=放半天(rest)，工作日=学(active)
    if (holiday && holiday.multiDay) { dayKind = 'rest'; label = `${holiday.name}（备考也歇半天）`; }
    else if (isWeekend && !isMakeup) { dayKind = 'rest'; label = '周末（放半天风）'; }
    else { dayKind = 'active'; label = '备考日'; }
    examCountdown = examCountdownFor(dateKey);
    return { identity, dayKind, label, isWeekend, holidayName: holiday ? holiday.name : null, academicPhase, examCountdown };
  }

  const acadBreak = isStudent(identity) ? semesterBreak(M, D) : null;

  if (acadBreak) {
    dayKind = 'break';
    label = acadBreak === 'winter_break' ? '寒假' : '暑假';
    academicPhase = acadBreak;
  } else if (holiday && holiday.multiDay) {
    dayKind = 'break';
    label = `${holiday.name}假期`;
  } else if (isMakeup) {
    dayKind = 'active';
    label = '调休补班日';
    academicPhase = isStudent(identity) ? 'in_session' : null;
  } else if (isWeekend || holiday) {
    dayKind = 'rest';
    label = holiday ? holiday.name : '周末';
  } else {
    dayKind = 'active';
    label = '工作日';
    academicPhase = isStudent(identity) ? 'in_session' : null;
  }

  return { identity, dayKind, label, isWeekend, holidayName: holiday ? holiday.name : null, academicPhase, examCountdown };
}
