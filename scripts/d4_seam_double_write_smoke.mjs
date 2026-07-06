/**
 * d4_seam_double_write_smoke.mjs —— Phase4b 信号接缝双写（批E·E3 §3.2·真信号驱动·零 LLM）
 *
 * ① 冲突事件双写：踩雷 taboo → arc 转移 + 引擎脉冲（source=event·同 event_id）
 * ② severe 怒悲同注：sev4 → 脉冲含 upset+sadness
 * ③ apology 同源加速：道歉 → 同 event_id 负面族回落（intensity 降·unresolved 清）
 * ④ 闸 OFF 字节安全：冲突消息不写脉冲（引擎零触碰）
 * ⑤ 双写不双表达前置：脉冲 event_id === arc open event id（engine_calmed 同源锚可用）
 *
 * 🔴 坏版本红验：去 _engineDoubleWrite 调用 → 冲突不写脉冲（①②⑤红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/d4_seam_double_write_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, upsertPreference, getEmotionPulses, getOpenRelationshipEvent } = await import('../src/db.mjs');
const { runArcSignalTick } = await import('../src/relationship_arc_runtime.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const db = getDb();
db.pragma('foreign_keys = OFF');

let seq = 9400;
const mkComp = (id) => {
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'avoidant', 0)").run(id);
  upsertPreference({ companionId: id, type: 'taboo', target: '催婚', intensity: 5 });
  return { id, user_id: 1, bot_id: 'b', attachment_style: 'avoidant', safe_mode: 0,
    last_user_reply_at: new Date().toISOString(), wechat_user_id: null };
};

console.log('── ①②⑤ 冲突双写 + 怒悲同注 + 同源锚 ──');
{
  const id = seq++;
  const comp = mkComp(id);
  const r = runArcSignalTick(comp, { userText: '你爸妈什么时候催婚啊，赶紧的' });
  const ev = getOpenRelationshipEvent(id);
  const pulses = getEmotionPulses(id).filter(p => p.source === 'event');
  ok(r.arcState === 'cold', `① 踩雷 → cold（得 ${r.arcState}）`);
  ok(pulses.length >= 1, `① 冲突写引擎脉冲（${pulses.length} 条·source=event）`);
  ok(pulses.some(p => p.emotion === 'upset') && pulses.some(p => p.emotion === 'sadness'), '② sev4 怒悲同注（upset+sadness）');
  ok(ev && pulses.length >= 1 && pulses.every(p => p.event_id === String(ev.id)), '⑤ 脉冲 event_id === arc open event id（同源锚·engine_calmed 可用·非 vacuous）');
}

console.log('── ③ apology 同源加速 ──');
{
  const id = seq++;
  const comp = mkComp(id);
  runArcSignalTick(comp, { userText: '你爸妈什么时候催婚啊，赶紧的' });   // 先踩雷造负面
  const before = getEmotionPulses(id).filter(p => p.source === 'event');
  const sumBefore = before.reduce((s, p) => s + Number(p.intensity), 0);
  const unresolvedBefore = before.some(p => p.unresolved === true);
  runArcSignalTick(comp, { userText: '对不起，我刚才不该催你的，我以后再也不提了' });   // 道歉
  const after = getEmotionPulses(id).filter(p => p.source === 'event');
  const sumAfter = after.reduce((s, p) => s + Number(p.intensity), 0);
  ok(unresolvedBefore, '③ 踩雷后负面脉冲 unresolved=true');
  ok(sumAfter < sumBefore, `③ 道歉 → 同源族强度回落（${r1(sumBefore)}→${r1(sumAfter)}）`);
  ok(after.every(p => p.unresolved === false), '③ 道歉 → 同源族 unresolved 全清（加速回落）');
}

console.log('── ④ 闸 OFF 字节安全 ──');
{
  process.env.EMOTION_ENGINE = '0';
  const id = seq;
  const comp = mkComp(id);
  const r = runArcSignalTick(comp, { userText: '你爸妈什么时候催婚啊，赶紧的' });
  process.env.EMOTION_ENGINE = '1';
  ok(r.arcState === 'cold', '④ 闸 OFF：arc 照常转移 cold（Legacy 行为不变）');
  ok(getEmotionPulses(id).length === 0, '④ 闸 OFF：不写脉冲（引擎零触碰·字节安全）');
}

console.log(`\n══ d4_seam_double_write smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
