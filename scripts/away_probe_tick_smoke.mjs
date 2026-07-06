/**
 * A刀 红验③①：mark 边界 + 整 tick 单条（决策层·套 proactive_timeline_smoke「调度判断层」范式）。
 * ③ shouldMarkAwayProbe = **真函数**：仅 guarded 返 'sent'(含 redline/empty drop·wrapper 仍返 sent)
 *   才记本周期已探；restrained/throttled/safety/arc_skip/inflight/error 一律不记（没发却记=漏掉真该探）。
 * ① 整 tick 单条：用真 shouldMarkAwayProbe 驱动 tick 的 sentThisTick flag 模型，断言「away_probe 真发→
 *   normal 让位（count=1）」「away 没真发(节流)→normal 照常」。
 * 🔴 诚实边界：真 tick 跑 DB/LLM，此处决策层模型（同 proactive_timeline_smoke 不验真 tick 随机分支）；
 *   live-tick 单条由 diff code review + 真 LLM 沙箱兜底。
 */
import { shouldMarkAwayProbe } from '../src/proactive_engine.mjs';

let fail = 0;
const chk = (n, g, w) => { const ok = g === w; if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${n}  got=${g} want=${w}`); };

console.log('— 🔴③ mark 边界（真 shouldMarkAwayProbe）—');
chk("'sent'(真发) → mark", shouldMarkAwayProbe('sent'), true);
chk("'sent'(redline/empty drop·wrapper 仍返 sent) → mark(防重试风暴)", shouldMarkAwayProbe('sent'), true);
for (const r of ['throttled', 'safety', 'arc_skip', 'inflight', 'restrained', undefined, null]) {
  chk(`'${r}' → 不 mark`, shouldMarkAwayProbe(r), false);
}

console.log('— 🔴① 整 tick 单条（决策层模型·严格对齐 tick flag 逻辑）—');
// tick 代码：each 块 `!sentThisTick && ...`，发后置 true；away_probe 用 shouldMarkAwayProbe(真) 决定是否置 true。
function tickModel(awayGuardedResult) {
  let sentThisTick = false, awayFired = false, normalFired = false;
  // away_probe 块（既有关键块后）：!sentThisTick && shouldSendAwayProbe(已 gate 通过) → guarded → mark 边界
  if (!sentThisTick && shouldMarkAwayProbe(awayGuardedResult)) { awayFired = true; sentThisTick = true; }
  // 普通 dueItems 循环：`if (sentThisTick) break`
  if (!sentThisTick) normalFired = true;
  return { awayFired, normalFired, count: (awayFired ? 1 : 0) + (normalFired ? 1 : 0) };
}
const t1 = tickModel('sent');     // away 真发（或 drop·wrapper 返 sent）
chk('away_probe 发→只一条(count=1)', t1.count, 1);
chk('away_probe 发→away 发/normal 让位', `${t1.awayFired}/${t1.normalFired}`, 'true/false');
const t2 = tickModel('throttled');  // away 被节流没真发→不占 tick→normal 照常
chk('away 没真发(throttled)→normal 照常(不被假占)', `${t2.awayFired}/${t2.normalFired}`, 'false/true');

console.log(fail ? `\n✗ FAIL ${fail}` : '\n✓ ALL PASS');
process.exit(fail ? 1 : 0);
