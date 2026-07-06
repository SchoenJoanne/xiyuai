/**
 * d2_digest_longtail_smoke.mjs —— digest 长尾入口（批D·件⑥·D2-3·确定性零 LLM）
 *
 * 修 ">3 月零入口"：buildLongTermDigest 月窗(3 月)+周(4 周)+日(7 天)之外，追加「更早的重要片段」段：
 *   imp≥8 或 locked、created_at 早于 90 天、一句化、上限 3 条。
 *   ① 老(>90天)高 imp / locked → 入长尾段（一句化）
 *   ② 近期(<90天)高 imp、老低 imp(非 locked)、日/周 summary → 不入长尾（避重复/够不上"值得记住"）
 *   ③ 复用件① 硬过滤：archived / do_not_mention 老高 imp → 不入（不泄漏脏记忆）
 *   ④ 上限 3 条
 *   ⑤ 冷却闸门：proactive 传 excludeUsedIds → 剔除近期已用（reply 不传=全保留·延续注入挂闸门铁律）
 *
 * 🔴 坏版本红验：plan_tasks 去长尾段 append → ① 变红（老重要片段无入口）。
 */
process.env.DB_PATH = '/tmp/d2_digest_longtail_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const M = await import('../src/db.mjs');
const { buildLongTermDigest } = await import('../src/plan_tasks.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

const gdb = M.getDb();
gdb.pragma('foreign_keys = OFF');
gdb.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (1,1,'b','测')").run();
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
const ins = gdb.prepare(`INSERT INTO companion_memories
  (companion_id, user_id, memory_type, content, importance, locked, memory_status, do_not_mention, created_at)
  VALUES (1,1,?,?,?,?,?,?,?)`);
//        type,        content,                    imp, lock, status,       dnm, createdAgo
ins.run('event', '我们第一次旅行去了海边看日出。那天说了好多好多话我到现在都还记得清清楚楚呢。', 9, 0, 'active', 0, iso(100));   // ① 老高imp→长尾(早句号验一句化)
ins.run('fact',  '他妈妈的忌日是清明前后，那几天他会很沉默。',   5, 1, 'active', 0, iso(120));   // ① 老locked→长尾
ins.run('event', '某天随口说的一句无关紧要的话',               5, 0, 'active', 0, iso(100));   // ② 老低imp非locked→不入
ins.run('event', '昨天刚发生的大事很重要',                     9, 0, 'active', 0, iso(10));    // ② 近期→不入(<90)
ins.run('event', '归档的老重要事',                            10, 0, 'archived', 0, iso(100));  // ③ archived→不入
ins.run('event', '勿提的老重要隐私',                          10, 0, 'active', 1, iso(100));   // ③ dnm→不入
ins.run('daily_summary', '2026-01-01 老日记很重要', 9, 0, 'active', 0, iso(100));            // ② 日summary排除

console.log('── ① 老(>90天)重要片段入长尾段 + 一句化 ──');
{
  const digest = await buildLongTermDigest(1, 1);
  ok(digest.includes('【更早的重要片段'), '① 长尾段头在场');
  const seg1 = digest.split('【更早的重要片段')[1] || '';
  ok(seg1.includes('我们第一次旅行去了海边看日出'), '① 老高imp(imp9·100天)入长尾');
  ok(seg1.includes('他妈妈的忌日是清明前后'), '① 老locked(120天)入长尾');
  ok(!seg1.includes('那天说了好多'), '① 一句化=截首句(首句后被切)');
}

console.log('── ②③ 排除：近期/老低imp/日summary/archived/dnm（查长尾段内） ──');
{
  const seg = (await buildLongTermDigest(1, 1)).split('【更早的重要片段')[1] || '';
  ok(!seg.includes('无关紧要'), '② 老低imp(5·非locked) 不入长尾');
  ok(!seg.includes('昨天刚发生'), '② 近期(<90天) 不入长尾（月/周/日窗覆盖）');
  ok(!seg.includes('归档的老重要'), '🔴③ archived 老重要 不入（件① 硬过滤）');
  ok(!seg.includes('勿提的老重要'), '🔴③ do_not_mention 老重要 不入');
  ok(!seg.includes('老日记很重要'), '② daily_summary 不入长尾段（走「每日小结」块·不重复）');
}

console.log('── ④ 上限 3 条 ──');
{
  for (let i = 0; i < 5; i++) ins.run('event', `更早重要事件第${i}号内容占位`, 9, 0, 'active', 0, iso(200 + i));
  const digest = await buildLongTermDigest(1, 1);
  const seg = digest.split('【更早的重要片段')[1] || '';
  const lines = seg.split('\n').filter(l => l.trim().startsWith('- '));
  ok(lines.length === 3, `④ 长尾段最多 3 条（实得 ${lines.length}）`);
}

console.log('── ⑤ 冷却闸门：excludeUsedIds 剔除近期已用 ──');
{
  const rows = M.getLongTailImportantMemories(1, 1, { olderThanDays: 90, minImportance: 8, limit: 3 });
  const usedId = rows[0].id;
  const digest = await buildLongTermDigest(1, 1, { excludeUsedIds: new Set([`mem:${usedId}`]) });
  const seg = digest.split('【更早的重要片段')[1] || '';
  ok(!seg.includes(rows[0].content.slice(0, 8)), '⑤ proactive 传 excludeUsedIds → 已用长尾片段被剔除');
  const digestReply = await buildLongTermDigest(1, 1);   // reply 不传 → 全保留
  ok((digestReply.split('【更早的重要片段')[1] || '').length > 0, '⑤ reply 不传 excludeUsedIds → 长尾全保留（召回不失忆）');
}

for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
console.log(`\n══ d2_digest_longtail smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
