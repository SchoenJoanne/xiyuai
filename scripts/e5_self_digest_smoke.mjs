/**
 * e5_self_digest_smoke.mjs —— 批E·E5②(B1)：self 次日自我消化接线（D4 §3③·清 unresolved）
 *
 * E5 §1b：再评价四触发仅接道歉 resolve→未道歉反刍永不清（sadness 半衰162h·85% 两周不熄）；§1c：engine_calmed
 * 两头堵 0/431。修=接线 self（B1：成功消化清 unresolved=卸×3反刍）→数天衰过 floor + 盘活 calmed 活窗。
 *
 * 🔴 红验三件（维护者 拍）：
 *   A probe 6 天达标：self 接线后 harsh sev3 未道歉 sadness【数天】衰过 floor10（对照修前纯衰减两周不熄）
 *   B engineCalmedCheck 活窗（1b→1c 连锁）：消化后同源<floor → calmed 触发（对照未接 self=修前 0/431 两头堵）
 *   C isNextDay 当轮大情绪不许秒想通保留 + 每日一次节流（确定性日 roll·无 schema）
 *   D RUMINATE_MULT/floor 零触碰（常量默认未动）
 *
 * 坏版本红验（提交后单独跑）：引擎 self 去 clearUnresolved（回读法A）→ A 崖(6天→15天·断言>8红)·B calmed 不触发。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/e5_self_digest_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, setArcState, insertEmotionPulse, getEmotionPulses, engineCalmedCheck } = await import('../src/db.mjs');
const { negativeEmotionSum, EMO_RUMINATE, ENGINE_CALM_FLOOR, EMOTION_SELF_PEAK_MIN } = await import('../src/emotion_engine.mjs');
const { runSelfDigestTick } = await import('../src/relationship_arc_runtime.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const H = 3600e3, D = 24 * H;
const T0 = new Date('2026-06-20T02:00:00Z');   // 冲突时刻
const db = getDb();
db.pragma('foreign_keys = OFF');

let seq = 9400;
function mkConflict(now = T0) {
  const id = seq++;
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'secure', 0)").run(id);
  db.prepare('UPDATE companions SET emotion_migrated_at = ? WHERE id = ?').run(now.toISOString(), id);   // 防 lazy 迁移干扰
  setArcState(id, 'hurt', now.toISOString());
  const evId = db.prepare(`INSERT INTO companion_relationship_events (companion_id, type, severity, state_before, state_after, repair_status, created_at)
    VALUES (?, 'harsh_words', 3, 'normal', 'hurt', 'open', ?)`).run(id, now.toISOString()).lastInsertRowid;
  insertEmotionPulse(id, { emotion: 'upset', intensity: 90, importance: 1.5, unresolved: true, source: 'event', event_id: String(evId) }, now);
  insertEmotionPulse(id, { emotion: 'sadness', intensity: 82.5, importance: 1.5, unresolved: true, source: 'event', event_id: String(evId) }, now);
  const comp = { id, user_id: 1, bot_id: 'b', attachment_style: 'secure', safe_mode: 0, last_user_reply_at: now.toISOString(), wechat_user_id: null };
  const src = (t) => negativeEmotionSum(getEmotionPulses(id).filter(p => p.event_id === String(evId)), t);
  return { comp, evId, src };
}

console.log('── A probe：self 接线后 sadness 数天衰过 floor10（对照修前两周不熄）──');
{
  const { comp, src } = mkConflict();
  let crossDay = null;
  for (let d = 1; d <= 14; d++) {
    const now = new Date(T0.getTime() + d * D);
    runSelfDigestTick(comp, now, { roll: 0.1 });   // 强制命中=隔离机制（生产走确定性日 roll·见 C）
    if (crossDay == null && src(now) < ENGINE_CALM_FLOOR()) crossDay = d;
  }
  console.log(`    crossDay(floor${ENGINE_CALM_FLOOR()})=${crossDay}`);
  ok(crossDay != null && crossDay <= 8, `A self 接线 sadness 数天(${crossDay}天)衰过 floor（B1 卸反刍·162h→54h）`);

  // 对照：不接 self（纯衰减·×3 反刍）→ 14 天仍不过 floor = 修前"两周不熄"
  const { src: ctlSrc } = mkConflict();
  const d14 = new Date(T0.getTime() + 14 * D);
  const ctl14 = ctlSrc(d14);
  ok(ctl14 >= ENGINE_CALM_FLOOR(), `A对照 不接 self（×3 反刍）→14 天仍未过 floor(${ctl14.toFixed(1)})=修前"两周不熄"`);
}

console.log('── B engineCalmedCheck 活窗（1b→1c 连锁·对照修前 0/431 两头堵）──');
{
  const { comp, src } = mkConflict();
  const nowB = new Date(T0.getTime() + 10 * D);
  for (let d = 1; d <= 10; d++) runSelfDigestTick(comp, new Date(T0.getTime() + d * D), { roll: 0.1 });
  ok(src(nowB) < ENGINE_CALM_FLOOR(), 'B 前置：消化后同源<floor');
  const calmed = engineCalmedCheck(comp.id, nowB);
  ok(calmed.calmed === true, 'B self 消化盘活 engineCalmedCheck 活触发(calmed=true·vs 修前 0/431)');
  ok(db.prepare('SELECT arc_state FROM companions WHERE id=?').get(comp.id).arc_state === 'normal', 'B calmed 后 arc→normal（1c 收敛通道活）');

  // 对照：未接 self（同源仍>floor）→ calmed 不触发=两头堵
  const { comp: cc } = mkConflict();
  const calmedCtl = engineCalmedCheck(cc.id, new Date(T0.getTime() + 10 * D));
  ok(calmedCtl.calmed === false, 'B对照 未消化(同源>floor)→calmed 不触发（证是 self 解的堵·1b→1c 连锁成立）');
}

console.log('── C isNextDay 当轮不许 + 每日一次节流 ──');
{
  const { comp: c0, src } = mkConflict();
  const b0 = src(T0);
  runSelfDigestTick(c0, T0, { roll: 0.1 });   // 同(上海)日 tick
  ok(Math.abs(src(T0) - b0) < 0.01, 'C 当轮(同上海日)大情绪不许秒想通（isNextDay=false→零消化）');

  const day1 = new Date(T0.getTime() + D);
  const n1 = runSelfDigestTick(c0, day1, { roll: 0.1 });   // 次日首调=命中
  const mid = src(day1);
  runSelfDigestTick(c0, day1, { roll: 0.1 });               // 同日再调
  ok(n1 > 0 && Math.abs(src(day1) - mid) < 0.01, 'C 每日一次：同(上海)日再调不再消化（消化后脉冲 at→今日=非上一日）');

  // 确定性日 roll：无 forced roll·同日重复判定稳定（失败日整日失败/命中日一次即止）
  const { comp: c3, src: s3 } = mkConflict();
  const dd = new Date(T0.getTime() + D);
  runSelfDigestTick(c3, dd); const a = s3(dd);
  runSelfDigestTick(c3, dd); const b = s3(dd);
  ok(Math.abs(a - b) < 0.01, 'C 确定性日 roll：同(上海)日重复 tick 判定稳定（无随机抖动）');
}

console.log('── D RUMINATE_MULT / floor 零触碰 ──');
{
  ok(EMO_RUMINATE() === 3, 'D EMOTION_RUMINATE_MULT 仍=3（未动）');
  ok(ENGINE_CALM_FLOOR() === 10, 'D ENGINE_CALM_FLOOR 仍=10（未动）');
  ok(EMOTION_SELF_PEAK_MIN() === 40, 'D EMOTION_SELF_PEAK_MIN 仍=40（未动）');
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} e5_self_digest_smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
