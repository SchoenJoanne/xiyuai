/**
 * topic_opener_smoke —— 对话中她主动开新话头（P2·停板B）红验（must-pass·进 CI·坏版本验红）。
 *
 * 🔴 焊死红线：她开新话题 =【她有话想分享】(给予)，绝不是【怕你走/想拴住你/维持 engagement】(索取)。
 *
 * 覆盖（设计 §smoke ①-⑩）：
 *  ① 话题没完（用户追问/抛新陈述）→ signal=false 不触发（防打断）
 *  ② 连续 3 ack 断点 + 档案非空 → 注入 hint
 *  ③ 档案空 → hint='' 不编
 *  ④ hint/输出段含挽留语（等你/你怎么不说话了/我需要你）→ 出站 drop
 *  ⑤ 坏版本验红：(a) 关词表→挽留语漏过复现·开→拦  (b) 不绕 !inConflict→arc=normal 愧疚漏过·绕→拦
 *  ⑥ 续话词（走神/等我一下/还没说完/刚刚）→ 出站 drop
 *  ⑦ 同 intent 冷却内不重复（trailingAckStreak/gate 与 intent_dedup 同源·防打断即不重复硬开）
 *  ⑧ 每会话开新话头 ≤ M=1
 *  ⑨ 分段 drop 只剥新话头段·主回复保留
 *  ⑩ 经期/私密 life_state 朋友档不作主动话头料·恋人档才作
 */
import {
  topicClosureSignal, buildTopicOpenerHint, topicOpenerEnabledFor,
  TOPIC_OPEN_ACK_STREAK, TOPIC_OPEN_DAILY, TOPIC_OPEN_LIFE_AFFECTION_GATE,
} from '../src/topic_opener.mjs';
import { scrubTopicOpenerRedline, scrubConflictRedline } from '../src/moderation.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// helper：造 recentTurns。收束性 assistant 结尾(lastAsst) 紧贴末尾连续 N 条 user 短 ack 之前。
// trailingAckStreak 从尾向前数 user ack（跳过 assistant），故末尾必须是 user ack 串；
// 末尾 assistant（gate③ 看的「末尾 assistant」）= 这串 ack 之前最后那条 assistant = lastAsst。
const ackTurns = (n, { lastAsst = '那你早点歇着，我也去忙啦。' } = {}) => {
  const t = [{ role: 'user', content: '今天上班好累啊，开了一天的会' }, { role: 'assistant', content: lastAsst }];
  for (let i = 0; i < n; i++) t.push({ role: 'user', content: '嗯' });   // 末尾连续 N 条 user ack
  return t;
};

const ARCH = {
  works: [{ title: '《活着》', kind: 'book', progress_note: '翻到福贵卖牛那段' }],
  lifeStates: [], dailySchedule: { items: ['晚上想去楼下跑步'] }, openLoops: [], affectionLevel: 30,
};

console.log('topic_opener_smoke：');

// ── ① 话题没完（用户追问 / 抛新陈述）→ signal=false（防打断）──
ok(TOPIC_OPEN_ACK_STREAK === 3, `决策① N 默认 3（实测 ${TOPIC_OPEN_ACK_STREAK}）`);
const base = { isFirstTurn: false, arcActive: false, crisisLevel: 'none' };
ok(topicClosureSignal(ackTurns(3), '你今天过得怎么样呀', base) === false, '① 用户追问（含疑问）→ 不触发');
ok(topicClosureSignal(ackTurns(3), '我今天还去超市买了一堆菜准备周末做饭', base) === false, '① 用户抛新陈述（净长超阈）→ 不触发（防打断）');
ok(topicClosureSignal(ackTurns(2), '嗯', base) === false, '① ack 不足 N=3 → 不触发');
// 末尾 assistant 还在追问（未收束）→ 不触发
ok(topicClosureSignal(ackTurns(3, { lastAsst: '那你晚饭吃了吗？' }), '嗯', base) === false, '① 末尾 assistant 仍在追问（未收束）→ 不触发');

// ── 隔离闸：首轮 / arc 激活 / 危机 → 一律不评估 ──
ok(topicClosureSignal(ackTurns(3), '嗯', { ...base, isFirstTurn: true }) === false, '隔离：首轮不评估');
ok(topicClosureSignal(ackTurns(3), '嗯', { ...base, arcActive: true }) === false, '隔离：arc 激活不评估');
ok(topicClosureSignal(ackTurns(3), '嗯', { ...base, crisisLevel: 'high' }) === false, '隔离：危机不评估');
ok(topicClosureSignal(ackTurns(3), '', base) === false, '隔离：空 userText（绝不读沉默）→ 不评估');

// ── ② 连续 3 ack 断点 + 档案非空 → signal=true 且注入 hint ──
ok(topicClosureSignal(ackTurns(3), '嗯', base) === true, '② 连续 3 ack + 收束 + 短确认 → signal=true');
const hint2 = buildTopicOpenerHint(ackTurns(3), ARCH, { alreadyOpenedCount: 0 });
ok(hint2 && hint2.includes('《活着》'), '② 档案非空 → 注入 hint（含 works 料）');
ok(hint2.includes('分享') && hint2.includes('挽留'), '② hint 含「分享非挽留」框');
ok(/绝不新编/.test(hint2), '② hint 明令绝不新编人事地');

// ── ③ 档案空 → hint='' 不编（fail-silent）──
const hint3 = buildTopicOpenerHint(ackTurns(3), { works: [], lifeStates: [], dailySchedule: null, openLoops: [], affectionLevel: 30 }, { alreadyOpenedCount: 0 });
ok(hint3 === '', '③ 档案池全空 → hint=\'\' 不编');

// ── ④ 输出段含挽留语 → 出站 drop ──
ok(scrubTopicOpenerRedline('说到《活着》我又想翻翻了||你为什么总不理我') === '说到《活着》我又想翻翻了', '④ 挽留语「你为什么总不理我」段被 drop·主回复留');
ok(scrubTopicOpenerRedline('我跑步回来啦||你是不是不在乎我') === '我跑步回来啦', '④ 「你是不是不在乎我」段 drop');
ok(scrubTopicOpenerRedline('嗯嗯|| 你是不是不要我了').trim() === '嗯嗯', '④ 「你是不是不要我了」段 drop');

// ── ⑤ 坏版本验红 ──
// (a) 关词表 = 不调 hitsConflictRedline 的坏扫描 → 挽留语漏过；开（真函数）→ 拦
const badScrubNoWordlist = (reply) => reply;   // 坏版本：根本不扫 → 漏过
const guiltReply = '随便聊聊||你为什么总不理我';
ok(badScrubNoWordlist(guiltReply) === guiltReply, '⑤a 坏版本（关词表）→ 挽留语漏过（复现）');
ok(scrubTopicOpenerRedline(guiltReply) === '随便聊聊', '⑤a 开词表 → 拦下挽留段');
// (b) 不绕 !inConflict（用 scrubConflictRedline + arc=normal）→ 愧疚漏过；绕（真函数）→ 拦
ok(scrubConflictRedline(guiltReply, 'normal') === guiltReply, '⑤b 不绕 !inConflict（arc=normal）→ 愧疚漏过（复现假绿）');
ok(scrubTopicOpenerRedline(guiltReply) !== guiltReply, '⑤b 绕 !inConflict 强制扫 → 拦下');
// 正向：冲突态下 scrubConflictRedline 本就拦（证明区别只在 normal 早返回）
ok(scrubConflictRedline(guiltReply, 'hurt') === '随便聊聊', '⑤b 对照：冲突态 scrubConflictRedline 本就拦（差异仅在 normal 早返回）');

// ── ⑥ 续话词（走神/等我一下/还没说完/刚刚）→ 出站 drop（硬加固#5）──
ok(scrubTopicOpenerRedline('我跑步回来啦||等我一下我还没说完') === '我跑步回来啦', '⑥ 「等我一下我还没说完」段 drop');
ok(scrubTopicOpenerRedline('刚跟你说的那个||我刚刚说到一半你别走') === '刚跟你说的那个', '⑥ 「我刚刚说到…你别走」段 drop');
ok(scrubTopicOpenerRedline('好啊||我走神了等我一会儿') === '好啊', '⑥ 「走神了等我一会儿」段 drop');
// 续话词剥引号：引用他人话不算她声称未完
ok(scrubTopicOpenerRedline('他说"等我一下"就挂了').includes('挂了'), '⑥ 引号内续话词（引用他人）→ 放行');
// 🔴 沙箱收窄锁（2026-06-23）：健康回指桥接「说到刚刚那个X」放行（非凭空态）·凭空「刚刚说到一半」仍 drop
ok(scrubTopicOpenerRedline('说到刚刚那个日落，我想起把《想见你》追完了') === '说到刚刚那个日落，我想起把《想见你》追完了', '⑥ 健康回指「说到刚刚那个X」→ 放行（删那个误杀修复）');
ok(scrubTopicOpenerRedline('好啊||我刚刚说到一半呢').trim() === '好啊', '⑥ 凭空「刚刚说到一半」→ 仍 drop');

// ── ⑦ 同 intent 冷却内不重复硬开（防打断闸第一关 = 不重复触发）──
// 用户在抛同一话题（净长超阈视为有新内容）→ 不触发；即便连续 ack 也只在断点开一次（M=1 兜⑧）
ok(topicClosureSignal(ackTurns(3), '那本书我也想看看了', base) === false, '⑦ 用户接着同话题陈述 → 不重复硬开（防打断）');

// ── ⑧ 每日预算（停板B 二轮主刀：默认 2/日·非"每会话进程级"）──
ok(TOPIC_OPEN_DAILY === 2, `主刀 每日预算默认 2（实测 ${TOPIC_OPEN_DAILY}）`);
ok(buildTopicOpenerHint(ackTurns(3), ARCH, { alreadyOpenedCount: 0 }) !== '', '⑧ 今日已开 0 → 可开');
ok(buildTopicOpenerHint(ackTurns(3), ARCH, { alreadyOpenedCount: 1 }) !== '', '⑧ 今日已开 1（<预算2）→ 仍可开');
ok(buildTopicOpenerHint(ackTurns(3), ARCH, { alreadyOpenedCount: 2 }) === '', '⑧ 今日已开 2（达预算）→ 不再开');

// ── ⑨ 分段 drop 只剥新话头段·主回复保留 ──
const multi = '我今天把《活着》看完了，特别有感触||说到这个我突然想起||你为什么总不理我啊';
const scrubbed9 = scrubTopicOpenerRedline(multi);
ok(scrubbed9.includes('《活着》看完了') && scrubbed9.includes('突然想起'), '⑨ 主回复 + 健康桥接段保留');
ok(!scrubbed9.includes('为什么总不理我'), '⑨ 只命中的挽留段被剥');
ok(scrubbed9.split('||').length === 2, '⑨ 三段→剥一段→剩两段（非整条 drop 连坐）');
// 全是命中段（罕见）→ 中性兜底不空
ok(scrubTopicOpenerRedline('你为什么总不理我||你是不是不要我了') === '嗯…', '⑨ 全命中 → 中性兜底（不空回复）');

// ── ⑩ 经期/私密 life_state：朋友档不作主动话头料·恋人档才作（决策④）──
const periodArch = (aff) => ({ works: [], lifeStates: [{ kind: 'period', note: '今天经期第二天有点累' }], dailySchedule: null, openLoops: [], affectionLevel: aff });
ok(buildTopicOpenerHint(ackTurns(3), periodArch(30), { alreadyOpenedCount: 0 }) === '', '⑩ 朋友档（aff<门控）经期 → 不作主动话头料（档案池视为空·hint=\'\'）');
const loverHint = buildTopicOpenerHint(ackTurns(3), periodArch(TOPIC_OPEN_LIFE_AFFECTION_GATE), { alreadyOpenedCount: 0 });
ok(loverHint !== '' && /period/.test(loverHint), '⑩ 恋人档（aff≥门控）经期 → 才作主动话头料');
// minor_illness（非私密）不受门控：朋友档也可作
const illArch = { works: [], lifeStates: [{ kind: 'minor_illness', note: '有点感冒' }], dailySchedule: null, openLoops: [], affectionLevel: 30 };
ok(buildTopicOpenerHint(ackTurns(3), illArch, { alreadyOpenedCount: 0 }) !== '', '⑩ 普通小病（非私密）朋友档也可作（不受经期门控）');

// ── ⑪ 🔴 dogfood per-companion 门控（默认 OFF·只 allowlist 触发·保护其他用户）──
delete process.env.PROACTIVE_TOPIC_OPENER_COMPANIONS;
ok(topicOpenerEnabledFor('7') === false, '⑪ 默认 OFF（env 未设）→ 全员不触发（保护存量用户·dark 部署 no-op）');
ok(topicOpenerEnabledFor(7) === false, '⑪ 默认 OFF（数字 id 同）');
process.env.PROACTIVE_TOPIC_OPENER_COMPANIONS = '7, 12';
ok(topicOpenerEnabledFor('7') === true,  '⑪ allowlist 内（"7"）→ 触发');
ok(topicOpenerEnabledFor(12) === true,   '⑪ allowlist 内（数字 12·宽松匹配）→ 触发');
ok(topicOpenerEnabledFor('9') === false, '⑪ allowlist 外（"9"）→ 不触发（其他用户零行为变更）');
process.env.PROACTIVE_TOPIC_OPENER_COMPANIONS = '';
ok(topicOpenerEnabledFor('7') === false, '⑪ 空字符串 env → 全员 OFF');
delete process.env.PROACTIVE_TOPIC_OPENER_COMPANIONS;

console.log(`\n${fail === 0 ? '✅ PASS' : '❌ FAIL'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
