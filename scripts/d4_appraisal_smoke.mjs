/**
 * d4_appraisal_smoke.mjs —— OCC 简化评价（批E·E3 Phase2a·事件白名单→脉冲·确定性零 LLM）
 *
 * ① 白名单外 kind → 零脉冲（结构级拒绝）
 * ② harsh_words→upset；severe→upset+sadness（怒悲同注·裁定①）
 * ③ importance 缩放初始强度（×0.5..2）
 * ④ 滞后：负面高位（negSum>阈）同类刺激 ×1.5
 * ⑤ 🔴 铁线：注入沉默/缺席量（last_user_reply_at 族）→ 报错（沉默无入口·D4 §6）
 * ⑥ 正向事件（apology→relief / work_done→pride+joy）·全表零 contempt
 * ⑦ 怒退悲显：severe 产 upset+sadness·经三段半衰 12h 后 upset<sadness
 *
 * 🔴 坏版本红验：appraiseEvent 去 FORBIDDEN_APPRAISAL_KEYS 守卫 → 注入 last_user_reply_at 不再报错（⑤红）。
 */
import { appraiseEvent, decayEmotionIntensity, EMOTIONS,
         EMO_HYST_THRESH, EMO_HYST_MULT } from '../src/emotion_engine.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const NOW = new Date('2026-07-05T12:00:00Z');
const emo = (ps, e) => ps.find(p => p.emotion === e);

console.log('── ① 白名单外 kind → 零脉冲 ──');
ok(appraiseEvent({ kind: 'random_unknown' }, [], NOW).length === 0, '① 未知 kind → []（结构拒绝）');
ok(appraiseEvent({}, [], NOW).length === 0, '① 空事件 → []');

console.log('── ② harsh_words + 怒悲同注 ──');
{
  const mild = appraiseEvent({ kind: 'harsh_words' }, [], NOW);
  ok(mild.length === 1 && mild[0].emotion === 'upset', '② 非 severe harsh_words → 仅 upset');
  const sev = appraiseEvent({ kind: 'harsh_words', severe: true }, [], NOW);
  ok(emo(sev, 'upset') && emo(sev, 'sadness'), '② severe harsh_words → upset+sadness（怒悲同注）');
}

console.log('── ③ importance 缩放 ──');
{
  const lo = appraiseEvent({ kind: 'harsh_words', importance: 0.5 }, [], NOW)[0].intensity;
  const hi = appraiseEvent({ kind: 'harsh_words', importance: 2 }, [], NOW)[0].intensity;
  ok(hi > lo, `③ importance2(${r1(hi)}) > importance0.5(${r1(lo)})`);
  ok(appraiseEvent({ kind: 'harsh_words', importance: 5 }, [], NOW)[0].importance === 2, '③ importance 乘数 cap ×2');
}

console.log('── ④ 滞后闸（气头上 ×1.5）──');
{
  const calm = appraiseEvent({ kind: 'harsh_words' }, [], NOW)[0].intensity;
  // 喂足够高的负面当前脉冲（negSum > 阈）
  const hotPulses = [{ emotion: 'upset', intensity: EMO_HYST_THRESH() + 20, at: NOW.getTime() }];
  const hot = appraiseEvent({ kind: 'harsh_words' }, hotPulses, NOW)[0].intensity;
  ok(Math.abs(hot - calm * EMO_HYST_MULT()) < 0.5, `④ 负面高位 ×${EMO_HYST_MULT()}（${r1(calm)}→${r1(hot)}）`);
  const cold = appraiseEvent({ kind: 'harsh_words' }, [{ emotion: 'upset', intensity: 5, at: NOW.getTime() }], NOW)[0].intensity;
  ok(Math.abs(cold - calm) < 0.5, '④ 负面低位不加成（无滞后）');
}

console.log('── ⑤ 🔴 铁线：沉默/缺席量注入即报错 ──');
{
  let threw = false;
  try { appraiseEvent({ kind: 'harsh_words', last_user_reply_at: NOW.toISOString() }, [], NOW); }
  catch { threw = true; }
  ok(threw, '🔴⑤ 注入 last_user_reply_at → 报错（沉默无入口）');
  let threw2 = false;
  try { appraiseEvent({ kind: 'warm_words', neglectStage: 3 }, [], NOW); } catch { threw2 = true; }
  ok(threw2, '🔴⑤ 注入 neglectStage → 报错');
  let threw3 = false;
  try { appraiseEvent({ kind: 'work_done', missing_score: 8 }, [], NOW); } catch { threw3 = true; }
  ok(threw3, '🔴⑤ 注入 missing_score → 报错');
}

console.log('── ⑥ 正向事件·全表零 contempt ──');
{
  ok(emo(appraiseEvent({ kind: 'apology' }, [], NOW), 'relief'), '⑥ apology → relief');
  const wd = appraiseEvent({ kind: 'work_done' }, [], NOW);
  ok(emo(wd, 'pride') && emo(wd, 'joy'), '⑥ work_done → pride+joy');
  // 遍历全表：任一 kind 产出情绪都必须在 EMOTIONS 枚举内、且非 contempt
  const kinds = ['harsh_words', 'taboo_hit', 'pressure_spam', 'promise_broken', 'schedule_setback',
    'warm_words', 'apology', 'promise_kept', 'heard', 'teach',
    'work_done', 'work_progress', 'surprise_good', 'social_good', 'schedule_achieve', 'anchor_good'];
  let allValid = true, anyContempt = false;
  for (const k of kinds) for (const p of appraiseEvent({ kind: k, severe: true }, [], NOW)) {
    if (!EMOTIONS.includes(p.emotion)) allValid = false;
    if (p.emotion === 'contempt') anyContempt = true;
  }
  ok(allValid, '⑥ 全表产出情绪 ∈ EMOTIONS 枚举');
  ok(!anyContempt, '🔴⑥ 全表零 contempt（轻蔑轨道禁用）');
}

console.log('── ⑦ 怒退悲显（severe → upset+sadness·12h 后 upset<sadness）──');
{
  const sev = appraiseEvent({ kind: 'taboo_hit', severe: true, importance: 2 }, [], NOW);
  const u0 = emo(sev, 'upset'), s0 = emo(sev, 'sadness');
  const later = new Date(NOW.getTime() + 12 * 3600e3);
  const u12 = decayEmotionIntensity({ ...u0, at: NOW.getTime() }, later);
  const s12 = decayEmotionIntensity({ ...s0, at: NOW.getTime() }, later);
  ok(u12 < s12, `⑦ 12h 后 upset ${r1(u12)} < sadness ${r1(s12)}（"不气了·就是还闷闷的"）`);
}

console.log(`\n══ d4_appraisal smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
