/**
 * e5_hint_event_context_smoke.mjs —— 批E·E5①：X/repair 叙事族事件语境闸（纯选择层·引擎数学零触碰）
 *
 * E5 §1a 头号 bug：X_ANGERSAD 分支条件(悲≥0.8×怒)在同注冲突出生即真→429/429 冲突在道歉前注入
 * "他道了歉"虚假叙事。修=X_ANGERSAD 家族 与 U_LOW_repair 只有 repaired(修复语境已发生) 才可选；未修复→U_HI 优先。
 *
 * 🔴 红验=E5 亲眼复现案逐字重放：
 *   ① harsh sev3 未道歉(upset=90/sadness=82.5)·+1min~+96h 每轮 hint【绝不】X_ANGERSAD*·U_HI 可达
 *   ② 道歉后(repaired) → X_ANGERSAD 恢复可选
 *   ③ 次生同族 U_LOW_repair「你们和好了」同受闸（未修复→U_LOW 中性残余）
 *   ④ 迁移脉冲(源=arc_migration·unresolved=false)不误判 repaired → S_HI_migrate 非 X_ANGERSAD（附带修正）
 *   ⑤ 接线：runArcSignalTick 未道歉冲突 directive 不含 X_ANGERSAD（runtime 传 repaired=false）
 *
 * 坏版本红验（提交后单独跑）：去 repaired 门控（X_ANGERSAD 无条件）→ ①⑤ 变红。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/e5_hint_event_context_smoke.db';
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { buildEngineHint } = await import('../src/emotion_hint.mjs');
const { getDb, upsertPreference } = await import('../src/db.mjs');
const { runArcSignalTick } = await import('../src/relationship_arc_runtime.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const H = 3600e3;
const T0 = new Date('2026-06-20T02:00:00Z').getTime();   // 冲突时刻

// X_ANGERSAD 家族探针（std/heavy 含"道歉"叙事·light 含"气早散·失落"和好尾巴）
const isAngerSad = (h) => /道过歉|他道了歉|你也接受了|没落地的失落/.test(h);
// harsh sev3 未道歉脉冲（E5 复现案值·unresolved 不参与①判定=与②解耦）
const conflict = () => ([
  { emotion: 'upset',   intensity: 90,   at: new Date(T0).toISOString(), importance: 1.5, unresolved: true, source: 'event', event_id: 'E1' },
  { emotion: 'sadness', intensity: 82.5, at: new Date(T0).toISOString(), importance: 1.5, unresolved: true, source: 'event', event_id: 'E1' },
]);

console.log('── ① 未道歉 +1min~+96h 每轮：绝不 X_ANGERSAD·U_HI 可达 ──');
{
  let anyAngerSad = false, uHiSeen = false, samples = 0;
  // +1min，随后 +0h..+96h 每小时（"每轮"逐点重放）
  const points = [1 / 60, ...Array.from({ length: 97 }, (_, i) => i)];
  for (const dh of points) {
    const now = new Date(T0 + dh * H);
    const h = buildEngineHint(conflict(), { arcEventType: 'harsh_words', repaired: false }, now);
    samples++;
    if (isAngerSad(h)) anyAngerSad = true;
    if (h.includes('堵得慌')) uHiSeen = true;   // U_HI_harsh
  }
  ok(!anyAngerSad, `① 未道歉 ${samples} 个采样点【零】X_ANGERSAD*（不注入"他道了歉"虚假事实）`);
  ok(uHiSeen, '① U_HI（冲突现场原生表达）在新鲜窗可达（U_HI 优先成立）');
}

console.log('── ② 道歉后（repaired 且 怒已退=unresolved 已清）→ X_ANGERSAD 恢复；relapse 补洞 ──');
{
  // 道歉=reappraiseEngine resolve→同源脉冲 unresolved=false·×0.6（怒已退的残余·非活怒）
  const resolved = [
    { emotion: 'upset', intensity: 54, at: new Date(T0).toISOString(), importance: 1.5, unresolved: false, source: 'event', event_id: 'E1' },
    { emotion: 'sadness', intensity: 49.5, at: new Date(T0).toISOString(), importance: 1.5, unresolved: false, source: 'event', event_id: 'E1' },
  ];
  ok(isAngerSad(buildEngineHint(resolved, { arcEventType: 'harsh_words', repaired: true }, new Date(T0 + 2 * H))), '② 道歉 resolve(×0.6·unresolved清)后 repaired → X_ANGERSAD 恢复可选');
  // 🔴 对抗复审补洞：repairing 窗内 sev-2 relapse = 新鲜【未决】冲撞（怒未退·repair_status 仍 repairing→repaired=true）·仍【绝不】X_ANGERSAD
  const relapse = [
    { emotion: 'upset', intensity: 60, at: new Date(T0 + 2 * H).toISOString(), importance: 1, unresolved: true, source: 'event', event_id: 'E_relapse' },
    { emotion: 'sadness', intensity: 55, at: new Date(T0 + 2 * H).toISOString(), importance: 1, unresolved: true, source: 'event', event_id: 'E_relapse' },
  ];
  const h = buildEngineHint(relapse, { arcEventType: 'harsh_words', repaired: true }, new Date(T0 + 2 * H));
  ok(!isAngerSad(h), '② sev-2 relapse（repairing 窗内新冲撞·未决·repaired=true）仍【绝不】X_ANGERSAD（怒未退=不谎称道歉）');
  ok(h.includes('堵得慌'), '② 该新冲撞(高档) → U_HI（冲突现场原生表达·非"他道了歉"·U_HI优先层）');
  // 中档新冲撞（decay 到 mid·U_HI优先不触发·须靠 X_ANGERSAD 的 !rawAnger 兜底=第二层）
  const midRelapse = [
    { emotion: 'upset', intensity: 45, at: new Date(T0 + 2 * H).toISOString(), importance: 1, unresolved: true, source: 'event', event_id: 'E_mid' },
    { emotion: 'sadness', intensity: 48, at: new Date(T0 + 2 * H).toISOString(), importance: 1, unresolved: false, source: 'event', event_id: 'E_old' },
  ];
  ok(!isAngerSad(buildEngineHint(midRelapse, { arcEventType: 'harsh_words', repaired: true }, new Date(T0 + 2 * H))), '② 中档新冲撞(未决) repaired=true 仍绝不 X_ANGERSAD（X_ANGERSAD 的 !rawAnger 第二层兜底·非 vacuous）');
}

console.log('── ③ 次生同族 U_LOW_repair 同受 repaired 闸 ──');
{
  // 低 upset 残余（unresolved=false=怒已退·rawAnger=false·隔离 repaired 判定）
  const low = () => [{ emotion: 'upset', intensity: 22, at: new Date(T0).toISOString(), importance: 1, unresolved: false, source: 'event', event_id: 'E2' }];
  const unrep = buildEngineHint(low(), { repaired: false }, new Date(T0 + 2 * H));
  const rep = buildEngineHint(low(), { repaired: true }, new Date(T0 + 2 * H));
  ok(!unrep.includes('你们和好了'), '③ 低 upset 未修复 → 不叙述"你们和好了"（U_LOW 中性残余）');
  ok(rep.includes('你们和好了'), '③ 低 upset 已修复 → U_LOW_repair 可选');
}

console.log('── ④ 迁移脉冲不误判 repaired（附带修正）──');
{
  // 迁移 cold：upset+sadness·source=arc_migration·unresolved=false（账已清）——不得触 X_ANGERSAD
  const mig = [
    { emotion: 'upset', intensity: 40, at: new Date(T0).toISOString(), importance: 1, unresolved: false, source: 'arc_migration', event_id: 'mig_1' },
    { emotion: 'sadness', intensity: 55, at: new Date(T0).toISOString(), importance: 1, unresolved: false, source: 'arc_migration', event_id: 'mig_1' },
  ];
  const h = buildEngineHint(mig, { repaired: false }, new Date(T0 + 1 * H));
  ok(!isAngerSad(h), '④ 迁移脉冲（unresolved=false 但源=迁移）→ 不误判 repaired·非 X_ANGERSAD');
  ok(/消化|压在心口|淡淡的闷/.test(h), '④ 迁移悲 → S_*_migrate / X_MIGRATE（存量迁移叙事·非冲突和好尾巴）');
}

console.log('── ⑤ 接线：runArcSignalTick 未道歉冲突 directive 不含 X_ANGERSAD ──');
{
  const db = getDb(); db.pragma('foreign_keys = OFF');
  const mk = (id) => {
    db.prepare("INSERT INTO companions (id, user_id, bot_id, name, attachment_style, safe_mode) VALUES (?, 1, 'b', '溪语', 'secure', 0)").run(id);
    upsertPreference({ companionId: id, type: 'taboo', target: '前任', intensity: 5 });
    return { id, user_id: 1, bot_id: 'b', attachment_style: 'secure', safe_mode: 0, last_user_reply_at: new Date(T0).toISOString(), wechat_user_id: null };
  };
  const r = runArcSignalTick(mk(9811), { userText: '你提这个干嘛，烦不烦', inner: { perceived_hurt: 4, user_tone: 'harsh' } }, new Date(T0));
  ok(!isAngerSad(r.directive), '⑤ runtime 未道歉冲突 → directive 不含 X_ANGERSAD（repair_status=open→repaired=false）');
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} e5_hint_event_context_smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
