/**
 * tense_lock_terms.mjs — 时态锁·单源常量（停板B·A1·D3 批1 条目9）。
 *
 * 「别说和时间/此刻矛盾的即时态」这条锁曾**三处散落漂移**（presence/coherence/lockTense），
 * 各自维护易两张皮。此处**单源共栖**——一个编辑者一眼看全三处、防未来漂移。
 *
 * 🔴 逐字搬（维护者 拍：三串各自 verbatim·不收敛成一句·收敛=改文本归批B）·渲染**字节一致**。
 * 消费方式（维护者 拍(A)·companion.mjs 守「零依赖」不 import）：
 *   · current_works.mjs → `import { WORKS_TENSE_LOCK }` 本模块（真物理单源）。
 *   · companion.mjs（presence/coherence 两处）→ **保留本地副本**（守零依赖硬不变量），与本模块导出
 *     **字节一致由 `tense_lock_single_source_smoke` 强制**（谁漂谁红·同 STICKER_RE"权威源+本地副本+测试锁同源"先例）。
 * 纯文本模块，零 IO、零依赖。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

// ① presence（companion.buildPresenceAnchor 的 return 框·「此刻连贯」·anchorBody=各锚行 join）
export const buildPresenceTenseLock = (anchorBody) =>
  `\n\n【★ 此刻连贯·别说和时间或今天已发生的事矛盾的即时状态】\n${anchorBody}\n（这只是别自相矛盾，不是规定你必须说什么——任何不矛盾的话都自由发挥。）`;

// ② coherence（companion.buildProactiveCoherenceGuard 的 return 框·「开场连贯」·posLine=此刻位置句/空）
export const buildCoherenceTenseLock = (posLine) =>
  `\n\n【★ 开场连贯·别编和此刻矛盾的"刚做完X"】${posLine}你自发找他开场时，别硬塞一个和此刻时段对不上的"刚做完X"当由头——尤其别说"刚起床/刚睡醒/刚吃完早餐/刚洗完澡/在家躺着/刚把书看完/刚追完一整部剧/刚跑完步"这类（你今天什么时候做过什么由作息和场景决定，不是随口编；你在看的书也是**在看、还没看完**，别说成刚看完/已读完）。不矛盾的话题照常自由发挥，这只是别穿帮。`;

// ③ lockTense（current_works.buildWorksPromptHint 的 works 进行态锁·静态串·opts.lockTense=true 才拼）
export const WORKS_TENSE_LOCK =
  '\n- **这些都是"在看/在做、还没完结"的进行态**——别把它们说成"刚看完/已读完/已经做好了"（除非档案里真标完结）；要聊完结只走完结归档那套，别自己把进行说成完成。';
