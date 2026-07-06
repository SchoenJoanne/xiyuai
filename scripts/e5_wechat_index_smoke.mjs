/**
 * e5_wechat_index_smoke.mjs —— 批E·E5④：wechat_messages(from_user,direction,created_at) 索引
 *
 * E5 §4 性能崖：_countInboundSince（runtime:48）在带 open 冲突事件的每轮 arc time-tick 全表扫
 * wechat_messages（百万级大表·全表扫 p95 崖）。修=一条 CREATE INDEX。本 smoke 用 EXPLAIN QUERY PLAN
 * 亲眼验查询计划从 SCAN（全表扫）→ SEARCH USING INDEX（等值前缀 seek·崖消）。
 *
 * ① 索引存在（migrate 建）
 * ② _countInboundSince 原样 SQL 的计划 = SEARCH ... USING INDEX idx_wechat_messages_from_dir_time
 * ③ 计划不含 SCAN wechat_messages（全表扫已消）
 * 🔴 坏版本红验：DROP 该索引 → 同 SQL 计划回落 SCAN（②③ 变红）。
 */
process.env.DB_PATH = process.env.DB_PATH || '/tmp/e5_wechat_index_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb } = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const db = getDb();

// _countInboundSince(runtime:48-57) 的原样查询（COUNT + from_user=? AND direction='in' AND datetime(created_at)>datetime(?)）
const COUNT_SQL = `
  SELECT COUNT(*) AS n FROM wechat_messages
  WHERE from_user = ? AND direction = 'in' AND datetime(created_at) > datetime(?)
`;
const planOf = (sql, ...args) =>
  db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(r => r.detail).join(' | ');

// 灌几行合成消息（计划分析不依赖行数·但坐实表可用）
const T0 = '2026-06-20T00:00:00Z';
for (let i = 0; i < 20; i++) {
  db.prepare(`INSERT INTO wechat_messages (msg_id, from_user, to_user, msg_type, content, direction, created_at)
              VALUES (?, 'synth_u1', 'bot', 'text', 'x', ?, ?)`)
    .run(`m${i}`, i % 2 ? 'in' : 'out', new Date(Date.parse(T0) + i * 3600e3).toISOString());
}

console.log('── ① 索引存在 ──');
{
  const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_wechat_messages_from_dir_time'`).get();
  ok(!!idx, '① idx_wechat_messages_from_dir_time 已建');
}

console.log('── ②③ 查询计划 = SEARCH USING INDEX（无 SCAN）──');
{
  const plan = planOf(COUNT_SQL, 'synth_u1', T0);
  console.log('    plan:', plan);
  ok(/USING (COVERING )?INDEX idx_wechat_messages_from_dir_time/.test(plan), '② 命中 idx_wechat_messages_from_dir_time（等值前缀 seek·此处 COVERING=连表都不碰）');
  ok(!/SCAN wechat_messages/.test(plan), '③ 计划不含 SCAN wechat_messages（全表扫已消）');
}

console.log('── 🔴 坏版本红验：DROP 索引 → 回落 SCAN ──');
{
  db.exec('DROP INDEX IF EXISTS idx_wechat_messages_from_dir_time');
  const plan = planOf(COUNT_SQL, 'synth_u1', T0);
  console.log('    plan(no-index):', plan);
  ok(/SCAN wechat_messages/.test(plan), '🔴 无索引时确为 SCAN（红验咬住：证②③非 vacuous）');
  // 重建（不污染同库其他潜在用途）
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wechat_messages_from_dir_time ON wechat_messages(from_user, direction, created_at)`);
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} e5_wechat_index_smoke: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
