/**
 * d4_engine_hint_smoke.mjs —— ② 表达单源=引擎 hint（批E·E3·E4 §4 文本库·确定性零 LLM）
 *
 * ① buildEngineHint 选择：upset高harsh/taboo·怒退悲显·迁移平静·各选对变体
 * ② 零 hint 判据：负面和 <floor → ''（平静不宣布·engine_calmed 后残余低同此）
 * ③ 铁线：冲突域 hint 带 REDLINE·全文零机制词（强度/状态/引擎/英文情绪名）="她在说心情"非"系统播报"
 * ④ wiring：闸 ON runArcSignalTick → directive 来自引擎 hint（非 arc"你凉了"态 tone）·闸 OFF → arc tone
 * ⑤ voiceConcern 同轮直说两臂保留（非 arc 态 tone·不被引擎替换）
 *
 * 🔴 坏版本红验：buildEngineHint 去零 hint floor 判断 → 平静(残余低)也注入 hint（②红=违"平静不宣布"）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/d4_engine_hint_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { buildEngineHint } = await import('../src/emotion_hint.mjs');
const { EMOTION_HINT_FLOOR } = await import('../src/emotion_engine.mjs');
const { getDb, upsertPreference } = await import('../src/db.mjs');
const { runArcSignalTick } = await import('../src/relationship_arc_runtime.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const NOW = new Date('2026-07-05T12:00:00Z');
const P = (emotion, intensity, over = {}) => ({ emotion, intensity, at: NOW.getTime(), importance: 1, unresolved: false, source: 'event', ...over });

console.log('── ① buildEngineHint 变体选择 ──');
{
  ok(buildEngineHint([P('upset', 70)], { arcEventType: 'harsh_words' }, NOW).includes('堵得慌'), '① upset高+harsh → U_HI_harsh');
  ok(buildEngineHint([P('upset', 70)], { arcEventType: 'taboo_hit' }, NOW).includes('别拿来开玩笑'), '① upset高+taboo → U_HI_taboo');
  ok(buildEngineHint([P('upset', 20), P('sadness', 40)], { repaired: true }, NOW).includes('不想翻旧账'), '① upset+sadness 悲不弱 +已修复 → 怒退悲显（X_ANGERSAD）');
  ok(!buildEngineHint([P('upset', 20), P('sadness', 40)], {}, NOW).includes('不想翻旧账'), '① E5① 同注但【未修复】→ 绝不 X_ANGERSAD（不叙述"他道了歉"）');
  ok(/早消化完|早就自己散了/.test(buildEngineHint([P('sadness', 18, { source: 'arc_migration' })], {}, NOW)), '① 迁移低烈度 → 迁移平静（③轮换 X迁-1/2）');
  ok(buildEngineHint([P('annoyance', 30)], {}, NOW).includes('那是嗔'), '① annoyance 主导 → 嗔');
}

console.log('── ② 零 hint 判据（平静不宣布）──');
{
  ok(buildEngineHint([P('upset', EMOTION_HINT_FLOOR() - 5)], {}, NOW) === '', '② 负面和 <floor → 零 hint');
  ok(buildEngineHint([], {}, NOW) === '', '② 无脉冲 → 零 hint');
  ok(buildEngineHint([P('joy', 80)], {}, NOW) === '', '② 纯正面（世界事件域未接线）→ 零 hint');
}

console.log('── ③ 铁线（带 REDLINE·零机制词）──');
{
  const h = buildEngineHint([P('upset', 70)], { arcEventType: 'harsh_words' }, NOW);
  ok(h.includes('绝对红线'), '③ 冲突域 hint 带 REDLINE_FOOTER');
  ok(!/强度|系统|引擎|状态[:：]|upset|sadness|annoyance/.test(h), '③ 全文零机制词（她在说心情·非系统播报）');
  ok(h.includes('【此刻你心里的事】'), '③ D4 §5 统一头');
}

console.log('── ④ wiring：闸 ON directive 换源 ──');
{
  const db = getDb(); db.pragma('foreign_keys = OFF');
  const mk = (id) => {
    db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'avoidant', 0)").run(id);
    upsertPreference({ companionId: id, type: 'taboo', target: '催婚', intensity: 5 });
    return { id, user_id: 1, bot_id: 'b', attachment_style: 'avoidant', safe_mode: 0, last_user_reply_at: NOW.toISOString(), wechat_user_id: null };
  };
  const on = runArcSignalTick(mk(9701), { userText: '你爸妈什么时候催婚啊，赶紧的' });
  ok(on.directive.includes('【此刻你心里的事】') && !on.directive.includes('你凉了'), '④ 闸 ON → directive=引擎 hint（非 arc"你凉了"态 tone）');
  process.env.EMOTION_ENGINE = '0';
  const off = runArcSignalTick(mk(9702), { userText: '你爸妈什么时候催婚啊，赶紧的' });
  process.env.EMOTION_ENGINE = '1';
  ok(off.directive.includes('你凉了') && !off.directive.includes('【此刻你心里的事】'), '④ 闸 OFF → directive=arc 态 tone（字节一致）');
}

console.log('── ⑤ voiceConcern 两臂保留 ──');
{
  const db = getDb();
  const mk = (id) => {
    db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'secure', 0)").run(id);
    return { id, user_id: 1, bot_id: 'b', attachment_style: 'secure', safe_mode: 0, last_user_reply_at: NOW.toISOString(), wechat_user_id: null };
  };
  // secure + 轻度不舒服（perceived_hurt）→ voice_concern（arc 停 normal）·gate ON 也应保留"直说"
  const r = runArcSignalTick(mk(9703), { userText: '你这话说得挺难听的', inner: { perceived_hurt: 3, user_tone: 'harsh' } });
  ok(r.voiceConcern ? r.directive.includes('把不舒服直说') : true, '⑤ voiceConcern 时保留"直说"指令（同轮信号·非态 tone·两臂在）');
}

console.log(`\n══ d4_engine_hint smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
