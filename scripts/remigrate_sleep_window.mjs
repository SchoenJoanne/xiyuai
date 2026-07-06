#!/usr/bin/env node
/**
 * 🔴 存量迁移：旧「纯复制用户作息」的 learned bed/wake → 拉回身份基线 ±窗内。
 *   完整作息/日程系统 B 方向：超窗的极端值拉回窗内（去掉纯复制），窗内的保留（连贯）。
 *   只对现值钳窗，不从样本重算。user_set（用户手设）跳过。
 *
 * 🔴 改生产数据 —— 维护者亲手跑：
 *   1) 默认 DRY-RUN（只打印 will-change，不写库）：
 *        node scripts/remigrate_sleep_window.mjs
 *   2) 确认后 --apply（先写备份 JSON 再改库，可回滚）：
 *        node scripts/remigrate_sleep_window.mjs --apply
 *   回滚：用备份文件逐行 UPDATE companion_sleep_schedule SET bed_time/wake_time 还原。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import { listSleepRowsEnabled, getCompanionById } from '../src/db.mjs';
import { remigrateSleepWindow } from '../src/sleep.mjs';
import { routineSleepBaseline, resolveIdentity } from '../src/routine_profiles.mjs';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');
const rows = listSleepRowsEnabled();
const plan = [];

for (const row of rows) {
  if (row.user_set) continue;                    // 用户手设=配置她·跳过
  const companion = getCompanionById(row.companion_id) || { id: row.companion_id };
  const base = routineSleepBaseline(companion, 'active');
  // 预演：复用 remigrate 的钳窗逻辑算 after（不写库时只读基线手算）
  const preview = previewClamp(row, base);
  plan.push({
    companion_id: row.companion_id,
    identity: resolveIdentity(companion),
    learn_state: row.learn_state,
    before: { bed: row.bed_time, wake: row.wake_time },
    after: preview.after,
    baseline: { bed: minToHHMM(base.bedMin), wake: minToHHMM(base.wakeMin) },
    pulled: preview.pulled,
  });
}

const willChange = plan.filter(p => p.pulled);
console.log(`\n══ 存量作息迁移 ${APPLY ? '【APPLY 写库】' : '【DRY-RUN 只读】'} ══`);
console.log(`非 user_set 行: ${plan.length} · 需拉回(超窗): ${willChange.length} · 窗内保留: ${plan.length - willChange.length}\n`);
for (const p of willChange) {
  console.log(`  companion=${p.companion_id}[${p.identity}/${p.learn_state}] ${p.before.bed}/${p.before.wake} → ${p.after.bed}/${p.after.wake}  (基线 ${p.baseline.bed}/${p.baseline.wake})`);
}
if (!willChange.length) console.log('  （无超窗值，全部窗内保留）');

if (!APPLY) {
  console.log(`\nDRY-RUN 结束。确认无误后加 --apply 写库（会先存备份）。\n`);
  process.exit(0);
}

// 🔴 写备份再改库
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = `/tmp/sleep_window_backup_${stamp}.json`;
fs.writeFileSync(backupFile, JSON.stringify(plan.map(p => ({ companion_id: p.companion_id, before: p.before })), null, 2));
console.log(`\n✓ 备份已写: ${backupFile}（回滚用）`);

let applied = 0;
for (const p of willChange) {
  const r = remigrateSleepWindow(p.companion_id);
  if (r.migrated && r.pulled) applied++;
}
console.log(`✓ 已迁移 ${applied} 行（learn_state→tracking·今日 cache 已清·下次 tick 重算）。\n`);

// ── helpers（与 sleep.mjs 同口径，避免循环导出内部函数）──
function hhmmToMin(hhmm) { const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10) || 0); return h * 60 + m; }
function minToHHMM(min) { const m = ((min % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function bedStrToMin(hhmm) { const m = hhmmToMin(hhmm); return m < 4 * 60 ? m + 1440 : m; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function previewClamp(row, base) {
  const WIN = Math.max(30, Math.min(120, Number(process.env.ROUTINE_DRIFT_WINDOW_MIN || 90)));
  const curBed = bedStrToMin(row.bed_time || '00:30');
  const curWake = hhmmToMin(row.wake_time || '07:30');
  const newBed = clamp(curBed, base.bedMin - WIN, base.bedMin + WIN);
  const newWake = clamp(curWake, base.wakeMin - WIN, base.wakeMin + WIN);
  const after = { bed: minToHHMM(newBed), wake: minToHHMM(newWake) };
  return { after, pulled: after.bed !== row.bed_time || after.wake !== row.wake_time };
}
