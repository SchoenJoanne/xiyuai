/**
 * daily_schedule_smoke.mjs — 完整作息/日程系统·红验（停板B·2026-06-24）
 *
 * 锁死（must-pass）：
 *  ① 五身份建模 + 🔴个体派生不雷同（两大学生作息有差异·防「一个样」）+ 确定性稳定 + 洗澡晚上
 *  ② 日历轴接上：工作日/周末/寒暑假/法定节假日 dayKind 不同 + 考研倒计时 + holiday 单一事实源
 *  ③ expectedActivityBand 按 dayKind（active 出门态 / break 在家态）
 *  ④ 🔴 anchor 用真实作息：工作日下午学生→禁在家躺着 / 🔴暑假同点→不误锚(不误杀) / 久醒只 active 硬禁
 *  ⑤ 🔴🔴 有限度趋同双向验红（B 核心）：
 *      - 用户熬到很晚 → 她睡钳在身份基线 ±窗内（不跟到 4:30）=有底线非影子；坏版本(无钳)超窗=证钳收紧
 *      - 用户正常偏移 → 她确朝用户方向偏移（趋同还在·非死板基线）
 *      - userOutpacesHer（该说「你别熬夜啦我先睡了」）只在极端时真
 *      - user_set 冻结 / 旧 locked 不自动覆盖（等迁移）/ 🔴存量迁移把超窗值拉回窗内
 *
 * 跑：DB_PATH=/tmp/ds_smoke.db node scripts/daily_schedule_smoke.mjs
 */
import {
  ROUTINE_PROFILES, IDENTITIES, WINDOW_MIN,
  routineSleepBaseline, expectedActivityBand, showerNorm,
  resolveIdentity, defaultIdentityFromAge,
} from '../src/routine_profiles.mjs';
import { getDayContext, holidayNameFor } from '../src/life_calendar.mjs';
import { tryLockSchedule, remigrateSleepWindow, userOutpacesHer, upsertSleepSchedule } from '../src/sleep.mjs';
import { buildPresenceAnchor } from '../src/companion.mjs';
import { getDb } from '../src/db.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));
const hhmmToMin = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const bedMinOf = s => { const m = hhmmToMin(s); return m < 4 * 60 ? m + 1440 : m; };
const minToHHMM = min => { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ── ① 五身份 + 个体派生不雷同 ──────────────────────────────────────────────────
console.log('— ① 五身份建模 + 个体派生防一个样 —');
for (const id of IDENTITIES) ck(`profile 存在: ${id}`, !!ROUTINE_PROFILES[id] && !!ROUTINE_PROFILES[id].sleep);
ck('age16→highschool', defaultIdentityFromAge(16) === 'highschool');
ck('age20→college', defaultIdentityFromAge(20) === 'college');
ck('age26→worker', defaultIdentityFromAge(26) === 'worker');
ck('显式 life_identity 优先', resolveIdentity({ life_identity: 'exam_prep', age: 20 }) === 'exam_prep');
ck('无显式→age 兜底', resolveIdentity({ age: 17 }) === 'highschool');
const b1 = routineSleepBaseline({ id: 16, life_identity: 'college' }, 'active');
const b2 = routineSleepBaseline({ id: 23, life_identity: 'college' }, 'active');
ck('🔴 两大学生 companion 作息不雷同（派生防一个样）', b1.bedMin !== b2.bedMin || b1.wakeMin !== b2.wakeMin);
const b1b = routineSleepBaseline({ id: 16, life_identity: 'college' }, 'active');
ck('同 id 确定性稳定', b1.bedMin === b1b.bedMin && b1.wakeMin === b1b.wakeMin);
const rng = ROUTINE_PROFILES.college.sleep.active;
ck('落点在身份区间内', b1.bedMin >= rng.bed[0] && b1.bedMin <= rng.bed[1]);
ck('🔴 洗澡晚上为主（修一天洗两次/写早上）', showerNorm({ life_identity: 'college' }).time === 'evening');

// ── ② 日历轴 ──────────────────────────────────────────────────────────────────
console.log('\n— ② 日历轴（学期/寒暑假/法定节假日/考研倒计时）—');
const COL = { life_identity: 'college' };
ck('工作日(周三)→active', getDayContext(COL, '2026-06-24').dayKind === 'active');
ck('周末(周六)→rest', getDayContext(COL, '2026-06-27').dayKind === 'rest');
ck('🔴 暑假学生→break（寒暑假轴接上）', getDayContext(COL, '2026-07-15').dayKind === 'break');
const wb = getDayContext({ life_identity: 'highschool' }, '2026-02-10');
ck('寒假→break + winter_break', wb.dayKind === 'break' && wb.academicPhase === 'winter_break');
const gq = getDayContext({ life_identity: 'worker' }, '2026-10-03');
ck('🔴 国庆→break + holidayName', gq.dayKind === 'break' && gq.holidayName === '国庆');
ck('上班族7月工作日→active（非学生无寒暑假）', getDayContext({ life_identity: 'worker' }, '2026-07-15').dayKind === 'active');
const ex = getDayContext({ life_identity: 'exam_prep' }, '2026-12-10');
ck('🔴 考研冲刺期 examCountdown=sprint', ex.examCountdown && ex.examCountdown.phase === 'sprint');
ck('考研党7月仍 active（无寒暑假）', getDayContext({ life_identity: 'exam_prep' }, '2026-07-15').dayKind === 'active');
ck('holidayNameFor 国庆（单一事实源）', holidayNameFor('2026-10-03') === '国庆');
ck('holidayNameFor 平日→null', holidayNameFor('2026-06-24') === null);

// ── ③ expectedActivityBand 按 dayKind ─────────────────────────────────────────
console.log('\n— ③ expectedActivityBand —');
const bandActive = expectedActivityBand(COL, 'active', 14 * 60);
const bandBreak = expectedActivityBand(COL, 'break', 14 * 60);
ck('工作日下午 band 存在', !!bandActive && !!bandActive.act);
ck('🔴 暑假下午 band 是在家态（不出门）', /家/.test(bandBreak.place));

// ── ④ 🔴 anchor 用真实作息（dayContext+band 经 presence 传入）────────────────────
console.log('\n— ④ 🔴 anchor 用真实作息（不误杀暑假）—');
const WED_14 = new Date('2026-06-24T06:00:00Z');       // 周三 14:00 CST（工作日）
const WED_14_JUL = new Date('2026-07-15T06:00:00Z');   // 14:00 CST（暑假）
const dcActive = getDayContext(COL, '2026-06-24');
const dcBreak = getDayContext(COL, '2026-07-15');
const bandA = expectedActivityBand(COL, 'active', 14 * 60);
const bandB = expectedActivityBand(COL, 'break', 14 * 60);
const aSchool = buildPresenceAnchor(COL, { wokeAt: 0, isSleeping: false, dayContext: dcActive, expectedBand: bandA }, null, WED_14);
ck('🔴 工作日下午学生→禁"在家躺着"（用真实作息）', /别说成"在家躺着/.test(aSchool));
const aSummer = buildPresenceAnchor(COL, { wokeAt: 0, isSleeping: false, dayContext: dcBreak, expectedBand: bandB }, null, WED_14_JUL);
ck('🔴 暑假学生同点→不误锚上学（不误杀）', !/别说成"在家躺着/.test(aSummer));
ck('🔴 暑假久醒→不硬禁刚醒（补觉放宽）', !/不是刚醒/.test(
  buildPresenceAnchor(COL, { wokeAt: WED_14_JUL.getTime() - 6 * 3600_000, isSleeping: false, dayContext: dcBreak, expectedBand: bandB }, null, WED_14_JUL)));
ck('工作日久醒→禁刚醒', /不是刚醒/.test(
  buildPresenceAnchor(COL, { wokeAt: WED_14.getTime() - 6 * 3600_000, isSleeping: false, dayContext: dcActive, expectedBand: bandA }, null, WED_14)));
ck('presence=null→空串（fail-open）', buildPresenceAnchor(COL, null, null, WED_14) === '');

// ── ⑤ 🔴🔴 有限度趋同双向验红（B 核心·DB）─────────────────────────────────────
console.log('\n— ⑤ 🔴🔴 有限度趋同双向验红（B 核心）—');
getDb().pragma('foreign_keys = OFF');   // /tmp 抛弃库·免建 FK 父行
function seedCompanion(id, life_identity) {
  getDb().prepare('INSERT OR REPLACE INTO companions (id,user_id,bot_id,name,age,life_identity) VALUES (?,1,?,?,?,?)')
    .run(id, 'dstest', 'DS' + id, 20, life_identity);
}
function seedSamples(id, lastHHMM, firstHHMM = '09:00') {
  const s = [];
  for (let d = 10; d <= 16; d++) s.push({ date: `2026-06-${d}`, first_msg: firstHHMM, last_msg: lastHHMM });
  upsertSleepSchedule(id, { observed_samples_json: JSON.stringify(s), user_set: 0, learn_state: 'observing', bed_time: '00:30', wake_time: '07:30' });
}
try {
  // (a) 用户熬到很晚（last_msg 03:30）· 考研党（早睡基线·使坏版本断言稳健）
  const idNight = 990201; seedCompanion(idNight, 'exam_prep'); seedSamples(idNight, '03:30');
  const baseE = routineSleepBaseline({ id: idNight, life_identity: 'exam_prep' }, 'active');
  const resE = tryLockSchedule(idNight);
  const lockedBed = bedMinOf(resE.bed_time);
  ck('🔴 用户熬4点→她睡钳在身份基线±窗内（有底线·不是影子）', Math.abs(lockedBed - baseE.bedMin) <= WINDOW_MIN + 1);
  ck('🔴 钳后绝不跟到凌晨4点（≤基线+窗）', lockedBed <= baseE.bedMin + WINDOW_MIN + 1);
  // 坏版本：旧「纯复制」全局 clamp [21:00,26:30] → 02:30，脱离她身份基线=超窗
  const oldStyle = Math.max(21 * 60, Math.min(26 * 60 + 30, bedMinOf('03:30') + 30));
  ck('🔴 坏版本(无钳·全局clamp)超窗=证钳收紧到身份基线', Math.abs(oldStyle - baseE.bedMin) > WINDOW_MIN);
  ck('🔴 钳版本比坏版本更早睡（不无限跟）', lockedBed < oldStyle);
  ck('🔴 用户极端晚→userOutpacesHer 真（该说「你别熬夜啦我先睡了」）', userOutpacesHer(idNight) === true);

  // (b) 用户正常但偏移（落在窗内、与基线错开）→ 她确朝用户偏移（趋同还在·非死板基线）
  const idNorm = 990202; seedCompanion(idNorm, 'college');
  const baseC = routineSleepBaseline({ id: idNorm, life_identity: 'college' }, 'active');
  const targetUserBed = baseC.bedMin + 45;                 // 比她基线晚 45min（窗内）
  seedSamples(idNorm, minToHHMM(targetUserBed - 30));       // userBed = median(last)+30 = 基线+45
  const resN = tryLockSchedule(idNorm);
  const bedN = bedMinOf(resN.bed_time);
  ck('🔴 用户正常偏移→她确朝用户方向偏移（趋同还在·非死板基线）', resN.drifted === true && bedN !== baseC.bedMin);
  ck('🔴 偏移后仍在窗内（不超）', Math.abs(bedN - baseC.bedMin) <= WINDOW_MIN + 1);
  ck('正常用户→不触发「我先睡了」', userOutpacesHer(idNorm) === false);

  // (c) user_set 冻结 / 旧 locked 不自动覆盖 / 存量迁移拉回
  upsertSleepSchedule(idNorm, { user_set: 1 });
  ck('user_set→冻结不覆盖（用户配置她）', tryLockSchedule(idNorm).reason === 'user_set');
  const idLock = 990203; seedCompanion(idLock, 'college'); seedSamples(idLock, '03:30');
  upsertSleepSchedule(idLock, { learn_state: 'locked', bed_time: '03:50', wake_time: '11:00' });
  ck('🔴 旧 locked（纯复制遗留）→不自动覆盖（等维护者迁移）', tryLockSchedule(idLock).reason === 'awaiting_migration');
  const baseL = routineSleepBaseline({ id: idLock, life_identity: 'college' }, 'active');
  const mig = remigrateSleepWindow(idLock);
  ck('🔴 存量迁移：超窗 03:50 拉回身份基线窗内（备份+亲手跑·此处验逻辑）',
    mig.pulled === true && Math.abs(bedMinOf(mig.after.bed) - baseL.bedMin) <= WINDOW_MIN + 1);

  for (const id of [idNight, idNorm, idLock]) getDb().prepare('DELETE FROM companions WHERE id=?').run(id);
} catch (e) {
  ck('⑤ DB 有限度趋同验红跑通', false); console.error('   db err:', e.message, e.stack);
}

console.log(`\n${f === 0 ? '✅' : '🔴'} daily_schedule_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
