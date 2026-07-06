/**
 * d2_recall_filter_smoke.mjs —— 召回硬过滤（批D·件①·信任事故先修·确定性零 LLM）
 *
 * 🔴 route≠filter 红验（维护者 拍·批C 铁律二次咬中）：archived/deleted/contradicted（memory_status≠active）
 *    + 用户标"勿提"（do_not_mention=1）的记忆【绝不出现在召回列表】。验的是 filter 生效（脏记忆不出列），
 *    不是 route（函数被调用）——故坏样本刻意给 imp=10+pinned=1（无过滤时必排最前），断言它仍不返回。
 *
 * 覆盖三档（pinned/keyword/topRows）+ semantic·四查询同源 MEM_RECALL_ACTIVE_FILTER。
 *
 * 🔴 坏版本红验：db.mjs 去 MEM_RECALL_ACTIVE_FILTER 任一处 → 对应脏记忆回流召回列表（红）。
 */
process.env.DB_PATH = '/tmp/d2_recall_filter_smoke.db';
import { unlinkSync, readFileSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const { getDb, recallMemories, recallMemoriesSemantic } = await import('../src/db.mjs');
const { packEmbedding } = await import('../src/memory_v2.mjs').catch(() => ({}));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };

const db = getDb();
db.pragma('foreign_keys = OFF');
const CID = 1, UID = 1;
db.prepare("INSERT INTO companions (id, user_id, bot_id, name) VALUES (?,?,?,?)").run(CID, UID, 'b', '测');
const now = new Date().toISOString();
const ins = db.prepare(`INSERT INTO companion_memories
  (companion_id, user_id, memory_type, content, importance, pinned, memory_status, do_not_mention, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
// active 干净记忆（各档都放一条·应召回）
ins.run(CID, UID, 'fact', '他喜欢猫也养了猫', 6, 0, 'active', 0, now);         // keyword 档(猫)
ins.run(CID, UID, 'fact', '他是程序员', 7, 1, 'active', 0, now);              // pinned 档
// 🔴 脏记忆（刻意 imp=10/pinned=1·无过滤必排最前·应【不】召回）
ins.run(CID, UID, 'fact', '归档的旧错误猫记忆', 10, 1, 'archived', 0, now);     // archived + pinned + imp10 + keyword(猫)
ins.run(CID, UID, 'fact', '用户明确说勿提的隐私猫事', 10, 1, 'active', 1, now);  // do_not_mention=1 + keyword(猫)
ins.run(CID, UID, 'fact', '被后续推翻的矛盾记忆', 9, 0, 'contradicted', 0, now); // contradicted (topRows 档)
ins.run(CID, UID, 'fact', '已删除态记忆', 9, 0, 'deleted', 0, now);            // 非 active

console.log('── ① recallMemories：脏记忆不出列（验 filter 非 ordering） ──');
const out = recallMemories(CID, UID, '猫', 7).map(m => m.content);
ok(out.some(c => c.includes('喜欢猫')), '① active 记忆正常召回（keyword 档）');
ok(out.some(c => c.includes('程序员')), '① active pinned 记忆召回（pinned 档）');
ok(!out.some(c => c.includes('归档')), '🔴① archived(imp10+pinned·本应排最前) 不召回=filter 胜 ordering');
ok(!out.some(c => c.includes('勿提')), '🔴① do_not_mention=1 记忆不召回');
ok(!out.some(c => c.includes('矛盾')), '🔴① contradicted 不召回');
ok(!out.some(c => c.includes('删除')), '🔴① deleted(memory_status≠active) 不召回');

console.log('── ② recallMemoriesSemantic：同源过滤 ──');
if (typeof packEmbedding === 'function') {
  const emb = packEmbedding(Array.from({ length: 8 }, () => 0.1));
  const insE = db.prepare(`INSERT INTO companion_memories
    (companion_id, user_id, memory_type, content, importance, pinned, memory_status, do_not_mention, embedding, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  insE.run(CID, UID, 'fact', 'sem 干净记忆', 6, 0, 'active', 0, emb, now);
  insE.run(CID, UID, 'fact', 'sem 归档脏记忆', 10, 1, 'archived', 0, emb, now);
  insE.run(CID, UID, 'fact', 'sem 勿提记忆', 10, 1, 'active', 1, emb, now);
  const semOut = recallMemoriesSemantic(CID, UID, Array.from({ length: 8 }, () => 0.1), 7).map(m => m.content);
  ok(semOut.some(c => c.includes('sem 干净')), '② semantic active 召回');
  ok(!semOut.some(c => c.includes('归档')), '🔴② semantic archived 不召回');
  ok(!semOut.some(c => c.includes('勿提')), '🔴② semantic do_not_mention 不召回');
} else {
  console.log('  (packEmbedding 未导出·跳 semantic 运行时·下方源断言兜底)');
}

console.log('── ③ 同源单一权威源（两活路共用一处过滤常量·防两张皮） ──');
const src = readFileSync(new URL('../src/db.mjs', import.meta.url), 'utf8');
ok((src.match(/MEM_RECALL_ACTIVE_FILTER/g) || []).length >= 5, '③ MEM_RECALL_ACTIVE_FILTER 定义1+四查询引用（recallMemories×3+Semantic×1）');
ok(src.includes("memory_status = 'active'") && src.includes('do_not_mention'), '③ 双过滤条件在常量内');

console.log(`\n══ d2_recall_filter smoke：${pass} 通过 / ${fail} 失败 ══`);
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
process.exit(fail ? 1 : 0);
