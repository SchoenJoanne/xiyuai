#!/usr/bin/env node
/**
 * user_nsfw_age_gate_smoke —— child-safety 步④（用户侧 nsfw 年龄门）坏版本验红（确定性·DB_PATH=/tmp·合成账号）。
 *
 * 缺口：getUserAgeStatus(db.mjs) canNsfw=!ageKnown||age>=16——阈值 16 与 isMinor=age<18 自相矛盾，
 *   16-17 未成年却 canNsfw=true。🔴 当前全库 0 消费者（死代码·无 live 风险），趁没接线前堵雷·与法定 18 对齐。
 *
 * 修：canNsfw 阈值 16→18。
 *
 * 🔴 红基线（旧版本必失败）：旧 canNsfw(age16)=true / canNsfw(age17)=true（block① 红）。
 *
 * 跑：DB_PATH=/tmp/una.db node scripts/user_nsfw_age_gate_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/una.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/una_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { getUserAgeStatus, getDb } = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

const db = getDb();
let seq = 0;
function mkUser(age) {
  const n = ++seq;
  const info = db.prepare('INSERT INTO user_accounts (username, email, password_hash, age_at_registration) VALUES (?,?,?,?)')
    .run(`u${process.pid}_${n}`, `u${process.pid}_${n}@t.test`, 'x', age);
  return info.lastInsertRowid;
}

console.log('── ① 🔴 16-17 未成年 → canNsfw=false（与法定 18 对齐）──');
{
  for (const age of [16, 17]) {
    const s = getUserAgeStatus(mkUser(age));
    ok(s.canNsfw === false && s.isMinor === true, `age${age} → canNsfw=false·isMinor=true（实测 canNsfw=${s.canNsfw}）← 旧码 age>=16 → canNsfw=true=红`);
  }
}

console.log('── ② 成年 → canNsfw=true（不误伤）──');
{
  for (const age of [18, 22, 30]) {
    const s = getUserAgeStatus(mkUser(age));
    ok(s.canNsfw === true && s.isMinor === false, `age${age} → canNsfw=true·isMinor=false`);
  }
}

console.log('── ③ 未知/无龄 → canNsfw=true（同"没填生日按成年"·不强制 KYC）──');
{
  const noAge = getUserAgeStatus(mkUser(null));
  ok(noAge.canNsfw === true && noAge.isMinor === false && noAge.ageKnown === false, '无 age → canNsfw=true·isMinor=false·ageKnown=false');
  ok(getUserAgeStatus(null).canNsfw === true, 'accountId=null → canNsfw=true(默认成年·不崩)');
}

console.log('── ④ 边界 15 / 18 ──');
{
  ok(getUserAgeStatus(mkUser(15)).canNsfw === false, 'age15 → canNsfw=false');
  ok(getUserAgeStatus(mkUser(18)).canNsfw === true, 'age18(法定成年下限) → canNsfw=true');
}

console.log(`\n══ user nsfw age-gate smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
