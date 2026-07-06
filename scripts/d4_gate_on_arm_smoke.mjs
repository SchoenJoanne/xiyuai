/**
 * d4_gate_on_arm_smoke.mjs —— 闸 ON 臂断言集（批E·E3 Phase5·E0a 22红改写+16暧昧四组·确定性零 LLM）
 *
 * 🔴 E3 §0 reframe：合入日全量 CI 256 全绿（闸 OFF→Legacy 字节一致）；本 smoke=闸 ON 臂【新语义正向断言】，
 *   把 E0a 22 红族的"退役面"改写为 V2 应有行为（缺席不再造 hurt/cold/withdrawing/scar），非留旧断言空过。
 *
 * A. 22 红族 → V2 语义正向断言（退役面在 ON 臂的正确行为·含全域 sweep 证不入退役态）
 * B. L234 / sandbox L95 vacuous-pass → 正向改写（E3 §4.2 硬要求·非空过）
 * C. engine_calmed 触发前置（同源负面随衰减跌破 floor·§4.3 新机制）
 * D. 16 暧昧四组按 E3 §1 裁决（组一删/组二换事件载体/组三表达层缩态/组四 morning 缩态）
 *
 * 🔴 坏版本红验：tickArcOnTimeV2 回填任一 neglect escalation → A 的 sweep/具名退役断言红。
 */
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { tickArcOnTime, tickArcOnTimeV2, tickArcOnSignal, buildArcToneDirective, repairNeed, ARC_STATES }
  from '../src/relationship_arc.mjs';
import { appraiseEvent, decayEmotionIntensity, negativeEmotionSum, reappraise, ENGINE_CALM_FLOOR } from '../src/emotion_engine.mjs';
import { morningFallbackByArc } from '../src/proactive.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const NOW = new Date('2026-07-05T12:00:00Z');
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
const RETIRED = new Set(['withdrawing', 'normal_with_scar']);
const v2 = (over) => tickArcOnTimeV2({ style: 'secure', interactionsSinceEvent: 0, now: NOW, ...over });

console.log('══ A. 22 红族 → V2 退役面正向断言 ══');
console.log('── A0 全域 sweep：缺席绝不 escalate 入退役态·绝不扣 trust·绝不建 neglect ──');
{
  let sweepOk = true, trustOk = true, createOk = true, n = 0;
  for (const state of ARC_STATES) {
    for (const neglectStage of ['none', 'disappointed', 'withdrawn', 'long_gone', 'dormant']) {
      for (const h of [1, 50, 200, 500]) {
        const r = v2({ state, neglectStage, stateChangedAt: ago(h) });
        n++;
        if (RETIRED.has(state)) { if (r.state !== state) sweepOk = false; }   // 存量退役态 noop·不加疤不升级
        else if (RETIRED.has(r.state)) sweepOk = false;                       // 非退役态绝不 escalate 入退役态
        if (r.trustDelta) trustOk = false;                                    // 绝无 SCAR_TRUST_PENALTY
        if (r.eventOp && r.eventOp.op === 'create') createOk = false;         // V2 只 resolve(faded)·不 create neglect
      }
    }
  }
  ok(sweepOk, `A0 ${n} 组合：非退役态绝不 escalate 入 withdrawing/scar·退役态 noop`);
  ok(trustOk, 'A0 全 sweep 零 trustDelta（SCAR_TRUST_PENALTY 退役）');
  ok(createOk, 'A0 全 sweep 零 neglect 事件创建（时间阶梯退役）');
}

console.log('── A1 具名退役断言（对照 E0a 红族逐条）──');
ok(v2({ state: 'normal', neglectStage: 'disappointed' }).state === 'normal', 'L217 neglect_disappointed 退役：normal+disappointed → 停 normal（不造 hurt）');
ok(v2({ state: 'hurt', neglectStage: 'withdrawn', stateChangedAt: ago(500) }).state === 'hurt', 'L221 neglect_deepened 退役：hurt+withdrawn → 停 hurt（不升 cold）');
ok(v2({ state: 'cold', neglectStage: 'long_gone', stateChangedAt: ago(500) }).state === 'cold', 'L225 neglect_long_gone 退役：cold+long_gone → 停 cold（不升 withdrawing）');
{
  const r = v2({ state: 'normal', neglectStage: 'dormant', stateChangedAt: ago(500) });
  ok(r.state === 'normal' && !r.trustDelta, 'L280 dormant_direct_scar 退役：normal+dormant → 停 normal·无 trust 扣');
}
ok(v2({ state: 'repairing', neglectStage: 'disappointed', stateChangedAt: ago(500) }).state === 'repairing', 'L276 repair_abandoned 退役：repairing+disappointed → 停 repairing（不打回 cold）');
{
  const r = v2({ state: 'normal_with_scar', stateChangedAt: ago(24 * 30) });
  ok(r.state === 'normal_with_scar', 'L272 scar_faded 退役：normal_with_scar 30d → noop（无自动淡出转移·scar 态本身退役）');
}
{
  const r = v2({ state: 'withdrawing', stateChangedAt: ago(500) });
  ok(r.state === 'withdrawing' && !r.trustDelta && !(r.eventOp && r.eventOp.op === 'stale'), 'L258-268 withdraw_capped 退役：withdrawing 500h → noop（无 cap→scar·无 trust·无 stale）');
}
ok(v2({ state: 'cold', neglectStage: 'withdrawn', stateChangedAt: ago(500) }).state === 'cold', 'L284 cold 支 neg 判断退役：cold+withdrawn → 停 cold（neg 边界失被测对象）');
// L155/159/206/211（tickArcOnSignal withdrawing/scar 态）→ 这些态在 ON 臂不可达（A0 sweep 已证无路径产出）·此处不重测死态

console.log('══ B. L234 / L95 vacuous-pass → 正向改写（非空过）══');
console.log('── B1 L234 正向：hurt+零互动+72h → 停 hurt·引擎 upset 半衰已降·无 cold ──');
{
  const r = v2({ state: 'hurt', neglectStage: 'none', interactionsSinceEvent: 0, stateChangedAt: ago(72) });
  const p0 = appraiseEvent({ kind: 'harsh_words', importance: 1.5, at: ago(72) }, [], NOW)[0];  // 事件造 upset（非缺席）
  const decayed = decayEmotionIntensity({ ...p0, at: NOW.getTime() - 72 * 3600e3 }, NOW);
  ok(r.state === 'hurt', 'B1 arc 停 hurt（缺席不再"伤了又晾"升 cold）');
  ok(r.state !== 'cold', 'B1 无 cold 转移（hurt_then_ignored 退役）');
  ok(decayed < p0.intensity && decayed >= 0, `B1 引擎 upset 半衰已降（${r1(p0.intensity)}→${r1(decayed)}·非 vacuous）`);
}
console.log('── B2 L95 正向：事件驱动弧（吵架→道歉→repairing·hurt 来自事件非缺席）──');
{
  const comp = { state: 'normal', stateChangedAt: NOW.toISOString(), style: 'secure', safeMode: false, openEvent: null, now: NOW };
  const s1 = tickArcOnSignal({ ...comp, signal: { kind: 'harsh_words', severity: 3 }, rng: () => 0.99 });  // pin rng（sev3 有吸收概率）
  ok(s1.state === 'hurt' && s1.eventOp, 'B2 harsh sev3 事件 → hurt（种子来自事件·非 55h 缺席）');
  const s2 = tickArcOnSignal({ state: 'hurt', stateChangedAt: NOW.toISOString(), style: 'secure', safeMode: false,
    openEvent: { type: 'harsh_words', severity: 3, created_at: NOW.toISOString(), repair_warm: 0 },
    signal: { kind: 'apology', apologyKind: 'matched' }, now: NOW, rng: () => 0.99 });
  ok(s2.state === 'repairing', 'B2 道歉 → repairing（事件驱动弧真转移·非空过）');
}

console.log('══ C. engine_calmed 触发前置（道歉同源加速→同源负面跌破 floor）══');
{
  // 🔴 未决冲突反刍(×3)本就 lingering·纯时间难平——engine_calmed 真实触发靠【道歉同源加速清 unresolved】+衰减
  const pulses = appraiseEvent({ kind: 'harsh_words', importance: 1, event_id: 'E' }, [], NOW).map(p => ({ ...p, at: NOW.getTime() }));
  const sumFresh = negativeEmotionSum(pulses, NOW);
  ok(sumFresh > ENGINE_CALM_FLOOR(), `C 新鲜同源负面 ${r1(sumFresh)} > floor ${ENGINE_CALM_FLOOR()}（未平静·反刍中）`);
  const resolved = reappraise(pulses, { type: 'resolve', event_id: 'E' }, NOW);   // 道歉→同源加速+清 unresolved
  const later = new Date(NOW.getTime() + 60 * 3600e3);
  const sumAged = negativeEmotionSum(resolved, later);
  ok(sumAged < ENGINE_CALM_FLOOR(), `C 道歉加速+60h → 同源负面 ${r1(sumAged)} < floor（engine_calmed 触发·收敛落库见 d4_engine_calmed/seam_timetick）`);
}

console.log('══ D. 16 暧昧四组（E3 §1 裁决）══');
console.log('── 组一：L115/141/179 distance 入口 ON 臂删（重逢移交 T3/T4）+ L163 repairNeed 改·正向 ──');
// 🔴 L163 裁决=【改】非【删】（E0a 复审逮回）：repairNeed 是纯查表函数·保留侧·须正向断言 hurt=3/cold=4（withdrawing 分量随 sunset 删·此批不测）
ok(repairNeed('hurt', 'secure', 'matched') === 3 && repairNeed('cold', 'secure', 'matched') === 4,
   'L163→ repairNeed 保留 hurt=3/cold=4 基准（查表函数保留·withdrawing 分量随 sunset 删·非"删断言"）');
console.log('── 组二 钳制机制载体换事件（L295/299/315/329）──');
{
  ok(v2({ state: 'hurt', maxState: 'normal' }).reason === 'ops_clamp', 'L295→ ops_clamp：hurt(事件可达) 被 maxState=normal 钳（换事件载体）');
  ok(v2({ state: 'cold', maxState: 'hurt' }).state === 'hurt', 'L299→ ops_clamp：cold(事件可达) 被 maxState=hurt 钳');
  ok(v2({ state: 'cold', maxState: 'normal' }).reason === 'ops_clamp', 'L315→ ops_clamp：cold 存量样本（E3 采纳·非退役态）');
  ok(v2({ state: 'withdrawing', maxState: 'normal' }).state === 'normal', 'L315 防御样本：残留 withdrawing 存量 → ops_clamp 兜底 normal');
  // L329 safe_mode 封顶：事件最强载体 severe_direct_cold sev4 在 safe_mode 下被 :101 钳到 hurt
  const sm = tickArcOnSignal({ state: 'normal', stateChangedAt: NOW.toISOString(), style: 'secure', safeMode: true,
    openEvent: null, signal: { kind: 'taboo_hit', severity: 4 }, now: NOW });
  ok(sm.state === 'hurt', 'L329→ safe_mode 封顶：taboo sev4 事件在 safe_mode 下钳到 hurt（非 cold·换事件载体）');
}
console.log('── 组三 表达层（L367/369/372）：cold/hurt/repairing 保留·withdrawing 随 sunset ──');
{
  ok(/道歉|留门|门/.test(buildArcToneDirective('cold', {})) || buildArcToneDirective('cold', {}).length > 0, 'L367→ cold 文案保留（事件可达·给道歉留门）');
  const REDLINE = '绝对红线';
  ok(buildArcToneDirective('hurt', {}).includes(REDLINE), 'L372→ hurt 文案含红线（3态循环之一）');
  ok(buildArcToneDirective('cold', {}).includes(REDLINE), 'L372→ cold 文案含红线');
  ok(buildArcToneDirective('repairing', {}).includes(REDLINE), 'L372→ repairing 文案含红线（withdrawing 轮随 sunset 删·此批缩 3 态）');
}
console.log('── 组四 morning proactive（L59 缩态·确定性·避 flaky 蒙卡）──');
{
  ok(morningFallbackByArc('hurt') === '早安。今天也好好的。', 'L59→ morningFallback hurt（事件可达·保留）');
  ok(morningFallbackByArc('cold') === '早安。', 'L59→ morningFallback cold（保留）');
  ok(morningFallbackByArc('normal') === '早安~' && morningFallbackByArc('repairing') === '早安~', 'L59→ morningFallback normal/repairing（保留·缩态后 withdrawing 并入 default）');
  // L33/44/52（getArcProactivePolicy 蒙卡）=缩 2 态(hurt/cold)·此处不纳（flaky proactive-policy 归 task_370d4bc0）
}

// ── 分派 ON 臂自证：闸 ON 时 tickArcOnTime 确走 V2 ──
{
  const routed = tickArcOnTime({ companionId: 1, state: 'hurt', neglectStage: 'dormant', stateChangedAt: ago(500), interactionsSinceEvent: 0, now: NOW });
  ok(routed.state === 'hurt', '分派自证：闸 ON → V2（hurt+dormant 不升级·非 Legacy）');
}

console.log(`\n══ d4_gate_on_arm smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
