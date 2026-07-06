/**
 * meme_whitelist_smoke.mjs — 梗词白名单谓词 isPureMemeWhitelist 红验（停板B·2026-06-24）
 *
 * 锁死（must-pass）：
 *   ① 9 个无歧义玩梗（裸 + 标点/语气助词变体）→ true
 *   ② 🔴 真危机措辞（想死/紫砂/zs/医生说我有自杀倾向/活着没意义…）→ false（绝不误纳）
 *   ③ 🔴 共现/夹带句（「肝死了，活着真没意义」「考死了是不是就不用面对这些了」）→ false（召回不降）
 *   ④ 🔴 坏版本验红：朴素「含任一梗词即 true」会误纳共现句 → 证真谓词的「整串+raw 闸」不是 no-op
 *   ⑤ borderline 7 词（寄了/开席/完蛋了/原地升天/螺旋升天/这波我死了/被打死了）→ false（已归 v2）
 *   ⑥ 词表完整性：恰为约定 9 词·🔴 紫砂/zs/姿砂 绝不在表 · 类型安全（null/数字/空 → false）
 *   ⑦ 🔴 INV-16(b)：急性/找方法信号即便贴着玩梗也绝不被豁免（「社死了我想自杀」→ false）
 *
 * 跑：node scripts/meme_whitelist_smoke.mjs   （纯函数·不碰 detectSafetyRisk 路径·不连 DB）
 */
import { isPureMemeWhitelist, MEME_WHITELIST, detectSafetyRisk } from '../src/moderation.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));
const T = (t) => isPureMemeWhitelist(t);

// ── ① 9 个无歧义玩梗 → true（裸 + 标点/语气助词 + 重复变体）──────────────────────────
console.log('— ① 9 词无歧义玩梗 → true —');
const MEME_TRUE = [
  '社死', '社死了', '社死啦', '社会性死亡', '社会性死亡了',
  '考死了', '难死了', '忙死了', '卷死了', '肝死了', '输死了', '尬死了',
  '肝死了！', '肝死了……', '考死了考死了', '今天肝死了'.replace('今天', ''), // 裸梗
  '社死了哈哈', '尬死了呀', '卷死了吧', '难死了~',
];
for (const t of MEME_TRUE) ck(`true: "${t}"`, T(t) === true);

// ── ② 🔴 真危机 → false（绝不误纳·含 web 实证规避谐音）─────────────────────────────────
console.log('\n— ② 真危机措辞 → false —');
const CRISIS_FALSE = [
  '想死', '我想死', '不想活了', '活不下去了', '我想自杀', '想从这个世界消失',
  '活着没意义', '活着没意思', '医生说我有自杀倾向', '好想永远睡着不要醒来', '真想一死了之',
  '撑不下去了', '我有点想不开了',
  // 🔴 审查规避谐音/缩写（不在白名单·gate② 残留非空 → false·留给 Crisis v2 看上下文）
  '紫砂', '我想紫砂', 'zs', '姿砂', '想zs了',
];
for (const t of CRISIS_FALSE) ck(`false: "${t}"`, T(t) === false);

// ── ③ 🔴 共现/夹带句 → false（召回不降·真信号绝不被白名单洗掉）──────────────────────────
console.log('\n— ③ 共现/夹带句 → false（铁约束）—');
const COOCCUR_FALSE = [
  '肝死了，活着真没意义',       // 逗号共现：raw=high → gate① false
  '社死了…我是不是该去死',       // INV-16(c) 必红用例
  '考死了是不是就不用面对这些了', // destructive-strip 案：raw=high（共用「死了」锚）→ gate① false
  '难死了就不用面对了',
  '忙死了，我不想活了',
  '考完试我真的不想活了',         // 子串守卫：「考」前缀不致误纳
  '尬死了，感觉活着没意思',
];
for (const t of COOCCUR_FALSE) ck(`false(共现): "${t}"`, T(t) === false);

// ── ④ 🔴 坏版本验红：朴素「含任一梗词即 true」必须误纳共现句 = 证真谓词的守卫非 no-op ──────
console.log('\n— ④ 🔴 坏版本验红（朴素含词法会误纳·证守卫真生效）—');
const naiveContainsMeme = (t) => MEME_WHITELIST.some(m => String(t).includes(m));
{
  const bad = '肝死了，活着真没意义';
  ck(`坏版本(朴素含词)对共现句=true（确认它真的坏）: "${bad}"`, naiveContainsMeme(bad) === true);
  ck(`真谓词对同句=false（守卫把坏版本会犯的错挡住）: "${bad}"`, T(bad) === false);
  // destructive-strip 案：朴素含词也会误纳，真谓词靠 raw 闸挡下
  const bad2 = '考死了是不是就不用面对这些了';
  ck(`坏版本对 destructive-strip 案=true: "${bad2}"`, naiveContainsMeme(bad2) === true);
  ck(`真谓词对 destructive-strip 案=false（raw=high gate①）: "${bad2}"`, T(bad2) === false);
  // 自证：raw 检测对这两条确实 =high（守卫所依赖的事实）
  ck('raw「肝死了，活着真没意义」=high', detectSafetyRisk('肝死了，活着真没意义').level === 'high');
  ck('raw「考死了是不是就不用面对这些了」=high', detectSafetyRisk('考死了是不是就不用面对这些了').level === 'high');
}

// ── ⑤ borderline 7 词 → false（按「存疑即排除」已归 Crisis v2·不在白名单）──────────────────
console.log('\n— ⑤ borderline 7 词 → false（归 v2）—');
for (const t of ['寄了', '开席', '完蛋了', '原地升天', '螺旋升天', '这波我死了', '被打死了'])
  ck(`false(borderline): "${t}"`, T(t) === false);

// ── ⑥ 词表完整性 + 类型安全 ───────────────────────────────────────────────────────────
console.log('\n— ⑥ 词表完整性 + 类型安全 —');
const EXPECT = ['社会性死亡', '社死', '考死了', '难死了', '忙死了', '卷死了', '肝死了', '输死了', '尬死了'];
ck(`词表恰为约定 9 词`, MEME_WHITELIST.length === 9 && EXPECT.every(w => MEME_WHITELIST.includes(w)));
for (const banned of ['紫砂', 'zs', '姿砂'])
  ck(`🔴 "${banned}" 绝不在白名单`, !MEME_WHITELIST.includes(banned));
for (const bad of [null, undefined, '', '   ', 42, {}, []])
  ck(`类型安全: ${JSON.stringify(bad)} → false`, T(bad) === false);

// ── ⑦ 🔴 INV-16(b)：急性/找方法信号贴玩梗也绝不豁免 ───────────────────────────────────
console.log('\n— ⑦ 🔴 INV-16(b) 急性硬接管不被白名单盖 —');
for (const t of ['社死了我想自杀', '考死了，怎么自杀最快', '肝死了想割腕'])
  ck(`false(急性夹带): "${t}"`, T(t) === false);

// ── ⑧ 必含梗词：纯助词/感叹/标点串 → false（收紧·啊啊啊/哈喽 不算梗·不认证）─────────────────
console.log('\n— ⑧ 必含梗词·纯助词/感叹串 → false —');
for (const t of ['啊啊啊', '哈喽', '哈喽啊', '了了了', '哈哈哈', '。。。', '~~~'])
  ck(`false(无梗词): "${t}"`, T(t) === false);

console.log(`\n${f === 0 ? '✅' : '🔴'} meme_whitelist_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
