/**
 * topic_loosen_smoke.mjs — topic 松绑·停板B 二轮·红验（2026-06-25）
 *
 * 锁死（must-pass）：
 *  ① 🔴🔴 主刀「每日预算」坏版本验红：
 *     - 每日预算（默认2）：今日 0→1→2，达2 → buildHint 今日不再开；
 *     - 🔴 日界重置「非时间间隔」：同一 dateKey 重读不衰减（时间过去不影响）；不同 dateKey=新的一天→归 0（只看"是不是新的一天"，不看"距上次多久"）；
 *     - 🔴 坏版本对比：旧"进程级永不重置"=次日仍堵（"开不出几次"）；主刀次日能再开 = 治真根因。
 *  ② fail-silent：档案池空 → 不开不编（''）。
 *  ③ 🔴 不读沉默焊死行：topicClosureSignal userText 空/空白 → false（放宽点全在其后·绝不读沉默）。
 *  ④ 取料扩面：works kind=series → "在追的" 框；progress_note 进料（零新数据源）。
 *  ⑤ clearTopicOpensTodayAll（次日 cron 清·读侧已自愈）。
 *
 * 跑：DB_PATH=/tmp/topic_loosen.db node scripts/topic_loosen_smoke.mjs
 */
import { getDb, getTopicOpensToday, bumpTopicOpensToday, clearTopicOpensTodayAll } from '../src/db.mjs';
import { buildTopicOpenerHint, topicClosureSignal, TOPIC_OPEN_DAILY } from '../src/topic_opener.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));

const turns = [
  { role: 'user', content: '在干嘛' }, { role: 'assistant', content: '在看书呀' },
  { role: 'user', content: '嗯' }, { role: 'assistant', content: '挺好看的' },
  { role: 'user', content: '嗯嗯' }, { role: 'assistant', content: '嗯' },
  { role: 'user', content: '哦' },
];
const ARCH = { works: [{ title: '活着', kind: 'book', progress_note: '看到一半' }], lifeStates: [], dailySchedule: null, openLoops: [], affectionLevel: 0 };

// ── ① 🔴🔴 主刀每日预算 + 日界重置非时间（DB）──
console.log('— ① 🔴🔴 每日预算·日界重置非时间（坏版本验红）—');
getDb().pragma('foreign_keys = OFF');   // /tmp 抛弃库·免建 FK 父行
const id = 990301;
getDb().prepare('INSERT OR REPLACE INTO companions (id,user_id,bot_id,name) VALUES (?,1,?,?)').run(id, 'tl', 'TL');
const D1 = '2026-06-25', D2 = '2026-06-26';
ck('day1 初始 0', getTopicOpensToday(id, D1) === 0);
ck('bump→1', bumpTopicOpensToday(id, D1) === 1);
ck('bump→2', bumpTopicOpensToday(id, D1) === 2);
ck('day1 读=2', getTopicOpensToday(id, D1) === 2);
ck(`🔴 达预算${TOPIC_OPEN_DAILY}→今日 buildHint 不再开`, buildTopicOpenerHint(turns, ARCH, { alreadyOpenedCount: getTopicOpensToday(id, D1) }) === '');
// 🔴 日界重置「非时间间隔」：同日重读不衰减；新的一天才归 0
ck('🔴 同日重读仍 2（非时间衰减·改"距上次多久"不影响）', getTopicOpensToday(id, D1) === 2);
ck('🔴 新的一天→0（日界重置·只看是不是新的一天）', getTopicOpensToday(id, D2) === 0);
ck('day2 bump→1（次日能再开）', bumpTopicOpensToday(id, D2) === 1);
// 🔴 坏版本对比：旧进程级永不重置=次日仍堵（开不出几次）；主刀次日能开<预算
ck('🔴 坏版本验红：主刀次日可再开（进程级永不重置则次日仍堵）', getTopicOpensToday(id, D2) >= 1 && getTopicOpensToday(id, D2) < TOPIC_OPEN_DAILY);
ck('🔴 次日未达预算→buildHint 能开（治"开不出几次"）', buildTopicOpenerHint(turns, ARCH, { alreadyOpenedCount: getTopicOpensToday(id, D2) }) !== '');

// ── ② fail-silent ──
console.log('— ② fail-silent —');
ck('档案空→不开不编（fail-silent）', buildTopicOpenerHint(turns, { works: [], lifeStates: [], dailySchedule: null, openLoops: [], affectionLevel: 0 }, { alreadyOpenedCount: 0 }) === '');

// ── ③ 🔴 不读沉默焊死行 ──
console.log('— ③ 🔴 不读沉默焊死行 —');
ck('🔴 userText 空→false（焊死行·绝不读沉默）', topicClosureSignal(turns, '', {}) === false);
ck('🔴 userText 纯空白→false', topicClosureSignal(turns, '   ', {}) === false);
ck('🔴 userText 非空 + 首轮→false（前置闸·不抢破冰）', topicClosureSignal(turns, '哦', { isFirstTurn: true }) === false);
ck('🔴 userText 非空 + 危机→false（让位）', topicClosureSignal(turns, '哦', { crisisLevel: 'high' }) === false);

// ── ④ 取料扩面 works kind ──
console.log('— ④ 取料扩面 works kind（零新数据源）—');
const hSeries = buildTopicOpenerHint(turns, { works: [{ title: '某剧', kind: 'series', progress_note: '追到12集' }], lifeStates: [], dailySchedule: null, openLoops: [], affectionLevel: 0 }, { alreadyOpenedCount: 0 });
ck('🔴 series→"在追的"框', /在追的/.test(hSeries));
ck('progress_note 进料（追到12集）', /追到12集/.test(hSeries));
const hCraft = buildTopicOpenerHint(turns, { works: [{ title: '围巾', kind: 'craft', progress_note: '织了一半' }], lifeStates: [], dailySchedule: null, openLoops: [], affectionLevel: 0 }, { alreadyOpenedCount: 0 });
ck('🔴 craft→"在做的手工"框', /在做的手工/.test(hCraft));

// ── ⑤ clear ──
console.log('— ⑤ clearTopicOpensTodayAll —');
bumpTopicOpensToday(id, D1);
clearTopicOpensTodayAll();
ck('clear→count 0', getTopicOpensToday(id, D1) === 0);
getDb().prepare('DELETE FROM companions WHERE id = ?').run(id);

console.log(`\n${f === 0 ? '✅' : '🔴'} topic_loosen_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
