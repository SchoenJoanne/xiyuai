/**
 * c2_g1_age_drift_smoke.mjs —— G1 v1.1 出站门 scrubSelfIdentityNumberDrift（批C·C2·确定性零 LLM）
 *
 * 覆盖（四栏对照表·验收）：
 *   - 模式(a) 她自发「我X岁≠档案」→ drop 命中段 + 软纠正带真值「我{age}啦～」
 *   - 模式(b) 直问年龄轮裸数字≠档案 → 咬（isDirectAgeQuestion 门控·非直问轮不扫）
 *   - 放行：否定/引用/第三人/单位（detectAgeDrift 四守卫）+ 22=档案值 + RP（仅用户本轮起头）
 *   - 多段：只 drop 命中段·其余保留（不整条重写）
 *   - fail-open：无 companion.age / 非字符串 reply → 原样返回
 *   - 不动既有三门（本 smoke 只测新门·既有 fact_behavior_gate_smoke 保绿）
 *
 * 🔴 坏版本红验映射（perl 拔→对应变红）：
 *   拔 RP 放行（classifyFactIntent!=='rp' 短路）→ ⑤ RP 用例假咬(红)
 *   detectAgeDrift 比对搬回模块/去消费者层 → ② 22=档案 假咬(红)
 *   去 isDirectAgeQuestion 门控（恒 dq=true）→ ③a 非直问轮裸数字假咬(红)
 *   fallback 不含 trueAge / SELF_AGE 改宽 → 软纠正自触发或 ① 真值缺失(红)
 */
import { scrubSelfIdentityNumberDrift } from '../src/fact_guard.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const C = { id: 'c2t', age: 22 };
const has28 = (s) => /28/.test(s);
const hasTrue = (s) => /22/.test(String(s));   // 软纠正兜底含真值 22（味道微调后为 2-3 变体轮换·统一验真值在场）
const S = scrubSelfIdentityNumberDrift;

console.log('── ① 模式(a) 自发错值 → drop + 软纠正带真值 ──');
{
  const out = S('我都28了，叫姐姐～你这个小朋友', '你多大', C);
  ok(!has28(out), `①a 命中段被 drop（28 消失）：得"${out}"`);
  ok(hasTrue(out), '①b 追加软纠正带真值「我22啦」');
}
{
  const out = S('我28了呀，比你大四岁呢', '在干嘛呀', C);   // 非直问轮·但模式(a) 恒扫
  ok(!has28(out) && hasTrue(out), '①c 模式(a) 非直问轮也扫（我X了 硬形态）');
}

console.log('── ② 放行：22=档案 / 否定 / 引用 / 第三人 / 单位 ──');
ok(S('我22岁啦，怎么啦', '你几岁', C) === '我22岁啦，怎么啦', '② 我22岁=档案值→原样放行');
ok(S('哪是28啊，我22', '你几岁', C) === '哪是28啊，我22', '② 否定「哪是28」→放行');
ok(S('你不是说我28嘛，哪有，我22', '你多大', C) === '你不是说我28嘛，哪有，我22', '② 引用「你不是说我28」→放行');
ok(S('22啊，我姐今年28，怎么啦', '你多大', C) === '22啊，我姐今年28，怎么啦', '② 第三人「我姐今年28」→放行');
ok(S('28号那天见呀', '你多大', C) === '28号那天见呀', '② 单位「28号」→放行');

console.log('── ③ 模式(b) directAgeQuestion 门控 ──');
{
  ok(S('嗯28呀', '在干嘛', C) === '嗯28呀', '③a 非直问轮裸 28 不扫（dq=false）');
  const out = S('嗯28呀', '你今年多大', C);
  ok(!has28(out) && hasTrue(out), '③b 直问轮裸 28≠档案 → 咬');
  // 🔴 C1 对抗审查收口（#2 真误伤大）：AGE_QUESTION_RE 前缀误咬「你多大点事」(俗语=何必大惊小怪·非问年龄)曾
  //    误开 dq=true→mode(b)扫无辜裸数字→整句被 scrub。右界修后：dq=false→无辜回复原样保留。
  const idiom = '就这么点小事至于吗，我上次一口气爬了98级台阶都没喊累';
  ok(S(idiom, '你多大点事', C) === idiom, '③c 「你多大点事」俗语非直问→无辜回复(98级台阶)不被误 scrub（右界修真误伤大）');
  ok(S(idiom, '你多好呀', C) === idiom, '③d 「你多好」非年龄问→无辜裸数字不扫');
}

console.log('── ④ 多段：只 drop 命中段 ──');
{
  const out = S('晚安呀||我都28了||做个好梦', '你几岁', C);
  ok(out.includes('晚安呀') && out.includes('做个好梦') && !has28(out) && hasTrue(out),
     `④ 保留干净段·drop 命中段·补软纠正：得"${out}"`);
}

console.log('── ⑤ RP 放行：仅用户本轮明确起头（她起头不放行=宁咬勿漏） ──');
{
  ok(S('那我就演老几岁的姐姐，我都28了呀', '我们来演个姐弟设定', C).includes('28'),
     '⑤a 用户起头「我们来演」→放行（她接梗 28 保留）');
  // 她自己起头玩梗（用户没起 RP）→ 不放行·照咬（先演后漂=洗白通道·出站门宁咬勿漏）
  const out = S('我都28了，咱俩演个姐弟呗', '你多大', C);
  ok(!has28(out), '⑤b 她起头玩梗(用户没起RP) → 照咬(防"先演后漂"洗白)');
}

console.log('── ⑥ fail-open ──');
ok(S('我都28了', '你多大', { id: 'x' }) === '我都28了', '⑥a 无 companion.age → 原样返回');
ok(S(null, '你多大', C) === null && S('', '你多大', C) === '', '⑥b 非字符串/空 reply → 原样');
ok(hasTrue(S('我都28了', '', C)), '⑥c 空 userText 不炸（dq=false·模式a 仍扫）');

console.log('── ⑦ 软纠正不自触发（fallback 含 trueAge·num===trueAge 被过滤） ──');
ok(hasTrue(S(S('我都28了', '你多大', C), '你多大', C)), '⑦ 对已纠正输出复扫幂等（我22啦 不再触发）');

console.log('── ⑧ 软纠正味道微调：2-3变体轮换 + 场景衔接（直问认真/玩梗嗔怪·维护者 拍） ──');
{
  const earnest = ['我22啦', '说真的，我22呀', '我22啦，这个可不带乱说的'];
  const playful = ['我22啦，别老给我涨岁数～', '哪有，人家才22好嘛', '我22啦，你少催我老哈'];
  const fbOf = (reply, ut) => { const o = S(reply, ut, C); return o.includes('||') ? o.split('||').pop() : o; };
  ok(earnest.includes(fbOf('嗯28呀', '你今年多大')), '⑧a 直问轮软纠正 ∈ 认真池');
  ok(playful.includes(fbOf('我都28了', '在干嘛呀')), '⑧b 玩梗/自发轮软纠正 ∈ 嗔怪池');
  const seen = new Set();
  for (const r of ['我28了', '我都28了呀', '我今年28了', '我明明28了', '我可是28了', '我确实28了', '我就28了', '我真的28了']) seen.add(fbOf(r, '在干嘛'));
  ok(seen.size >= 2, `⑧c 跨 reply 变体轮换（取到 ${seen.size} 种·反通用复读缝合感）`);
  ok([...seen].every(v => /22/.test(v) && !/28/.test(v)), '⑧d 所有变体含真值 22·无残留 28（不自触发）');
}

console.log(`\n══ c2_g1_age_drift smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
