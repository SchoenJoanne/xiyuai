/**
 * d2_recall_decay_smoke.mjs —— recallMemories decay 打分接线（批D·件③b·确定性零 LLM）
 *
 * 验 D2-1「打分接线」（design_D2 红验规格 ①②④⑤⑥）：recallMemories 候选池改用 decay 打分重排，
 * 修设计缺陷#1「打分无时间项→远期琐碎压近期状态」。真 DB·真 recallMemories（非只测公式）。
 *   ① 近期语境约定登顶（排在所有远期琐事之前·ctx boost 生效）
 *   ② 大事(imp9·95 天)存活 top-7（decay 免疫 major）
 *   ④ 远期 auto-pin 琐事(imp7·90/120 天·抹茶/骑行)【不】在 top-7（读侧褪色掉出=件③a+③b 合力）
 *   ⑤ 两语境列表分化（换 ctx → 命中项排名上升）
 *   🔴⑥ 坏版本红验（自旋子进程·env MEM_SCORE_W_DECAY=0=去 decay 项）：抹茶/骑行【回】top-7
 *      （证 decay 项是把远期琐事压下去的承重项·env 化灰度旋钮真可调）。
 *
 * 🔴 真活路：db.mjs recallMemories 去 scoreMemoryForRecall 重排（回退 imp DESC 切顶）→ ④ 变红（抹茶回前 7）。
 */
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const IS_CHILD = process.argv.includes('--nodecay-child');
const DB_PATH = IS_CHILD ? '/tmp/d2_recall_decay_child.db' : '/tmp/d2_recall_decay_smoke.db';
process.env.DB_PATH = DB_PATH;
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(DB_PATH + suf); } catch {} }

const { getDb, recallMemories } = await import('../src/db.mjs');

// 合成记忆集：[type, content, imp, pinned, weight, daysAgo]（全 active·do_not_mention=0）
const NOW = Date.now();
const MEMS = [
  ['event', '周五要考试记得提醒我复习', 6, 0, 3, 3],      // 近期语境约定（ctx=考试）
  ['event', '随口说过想喝抹茶', 7, 1, 3, 90],             // 远期 auto-pin 琐事①（设计⑥ 抹茶）
  ['event', '提过想学骑行', 7, 1, 3, 120],               // 远期 auto-pin 琐事②（设计⑥ 骑行）
  ['event', '我们在一起的纪念日', 9, 0, 5, 95],           // 大事 major（imp9·95 天·decay 免疫）
  ['event', '昨天一起看了电影', 5, 0, 3, 1],             // 近期（ctx=电影 用）
  ['event', '今早互道了早安', 4, 0, 3, 1],
  ['event', '上周去了公园散步', 5, 0, 3, 5],
  ['fact',  '他喜欢喝手冲咖啡', 6, 0, 4, 10],            // weight4→慢褪
  ['event', '周末一起做了饭', 5, 0, 3, 2],
  ['event', '他说过想去旅行', 6, 0, 3, 7],
];

function seed(db) {
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (1,1,'b','测')").run();
  const ins = db.prepare(`INSERT INTO companion_memories
    (companion_id, user_id, memory_type, content, importance, pinned, memory_weight, memory_status, do_not_mention, created_at)
    VALUES (1,1,?,?,?,?,?,'active',0,?)`);
  for (const [t, c, imp, pin, w, d] of MEMS) {
    ins.run(t, c, imp, pin, w, new Date(NOW - d * 86400000).toISOString());
  }
}

const db = getDb();
seed(db);
const rankOf = (out, needle) => out.findIndex(c => c.includes(needle));   // -1=不在列表

// ── 子进程分支（decay=0 坏版本）：seed→query→打印 top-7 内容·退出 ────────────────────
if (IS_CHILD) {
  const out = recallMemories(1, 1, '考试', 7).map(m => m.content);
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ── 父进程：正常 env（decay 生效）断言 ───────────────────────────────────────────────
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

const outExam = recallMemories(1, 1, '考试', 7).map(m => m.content);
console.log('── top-7(ctx=考试):', outExam.map((c, i) => `${i}:${c.slice(0, 6)}`).join(' | '));

console.log('── ① 近期语境约定登顶（排在所有远期琐事之前） ──');
const rExam = rankOf(outExam, '考试');
ok(rExam >= 0, '① 近期语境约定在 top-7');
ok(rExam >= 0 && rankOf(outExam, '抹茶') < 0 && rankOf(outExam, '骑行') < 0,
   '① 约定在列 且 远期琐事(抹茶/骑行)全不在=近期压过远期（缺陷#1 修复）');

console.log('── ② 大事 major(imp9·95 天) 存活 top-7（decay 免疫） ──');
ok(rankOf(outExam, '纪念日') >= 0, '② imp9 大事 95 天仍在 top-7（major decay=1.0）');

console.log('── ④ 远期 auto-pin 琐事(imp7·90/120 天) 出 top-7 ──');
ok(rankOf(outExam, '抹茶') < 0, '🔴④ 抹茶(imp7·auto-pin·90 天) 不在 top-7=读侧褪色掉出（件③a+③b 合力）');
ok(rankOf(outExam, '骑行') < 0, '🔴④ 骑行(imp7·auto-pin·120 天) 不在 top-7');

console.log('── ⑤ 两语境列表分化（换 ctx → 命中项排名上升） ──');
const outMovie = recallMemories(1, 1, '电影', 7).map(m => m.content);
const movieInExam = rankOf(outExam, '电影'), movieInMovie = rankOf(outMovie, '电影');
ok(movieInMovie >= 0, '⑤ ctx=电影 时 电影记忆在 top-7');
ok(movieInMovie >= 0 && (movieInExam < 0 || movieInMovie < movieInExam),
   `⑤ 电影记忆在 ctx=电影 排名上升（考试:${movieInExam} → 电影:${movieInMovie}·ctxBoost 改序）`);

console.log('── 🔴⑥ 坏版本红验：子进程 MEM_SCORE_W_DECAY=0 → 远期琐事回 top-7 ──');
const selfPath = fileURLToPath(import.meta.url);
const childOut = JSON.parse(execFileSync(process.execPath, [selfPath, '--nodecay-child'], {
  env: { ...process.env, MEM_SCORE_W_DECAY: '0', DB_PATH: '/tmp/d2_recall_decay_child.db' },
  encoding: 'utf8',
}));
console.log('── 子进程 top-7(decay=0):', childOut.map((c, i) => `${i}:${c.slice(0, 6)}`).join(' | '));
ok(childOut.some(c => c.includes('抹茶')) || childOut.some(c => c.includes('骑行')),
   '🔴⑥ 去 decay 项(env=0) → 远期琐事(抹茶/骑行) 回 top-7=证 decay 项承重（红基线·env 旋钮真可调）');
ok(childOut.some(c => c.includes('抹茶')) && !outExam.some(c => c.includes('抹茶')),
   '🔴⑥ 同一抹茶：decay=0 在列 vs decay 默认不在列=接线前后行为反转（坏版本红验闭合）');

for (const suf of ['', '-wal', '-shm']) {
  try { unlinkSync(DB_PATH + suf); } catch {}
  try { unlinkSync('/tmp/d2_recall_decay_child.db' + suf); } catch {}
}
console.log(`\n══ d2_recall_decay smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
