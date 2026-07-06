/**
 * 存量"用户"清洗（v1.21.3 PR-B，配套 #272 写入端护栏——先堵口再清存量）。
 *
 * 范围（用户可见或会进 prompt 的"她的认知/她写的文本"）：
 *   companion_memories.content / companion_shaping.content /
 *   companion_preferences.target,reason / companion_open_loops.title,expected_followup /
 *   memory_entities.name / user_profiles.notes / companion_diary.content /
 *   companion_relational_diary.body（仅 user_edited=0）/ companion_time_capsules.her_reaction
 *
 * 明确不碰（写明理由）：
 *   - conversation_turns / wechat_messages：说过的话是史实，改写会让
 *     反复读注入、素材归因与历史对不上
 *   - companion_shaping.raw_msg / time_capsules.body：他的原话/他写的胶囊原文，
 *     用户创作不改
 *   - companion_relational_diary user_edited=1：用户亲手编辑过的内容不动
 *
 * 改写规则：该 companion 教过称呼（shaping nickname）用称呼，否则"他"；
 * 保护词（用户名/用户协议）不误伤——复用 privacy_filter.replaceUserWording。
 *
 * 用法：
 *   node scripts/scrub_user_wording.mjs --db <path>              # dry-run，产出 diff 文件（含前后文本）
 *   node scripts/scrub_user_wording.mjs --db <path> --counts-only # 🔴只读·仅计数（不吐任何 PIPL 内容）
 *   node scripts/scrub_user_wording.mjs --db <path> --apply      # 人工审过 diff 后执行
 *
 * 🔴 --counts-only（PIPL 亲验用·交维护者对生产库跑）：强制只读、绝不写 /tmp diff、
 *    只打印每表「扫描行数 / 含"用户"行数 / 会被改写行数」三个数字。因生产 bot.db 内容
 *    是 PIPL 敏感数据，"亲验抓化名"只需看得到"scrub 有没有咬住残留 + 化名替换率"，
 *    不需要、也绝不导出任何真实记忆文本。dry-run 的 diff 文件模式仅供本地脱敏库用。
 *
 * apply 安全性：逐条 UPDATE 带 WHERE 原文匹配（dry-run 到 apply 之间数据变了
 * 就跳过该条并告警），绝不盲写。
 */
import { writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { replaceUserWording } from '../src/privacy_filter.mjs';

const argv = process.argv.slice(2);
const dbIdx = argv.indexOf('--db');
const DB = dbIdx > -1 ? argv[dbIdx + 1] : null;
const COUNTS_ONLY = argv.includes('--counts-only');
const APPLY = argv.includes('--apply') && !COUNTS_ONLY;   // 🔴 --counts-only 永不写库
if (COUNTS_ONLY && argv.includes('--apply')) {
  console.error('🔴 --counts-only 与 --apply 互斥（元数据审计只读，绝不写库）'); process.exit(1);
}
if (!DB) { console.error('必须显式指定 --db <path>（拒绝默认库，防误跑）'); process.exit(1); }

const db = new Database(DB, { readonly: !APPLY });

// 每 companion 的称呼（教过的 nickname，无则"他"）
const aliasCache = new Map();
function aliasOf(companionId) {
  if (!aliasCache.has(companionId)) {
    let a = '他';
    try {
      const row = db.prepare(`SELECT content FROM companion_shaping WHERE companion_id = ? AND kind = 'nickname' ORDER BY created_at DESC, id DESC LIMIT 1`).get(companionId);
      if (row?.content && !String(row.content).includes('用户')) a = String(row.content);
    } catch {}
    aliasCache.set(companionId, a);
  }
  return aliasCache.get(companionId);
}

// 清洗目标：表 / 主键 / companion 列 / 文本列 / 额外 WHERE
const TARGETS = [
  { table: 'companion_memories',          cols: ['content'],                    cid: 'companion_id' },
  { table: 'companion_shaping',           cols: ['content'],                    cid: 'companion_id' },
  { table: 'companion_preferences',       cols: ['target', 'reason'],           cid: 'companion_id' },
  { table: 'companion_open_loops',        cols: ['title', 'expected_followup'], cid: 'companion_id' },
  { table: 'memory_entities',             cols: ['name'],                       cid: 'companion_id' },
  { table: 'user_profiles',               cols: ['notes'],                      cid: 'companion_id' },
  { table: 'companion_diary',             cols: ['content'],                    cid: 'companion_id' },
  { table: 'companion_relational_diary',  cols: ['body'],                       cid: 'companion_id', extraWhere: 'user_edited = 0' },
  { table: 'companion_time_capsules',     cols: ['her_reaction'],               cid: 'companion_id' },
];

function hasTable(name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

const changes = [];   // { table, id, col, companionId, before, after }
const meta = {};      // table → { scanned, withUser, wouldChange }（纯计数·无内容）
const bump = (tbl, k) => { (meta[tbl] ||= { scanned: 0, withUser: 0, wouldChange: 0 })[k]++; };
for (const t of TARGETS) {
  if (!hasTable(t.table)) continue;
  const where = t.extraWhere ? `WHERE ${t.extraWhere}` : '';
  const rows = db.prepare(`SELECT id, ${t.cid} AS cid, ${t.cols.join(', ')} FROM ${t.table} ${where}`).all();
  for (const r of rows) {
    for (const col of t.cols) {
      const before = r[col];
      if (typeof before !== 'string') continue;
      bump(t.table, 'scanned');
      if (!before.includes('用户')) continue;
      bump(t.table, 'withUser');
      const after = replaceUserWording(before, aliasOf(r.cid));
      if (after !== before) {
        bump(t.table, 'wouldChange');
        if (!COUNTS_ONLY) changes.push({ table: t.table, id: r.id, col, companionId: r.cid, before, after });
      }
    }
  }
}

// ── 元数据审计（🔴只读·只计数·不吐任何 PIPL 内容）───────────────────────────
if (COUNTS_ONLY) {
  console.log(`# 存量"用户"清洗 · 元数据审计（只读·不含任何 PIPL 内容）`);
  console.log(`# 库：${DB} · ${new Date().toISOString()}`);
  const tot = { scanned: 0, withUser: 0, wouldChange: 0 };
  for (const [tbl, m] of Object.entries(meta)) {
    tot.scanned += m.scanned; tot.withUser += m.withUser; tot.wouldChange += m.wouldChange;
    console.log(`  ${tbl.padEnd(30)} 扫描 ${m.scanned} · 含"用户" ${m.withUser} · 会改写 ${m.wouldChange}`);
  }
  console.log(`  ${'合计'.padEnd(28)} 扫描 ${tot.scanned} · 含"用户" ${tot.withUser} · 会改写 ${tot.wouldChange}`);
  const protectedOnly = tot.withUser - tot.wouldChange;
  console.log(`\n判读：含"用户" ${tot.withUser} 处 → scrub 会改写 ${tot.wouldChange} 处为化名/他，剩 ${protectedOnly} 处属保护词（用户协议/用户名）不动。`);
  console.log(`      ${tot.wouldChange === 0
    ? '✅ 零残留需改写（写入端护栏在挡新增·存量干净=亲验通过）'
    : '⚠ 有存量残留 → 维护者本机脱敏库审 diff 后 --apply，或在生产亲手清理（绝不导出内容）'}`);
  db.close();
  process.exit(0);
}

// ── 输出 diff ──────────────────────────────────────────────────────────────
const byTable = {};
for (const c of changes) byTable[c.table] = (byTable[c.table] || 0) + 1;
const lines = [
  `# 存量"用户"清洗 ${APPLY ? 'APPLY 报告' : 'DRY-RUN diff（人工审后再 --apply）'}`,
  `# 库：${DB} · ${new Date().toISOString()}`,
  `# 总计 ${changes.length} 处${Object.entries(byTable).map(([t, n]) => `\n#   ${t}: ${n}`).join('')}`,
  '',
];
for (const c of changes) {
  lines.push(`${c.table} id=${c.id} col=${c.col} companion=${c.companionId}`);
  lines.push(`- ${c.before}`);
  lines.push(`+ ${c.after}`);
  lines.push('');
}
const outFile = `/tmp/scrub_user_wording_${APPLY ? 'apply' : 'dryrun'}_${new Date().toISOString().slice(0, 10)}.diff`;
writeFileSync(outFile, lines.join('\n'));
console.log(`共 ${changes.length} 处需清洗：`);
for (const [t, n] of Object.entries(byTable)) console.log(`  ${t}: ${n}`);
console.log(`diff 已写入：${outFile}`);

// ── apply ──────────────────────────────────────────────────────────────────
if (APPLY) {
  let applied = 0, skipped = 0;
  const tx = db.transaction(() => {
    for (const c of changes) {
      // 原文匹配保护：dry-run 后数据变了就跳过
      const r = db.prepare(`UPDATE ${c.table} SET ${c.col} = ? WHERE id = ? AND ${c.col} = ?`)
        .run(c.after, c.id, c.before);
      if (r.changes === 1) applied++;
      else { skipped++; console.log(`  ⚠ 跳过（数据已变）：${c.table} id=${c.id}`); }
    }
  });
  tx();
  console.log(`APPLY 完成：${applied} 条更新，${skipped} 条跳过`);
} else if (changes.length) {
  console.log('\n（dry-run 未写库。人工审完 diff 后加 --apply 执行）');
}
db.close();
