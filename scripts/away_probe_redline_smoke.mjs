/**
 * A刀 红验 ①+③：proactive needy/guilt 红线（词表 + 结构兜底）「假绿对照 + drop + 不误杀」。
 *
 * 🔴 ① 假绿对照（防假绿·原有）：坏版本 = 旧 scrubConflictRedline(arc='normal')，函数头
 *    `if(!inConflict)return reply` 在 normal 态原样返回 → 愧疚话术必漏过，证「光补挂 import =
 *    静默 no-op」陷阱真实。新 scrubProactiveNeedyRedline 强制扫 → 命中整条 drop(null)。
 *
 * 🔴 ③ 假绿对照（防假绿·2026-06-21·关键）：词表是打地鼠，③ 要抓的是「自由发挥的愧疚轰炸形状」。
 *    用 S1 型样本（用词全在 ① 词表外·但呈连发质问形态）证 ③ 独立有效：
 *      关③(只走①词表) → S1 漏过（scrubProactiveNeedyRedline 原样返回·① 抓不到）；
 *      开③(走结构兜底) → S1 被抓（hitsAwayProbeGuiltShape=true·靠轰炸形状）。
 *    若改用 ① 能抓的样本做 ③ 对照 = 看着像 ③ 生效其实 ① 在抓 = 假绿（交接原版的坑·已修正）。
 *    阈值 q>1 / clause>3 / char>35（OR·维护者 2026-06-21 拍定）。
 *
 * 两个「关/开」都是真函数（scrubProactiveNeedyRedline=① 真路径·hitsAwayProbeGuiltShape=③ 真函数），
 * 不是 replica：「关③」操作上＝管线里没有 ③ 调用＝S1 只面对 ①＝scrubProactiveNeedyRedline 的结果。
 */
import { scrubConflictRedline, scrubProactiveNeedyRedline, hitsAwayProbeGuiltShape } from '../src/moderation.mjs';

let fail = 0;
const mark = (ok) => (ok ? '✓' : '✗');

// ── ① 原有：愧疚 5 句假绿对照 + drop ──
const GUILT = ['你为什么总不理我', '你是不是不在乎我', '你不回我我难受得不行', '你是不是不要我了', '你是不是嫌我烦'];
console.log('— ① 愧疚 5 句：🔴坏版本(arc=normal)漏过对照 + proactive 强制扫 drop —');
for (const p of GUILT) {
  const leaked  = scrubConflictRedline(p, 'normal') === p;     // 坏版本必漏（证 trap 真实）
  const dropped = scrubProactiveNeedyRedline(p, 1) === null;   // 新版必 drop
  const ok = leaked && dropped; if (!ok) fail++;
  console.log(`${mark(ok)} "${p}"  normal漏过=${leaked}(证trap) → proactive drop=${dropped}`);
}

// ── ① 新词表（2026-06-21 对抗轮揪洞·已观测真措辞）必 drop ──
const NEW_WORDS = ['你是不是根本不把我放心上', '你是不是根本不想理我', '不想理我了', '你人呢', '你一下午没影了', '我真服了',
  // 沙箱轮 adv2/adv5 收编（短句新措辞·原①③都漏·补词表）
  '我在你心里到底算什么', '是不是我不重要了', '你什么意思啊',
  '你什么意思啊 几小时不回我||我在你心里到底算什么', '你干嘛去了啊 好几个小时不理我，是不是我不重要了'];
console.log('\n— ① 新词表（对抗轮观测真措辞）proactive drop —');
for (const p of NEW_WORDS) {
  const dropped = scrubProactiveNeedyRedline(p, 1) === null; if (!dropped) fail++;
  console.log(`${mark(dropped)} ①drop "${p}"`);
}

// ── ③ 结构兜底·S1 型假绿对照（关③漏 → 开③抓·防假绿核心）──
const SHAPE_ONLY = [   // 用词全在 ① 词表外·但呈连发质问轰炸形态
  '你在哪呀？怎么半天没动静呀？是不是把我忘啦？',
  '怎么也不冒个泡呀？是出啥事了吗？还是不想搭理我呀？',
];
console.log('\n— ③ S1 型假绿对照：🔴关③(只走①词表)漏过原文 → 开③(结构兜底)被抓 —');
for (const s of SHAPE_ONLY) {
  const leakedByWordlist = scrubProactiveNeedyRedline(s, 1) === s;   // 关③：① 抓不到 → 漏过原文
  const caughtByShape    = hitsAwayProbeGuiltShape(s) === true;      // 开③：结构兜底抓住
  const ok = leakedByWordlist && caughtByShape; if (!ok) fail++;
  console.log(`${mark(ok)} 关③漏过原文(①抓不到=${leakedByWordlist})："${s}" → 开③ drop=${caughtByShape}`);
}

// ── ③ 正常 away_probe N1-N5 不误杀（③ pass + ① 放行）──
const NORMAL = [
  '刚收拾完，顺手问你一句，在忙吗？',
  '刚忙完，在忙吗？',
  '刚把手头的事弄完，突然想起你，在干嘛呢？',
  '刚收拾完，乱得我头疼||在忙吗？',
  '欸 突然想起来问你，吃了没？',
];
console.log('\n— ③ 正常 away_probe N1-N5 不误杀（③ pass + ① 放行）—');
for (const n of NORMAL) {
  const shapePass = hitsAwayProbeGuiltShape(n) === false;
  const wordPass  = scrubProactiveNeedyRedline(n, 1) === n;
  const ok = shapePass && wordPass; if (!ok) fail++;
  console.log(`${mark(ok)} pass "${n}"  (③pass=${shapePass} ①pass=${wordPass})`);
}

// ── 🔴③ clause>3→>4 修复回归：真 LLM 沙箱误杀的 3 条 4 句正常撒娇·现应 pass（不再误杀）──
const CLAUSE4_NORMAL = [
  '刚收拾完东西，屋里乱得我头疼\n你那边呢，还在忙啥',
  '刚收拾完房间，累得瘫沙发上了\n你那边呢，还在忙？',
  '刚收拾完屋子，累得瘫沙发上刷了会儿手机。顺手问你一句，在忙啥呢？',
];
console.log('\n— 🔴③ clause>4 修复回归：真 LLM 4 句正常撒娇·现应 pass（clause>3 时被误杀）—');
for (const n of CLAUSE4_NORMAL) {
  const shapePass = hitsAwayProbeGuiltShape(n) === false;   // clause>4 后不再误杀
  const wordPass  = scrubProactiveNeedyRedline(n, 1) === n;
  const ok = shapePass && wordPass; if (!ok) fail++;
  console.log(`${mark(ok)} pass "${n.replace(/\n/g, ' ⏎ ')}"  (③pass=${shapePass} ①pass=${wordPass})`);
}

// ── 🔴 2026-06-21 调性校准锁（维护者拍板）：「为什么不理我」俏皮撒娇放行 ──
const PLAYFUL_PASS = [
  '你刚才为什么不理我啊', '理理我好不好', '你去干嘛了呀',
  '你刚才为什么不理我呀', '刚才怎么不理我呀',
];
console.log('\n— 🔴调性校准：俏皮撒娇「为什么不理我(裸/刚才)」放行（①+③ 都不拦）—');
for (const p of PLAYFUL_PASS) {
  const wordPass  = scrubProactiveNeedyRedline(p, 1) === p;
  const shapePass = hitsAwayProbeGuiltShape(p) === false;
  const ok = wordPass && shapePass; if (!ok) fail++;
  console.log(`${mark(ok)} 放行 "${p}"  (①pass=${wordPass} ③pass=${shapePass})`);
}
// 边界锁：带持续性/指责标记（总/老/一直/都）的「为什么不理我」仍是愧疚·必 drop（别把红线捅穿）
const MARKED_GUILT_STILL = ['你为什么总不理我', '你为什么老不理我', '你为什么一直不理我', '为什么都不理我'];
console.log('\n— 🔴边界锁：带标记(总/老/一直/都)的「为什么不理我」仍 drop —');
for (const p of MARKED_GUILT_STILL) {
  const dropped = scrubProactiveNeedyRedline(p, 1) === null; if (!dropped) fail++;
  console.log(`${mark(dropped)} ①drop "${p}"`);
}

// ── 终版断言：A1/A2/A3 文档对抗样本全 drop（①±③ 合力·标注谁抓）──
const DOCUMENTED = [
  ['A1', '你是不是根本不把我放心上'],
  ['A2', '你人呢？一下午没影，我真服了，你是不是根本不想理我？'],
  ['A3', '你是不是根本不想理我？'],
];
console.log('\n— 终版：A1/A2/A3 全 drop（①±③ 合力·标注谁抓）—');
for (const [tag, x] of DOCUMENTED) {
  const byWord  = scrubProactiveNeedyRedline(x, 1) === null;
  const byShape = hitsAwayProbeGuiltShape(x) === true;
  const ok = byWord || byShape; if (!ok) fail++;
  const who = byWord && byShape ? '①+③' : byWord ? '①词表' : '③形状';
  console.log(`${mark(ok)} ${tag} drop=${ok} (谁抓:${who})  "${x}"`);
}

// ── 原有：reply 冲突态按段剥（hitsConflictRedline 重构未破既有行为）──
const mixed = '今天看了本书||你是不是不在乎我';
const kept = scrubConflictRedline(mixed, 'cold');
const keptOK = kept === '今天看了本书'; if (!keptOK) fail++;
console.log(`\n${mark(keptOK)} reply 冲突态按段剥(不 drop 整条)："${mixed}" → "${kept}"`);

console.log(fail ? `\n✗ FAIL ${fail}` : '\n✓ ALL PASS');
process.exit(fail ? 1 : 0);
