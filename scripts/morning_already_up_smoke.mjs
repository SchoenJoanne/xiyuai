/**
 * 2026-06-24 替代方向 morning 防穿帮盲区补丁·回归 smoke（纯函数 + prompt 级·零 LLM·确定性）。
 *
 * 根因：07:30 away_probe「刚洗完澡」→ 09:10 morning「刚醒」自相矛盾。morning prompt 硬编码"刚醒"，
 * 防穿帮闸只看用户、不看她自己今早已发过 proactive。
 * 修法（替代方向·非降级）：proactiveSentThisMorning 时留 morning·只去 prompt 的"刚醒"框架·missedHint 天然保留。
 *
 * 🔴 两方向都验：① 真没发过→照常"刚醒"(不误伤) ② 发过→不装"刚醒"且 missedHint 承接不丢。
 * 🔴 prompt 级（非只纯函数布尔）：断言真实 userMessage / missedHint 文案含/不含"刚醒"。
 */
import { wasProactiveSentThisMorning, buildMorningUserMessage, buildMorningMissedHint, filterMorningMissed } from '../src/proactive.mjs';
import { shanghaiDateKey } from '../src/db.mjs';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  🔴 FAIL', name); } };
const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);   // 秒戳（同 last_proactive_sent_at）
const today = shanghaiDateKey(new Date('2026-06-24T01:10:00Z'));  // 上海 09:10 = 2026-06-24

console.log('── 纯函数 wasProactiveSentThisMorning（信号·两方向+边界+重启）──');
ok('null→false（真没发过）', wasProactiveSentThisMorning({ lastProactiveSentAtSec: 0, todayKey: today }) === false);
ok('undefined→false', wasProactiveSentThisMorning({ lastProactiveSentAtSec: undefined, todayKey: today }) === false);
ok('今早07:30 CST发过→true', wasProactiveSentThisMorning({ lastProactiveSentAtSec: ts('2026-06-23T23:30:00Z'), todayKey: today }) === true);
ok('凌晨01:00 CST(goodnight归昨晚)→false', wasProactiveSentThisMorning({ lastProactiveSentAtSec: ts('2026-06-23T17:00:00Z'), todayKey: today }) === false);
ok('04:59 CST→false（05:00 边界下沿）', wasProactiveSentThisMorning({ lastProactiveSentAtSec: ts('2026-06-23T20:59:00Z'), todayKey: today }) === false);
ok('05:00 CST→true（边界上沿）', wasProactiveSentThisMorning({ lastProactiveSentAtSec: ts('2026-06-23T21:00:00Z'), todayKey: today }) === true);
ok('昨天发过→false（不跨天误判）', wasProactiveSentThisMorning({ lastProactiveSentAtSec: ts('2026-06-22T23:30:00Z'), todayKey: today }) === false);

console.log('── prompt 级 buildMorningUserMessage（两方向·真实文案）──');
const upMsg = buildMorningUserMessage({ morningAlreadyUp: true, missedHint: '' });
const normalMsg = buildMorningUserMessage({ morningAlreadyUp: false, missedHint: '' });
ok('🔴发过→userMsg 不含"带刚醒的迷糊感"', !upMsg.includes('带刚醒的迷糊感'));
ok('发过→userMsg 含"不是刚醒"', upMsg.includes('不是刚醒'));
ok('🔴没发过→userMsg 含"带刚醒的迷糊感"（不误伤正常 morning）', normalMsg.includes('带刚醒的迷糊感'));

console.log('── prompt 级 buildMorningMissedHint（承接不丢·去刚醒）──');
const upHint = buildMorningMissedHint({ count: 3, preview: 'x', morningAlreadyUp: true });
const normalHint = buildMorningMissedHint({ count: 3, preview: 'x', morningAlreadyUp: false });
ok('🔴发过→missedHint 非空且承接昨晚（不丢承接）', upHint.length > 0 && upHint.includes('昨晚'));
ok('发过→missedHint 不含"刚醒来看到"/"表达\\"刚醒\\""', !upHint.includes('刚醒来看到') && !upHint.includes('表达"刚醒"'));
ok('发过→missedHint 含中性承接"看到你昨晚发的了"', upHint.includes('看到你昨晚发的了'));
ok('没发过→missedHint 含"刚醒"（原承接）', normalHint.includes('刚醒'));
ok('无 missed→missedHint 空', buildMorningMissedHint({ count: 0, morningAlreadyUp: true }) === '');

console.log('── must-fix 跨天残留时间窗（filterMorningMissed·peek-no-consume 防护）──');
const bedAtToday = new Date('2026-06-23T16:30:00Z').getTime();   // 今晨睡眠窗起点(06-24 00:30 CST·ms)
const missedRows = [
  { received_at: new Date('2026-06-22T18:00:00Z').getTime(), content: '前天的' },   // 前天 missed → 应滤掉
  { received_at: new Date('2026-06-23T18:00:00Z').getTime(), content: '今晨的' },   // 今晨 missed → 应保留
];
ok('🔴开过滤→只承接今晨（前天滤掉·不跨天穿帮）', (() => { const r = filterMorningMissed(missedRows, bedAtToday); return r.length === 1 && r[0].content === '今晨的'; })());
ok('🔴关过滤(坏版本)→承接到前天（复现跨天穿帮）', filterMorningMissed(missedRows, 0).length === 2);
ok('sinceMs 缺失→fail-open 全保留（宁重复承接不丢）', filterMorningMissed(missedRows, null).length === 2);
ok('非数组→空（防御）', filterMorningMissed(null, bedAtToday).length === 0);

console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
