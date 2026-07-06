/**
 * d4_engine_calmed_smoke.mjs —— engine_calmed 收敛（批E·E3 Phase2c·db 集成·确定性零 LLM）
 *
 * ① cold + 同源负面 >floor → 不收敛（above_floor）
 * ② cold + 同源负面 <floor → 收敛：事件 resolved(note=engine_calmed)·arc→normal·digest 计数+1
 * ③ repairing → 不收敛（修复弧排除·保留仪式感·E3 §3.3）
 * ④ normal → 不收敛
 * ⑤ 闸 OFF → 不收敛（gate_off·字节安全）
 * ⑥ 🔴 同源隔离：本事件脉冲 <floor 而无关高负面在场 → 仍收敛（只看同源·读引擎同源强度）
 * ⑦ digest 计数：收敛后 engine_calmed_count=1
 *
 * 🔴 坏版本红验：engineCalmedCheck 去同源 filter（sum 全脉冲）→ 无关高负面挡住收敛（⑥红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/d4_engine_calmed_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, setArcState, insertEmotionPulse, engineCalmedCheck } = await import('../src/db.mjs');
const { ENGINE_CALM_FLOOR } = await import('../src/emotion_engine.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const NOW = new Date('2026-07-05T12:00:00Z');
const db = getDb();
db.pragma('foreign_keys = OFF');

let seq = 9200;
const mkCase = (arcState, pulses) => {
  const id = seq++;
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (?, 1, 'b', '溪语')").run(id);
  setArcState(id, arcState, NOW.toISOString());
  const evId = db.prepare(
    `INSERT INTO companion_relationship_events (companion_id, type, severity, state_before, state_after, repair_status, created_at)
     VALUES (?, 'harsh_words', 3, 'normal', ?, 'open', ?)`,
  ).run(id, arcState, NOW.toISOString()).lastInsertRowid;
  for (const p of pulses) {
    insertEmotionPulse(id, {
      emotion: p.emotion, intensity: p.intensity, at: NOW.toISOString(), unresolved: false,
      source: 'event', event_id: p.otherEvent ? 'OTHER_EVENT' : String(evId),
    }, NOW);
  }
  return { id, evId };
};

console.log('── ① cold + 同源 >floor → 不收敛 ──');
{
  const { id } = mkCase('cold', [{ emotion: 'upset', intensity: 30 }, { emotion: 'sadness', intensity: 30 }]);
  const r = engineCalmedCheck(id, NOW);
  ok(r.calmed === false && r.reason === 'above_floor', `① 同源和60>floor → above_floor（reason=${r.reason}）`);
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(id).arc_state === 'cold', '① arc 仍 cold');
}

console.log('── ② cold + 同源 <floor → 收敛 ──');
{
  const { id, evId } = mkCase('cold', [{ emotion: 'upset', intensity: 4 }]);
  const r = engineCalmedCheck(id, NOW);
  ok(r.calmed === true && r.from === 'cold', '② 同源4<floor → 收敛');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(id).arc_state === 'normal', '② arc → normal（降级平静）');
  const ev = db.prepare('SELECT repair_status, resolve_note FROM companion_relationship_events WHERE id=?').get(evId);
  ok(ev.repair_status === 'resolved' && ev.resolve_note === 'engine_calmed', '② 事件 resolved(note=engine_calmed)');
  ok(db.prepare('SELECT engine_calmed_count FROM companions WHERE id=?').get(id).engine_calmed_count === 1, '② digest 计数+1');
}

console.log('── ③ repairing 排除（保留仪式感）──');
{
  const { id } = mkCase('repairing', [{ emotion: 'upset', intensity: 2 }]);
  const r = engineCalmedCheck(id, NOW);
  ok(r.calmed === false && r.reason === 'arc_not_hurt_cold', '③ repairing 不走收敛（修复要互动完成）');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(id).arc_state === 'repairing', '③ arc 仍 repairing');
}

console.log('── ④ normal → 不收敛 ──');
{
  const { id } = mkCase('normal', [{ emotion: 'upset', intensity: 2 }]);
  ok(engineCalmedCheck(id, NOW).reason === 'arc_not_hurt_cold', '④ normal 无需收敛');
}

console.log('── ⑤ 闸 OFF → 不收敛（字节安全）──');
{
  const { id } = mkCase('cold', [{ emotion: 'upset', intensity: 2 }]);
  process.env.EMOTION_ENGINE = '0';
  const r = engineCalmedCheck(id, NOW);
  process.env.EMOTION_ENGINE = '1';
  ok(r.calmed === false && r.reason === 'gate_off', '⑤ 闸 OFF → gate_off（绝不收敛）');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(id).arc_state === 'cold', '⑤ arc 仍 cold（闸 OFF 零副作用）');
}

console.log('── ⑥ 🔴 同源隔离（无关高负面不挡收敛）──');
{
  const { id } = mkCase('cold', [
    { emotion: 'upset', intensity: 4 },                    // 本事件（同源·<floor）
    { emotion: 'sadness', intensity: 50, otherEvent: true }, // 无关另一起（高·不该计入）
  ]);
  const r = engineCalmedCheck(id, NOW);
  ok(r.calmed === true, '🔴⑥ 只看同源(4<floor)→收敛·无关高负面(50)不挡');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(id).arc_state === 'normal', '⑥ arc → normal');
}

console.log('── ⑦ digest 计数独立 ──');
{
  const { id } = mkCase('hurt', [{ emotion: 'upset', intensity: 3 }]);
  engineCalmedCheck(id, NOW);
  ok(db.prepare('SELECT engine_calmed_count FROM companions WHERE id=?').get(id).engine_calmed_count === 1, '⑦ 新 companion 收敛 count=1（独立计数）');
}

console.log(`\n══ d4_engine_calmed smoke：${pass} 通过 / ${fail} 失败（floor=${ENGINE_CALM_FLOOR()}）══`);
process.exit(fail ? 1 : 0);
