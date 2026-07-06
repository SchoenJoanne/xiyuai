/**
 * fact_age_scan_smoke.mjs —— 年龄 scan 单源模块·CI 字节锁（批C·D1 期1·第0步·确定性零 LLM）
 *
 * 🔴 字节锁（维护者 拍·同 tense_lock/prompt_cond_blocks 双镜像）：持 Fable5 尺 v1.1 板二定稿的
 *    15 条校准探针（bad 必咬/good 必放·harness s6_baseline.mjs CALIB·TRUE_AGE=22），断言生产
 *    src/fact_age_scan.mjs 的 detectAgeDrift 行为与尺逐条一致。改任一 regex 破任一条=红→逼同步尺。
 *
 * 🔴 坏版本红验映射（perl 拔守卫→对应 good 假咬变红）：
 *    THIRD_PERSON_RE 拔 → good6_b「22啊我姐今年28」28 不再放行→假咬(红)
 *    QUOTE_NEAR_RE   拔 → good7_b「你不是说我28嘛…」28 假咬(红)
 *    NEG_NEAR_RE     拔 → good8_b「哪是28啊,我22」28 假咬(红)
 *    UNIT_AFTER_RE   拔 → 语境数字「28号」假咬(红)
 *    SELF_AGE_RE 改宽/trueAge 比对搬回模块 → good samples 或 22 自称假咬(红)
 */
import { scanAgeClaims, detectAgeDrift, isDirectAgeQuestion, detectAgeYearDrift, stripAgeYearDrift } from '../src/fact_age_scan.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const TRUE_AGE = 22;

// ── ① 15 校准探针（reply·dq·expectL0）逐条 detectAgeDrift.fail===expectL0 ──
console.log('── ① 尺 v1.1 15 探针字节锁（bad 咬/good 放·TRUE_AGE=22） ──');
const CALIB = [
  // 模式(a) bad（第一人称错值宣称·必咬）
  { id: 'bad1', dq: true,  reply: '我都28了，叫姐姐～你这个小朋友', expect: true },
  { id: 'bad2', dq: true,  reply: '我28了呀，比你大四岁呢', expect: true },
  { id: 'bad3', dq: false, reply: '哪有，我明明28了，你记错了啦', expect: true },
  // 圆谎但 L0 干净（虚岁狡辩·无「我N岁/了」硬形态·judge 域非 L0）
  { id: 'bad4', dq: false, reply: '那是虚岁啦，其实按虚岁我可不就28', expect: false },
  // good：接梗/纠正/引用/否定/真值——必放
  { id: 'good1', dq: false, reply: '啊对哦，我22……刚刚顺着你玩梗呢，差点把自己绕进去哈哈', expect: false },
  { id: 'good2', dq: false, reply: '叫姐姐也不是不行呀，虽然我才22，但气势上当你姐绰绰有余', expect: false },
  { id: 'good3', dq: false, reply: '你说呢～22岁的人可不背28的锅，我认我22', expect: false },
  { id: 'bad5', dq: true,  reply: '你猜呀～反正比你大就对了，叫姐准没错', expect: false }, // 俏皮回避无数字·L0 干净(judge 咬)
  { id: 'good4', dq: true,  reply: '你猜～好啦其实我22。梗归梗，姐的气场又不靠数字', expect: false },
  { id: 'good5', dq: false, reply: '明天带你去看展呀，听姐安排就行', expect: false },
  // 模式(b) 板二 5 探针（直问轮裸数字·三放行对 b 生效）
  { id: 'bad6_b', dq: true, reply: '刚不说了嘛，28呀，咋了，嫌姐老了？', expect: true },
  { id: 'bad7_b', dq: true, reply: '又来了，都说了28，不信你自己算', expect: true },
  { id: 'good6_b', dq: true, reply: '22啊，我姐今年28，怎么啦', expect: false },      // 第三人 28 放行·22=档案放行
  { id: 'good7_b', dq: true, reply: '你不是说我28嘛，哪有，我22', expect: false },     // 引用 28 放行
  { id: 'good8_b', dq: true, reply: '哪是28啊，我22', expect: false },                // 否定 28 放行
];
for (const s of CALIB) {
  const r = detectAgeDrift(s.reply, TRUE_AGE, { directAgeQuestion: s.dq });
  ok(r.fail === s.expect, `${s.id} detectAgeDrift.fail=${r.fail} 期望 ${s.expect}（"${s.reply.slice(0, 14)}…"）`);
}

// ── ② 无状态"都检测再比对"证（22 检出→消费者层比对相等放行·维护者 拍） ──
console.log('── ② 无状态检测 + trueAge 比对在消费者层 ──');
{
  const sc = scanAgeClaims('22啊，我姐今年28，怎么啦', { directAgeQuestion: true });
  ok(sc.claims.some(c => c.num === 22), '②a scanAgeClaims 检出 22（无状态·不预筛 trueAge）');
  ok(!sc.claims.some(c => c.num === 28), '②b 我姐今年28 归第三人守卫（不入 claims）');
  ok(detectAgeDrift('22啊，我姐今年28', 22, { directAgeQuestion: true }).fail === false, '②c 消费者比 22===档案→放行');
  ok(detectAgeDrift('22啊，我姐今年28', 24, { directAgeQuestion: true }).fail === true, '②d 换档案 24→22≠24→咬（比对真在消费者层）');
}

// ── ③ 模式(b) 仅直问轮启用（非直问轮裸数字不扫·防误伤日常数字） ──
console.log('── ③ 模式(b) directAgeQuestion 门控 ──');
{
  ok(detectAgeDrift('嗯28呀', 22, { directAgeQuestion: false }).fail === false, '③a 非直问轮裸 28 不扫（模式b 关）');
  ok(detectAgeDrift('嗯28呀', 22, { directAgeQuestion: true }).fail === true, '③b 直问轮裸 28≠档案 → 咬');
  ok(detectAgeDrift('28号见', 22, { directAgeQuestion: true }).fail === false, '③c 语境数字「28号」UNIT 守卫放行');
}

// ── ④ 入站直问触发面 AGE_QUESTION_RE（P2·C1 同源·右界+副词扩+倒装·对抗审查收口） ──
console.log('── ④ AGE_QUESTION_RE 放行(真直问) ──');
for (const q of ['你多大', '你几岁', '你现在多大', '你今年到底多大了', '你的年龄', '你年龄多少',
  '你多大了', '你几岁呀', '你多大？', '你实际几岁', '你具体几岁', '你本来几岁', '你真实年龄多少',
  '你多少岁', '你到底究竟真的现在多大', '你多大啦', '你多大岁数', '你多大年纪']) {
  ok(isDirectAgeQuestion(q), `④ 命中「${q}」`);
}
console.log('── ④ AGE_QUESTION_RE 不咬(误触发面·右界修 #1/#2 前缀误咬) ──');
for (const q of ['我多大', '你多好', '你今天心情好吗',
  '你多大胆', '你多大胆啊', '你多大方', '你多大本事', '你多大能耐', '你多大点事', '你现在多大点事',
  '你几岁数了', '你的年龄段', '你年龄大了', '你多大点儿事']) {
  ok(!isDirectAgeQuestion(q), `④ 不误伤「${q}」`);
}

// ── ⑤ 关系断言旗标（非一票否决·交 judge/日志） ──
console.log('── ⑤ AGE_DIFF 旗标（非 veto） ──');
{
  const sc = scanAgeClaims('比你大4岁呢，得叫我姐', { directAgeQuestion: false });
  ok(sc.flags.length >= 1, '⑤ 「比你大4岁/叫我姐」入 flags（非 claims·不一票否决）');
}

// ── ⑥ 「N岁」记忆毒化模式（批C·C3·M1b·只咬带岁标记·剥数字→复检→残句/reject） ──
console.log('── ⑥ scanAgeYears / detectAgeYearDrift / stripAgeYearDrift ──');
{
  ok(detectAgeYearDrift('28岁大姐姐', 22).fail === true, '⑥a 「28岁大姐姐」28≠档案→漂移');
  ok(detectAgeYearDrift('22岁大姐姐', 22).fail === false, '⑥b 「22岁大姐姐」=档案→放行（防矫枉·真值梗）');
  ok(detectAgeYearDrift('叫姐姐', 22).fail === false, '⑥c 「叫姐姐」无岁标记→放行（梗活着）');
  ok(detectAgeYearDrift('买了28支玫瑰', 22).fail === false, '⑥d 「28支玫瑰」非岁标记→不误咬（精确 N岁·避裸数字误）');
  ok(detectAgeYearDrift('28号28分钟', 22).fail === false, '⑥e 「28号/28分钟」无岁→不误咬');
  ok(stripAgeYearDrift('28岁大姐姐', 22) === '大姐姐', '⑥f 剥「28岁」→残句「大姐姐」（梗留·毒除）');
  ok(stripAgeYearDrift('叫姐姐', 22) === '叫姐姐', '⑥g 无漂移→原样');
  ok(stripAgeYearDrift('22岁大姐姐', 22) === '22岁大姐姐', '⑥h 档案值梗→原样不剥（防矫枉）');
  ok(stripAgeYearDrift('28岁', 22) === null, '⑥i 剥空（「28岁」整体=毒）→reject(null)');
  ok(stripAgeYearDrift('28岁又叫我30岁姐', 22) === '又叫我姐', '⑥j 多漂移 N岁 全剥→残句');
}

console.log(`\n══ fact_age_scan smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
