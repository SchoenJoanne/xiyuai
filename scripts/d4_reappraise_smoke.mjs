/**
 * d4_reappraise_smoke.mjs —— 再评价算子（批E·E3 Phase2b·自愈只由事件触发·确定性零 LLM）
 *
 * ① resolve 同源加速：同 event_id 族全体回落+清 unresolved·异源不动
 * ② heard 换视角：所有活跃负面 ×0.55+清 unresolved·正面不动
 * ③ self 次日自我消化：当轮(isNextDay=false)不想通·次日高强度+概率命中才降
 * ④ 🔴 缺席绝不反向：任何触发负面只降不增·正面恒不动（单调自愈）
 * ⑤ 同源加速使 negativeEmotionSum 下降（engine_calmed 前置联动）
 * ⑥ dilute 最弱（×0.85 > heard ×0.55 的残留）
 *
 * 🔴 坏版本红验：resolve 匹配 event_id 用 !== 取代 === → 加速打到异源、同源反不动（①⑤红）。
 */
import { reappraise, negativeEmotionSum, EMO_NEGATIVE,
         EMOTION_RESOLVE_FACTOR, EMOTION_REAPPRAISE_FACTOR, EMOTION_DILUTE_FACTOR } from '../src/emotion_engine.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const NOW = new Date('2026-07-05T12:00:00Z');
const emoOf = (ps, e) => ps.find(p => p.emotion === e);

// 冲突 E1（upset+sadness 同源·unresolved）+ 无关 E2（另一起 upset）
const mkPulses = () => ([
  { emotion: 'upset',   intensity: 60, at: NOW.getTime(), importance: 2, unresolved: true,  event_id: 'E1' },
  { emotion: 'sadness', intensity: 55, at: NOW.getTime(), importance: 2, unresolved: true,  event_id: 'E1' },
  { emotion: 'upset',   intensity: 40, at: NOW.getTime(), importance: 1, unresolved: true,  event_id: 'E2' },
  { emotion: 'joy',     intensity: 50, at: NOW.getTime(), importance: 1, unresolved: false, event_id: null },
]);

console.log('── ① resolve 同源加速（道歉→同 event_id 族回落）──');
{
  const out = reappraise(mkPulses(), { type: 'resolve', event_id: 'E1' }, NOW);
  const u1 = emoOf(out.filter(p => p.event_id === 'E1'), 'upset');
  const s1 = emoOf(out.filter(p => p.event_id === 'E1'), 'sadness');
  const u2 = emoOf(out.filter(p => p.event_id === 'E2'), 'upset');
  ok(Math.abs(u1.intensity - 60 * EMOTION_RESOLVE_FACTOR()) < 0.5 && u1.unresolved === false, '① E1 upset ×0.6+清unresolved');
  ok(Math.abs(s1.intensity - 55 * EMOTION_RESOLVE_FACTOR()) < 0.5 && s1.unresolved === false, '① E1 sadness ×0.6+清unresolved（同源族全体）');
  ok(Math.abs(u2.intensity - 40) < 0.5 && u2.unresolved === true, '① 异源 E2 upset 不动（40·仍 unresolved）');
}

console.log('── ② heard 换视角 ──');
{
  const out = reappraise(mkPulses(), { type: 'heard' }, NOW);
  const negLower = out.filter(p => EMO_NEGATIVE.includes(p.emotion))
    .every(p => p.unresolved === false);
  ok(negLower, '② heard：所有负面清 unresolved');
  ok(Math.abs(emoOf(out, 'upset').intensity - 60 * EMOTION_REAPPRAISE_FACTOR()) < 0.5, '② upset ×0.55（换视角）');
  ok(emoOf(out, 'joy').intensity === 50, '② 正面 joy 不动');
}

console.log('── ③ self 次日自我消化（顺序约束）──');
{
  const sameTurn = reappraise(mkPulses(), { type: 'self', isNextDay: false, roll: 0.1 }, NOW);
  ok(emoOf(sameTurn, 'upset').intensity === 60, '③ 当轮(isNextDay=false)不想通（大情绪不许秒想通）');
  const nextHit = reappraise(mkPulses(), { type: 'self', isNextDay: true, roll: 0.1 }, NOW);
  ok(emoOf(nextHit, 'upset').intensity < 60, '③ 次日+高强度+概率命中(roll<0.5) → 消化回落');
  // 🔴 E5②(B1)：成功"想开了"=不再反刍→清 unresolved（与 heard 一致·否则×3 反刍尾巴拖两周不达"数天"）
  ok(emoOf(nextHit, 'upset').unresolved === false, '③ B1：self 消化命中 → 清 unresolved（卸反刍·尾巴半衰162h→54h）');
  const nextMiss = reappraise(mkPulses(), { type: 'self', isNextDay: true, roll: 0.9 }, NOW);
  ok(emoOf(nextMiss, 'upset').intensity === 60, '③ 次日但概率未命中(roll≥0.5) → 不动');
  ok(emoOf(nextMiss, 'upset').unresolved === true, '③ B1：未命中不清 unresolved（只对成功消化卸反刍）');
}

console.log('── ④ 🔴 缺席绝不反向（单调自愈）──');
{
  for (const t of [{ type: 'resolve', event_id: 'E1' }, { type: 'heard' },
    { type: 'self', isNextDay: true, roll: 0.1 }, { type: 'dilute' }]) {
    const before = mkPulses();
    const after = reappraise(before, t, NOW);
    let mono = true, posFixed = true;
    for (let i = 0; i < before.length; i++) {
      if (EMO_NEGATIVE.includes(before[i].emotion)) { if (after[i].intensity > before[i].intensity + 1e-9) mono = false; }
      else if (after[i].intensity !== before[i].intensity) posFixed = false;
    }
    ok(mono, `④ ${t.type}：负面只降不增`);
    ok(posFixed, `④ ${t.type}：正面恒不动`);
  }
}

console.log('── ⑤ 同源加速使 negativeEmotionSum 下降 ──');
{
  const before = mkPulses();
  const after = reappraise(before, { type: 'resolve', event_id: 'E1' }, NOW);
  const nb = negativeEmotionSum(before, NOW), na = negativeEmotionSum(after, NOW);
  ok(na < nb, `⑤ negSum ${r1(nb)} → ${r1(na)}（engine_calmed 收敛前置）`);
}

console.log('── ⑥ dilute 最弱 ──');
{
  const heard = reappraise(mkPulses(), { type: 'heard' }, NOW);
  const dilute = reappraise(mkPulses(), { type: 'dilute' }, NOW);
  ok(emoOf(dilute, 'upset').intensity > emoOf(heard, 'upset').intensity,
     `⑥ dilute(×${EMOTION_DILUTE_FACTOR()}) 残留 > heard(×${EMOTION_REAPPRAISE_FACTOR()})`);
}

console.log(`\n══ d4_reappraise smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
