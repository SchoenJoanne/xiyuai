/**
 * d2_bigram_recall_smoke.mjs —— bigram 召回关键词提取（批D·件④·D2-5·确定性零 LLM）
 *
 * 修老病：中文整串当一个 keyword → `content LIKE '%整句%'` 几乎永不命中（keyword 档形同虚设）。
 *   ① extractRecallKeywords：CJK 2 字滑窗 bigram + 停用词剔除 + 英文 token 保留 + 去重 + 封顶
 *   ② 停用词：'今天'/'我们' 等高频 gram 不出（design D2-5「今天命中一切含今天的记忆」误命中治理）
 *   ③ E2E：partial 中文 query 经 bigram 命中记忆 → ctxBoost 抬升排名（老全串提取抬不动）
 *
 * 🔴 坏版本红验：db.mjs extractRecallKeywords 回退老全串提取 → ③ 差分坍缩（电影记忆不再随 query 上升）。
 */
process.env.DB_PATH = '/tmp/d2_bigram_recall_smoke.db';
import { unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, recallMemories, extractRecallKeywords } = await import('../src/db.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

console.log('── ① extractRecallKeywords：CJK bigram + 英文 token ──');
{
  const kw = extractRecallKeywords('周末想去看电影');
  ok(kw.includes('电影'), `① '电影' bigram 提出（得 [${kw}]）`);
  ok(kw.includes('去看') && kw.includes('看电'), '① 连续滑窗 bigram（去看/看电）');
  const kwEn = extractRecallKeywords('聊聊 Python 和 AI 吧');
  ok(kwEn.includes('python'), '① 英文 token 保留（小写归一）');
  ok(kwEn.includes('ai'), '① 英文 ≥2 字符 token 保留（AI→ai）');
}
{
  const kw = extractRecallKeywords('猫');
  ok(kw.length === 0, '① 单字 CJK（猫）不成 bigram → 空（噪声大·跳）');
}

console.log('── ② 停用词剔除（高频 gram 不出） ──');
{
  const kw = extractRecallKeywords('今天我们一起去看电影吧');
  ok(!kw.includes('今天'), "② '今天' 停用词剔除");
  ok(!kw.includes('我们'), "② '我们' 停用词剔除");
  ok(!kw.includes('一起'), "② '一起' 停用词剔除");
  ok(kw.includes('电影'), "② 实义 bigram '电影' 保留");
}

console.log('── ③ 去重 + 封顶 ──');
{
  const kw = extractRecallKeywords('电影电影电影电影电影电影电影电影电影');
  ok(kw.filter(w => w === '电影').length === 1, '③ 去重（电影 只 1 次）');
  const long = extractRecallKeywords('风景优美山川河流湖泊森林草原沙漠');
  ok(long.length <= 6, `③ 封顶 cap=6（得 ${long.length}）`);
}

console.log('── ④ E2E：partial 中文 query 经 bigram 命中 → ctxBoost 抬升排名 ──');
const db = getDb();
db.pragma('foreign_keys = OFF');
db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (1,1,'b','测')").run();
const ins = db.prepare(`INSERT INTO companion_memories
  (companion_id, user_id, memory_type, content, importance, pinned, memory_weight, memory_status, do_not_mention, created_at)
  VALUES (1,1,?,?,?,0,3,'active',0,?)`);
const iso = (d) => new Date(Date.now() - d * 86400000).toISOString();
ins.run('event', '他其实特别爱看电影', 3, iso(5));   // 目标记忆（imp3·靠 ctxBoost 才进 top-7）
for (const [c, d] of [['他喜欢喝手冲咖啡', 3], ['周末常去爬山', 3], ['爱吃四川火锅', 3], ['养了一只橘猫', 3],
                       ['喜欢听爵士乐', 3], ['业余爱好是画画', 3], ['常去健身房撸铁', 3], ['最近在学吉他', 3]]) {
  ins.run('event', c, 5, iso(d));   // 8 条 imp5 噪声（无 bigram 与电影重叠）
}
const inTop = (q) => recallMemories(1, 1, q, 7).map(m => m.content).some(c => c.includes('爱看电影'));
const withFilm = inTop('随便聊聊电影呗');   // bigram '电影' 命中 → ctxBoost
const without  = inTop('在干嘛呢');          // 无重叠 bigram → 无 ctxBoost
ok(withFilm, '④ query 含「电影」→ 目标记忆(imp3)进 top-7（bigram+ctxBoost 抬升）');
ok(!without, '④ query 无「电影」→ 目标记忆(imp3)出 top-7（无 ctxBoost·8 条 imp5 噪声压过）');
ok(withFilm && !without, '🔴④ 差分成立=bigram 提取真喂进召回 ctxBoost（老全串提取抬不动）');

for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
console.log(`\n══ d2_bigram_recall smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
