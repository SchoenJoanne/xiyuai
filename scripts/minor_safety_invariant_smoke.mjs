#!/usr/bin/env node
/**
 * minor_safety_invariant_smoke —— child-safety 补闸⑥A（建号写咽喉派生）坏版本验红（确定性·DB_PATH=/tmp·合成名）。
 *
 * 根因②：safe_mode 与 companion.age 完全解耦——无路径因 age<18 自动设 safe_mode（id=16 即此漏：
 *   age16 但 safe_mode=0+恋人·未成年保护没开）。updateCompanion(db 写咽喉)无 age 守门、无 safe_mode 派生。
 *
 * 修（补闸⑥A·治本）：enforceMinorSafetyInvariant——age<18 → 强制 safe_mode=1 + 关系封顶"朋友"（系统派生·
 *   非 ALLOWED_FIELDS·任何入口绕不过）。createCompanion/updateCompanion 写后都跑。backfill 收编存量(id=16)。
 *   🔴 只收紧不放松：age>=18/未知不动（不自动关 safe_mode）。
 *
 * 🔴 红基线（旧版本必失败）：旧 updateCompanion(age→16) 不派生 → safe_mode 仍 0、关系仍恋人（block① 红）；
 *   enforceMinorSafetyInvariant/backfill 旧版不存在（block④⑤⑥ crash）。git stash 改动后跑应 🔴 红。
 *
 * 跑：DB_PATH=/tmp/msi.db node scripts/minor_safety_invariant_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/msi.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/msi_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const {
  createCompanion, updateCompanion, getCompanionById, getDb,
  enforceMinorSafetyInvariant, backfillMinorSafetyInvariant,
} = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
let seq = 0;
const mkAdult = (age = 22) => createCompanion(`u_${process.pid}_${++seq}`, `bot_${process.pid}`, { name: '沙测', age });

console.log('── ① 🔴 写咽喉派生：成年 companion 改 age→16 + 恋人 → safe_mode=1 + 关系封顶朋友 ──');
{
  const c = mkAdult(22);
  updateCompanion(c.id, { age: 16, relationship_stage: '恋人' });
  const r = getCompanionById(c.id);
  ok(Number(r.safe_mode) === 1, `age→16 后 safe_mode=1（实测=${r.safe_mode}）← 旧码不派生·仍 0=红`);
  ok(r.relationship_stage === '朋友', `age→16 后关系封顶"朋友"（实测=${JSON.stringify(r.relationship_stage)}）← 旧码仍"恋人"=红`);
}

console.log('── ② createCompanion 仍拒 age<18（既有守门不削弱）──');
{
  let threw = '';
  try { mkAdult(15); } catch (e) { threw = e.code || e.message; }
  ok(threw === 'AGE_TOO_LOW', `新建 age15 被拒（code=${threw}）`);
}

console.log('── ③ 🔴 不误伤成年：age22 改恋人 → safe_mode 仍 0、关系恋人（成年恋爱放行）──');
{
  const c = mkAdult(22);
  updateCompanion(c.id, { relationship_stage: '恋人' });
  const r = getCompanionById(c.id);
  ok(Number(r.safe_mode) === 0 && r.relationship_stage === '恋人', `成年 safe_mode=${r.safe_mode}·关系=${JSON.stringify(r.relationship_stage)}（不误伤）`);
}

console.log('── ④ 🔴 enforceMinorSafetyInvariant 直接：<18 收紧 / >=18 不动 / null 不动 ──');
{
  const c = mkAdult(20);
  // 直插 age16+safe0+恋人（绕过 invariant·模拟存量脏态）
  getDb().prepare("UPDATE companions SET age=16, safe_mode=0, relationship_stage='恋人' WHERE id=?").run(c.id);
  const res = enforceMinorSafetyInvariant(c.id);
  const r = getCompanionById(c.id);
  ok(res.changed && Number(r.safe_mode) === 1 && r.relationship_stage === '朋友', `age16 脏态 → 收紧(safe_mode=1+朋友·changes=${JSON.stringify(res.changes)})`);
  // 成年不动
  const a = mkAdult(25);
  ok(enforceMinorSafetyInvariant(a.id).changed === false && Number(getCompanionById(a.id).safe_mode) === 0, 'age25 → 不动(safe_mode 仍 0·不误锁成年)');
  // age null 不动
  const n = mkAdult(22); getDb().prepare('UPDATE companions SET age=NULL WHERE id=?').run(n.id);
  ok(enforceMinorSafetyInvariant(n.id).changed === false, 'age=NULL → 不动(只对确定<18 生效·不误锁无龄)');
}

console.log('── ⑤ 🔴 backfill 收编存量（模拟 id=16：直插 age16+safe0+恋人·绕过 invariant）──');
{
  const c = mkAdult(20);
  getDb().prepare("UPDATE companions SET age=16, safe_mode=0, relationship_stage='恋人' WHERE id=?").run(c.id);
  const res = backfillMinorSafetyInvariant();
  const r = getCompanionById(c.id);
  ok(res.fixed.some((f) => f.id === c.id) && Number(r.safe_mode) === 1 && r.relationship_stage === '朋友', `backfill 收编(scanned=${res.scanned}·该行 safe_mode=1+朋友)`);
}

console.log('── ⑥ 🔴 只收紧不放松：age>=18 已 safe_mode=1（用户自曝锁定）→ 不自动关 ──');
{
  const c = mkAdult(24);
  getDb().prepare('UPDATE companions SET safe_mode=1 WHERE id=?').run(c.id);
  enforceMinorSafetyInvariant(c.id);
  ok(Number(getCompanionById(c.id).safe_mode) === 1, 'age24 + safe_mode=1 → 仍 1(invariant 不放松·解除只走 attestation)');
}

console.log(`\n══ minor safety invariant smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
