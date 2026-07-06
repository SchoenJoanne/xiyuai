/**
 * e0b_arc_migration_smoke.mjs —— 存量 arc→引擎迁移（批E·E0b §5 六测·确定性零 LLM）
 *
 * ① 五态映射逐条（hurt→upset / cold→upset+sadness / withdrawing→sadness / repairing→低upset / scar→清）
 * ② 衰减折算：新态(4h)迁有效脉冲·老态(60h)迁近零/丢弃·单调递减（越老越淡）
 * ③ scar 清除【不扣 trust】（对比退役前 withdraw_capped 扣 −3）
 * ④ 幂等：二次迁移跳过（emotion_migrated_at 已置）
 * ⑤ 铁线：目标枚举无 contempt·折算入参不含 last_user_reply_at 族（结构断言）
 * ⑥ 审计：每迁一态产一条 migration_event（可回溯 migrated_from·cold 双脉冲共享 event_id）
 *
 * 🔴 坏版本红验：migrateArcToPulses 去衰减折算（迁 base 原值）→ 60h cold 迁成满强度 sadness=旧情绪原样再注（②红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/e0b_arc_migration_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { migrateArcToPulses, EMO_NEGATIVE, MIG_COLD_SAD, MIG_DROP_FLOOR } =
  await import('../src/emotion_engine.mjs');
const { getDb, setArcState, migrateArcToEngine, getEmotionPulses, getEmotionMigratedAt } =
  await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const NOW = new Date('2026-07-05T12:00:00Z');
const agoIso = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

console.log('── ① 五态映射（纯折算）──');
{
  const hurt = migrateArcToPulses('hurt', NOW.getTime() - 1 * 3600e3, NOW);
  ok(hurt.pulses.length === 1 && hurt.pulses[0].emotion === 'upset', '① hurt→upset');
  const cold = migrateArcToPulses('cold', NOW.getTime(), NOW);
  ok(cold.pulses.length === 2 && cold.pulses[0].emotion === 'upset' && cold.pulses[1].emotion === 'sadness',
     '① cold→upset+sadness（怒悲同注）');
  const wd = migrateArcToPulses('withdrawing', NOW.getTime(), NOW);
  ok(wd.pulses.length === 1 && wd.pulses[0].emotion === 'sadness', '① withdrawing→sadness（深悲）');
  const rep = migrateArcToPulses('repairing', NOW.getTime(), NOW);
  ok(rep.pulses.length === 1 && rep.pulses[0].emotion === 'upset' && rep.pulses[0].intensity < 20,
     '① repairing→低 upset（残余委屈）');
  const scar = migrateArcToPulses('normal_with_scar', NOW.getTime(), NOW);
  ok(scar.pulses.length === 0 && scar.clearScar === true, '① normal_with_scar→无脉冲+clearScar');
  const normal = migrateArcToPulses('normal', NOW.getTime(), NOW);
  ok(normal.pulses.length === 0 && normal.clearScar === false, '① normal→不迁');
}

console.log('── ② 衰减折算（防旧情绪原样再注）──');
{
  // 新态 4h hurt → upset ≈34（有效脉冲）
  const h4 = migrateArcToPulses('hurt', NOW.getTime() - 4 * 3600e3, NOW).pulses[0];
  ok(h4 && h4.intensity > MIG_DROP_FLOOR() && h4.intensity < 40, `② 4h hurt→upset 有效脉冲(${r1(h4.intensity)})`);
  // 老态 60h cold → upset 折算<floor 丢弃·sadness 仅剩淡淡的闷（≈17·非满强度 55）
  const c60 = migrateArcToPulses('cold', NOW.getTime() - 60 * 3600e3, NOW).pulses;
  const s60 = c60.find(p => p.emotion === 'sadness');
  ok(!c60.some(p => p.emotion === 'upset'), '② 60h cold：upset 折算<floor 丢弃（已消化）');
  ok(s60 && s60.intensity > MIG_DROP_FLOOR() && s60.intensity < 25,
     `② 60h cold：sadness 折算≈17 远低于 base ${MIG_COLD_SAD()}（🔴红验点：去折算=满强度再注）·得 ${r1(s60.intensity)}`);
  // 单调：越老迁得越淡（2h vs 8h hurt→upset）
  const u2 = migrateArcToPulses('hurt', NOW.getTime() - 2 * 3600e3, NOW).pulses[0].intensity;
  const u8 = migrateArcToPulses('hurt', NOW.getTime() - 8 * 3600e3, NOW).pulses[0].intensity;
  ok(u2 > u8, `② 单调递减：2h(${r1(u2)}) > 8h(${r1(u8)})·越老越淡`);
}

console.log('── ⑤ 铁线（无 contempt·时间只衰减不产情绪）──');
{
  const emitted = new Set();
  for (const st of ['hurt', 'cold', 'withdrawing', 'repairing']) {
    for (const p of migrateArcToPulses(st, NOW.getTime(), NOW).pulses) emitted.add(p.emotion);
  }
  ok(![...emitted].includes('contempt'), '🔴⑤ 迁移目标枚举无 contempt（轻蔑轨道结构排除）');
  ok([...emitted].every(e => EMO_NEGATIVE.includes(e)), '⑤ 迁移目标全在 OCC 负面枚举');
  ok(migrateArcToPulses.length === 2, '⑤ 折算入参=2 标量(arcState,stateChangedAt)+now·无 options 对象=无 reply-time 注入面');
  // 🔴 铁线核心：stateChangedAt 只作【衰减输入】——在态越久 intensity 只降不升（沉默/缺席绝不产/加情绪）
  const recent = migrateArcToPulses('cold', NOW.getTime() - 1 * 3600e3, NOW).pulses.find(p => p.emotion === 'sadness').intensity;
  const old = migrateArcToPulses('cold', NOW.getTime() - 50 * 3600e3, NOW).pulses.find(p => p.emotion === 'sadness').intensity;
  ok(old < recent, `🔴⑤ 在态越久强度只降不升(50h ${r1(old)} < 1h ${r1(recent)})=沉默绝不入驱动源`);
}

// ── DB 集成（③④⑥）──
const db = getDb();
db.pragma('foreign_keys = OFF');
const mkComp = (id, state, changedIso) => {
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (?, 1, 'b', '溪语')").run(id);
  setArcState(id, state, changedIso);
};

console.log('── ③ scar 清除不扣 trust ──');
{
  const ID = 9103;
  mkComp(ID, 'normal_with_scar', agoIso(100));
  db.prepare('INSERT INTO companion_emotion_state (companion_id, trust) VALUES (?, 50)').run(ID);
  const res = migrateArcToEngine(ID, NOW);
  const trustAfter = db.prepare('SELECT trust FROM companion_emotion_state WHERE companion_id = ?').get(ID).trust;
  const arcAfter = db.prepare('SELECT arc_state FROM companions WHERE id = ?').get(ID).arc_state;
  ok(res.migrated === true && res.clearScar === true && res.pulses.length === 0, '③ scar 迁移=清除无脉冲');
  ok(arcAfter === 'normal', '③ arc_state → normal（scar 清除）');
  ok(trustAfter === 50, `③ trust 不变=50（不扣 SCAR_TRUST_PENALTY·得 ${trustAfter}）`);
  ok(getEmotionMigratedAt(ID) !== null, '③ emotion_migrated_at 已置（幂等标）');
}

console.log('── ④ 幂等（二次迁移跳过）──');
{
  const ID = 9104;
  mkComp(ID, 'hurt', agoIso(2));
  const r1st = migrateArcToEngine(ID, NOW);
  const n1 = getEmotionPulses(ID).length;
  const r2nd = migrateArcToEngine(ID, NOW);
  const n2 = getEmotionPulses(ID).length;
  ok(r1st.migrated === true && r1st.count === 1, '④ 首次迁移：hurt→1 脉冲');
  ok(r2nd.migrated === false && r2nd.reason === 'already', '④ 二次迁移跳过（already）');
  ok(n1 === 1 && n2 === 1, '④ 脉冲不重复注入（1→1）');
}

console.log('── ⑥ 审计（migration_event 可回溯）──');
{
  const ID = 9106;
  mkComp(ID, 'cold', agoIso(4));   // 4h cold → upset+sadness 均存活
  const res = migrateArcToEngine(ID, NOW);
  const rows = getEmotionPulses(ID).filter(p => p.source === 'arc_migration');
  ok(rows.length === 2, `⑥ cold 4h 迁 2 脉冲（upset+sadness·得 ${rows.length}）`);
  ok(rows.every(r => r.migrated_from === 'cold'), '⑥ 每脉冲 migrated_from=cold（可回溯原态）');
  ok(rows.every(r => r.event_id === res.migrationEventId) && new Set(rows.map(r => r.event_id)).size === 1,
     '⑥ cold 双脉冲共享同一 migration_event_id（同源加速锚）');
}

console.log(`\n══ e0b_arc_migration smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
