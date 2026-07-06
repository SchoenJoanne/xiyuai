/**
 * d2_autopin_decay_smoke.mjs —— auto-pin 治理·computeMemoryDecay 读侧源判（批D·件③a·确定性零 LLM）
 *
 * 维护者 拍(locked-first)：locked=显式意志永不褪 / user-pin·高imp-pin(pinned∧imp≥9)永活 /
 *   auto-pin(pinned∧imp<9∧!locked·saveMemory imp≥7 自动 pin 毒化源) 读侧(ignoreAutoPin=true)不再豁免→正常 decay。
 *   默认 ignoreAutoPin=false=零行为变更（夜批 applyMemoryDecayBatch/rank 旧调用不受影响）。
 *
 * 🔴 件③b（recallMemories 用此 decay 评分·D2-1 打分接线）撞 db↔memory_v2 import cycle=架构拍板·待 维护者 定后落。
 * 🔴 坏版本红验：去 locked-first（locked 也当 auto-pin）→ locked 褪色(红) / 去 autoPin 判据 → auto-pin 恒 1.0(红)。
 */
import { computeMemoryDecay } from '../src/memory_v2.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const now = new Date();
const daysAgo = (d) => new Date(now.getTime() - d * 86400e3).toISOString();

const autoPin = { pinned: 1, importance: 7, created_at: daysAgo(60) };   // imp7 自动 pin·60天前
const userPin = { pinned: 1, importance: 9, created_at: daysAgo(60) };   // imp9 user-pin
const locked  = { locked: 1, importance: 5, created_at: daysAgo(60) };   // locked
const plain   = { importance: 5, memory_weight: 3, created_at: daysAgo(60) };  // 非pin·45天半衰

console.log('── ① 默认 ignoreAutoPin=false：零行为变更（夜批/rank 不变） ──');
ok(computeMemoryDecay(autoPin, now) === 1.0, '① auto-pin 默认→1.0（旧行为·夜批 WHERE pinned=0 本就跳）');
ok(computeMemoryDecay(userPin, now) === 1.0, '① user-pin 默认→1.0');

console.log('── ② 读侧 ignoreAutoPin=true：auto-pin 治理 ──');
{
  const d = computeMemoryDecay(autoPin, now, true);
  ok(d < 1.0 && d > 0, `② auto-pin(imp7) 读侧→褪色 ${d.toFixed(3)}（<1·治毒化·60天>14天半衰[weight默认3=45天半衰]）`);
  ok(computeMemoryDecay(userPin, now, true) === 1.0, '② user-pin(imp≥9) 读侧→1.0 永活（不误伤真 pin）');
  ok(computeMemoryDecay(locked, now, true) === 1.0, '② locked 读侧→1.0 永不褪（locked-first·显式意志）');
}

console.log('── ③ locked-first 优先级（locked ∧ imp<9 仍永活·不被误当 auto-pin） ──');
ok(computeMemoryDecay({ locked: 1, pinned: 1, importance: 6, created_at: daysAgo(90) }, now, true) === 1.0,
   '③ locked∧pinned∧imp6 读侧→1.0（locked 先判·避误杀"真大事恰好 imp 低"）');

console.log('── ④ 非 pin 记忆 decay 不受影响（半衰仍算） ──');
{
  const d = computeMemoryDecay(plain, now, true);
  const d0 = computeMemoryDecay(plain, now, false);
  ok(d === d0 && d < 1.0, `④ 非pin记忆 ignoreAutoPin 不影响其 decay（${d.toFixed(3)}·两调用同值）`);
}

console.log('── ⑤ archived 记忆 decay=0（memory_status≠active·件①同族兜底） ──');
ok(computeMemoryDecay({ importance: 5, memory_status: 'archived', created_at: daysAgo(1) }, now, true) === 0,
   '⑤ archived → decay=0');

console.log(`\n══ d2_autopin_decay smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
