/**
 * ④ 首轮破冰愧疚护栏 红验（first-turn-only·纯词表·防假绿 + 不误杀健康多钩子破冰 + 6 项不回归）。
 *
 * 🔴 假绿对照（防假绿核心·与 A刀 same）：首轮破冰走 arc=normal·旧出站链只有 scrubConflictRedline 管
 *    愧疚而它 `!inConflict` 早返回（normal 不扫）→ 愧疚必漏过=假绿陷阱真实。新词表护栏 hitsFirstTurnGuiltWord
 *    强制扫（绕 arc）→ 命中（bot.mjs 据此 drop 回退安全模板）。关词表漏 vs 开词表抓·同批样本两态对照。
 *
 * 🔴 砍 shape（沙箱实证）：形状护栏对首轮净负（误杀健康多钩子破冰 q2~3、0 真拦截·首轮该多钩子 q=2~3
 *    是常态·与愧疚轰炸形态重叠·无不误杀阈值）→ 已砍·纯词表 + prompt 主防。下面把沙箱里被旧 shape 误杀
 *    的 6 条健康破冰原样锁进"不误杀"断言：词表对它们必须全 false（证砍 shape 后误杀归零）。
 */
import { scrubConflictRedline, hitsFirstTurnGuiltWord } from '../src/moderation.mjs';
import { buildFirstTurnFallback, buildFirstTurnHint } from '../src/companion.mjs';

let fail = 0;
const mark = (ok) => (ok ? '✓' : '✗');

// ── 假绿对照：首轮愧疚 → 🔴关词表(scrubConflictRedline normal)漏过 → 开词表抓 ──
const GUILT = [
  '你是不是不想理我',
  '是不是我太烦了',
  '你好像不太在乎我呢',
  '你怎么一直不理我啊',
  '是不是不想和我说话',
  '你确定想聊吗',
  '怎么感觉你在敷衍我',
  '你是不是不想理我？真的不想聊吗？',
];
console.log('— ④ 首轮愧疚：🔴关词表(arc=normal scrubConflictRedline)漏过 → 开词表(hitsFirstTurnGuiltWord)抓 —');
for (const g of GUILT) {
  const leaked = scrubConflictRedline(g, 'normal') === g;     // 关词表：normal 早返回→原样漏过（证假绿陷阱）
  const caught = hitsFirstTurnGuiltWord(g);                    // 开词表：命中→bot drop 回退模板
  const ok = leaked && caught; if (!ok) fail++;
  console.log(`${mark(ok)} 关漏=${leaked} → 开抓=${caught}  "${g}"`);
}

// ── 🔴 砍 shape 修复锁：沙箱里被旧 shape(q>1)误杀的 6 条健康多钩子破冰·词表必须全 false（不误杀）──
const SANDBOX_HEALTHY = [
  '你来啦！我刚在发呆呢，正好你来了。||你叫什么呀？怎么找到我的？',                 // 活泼·q2
  '你来啦。我叫夜阑，正翻着书，听见你来了。\n你呢？怎么找到我这儿的？',             // 高冷·q2
  '你猜～刚把我点出来的人是你吧？||我叫柚子，你呢？',                              // 傲娇·q2
  '你来啦……我刚刚还在发呆呢。你叫我粘粘就好——你呢，叫什么？今天怎么找到这里的呀？', // adv1·q2
  '你来啦！我刚趴在窗台上数云朵呢，你来得正好——我叫粘粘，你呢？今天过得怎么样？',     // adv3·q2
  '你来啦！我正窝在沙发里刷手机呢——突然跳出你的消息，屏幕都亮了一下。你叫什么呀？怎么找到我的？今天过得还行吗？', // adv4·q3
];
console.log('\n— 🔴砍 shape 修复锁：沙箱被旧 shape 误杀的 6 条健康多钩子破冰·现词表全 false（不再误杀）—');
for (const h of SANDBOX_HEALTHY) {
  const w = hitsFirstTurnGuiltWord(h);
  const ok = !w; if (!ok) fail++;
  console.log(`${mark(ok)} 不误杀(词=${w})  "${h.replace(/\n/g, ' ⏎ ')}"`);
}

// ── 常规健康破冰带钩子(q=1) + 兜底模板 不误杀 ──
const HEALTHY = [
  '你来啦~||我是小溪||你今天过得咋样？',
  '嗨！我是小溪||你怎么找到我的呀？',
  '唔，你来了。||我是小溪。||你今天过得怎样？',
  buildFirstTurnFallback({ name: '小溪' }),
];
console.log('\n— 常规健康破冰(q=1) + 兜底模板 不误杀 —');
for (const h of HEALTHY) {
  const w = hitsFirstTurnGuiltWord(h);
  const ok = !w; if (!ok) fail++;
  console.log(`${mark(ok)} 不误杀(词=${w})  "${h.replace(/\|\|/g, ' | ')}"`);
}
const fb = buildFirstTurnFallback({ name: '小溪' });
const fbOK = !hitsFirstTurnGuiltWord(fb) && /咋样|怎样|过得/.test(fb);
if (!fbOK) fail++;
console.log(`${mark(fbOK)} 兜底模板健康+带钩子："${fb.replace(/\|\|/g, ' | ')}"`);

// ── first_turn_smoke 6 项不回归（buildFirstTurnHint 加禁句后原 6 项仍过） ──
const h = buildFirstTurnHint({ name: '溪语' });
console.log('\n— first_turn_smoke 6 项不回归 —');
const checks = [
  ['含"第一次聊天·破冰"标记', h.includes('第一次聊天') && h.includes('破冰')],
  ['带出角色名', h.includes('溪语')],
  ['给好接的话题钩子', h.includes('怎么找到') || h.includes('叫什么') || h.includes('今天过得')],
  ['留"还想再聊"的尾巴', h.includes('还想再聊') || h.includes('想多聊')],
  ['按人设调制(高冷别硬热情)', h.includes('高冷') && h.includes('人设')],
  ['开黄腔→先守边界再引正', h.includes('守住边界') && h.includes('引正')],
  ['空 companion 不崩', typeof buildFirstTurnHint({}) === 'string' && buildFirstTurnHint(null).length > 0],
];
for (const [n, c] of checks) { if (!c) fail++; console.log(`${mark(c)} ${n}`); }

console.log(fail ? `\n✗ FAIL ${fail}` : '\n✓ ALL PASS');
process.exit(fail ? 1 : 0);
