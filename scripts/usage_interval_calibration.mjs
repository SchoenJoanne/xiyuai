#!/usr/bin/env node
/**
 * usage_interval_calibration.mjs —— 防沉迷「连续使用」gap 阈值校准（只读·聚合·零 PII）。
 *
 * 停板A #1 gap 阈值改判后置补课（维护者 2026-07-02）：30min 默认出局，候选带 10/15min，
 * 最终默认由本脚本产出的真实数据决定。核心两问：
 *   ① 若 gap=10min 下几乎切不出 ≥2h 会话 → 阈值过严、功能失效。
 *   ② 若 gap=30min 下「会话」内消息稀疏（如 <20 条/2h）→「连着聊」为假话（她不说假话）。
 *
 * ── 严格纪律（对齐 CLAUDE.md 数据最小化 + PIPL 红线）──
 *  · 只读 wechat_messages（direction='in'·近 60 天）的 **from_user + created_at 两列**，
 *    绝不读 content / media / 任何正文。
 *  · 输出**只有计数/分布/分位数**，绝不输出原始 from_user（openid=PII）或任何可定位到人的标识；
 *    伙伴维度只报「有多少个伙伴命中」，不报是谁。
 *  · 纯聚合、不写库、不改任何数据。
 *  · 🔴 生产 bot.db 由**运营者亲手**跑本脚本（`绝不 Claude 查生产 bot.db`）；
 *    Claude 侧只对合成库 smoke 验证脚本正确性。
 *
 * 用法：
 *   DB_PATH=./data/bot.db node scripts/usage_interval_calibration.mjs        # 运营者在生产跑
 *   DB_PATH=/tmp/xxx.db CALIB_NOW=1782000000000 node scripts/...             # 确定性复跑(smoke/CI)
 *   加 --json 只输出机器可读 JSON。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'data/bot.db');
const NOW = process.env.CALIB_NOW ? Number(process.env.CALIB_NOW) : Date.now();
const WINDOW_DAYS = 60;
const HOUR_MS = 3600e3;
const MIN_MS = 60e3;
const GAP_CANDIDATES_MIN = [10, 15, 30];   // 回测的候选 gap
const SESSION_MIN_DURATION_MS = 2 * HOUR_MS;  // 「≥2h 会话」阈值
const JSON_ONLY = process.argv.includes('--json');

/** UTC 'YYYY-MM-DD HH:MM:SS' → epoch ms（wechat_messages.created_at 是 UTC 文本）。 */
function parseUtc(s) {
  if (!s) return NaN;
  const t = String(s).replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z');
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx];
}

function main() {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  const windowStartMs = NOW - WINDOW_DAYS * 24 * HOUR_MS;
  // 只取两列·direction=in·近 60 天。startSql 为 UTC 'YYYY-MM-DD HH:MM:SS'。
  const startSql = new Date(windowStartMs).toISOString().slice(0, 19).replace('T', ' ');
  const rows = db.prepare(
    `SELECT from_user, created_at FROM wechat_messages
     WHERE direction = 'in' AND created_at >= ?
     ORDER BY from_user ASC, created_at ASC`,
  ).all(startSql);
  db.close();

  // 按伙伴分组入站时刻（ms）。
  const byPartner = new Map();
  for (const r of rows) {
    const ms = parseUtc(r.created_at);
    if (!Number.isFinite(ms)) continue;
    if (!byPartner.has(r.from_user)) byPartner.set(r.from_user, []);
    byPartner.get(r.from_user).push(ms);
  }

  // ── 间隔分布（所有伙伴的相邻入站间隔）──
  const buckets = { '0-5': 0, '5-10': 0, '10-15': 0, '15-30': 0, '30+': 0 };
  const allGapsMin = [];
  for (const times of byPartner.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gapMin = (times[i] - times[i - 1]) / MIN_MS;
      allGapsMin.push(gapMin);
      if (gapMin < 5) buckets['0-5']++;
      else if (gapMin < 10) buckets['5-10']++;
      else if (gapMin < 15) buckets['10-15']++;
      else if (gapMin < 30) buckets['15-30']++;
      else buckets['30+']++;
    }
  }
  allGapsMin.sort((a, b) => a - b);
  const pctl = { p50: percentile(allGapsMin, 50), p75: percentile(allGapsMin, 75), p90: percentile(allGapsMin, 90) };

  // ── gap 回测：按各候选 gap 切会话，统计 ≥2h 会话 ──
  const backtest = {};
  for (const gMin of GAP_CANDIDATES_MIN) {
    const gapMs = gMin * MIN_MS;
    let longSessions = 0;              // ≥2h 会话数
    const partnersWithLong = new Set();
    const longMsgCounts = [];          // 每个 ≥2h 会话的消息条数（判「连着」密度）
    for (const [partner, times] of byPartner.entries()) {
      let sesStart = times[0], sesCount = 1;
      for (let i = 1; i <= times.length; i++) {
        const broke = i === times.length || (times[i] - times[i - 1]) >= gapMs;
        if (broke) {
          const dur = times[i - 1] - sesStart;
          if (dur >= SESSION_MIN_DURATION_MS) {
            longSessions++;
            partnersWithLong.add(partner);
            longMsgCounts.push(sesCount);
          }
          if (i < times.length) { sesStart = times[i]; sesCount = 1; }
        } else {
          sesCount++;
        }
      }
    }
    longMsgCounts.sort((a, b) => a - b);
    backtest[`gap_${gMin}min`] = {
      long_sessions_ge_2h: longSessions,
      distinct_partners_with_long: partnersWithLong.size,
      long_session_msgcount: {
        min: longMsgCounts[0] ?? null,
        median: percentile(longMsgCounts, 50),
        max: longMsgCounts[longMsgCounts.length - 1] ?? null,
        // 「连着」真实性：≥2h 会话里消息 <20 条的比例（越高→30min 越可能把稀疏聊天误称"连着"）
        pct_under_20msgs: longMsgCounts.length
          ? Math.round((longMsgCounts.filter((c) => c < 20).length / longMsgCounts.length) * 100)
          : null,
      },
    };
  }

  const report = {
    meta: {
      db: DB_PATH,
      now_iso: new Date(NOW).toISOString(),
      window_days: WINDOW_DAYS,
      total_inbound_in_window: rows.length,
      distinct_partners: byPartner.size,
      total_gaps: allGapsMin.length,
    },
    interval_distribution_min: buckets,
    interval_percentiles_min: pctl,
    gap_backtest: backtest,
    note: '零内容·零 PII·仅计数/分布。判据：某 gap 下 long_sessions_ge_2h≈0=阈值过严;pct_under_20msgs 高=该 gap 下"连着"多为假。',
  };

  if (JSON_ONLY) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return report; }

  // 人类可读
  const L = [];
  L.push('══════ 防沉迷 gap 阈值校准（只读·零 PII）══════');
  L.push(`DB=${DB_PATH}  窗口=近${WINDOW_DAYS}天  基准now=${report.meta.now_iso}`);
  L.push(`入站消息总数=${report.meta.total_inbound_in_window}  伙伴数=${report.meta.distinct_partners}  相邻间隔样本=${report.meta.total_gaps}`);
  L.push('');
  L.push('── 入站相邻间隔分布 ──');
  for (const [k, v] of Object.entries(buckets)) {
    const pct = report.meta.total_gaps ? Math.round((v / report.meta.total_gaps) * 100) : 0;
    L.push(`  ${k.padEnd(6)}min : ${String(v).padStart(7)}  (${pct}%)`);
  }
  L.push(`  P50=${pctl.p50?.toFixed(1)}min  P75=${pctl.p75?.toFixed(1)}min  P90=${pctl.p90?.toFixed(1)}min`);
  L.push('');
  L.push('── gap 回测（各阈值切出的 ≥2h「连续会话」）──');
  for (const gMin of GAP_CANDIDATES_MIN) {
    const b = backtest[`gap_${gMin}min`];
    L.push(`  gap=${gMin}min: ≥2h会话=${b.long_sessions_ge_2h}  命中伙伴=${b.distinct_partners_with_long}  ` +
      `会话消息数[min/中位/max]=[${b.long_session_msgcount.min}/${b.long_session_msgcount.median}/${b.long_session_msgcount.max}]  ` +
      `<20条占比=${b.long_session_msgcount.pct_under_20msgs}%`);
  }
  L.push('');
  L.push('判据：①某 gap 下 ≥2h会话≈0 → 阈值过严、功能失效。 ②<20条占比高 → 该 gap 下"连着聊"多为假话（阈值须更严）。');
  L.push('数据放桌上·gap 默认值 维护者 拍。');
  process.stdout.write(L.join('\n') + '\n');
  return report;
}

main();
