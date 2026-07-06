/**
 * e5_hint_rotation_smoke.mjs —— 批E·E5③：hint 变体 date-seeded 轮换 + 同文本冷却
 *
 * E5 §3.2 轰炸：同一文本连打>30 轮者 446 个·最重 1648 轮（marathon·S_LOW_tail·十余天同句「闷闷的尾巴」）。
 * 修=选择层内可互换池 round-robin 按日轮换（换日必换变体=冷却）。只施于场景无关池（低悲残余 S中低-1/2·
 * 迁移平静 X迁-1/2）——冲突场景档不轮换（不误描述事件）。
 *
 * 🔴 红验=同文本连打上限（对照修前最重 1648 轮）：
 *   ① 低悲 marathon（14 天×48 tick/天=672 轮）→ 最长连打 ≤ 一日 tick 数（≪672）·两变体皆现
 *   ② 迁移平静 marathon → X迁-1/2 皆现（轮换生效）
 *   ③ 确定性：同 companion 同日 → 同变体（可复现·非随机抖动）
 *   ④ 相位：不同 companion 盐错开（同日可落不同变体·非全同步）
 *
 * 坏版本红验（提交后单独跑）：_rotate 恒返 pool[0] → ①最长连打=672·distinct=1（红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/e5_hint_rotation_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { buildEngineHint } = await import('../src/emotion_hint.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const H = 3600e3;
const T0 = Date.parse('2026-06-20T00:00:00Z');

// 低悲残余脉冲（route→S_LOW 轮换池）·迁移平静脉冲（route→X_MIGRATE 轮换池）
const lowSad = (atMs) => [{ emotion: 'sadness', intensity: 20, at: new Date(atMs).toISOString(), importance: 1, unresolved: true, source: 'event', event_id: 'E1' }];
const migCalm = (atMs) => [{ emotion: 'sadness', intensity: 18, at: new Date(atMs).toISOString(), importance: 1, unresolved: false, source: 'arc_migration', event_id: 'mig_1' }];

// 变体指纹（用于计连打/distinct）
const fp = (h) => {
  if (h.includes('闷闷的尾巴')) return 'S_tail';
  if (h.includes('消化得差不多')) return 'S_mig';
  if (h.includes('早消化完')) return 'X_1';
  if (h.includes('早就自己散了')) return 'X_2';
  return 'other:' + h.slice(10, 22);
};
function marathon(mkPulse, companionId, ticks = 672, stepH = 0.5) {
  const seq = [];
  for (let i = 0; i < ticks; i++) {
    const now = new Date(T0 + i * stepH * H);
    seq.push(fp(buildEngineHint(mkPulse(now.getTime()), { companionId }, now)));
  }
  let maxRun = 1, run = 1;
  for (let i = 1; i < seq.length; i++) { if (seq[i] === seq[i - 1]) { run++; maxRun = Math.max(maxRun, run); } else run = 1; }
  return { seq, maxRun, distinct: new Set(seq).size, ticks };
}

console.log('── ① 低悲 marathon 连打上限（对照修前 1648）──');
{
  const m = marathon(lowSad, 7001);
  console.log(`    ticks=${m.ticks} maxRun=${m.maxRun} distinct=${m.distinct}`);
  ok(m.maxRun <= 50, `① 最长连打 ${m.maxRun} ≤ 一日(48)·远小于 ${m.ticks}（marathon 破解·对照修前 1648）`);
  ok(m.distinct >= 2, `① 两变体皆现（distinct=${m.distinct}·S中低-1/2 轮换生效）`);
}

console.log('── ② 迁移平静 marathon：X迁-1/2 皆现 ──');
{
  const m = marathon(migCalm, 7002);
  console.log(`    maxRun=${m.maxRun} distinct=${m.distinct} set=${[...new Set(m.seq)]}`);
  ok(m.maxRun <= 50 && m.distinct >= 2, `② 迁移平静轮换生效（maxRun=${m.maxRun}·distinct=${m.distinct}）`);
}

console.log('── ③ 确定性：同 companion 同日 → 同变体 ──');
{
  const t = new Date(T0 + 3 * 24 * H + 5 * H);   // 第3日某时刻
  const a = fp(buildEngineHint(lowSad(t.getTime()), { companionId: 7003 }, t));
  const b = fp(buildEngineHint(lowSad(t.getTime()), { companionId: 7003 }, t));
  ok(a === b, `③ 同 companion 同日同变体（${a}·可复现非随机）`);
}

console.log('── ④ 相位：不同 companion 盐错开 ──');
{
  // 找一日使两 companion 落不同变体（round-robin 相位差存在即可·扫 14 日至少一日不同）
  let anyDiff = false;
  for (let d = 0; d < 14; d++) {
    const t = new Date(T0 + d * 24 * H + 5 * H);
    const a = fp(buildEngineHint(lowSad(t.getTime()), { companionId: 7100 }, t));
    const b = fp(buildEngineHint(lowSad(t.getTime()), { companionId: 7101 }, t));
    if (a !== b) { anyDiff = true; break; }
  }
  ok(anyDiff, '④ 不同 companion 存在落不同变体的日（相位盐错开·非全员同步连打）');
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} e5_hint_rotation_smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
