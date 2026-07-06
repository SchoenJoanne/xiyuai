/**
 * d4_seam_timetick_smoke.mjs —— Phase4a 时间 tick 接缝（批E·E3 §3·db 集成·确定性零 LLM）
 *
 * ① 闸 ON 迁移 lazy 触发 + 幂等（首 tick 迁移·arc→normal·写 arc_migration 脉冲·二次不重迁）
 * ② 闸路由：闸 ON→V2（hurt+高 neglect 不升级）·闸 OFF→Legacy（升 cold）
 * ③ fail-open：未知 arc_state → normal + 不崩
 * ④ engine_calmed wiring：闸 ON + arc=cold + 同源脉冲<floor → tick 后 arc→normal
 * ⑤ 闸 OFF 字节安全：无迁移·无脉冲·arc 不被引擎触碰
 *
 * 🔴 坏版本红验：runArcTimeTickOne 去 ctx.companionId → 闸 ON 也 emotionEngineOn(undefined)=false→Legacy（②路由红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/d4_seam_timetick_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, setArcState, insertEmotionPulse, getEmotionPulses, getEmotionMigratedAt } = await import('../src/db.mjs');
const { runArcTimeTickOne } = await import('../src/relationship_arc_runtime.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const NOW = new Date('2026-07-05T12:00:00Z');
const db = getDb();
db.pragma('foreign_keys = OFF');

let seq = 9300;
const mkComp = (arc, over = {}) => {
  const id = seq++;
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'secure', 0)").run(id);
  setArcState(id, arc, (over.changedIso || NOW.toISOString()));
  return { id, user_id: 1, bot_id: 'b', attachment_style: 'secure', safe_mode: 0,
    last_user_reply_at: over.lastReply || NOW.toISOString(), wechat_user_id: null, ...over };
};
const preMigrate = (id) => db.prepare('UPDATE companions SET emotion_migrated_at = ? WHERE id = ?').run(NOW.toISOString(), id);
const mkOpenEvent = (id) => db.prepare(
  `INSERT INTO companion_relationship_events (companion_id, type, severity, state_before, state_after, repair_status, created_at)
   VALUES (?, 'harsh_words', 3, 'normal', 'cold', 'open', ?)`).run(id, NOW.toISOString()).lastInsertRowid;

console.log('── ① 闸 ON 迁移 lazy + 幂等 ──');
{
  const c = mkComp('cold', { changedIso: new Date(NOW.getTime() - 4 * 3600e3).toISOString() });
  runArcTimeTickOne(c, NOW);
  ok(getEmotionMigratedAt(c.id) !== null, '① 首 tick 触发迁移（emotion_migrated_at 置）');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(c.id).arc_state === 'normal', '① arc→normal（迁移清）');
  const n1 = getEmotionPulses(c.id).filter(p => p.source === 'arc_migration').length;
  ok(n1 >= 1, `① 写 arc_migration 脉冲（${n1}）`);
  runArcTimeTickOne(c, NOW);
  const n2 = getEmotionPulses(c.id).filter(p => p.source === 'arc_migration').length;
  ok(n1 === n2, '① 二次 tick 幂等（脉冲不重复注入）');
}

console.log('── ② 闸路由（白名单模式·companionId 承重）──');
{
  const oldReply = new Date(NOW.getTime() - 60 * 86400e3).toISOString();   // 高 neglect
  const cOn = mkComp('hurt', { lastReply: oldReply });
  const cOut = mkComp('hurt', { lastReply: oldReply });
  preMigrate(cOn.id); preMigrate(cOut.id);   // 预置已迁移·防迁移清掉我设的 hurt
  // 🔴 白名单只含 cOn（非 '*'）——companionId 若不入 ctx，emotionEngineOn(undefined)→false→Legacy
  process.env.EMOTION_ENGINE_WHITELIST = String(cOn.id);
  const sOn = runArcTimeTickOne(cOn, NOW);
  ok(sOn === 'hurt', `② 白名单内 → V2：hurt+高neglect 不升级（得 ${sOn}·companionId 缝承重）`);
  const sOut = runArcTimeTickOne(cOut, NOW);
  ok(sOut === 'cold', `② 白名单外 → Legacy：hurt+高neglect 升 cold（得 ${sOut}·白名单真辨别）`);
  process.env.EMOTION_ENGINE_WHITELIST = '*';
}

console.log('── ③ fail-open 未知 arc_state ──');
{
  const c = mkComp('normal');
  preMigrate(c.id);
  db.prepare("UPDATE companions SET arc_state='bogus_legacy_state' WHERE id=?").run(c.id);
  let crashed = false, res;
  try { res = runArcTimeTickOne(c, NOW); } catch { crashed = true; }
  ok(!crashed, '③ 未知 arc_state 不崩（fail-open）');
  ok(res === 'normal', `③ 未知态 → normal（得 ${res}）`);
}

console.log('── ④ engine_calmed wiring ──');
{
  const c = mkComp('cold');
  preMigrate(c.id);
  db.prepare("UPDATE companions SET arc_state='cold' WHERE id=?").run(c.id);
  const evId = mkOpenEvent(c.id);
  insertEmotionPulse(c.id, { emotion: 'upset', intensity: 3, at: NOW.toISOString(), source: 'event', event_id: String(evId) }, NOW);
  const s = runArcTimeTickOne(c, NOW);
  ok(s === 'normal', `④ 闸 ON + cold + 同源3<floor → tick 后 normal（engine_calmed·得 ${s}）`);
  ok(db.prepare('SELECT engine_calmed_count FROM companions WHERE id=?').get(c.id).engine_calmed_count === 1, '④ engine_calmed_count=1');
}

console.log('── ⑤ 闸 OFF 字节安全 ──');
{
  process.env.EMOTION_ENGINE = '0';
  const c = mkComp('cold', { changedIso: new Date(NOW.getTime() - 4 * 3600e3).toISOString() });
  runArcTimeTickOne(c, NOW);
  ok(getEmotionMigratedAt(c.id) === null, '⑤ 闸 OFF：无迁移（emotion_migrated_at 仍 null）');
  ok(getEmotionPulses(c.id).length === 0, '⑤ 闸 OFF：无脉冲写入（引擎零触碰）');
  process.env.EMOTION_ENGINE = '1';
}

console.log(`\n══ d4_seam_timetick smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
