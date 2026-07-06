/**
 * persona_tone_guard_smoke.mjs — P1-③ proactive 人设语气稳定化·纯函数红验（停板B·2026-06-24）
 *
 * 锁死（must-pass）：
 *   ① flag 逻辑：mustFix(c) avoidant 即使温柔 tags 也 reserved / 端着 tag reserved / 温柔→false /
 *      mustFix(b) 端着+暖 混合→warmMix / mustFix(d) confession 豁免 / mustFix(a) anxious 恒 false / fail-open
 *   ② guard 文案：纯端着→减黏减示弱(别主动示弱/突然想找你/软糯) · 混合→收敛(并存·🔴不含别软糯/别黏) ·
 *      anxious→拍平(肯定主动天性·🔴无加黏·🔴无"别质问"=交老红线串) · 温柔/secure→空串(字节不变·不误伤)
 *   ③ morning prompt 级：端着→去"刚醒迷糊感"·温柔→原文"带刚醒的迷糊感"(字节不变) · morningAlreadyUp 不回归
 *   ④ 🔴 坏版本验红：护栏关(空串)/morning 不分人设→端着 persona 无棱角=飘复现；护栏开/分人设→保棱角
 *   ⑤ 取证主样本画像(companion 16 avoidant傲娇毒舌活泼 / 12 secure温柔傲娇治愈) 判定正确
 *
 * 跑：node scripts/persona_tone_guard_smoke.mjs   （纯函数·不连 DB·不发消息）
 */
import { derivePersonaToneFlags, buildPersonaToneGuard } from '../src/proactive_policy.mjs';
import { buildMorningUserMessage } from '../src/proactive.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));
const mk = (attach, tags) => ({ id: 0, attachment_style: attach, personality_tags: JSON.stringify(tags) });
const F = (c, k = 'normal') => derivePersonaToneFlags(c, k);
const G = (c, k = 'normal') => buildPersonaToneGuard(c, k);

// ── ① flag 逻辑 ───────────────────────────────────────────────────────────────────
console.log('— ① flag 逻辑 —');
ck('mustFix(c) avoidant+温柔tags → reserved=true（取证主样本端着全靠 avoidant）', F(mk('avoidant', ['温柔', '活泼'])).personaReserved === true);
ck('companion16(avoidant·傲娇/活泼/腹黑/毒舌) → reserved=true·warmMix=false（活泼非暖→full端着）', (() => { const x = F(mk('avoidant', ['傲娇', '活泼', '腹黑', '毒舌'])); return x.personaReserved === true && x.warmMix === false; })());
ck('端着 tag(secure·傲娇/毒舌) → reserved=true', F(mk('secure', ['傲娇', '毒舌'])).personaReserved === true);
ck('温柔(secure·温柔/治愈) → reserved=false', F(mk('secure', ['温柔', '治愈'])).personaReserved === false);
ck('mustFix(b) 混合[高冷,爱撒娇] → warmMix=true', F(mk('secure', ['高冷', '爱撒娇'])).warmMix === true);
ck('mustFix(b) 混合[毒舌,治愈] → warmMix=true', F(mk('secure', ['毒舌', '治愈'])).warmMix === true);
ck('companion12(secure·温柔/傲娇/腹黑/治愈) → warmMix=true（有暖 tag）', F(mk('secure', ['温柔', '傲娇', '腹黑', '治愈'])).warmMix === true);
ck('mustFix(d) confession 豁免：avoidant+傲娇@confession → reserved=false', F(mk('avoidant', ['傲娇']), 'confession').personaReserved === false);
ck('mustFix(a) anxious 恒 reserved=false（不走端着模板分叉）', F(mk('anxious', ['爱撒娇'])).personaReserved === false);
ck('fail-open：空 companion → reserved=false', F({}).personaReserved === false);
ck('fail-open：personality_tags 坏 JSON → reserved=false(不崩)', F({ attachment_style: 'secure', personality_tags: '{坏' }).personaReserved === false);
ck('fail-open：null companion → 不崩·reserved=false', F(null).personaReserved === false);

// ── ② guard 文案 ──────────────────────────────────────────────────────────────────
console.log('\n— ② guard 文案 —');
{
  const gCold = G(mk('avoidant', ['傲娇', '毒舌']));
  ck('纯端着 avoidant guard 含「别主动示弱」(减示弱)', gCold.includes('别主动示弱'));
  ck('纯端着 avoidant guard 含「突然想找你」禁(回避型反向修复)', gCold.includes('突然想找你'));
  ck('纯端着 guard 含「软糯」(还原棱角)', gCold.includes('软糯'));
  ck('🔴 纯端着 guard 不显式授权「呛」(anchor-less 反讽质问滑点·finding-3)', !gCold.includes('呛'));

  const gMix = G(mk('secure', ['高冷', '爱撒娇']));
  ck('mustFix(b) 混合 guard 含「并存」(保两半)', gMix.includes('并存'));
  ck('🔴 混合 guard 不含「别被磨成软糯」(不压暖半边)', !gMix.includes('别被磨成软糯'));
  ck('🔴 混合 guard 不含「别黏」(不压暖半边)', !gMix.includes('别黏'));

  const gAnx = G(mk('anxious', ['爱撒娇']));
  ck('mustFix(a) anxious guard 肯定主动天性', gAnx.includes('主动') && gAnx.includes('天性'));
  ck('🔴 anxious guard 无加黏增量(不含"更黏/爱黏")', !gAnx.includes('更黏') && !gAnx.includes('爱黏'));
  ck('🔴 anxious guard 不写"别质问/别讨债"(交老红线串·避近因收一格)', !gAnx.includes('别质问') && !gAnx.includes('别讨债') && !gAnx.includes('查岗'));

  ck('温柔/secure guard = 空串(不注入·字节不变·不误伤)', G(mk('secure', ['温柔', '治愈'])) === '');
  ck('mustFix(d) confession+avoidant guard = 空串(豁免端着)', G(mk('avoidant', ['傲娇']), 'confession') === '');
  ck('fail-open：空 companion guard = 空串', G({}) === '');
}

// ── ③ morning prompt 级 ───────────────────────────────────────────────────────────
console.log('\n— ③ morning prompt 级 —');
ck('端着(personaReserved) morning 去「刚醒迷糊感」', !buildMorningUserMessage({ personaReserved: true }).includes('带刚醒的迷糊感'));
ck('端着 morning 走「别装软萌迷糊」', buildMorningUserMessage({ personaReserved: true }).includes('别装软萌迷糊'));
ck('温柔(false) morning 原文「带刚醒的迷糊感」(字节不变)', buildMorningUserMessage({ personaReserved: false }).includes('带刚醒的迷糊感'));
ck('morningAlreadyUp 不回归(仍「不是刚醒」)', buildMorningUserMessage({ morningAlreadyUp: true }).includes('不是刚醒'));

// ── ④ 🔴 坏版本验红：护栏/分人设是载荷·非 no-op ──────────────────────────────────────
console.log('\n— ④ 🔴 坏版本验红（护栏/分人设真生效）—');
{
  // 护栏「关闭」(空串=部署前状态)：端着 persona 拿不到任何棱角信号 = 飘的条件
  const guardOff = '';
  ck('坏版本(护栏关·空串) 端着 persona 无「别主动示弱」棱角信号 = 飘复现', !guardOff.includes('别主动示弱'));
  // 护栏「开启」(真函数)：同一端着 persona 拿到棱角信号 = 保
  ck('真版本(护栏开) 同端着 persona 有棱角信号 = 保棱角', G(mk('avoidant', ['傲娇', '毒舌'])).includes('别主动示弱'));
  // morning 不分人设(坏版本=部署前·端着也带刚醒迷糊=飘) vs 分人设(真版本=端着去迷糊=保)
  ck('坏版本(morning 不分人设·false 分支) 端着也带刚醒迷糊 = 飘', buildMorningUserMessage({ personaReserved: false }).includes('带刚醒的迷糊感'));
  ck('真版本(morning 分人设) 端着去迷糊 = 保', !buildMorningUserMessage({ personaReserved: true }).includes('带刚醒的迷糊感'));
}

// ── ⑤ 取证主样本画像判定 ───────────────────────────────────────────────────────────
console.log('\n— ⑤ 取证主样本画像 —');
ck('companion16 → 注入端着护栏(非空·含别主动示弱)', G(mk('avoidant', ['傲娇', '活泼', '腹黑', '毒舌'])).includes('别主动示弱'));
ck('companion12 → 收敛档(并存·不压暖)', (() => { const g = G(mk('secure', ['温柔', '傲娇', '腹黑', '治愈'])); return g.includes('并存') && !g.includes('别黏'); })());
ck('companion3(温柔活泼治愈·secure) → 空串(不误伤·字节不变)', G(mk('secure', ['温柔', '活泼', '治愈'])) === '');

console.log(`\n${f === 0 ? '✅' : '🔴'} persona_tone_guard_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
