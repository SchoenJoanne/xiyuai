/**
 * d2_open_loops_lifecycle_smoke.mjs —— open_loops 生命周期状态机·考试案四环（批D·件⑤·确定性零 LLM）
 *
 * 状态图：open →(答中/兑现)resolved →(due 后 N 天分层)expired →(注入计数上限)expired。
 *   ① schema：'expired' 新独立状态（决议⑧）· 老 CHECK 无 expired 的表自动重建 + 数据保全（自旋子进程验）
 *   ② markStaleOpenLoops 分层→expired（时效类 kind 2 天 / 现役 kind 7 天 / 无 due 14 天）
 *   ③ markOpenLoopFollowedUp 计数满 FOLLOWUP_CAP(3) → 强制 expired（注入上限·决议⑦）
 *   ④ listDueOpenLoops：过 N 天不再被 recall 路捞起（考试案·下界+精滤）
 *   ⑤ dueStatus past 封顶：过 N 天 → phase='expired'（不再"越过期越催"）
 *   ⑥ buildOpenLoopsHint：expired-phase loop 不注入
 *   ⑦ 三处同源：dueStatus/markStale/listDue 天数皆读 open_loops_lifecycle 叶子常量
 *
 * 🔴 坏版本红验：markStale 回 'stale'+统一 7 天 / 去 dueStatus 封顶 / 去 CAP → 对应环红。
 */
process.env.DB_PATH = '/tmp/d2_open_loops_lifecycle_smoke.db';
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── 子进程分支（迁移验）：全新 import db.mjs → getDb 跑 migrateOpenLoops → 老表重建·打印结果 ──
if (process.argv.includes('--migrate-child')) {
  const M = await import('../src/db.mjs');
  const gdb = M.getDb();
  const sql = gdb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='companion_open_loops'").get().sql;
  const n = gdb.prepare("SELECT COUNT(*) n FROM companion_open_loops WHERE title='老数据保全测试'").get().n;
  let writable = false;
  try { gdb.prepare("UPDATE companion_open_loops SET status='expired' WHERE title='老数据保全测试'").run(); writable = true; } catch {}
  process.stdout.write(JSON.stringify({ hasExpired: sql.includes("'expired'"), hasFc: sql.includes('follow_up_count'), preserved: n, writable }));
  process.exit(0);
}

for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

// db.mjs 建全量 schema（companions 全字段 + 新 open_loops 含 'expired'）
const M = await import('../src/db.mjs');
const gdb = M.getDb();
gdb.pragma('foreign_keys = OFF');
const dateAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const ins = gdb.prepare(`INSERT INTO companion_open_loops
  (companion_id, title, due_at, emotional_weight, status, loop_kind, follow_up_count, created_at)
  VALUES (1,?,?,50,'open',?,?,?)`);
const insLoop = ({ title, dueAgo = null, kind = 'user_said', fc = 0, createdAgo = 0 }) =>
  ins.run(title, dueAgo == null ? null : dateAgo(dueAgo), kind, fc, new Date(Date.now() - createdAgo * 86400000).toISOString()).lastInsertRowid;
const stOf = (id) => gdb.prepare('SELECT status FROM companion_open_loops WHERE id=?').get(id).status;

console.log('── ⓪ 新装 schema：CHECK 含 expired + follow_up_count 列 ──');
{
  const sql = gdb.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='companion_open_loops'").get().sql;
  ok(sql.includes("'expired'"), 'ⓞ 新装 CHECK 含 expired');
  ok(sql.includes('follow_up_count'), 'ⓞ 新装含 follow_up_count 列');
}

console.log('── ② markStaleOpenLoops 分层 → expired ──');
{
  const a = insLoop({ title: '现役kind过期8天', dueAgo: 8, kind: 'user_said' });
  const b = insLoop({ title: '现役kind过期3天', dueAgo: 3, kind: 'user_said' });
  const c = insLoop({ title: '时效kind过期3天', dueAgo: 3, kind: 'exam' });
  const e = insLoop({ title: '无due创建16天', dueAgo: null, kind: 'user_said', createdAgo: 16 });
  const f = insLoop({ title: '无due创建5天', dueAgo: null, kind: 'user_said', createdAgo: 5 });
  M.markStaleOpenLoops(1);
  ok(stOf(a) === 'expired', '② 现役kind 过期 8 天(>7) → expired');
  ok(stOf(b) === 'open', '② 现役kind 过期 3 天(<7) → 仍 open');
  ok(stOf(c) === 'expired', '② 时效类kind(exam) 过期 3 天(>2) → expired（分层生效·非统一7天）');
  ok(stOf(e) === 'expired', '② 无 due 创建 16 天(>14) → expired');
  ok(stOf(f) === 'open', '② 无 due 创建 5 天(<14) → 仍 open');
}

console.log('── ③ markOpenLoopFollowedUp 计数满 CAP(3) → expired ──');
{
  const id = insLoop({ title: '注入上限测试', dueAgo: 0, kind: 'user_said' });
  M.markOpenLoopFollowedUp(id);
  ok(stOf(id) === 'open', '③ 第1次 follow-up → 仍 open');
  M.markOpenLoopFollowedUp(id);
  ok(stOf(id) === 'open', '③ 第2次 → 仍 open');
  M.markOpenLoopFollowedUp(id);
  const r = gdb.prepare('SELECT status, follow_up_count FROM companion_open_loops WHERE id=?').get(id);
  ok(r.status === 'expired' && r.follow_up_count === 3, '🔴③ 第3次(=CAP) → expired·count=3（注入上限硬止损）');
}

console.log('── ④ listDueOpenLoops：过 N 天不再被 recall 路捞起 ──');
{
  gdb.prepare("UPDATE companion_open_loops SET status='resolved' WHERE status='open'").run();
  const near = insLoop({ title: 'recall可捞·过期3天现役', dueAgo: 3, kind: 'user_said' });
  const far  = insLoop({ title: 'recall不捞·过期10天现役', dueAgo: 10, kind: 'user_said' });
  const timelyFar = insLoop({ title: 'recall不捞·时效过期3天', dueAgo: 3, kind: 'exam' });
  const due = M.listDueOpenLoops(1, { withinHours: 24 }).map(l => l.id);
  ok(due.includes(near), '④ 过期 3 天现役(<7) 仍被 recall 捞起');
  ok(!due.includes(far), '🔴④ 过期 10 天现役(>7) 不被捞起（考试案·下界精滤）');
  ok(!due.includes(timelyFar), '🔴④ 时效类过期 3 天(>2) 不被捞起');
}

console.log('── ⑤⑥ dueStatus 封顶 + buildOpenLoopsHint 不注入 expired ──');
{
  const OL = await import('../src/open_loops.mjs');
  const today = M.shanghaiDateKey(new Date());
  ok(OL.dueStatus(dateAgo(3), today, 'user_said')?.phase === 'past', '⑤ 现役过期3天(<7) → past（仍关心）');
  ok(OL.dueStatus(dateAgo(10), today, 'user_said')?.phase === 'expired', '🔴⑤ 现役过期10天(>7) → expired（封顶·不越催）');
  ok(OL.dueStatus(dateAgo(3), today, 'exam')?.phase === 'expired', '⑤ 时效过期3天(>2) → expired（分层封顶）');
  ok(OL.dueStatus(dateAgo(1), today, 'user_said')?.phase === 'past', '⑤ 过期1天 → past（该问后来）');
  gdb.prepare("UPDATE companion_open_loops SET status='resolved' WHERE status='open'").run();
  insLoop({ title: '新鲜约定明天见', dueAgo: -1, kind: 'appointment' });
  insLoop({ title: '陈年旧账过期20天', dueAgo: 20, kind: 'user_said' });
  const hint = OL.buildOpenLoopsHint(1);
  ok(hint.includes('新鲜约定明天见'), '⑥ 新鲜 loop 注入 hint');
  ok(!hint.includes('陈年旧账'), '🔴⑥ 过期20天 loop 不注入 hint（读侧封顶·翻旧账止）');
}

console.log('── ⑦ 三处同源（叶子常量真被引用） ──');
{
  const life = await import('../src/open_loops_lifecycle.mjs');
  ok(life.EXPIRE_DAYS.standard === 7 && life.EXPIRE_DAYS.timely === 2 && life.EXPIRE_DAYS.noDue === 14, '⑦ 叶子 EXPIRE_DAYS 权威值(2/7/14)');
  ok(life.FOLLOWUP_CAP === 3, '⑦ 叶子 FOLLOWUP_CAP=3');
  ok(life.expireDaysForKind('exam') === 2 && life.expireDaysForKind('user_said') === 7, '⑦ expireDaysForKind 分层正确');
}

console.log('── ① 老 schema(CHECK 无 expired)自动重建迁移 + 数据保全（自旋子进程） ──');
{
  // 父进程把 open_loops 换成 legacy 老表（companions 已由 db.mjs 全量迁移·子进程不再触发 ALTER 错）
  gdb.exec(`
    DROP TABLE companion_open_loops;
    CREATE TABLE companion_open_loops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      companion_id INTEGER NOT NULL,
      title TEXT NOT NULL, due_at TEXT, emotional_weight INTEGER DEFAULT 5, expected_followup TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','stale','dismissed')),
      source_message_id TEXT, resolved_at TEXT, resolved_text TEXT, followed_up_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loop_kind TEXT DEFAULT 'user_said', promise_payload TEXT
    );
    INSERT INTO companion_open_loops (companion_id, title, status, loop_kind) VALUES (1,'老数据保全测试','open','user_said');
  `);
  gdb.close();
  const r = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--migrate-child'], {
    env: { ...process.env, DB_PATH: process.env.DB_PATH }, encoding: 'utf8',
  }));
  ok(r.hasExpired, '① 老表自动重建·CHECK 含 expired（决议⑧）');
  ok(r.hasFc, '① 重建含 follow_up_count 列');
  ok(r.preserved === 1, '① 迁移数据保全（老行还在）');
  ok(r.writable, "① status='expired' 可写（CHECK 放行）");
}

for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
console.log(`\n══ d2_open_loops_lifecycle smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
