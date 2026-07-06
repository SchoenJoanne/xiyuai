#!/usr/bin/env node
/**
 * usage_interval_calibration_smoke.mjs —— 校准脚本的确定性验证（进 CI·可复跑）。
 *
 * 停板A #1 gap 改判：维护者 要求「校准回测脚本本身进 CI 留档·确定性·可复跑」。
 * 本 smoke 用**合成库**（零真实数据·DB_PATH=/tmp）喂已知间隔 fixture，跑校准脚本、断言输出，
 * 证明聚合/回测逻辑正确且确定性。绝不碰生产 bot.db。
 *
 * fixture 三伙伴（构造覆盖两关键判据）：
 *   A 密集连聊：每 5min 一条·共 2h30m（31 条）——所有 gap 下都是 1 个 ≥2h 会话（真「连着」）。
 *   B 稀疏聊天：每 25min 一条·共 2h30m（7 条）——gap=30 下算 1 个 ≥2h 会话但 <20 条（「连着」为假）；
 *                gap=15/10 下 25min>阈值 → 断开 → 0 个 ≥2h。
 *   C 中断：两簇各 10min·中间 40min 断——任何 gap 下都无 ≥2h。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN_MS = 60e3;
const CALIB_NOW = Date.parse('2026-06-25T00:00:00Z');   // 固定基准→确定性
const tmpDb = path.join(os.tmpdir(), `calib_smoke_${process.pid}.db`);

function sql(ms) { return new Date(ms).toISOString().slice(0, 19).replace('T', ' '); }

function build() {
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
  const db = new Database(tmpDb);
  db.exec(`CREATE TABLE wechat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, msg_id TEXT UNIQUE, from_user TEXT NOT NULL,
    to_user TEXT NOT NULL, msg_type TEXT NOT NULL, content TEXT, media_url TEXT,
    media_mime TEXT, direction TEXT DEFAULT 'in', created_at DATETIME);`);
  const ins = db.prepare(`INSERT INTO wechat_messages (msg_id, from_user, to_user, msg_type, content, direction, created_at) VALUES (?,?,?,?,?,?,?)`);
  let n = 0;
  const add = (partner, ms) => ins.run(`m${n++}`, partner, 'bot', 'text', 'x', 'in', sql(ms));
  // A: 每5min·2h30m → 31 条 (0..150min)
  const aStart = Date.parse('2026-06-20T10:00:00Z');
  for (let m = 0; m <= 150; m += 5) add('A', aStart + m * MIN_MS);
  // B: 每25min·2h30m → 7 条 (0,25,...,150)
  const bStart = Date.parse('2026-06-21T10:00:00Z');
  for (let m = 0; m <= 150; m += 25) add('B', bStart + m * MIN_MS);
  // C: 两簇 0,5,10 / 50,55,60 (40min 断)
  const cStart = Date.parse('2026-06-22T10:00:00Z');
  for (const m of [0, 5, 10, 50, 55, 60]) add('C', cStart + m * MIN_MS);
  // 加一条 out 方向 + 一条超窗(应被排除)
  ins.run('mout', 'A', 'bot', 'text', 'x', 'out', sql(aStart + 3 * MIN_MS));
  ins.run('mold', 'A', 'bot', 'text', 'x', 'in', sql(Date.parse('2026-01-01T00:00:00Z')));
  db.close();
}

function run() {
  const out = execFileSync('node', ['scripts/usage_interval_calibration.mjs', '--json'], {
    env: { ...process.env, DB_PATH: tmpDb, CALIB_NOW: String(CALIB_NOW) },
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`  ✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

try {
  build();
  const r = run();
  // 元信息：只数 in + 在窗内（out 与超窗那条应被排除）→ 31+7+6 = 44
  eq('total_inbound_in_window', r.meta.total_inbound_in_window, 44);
  eq('distinct_partners', r.meta.distinct_partners, 3);
  eq('total_gaps', r.meta.total_gaps, 30 + 6 + 5);   // A:30 B:6 C:5 = 41
  // 间隔分布：A 30×5min(5-10) + C 4×5min(5-10) = 34; B 6×25min(15-30); C 1×40min(30+)
  eq('bucket_0-5', r.interval_distribution_min['0-5'], 0);
  eq('bucket_5-10', r.interval_distribution_min['5-10'], 34);
  eq('bucket_15-30', r.interval_distribution_min['15-30'], 6);
  eq('bucket_30+', r.interval_distribution_min['30+'], 1);
  eq('p50', r.interval_percentiles_min.p50, 5);
  eq('p90', r.interval_percentiles_min.p90, 25);
  // gap 回测：核心两判据
  eq('gap10_long_sessions', r.gap_backtest.gap_10min.long_sessions_ge_2h, 1);   // 只 A
  eq('gap10_partners', r.gap_backtest.gap_10min.distinct_partners_with_long, 1);
  eq('gap10_pct_under20', r.gap_backtest.gap_10min.long_session_msgcount.pct_under_20msgs, 0);
  eq('gap15_long_sessions', r.gap_backtest.gap_15min.long_sessions_ge_2h, 1);   // 只 A（B 断）
  eq('gap30_long_sessions', r.gap_backtest.gap_30min.long_sessions_ge_2h, 2);   // A + B
  eq('gap30_partners', r.gap_backtest.gap_30min.distinct_partners_with_long, 2);
  eq('gap30_pct_under20', r.gap_backtest.gap_30min.long_session_msgcount.pct_under_20msgs, 50);  // B(7)稀疏,A(31)密→1/2
  eq('gap30_median_msg', r.gap_backtest.gap_30min.long_session_msgcount.median, 31);  // sorted[7,31] p50→idx1→31
} catch (e) {
  fail++; console.error('  ✗ smoke threw:', e.message);
} finally {
  if (fs.existsSync(tmpDb)) fs.unlinkSync(tmpDb);
}

console.log(`[usage_interval_calibration_smoke] ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
