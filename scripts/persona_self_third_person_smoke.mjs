/**
 * persona_self_third_person_smoke.mjs — self_third_person guard 去名字硬编码·纯函数红验
 *
 * 背景：persona_guard.mjs 的 self-third-person 检测（AI 用第三人称自称角色名，
 * 如"溪语觉得…"而非"我觉得…"）原先把角色名硬编码为「溪语」，对其他真实
 * companion（星禾/阿晚…）完全失灵。修复=按 companion.name 动态构造正则。
 * 同"绝不字面写死名字"族（D1 审① / 批B1 P4 §18 prompt 去硬编）。
 *
 * 锁死（must-pass）：
 *   ① 回归：名叫「溪语」仍被抓（不回退）
 *   ② 🔴 修复核心：名叫「星禾」「阿晚」说"<名>觉得…"必须被抓（修复前漏抓）
 *   ③ 全动词覆盖 + 只对角色【自己的】名生效（他人名/无动词不误伤）
 *   ④ 正则元字符转义：名叫"A.B"时"AxB觉得"不误伤、"A.B觉得"命中
 *   ⑤ fail-open：空/纯空白/缺 name → 不崩·不误报
 *   ⑥ sanitize 同步动态化："<名>觉得"→"我觉得"（含转义）
 *   ⑦ 🔴 坏版本验红：内嵌旧硬编码正则证明其对「星禾」漏抓、新检测命中
 *
 * 跑：node scripts/persona_self_third_person_smoke.mjs   （纯函数·不连 DB·不发消息）
 */
import { checkPersonaConsistency, sanitizeReplyByGuard } from '../src/persona_guard.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));

// checkPersonaConsistency(reply, { companion: { name } }) → reasons 含 self_third_person ?
const has3P = (reply, name) =>
  checkPersonaConsistency(reply, { companion: { name } }).reasons.includes('self_third_person');

// ── ① 回归：溪语仍被抓 ────────────────────────────────────────────────────────────
console.log('— ① 回归（溪语不回退）—');
ck('溪语「溪语觉得…」→ 抓', has3P('溪语觉得今天天气真好', '溪语'));
ck('溪语「溪语打算…」→ 抓', has3P('溪语打算晚点给你做饭', '溪语'));

// ── ② 🔴 修复核心：其他 companion 名也被抓（修复前漏抓）───────────────────────────
console.log('\n— ② 🔴 修复核心（非溪语角色也被抓）—');
ck('🔴 星禾「星禾觉得…」→ 抓（修复前漏抓）', has3P('星禾觉得今天很开心', '星禾'));
ck('🔴 阿晚「阿晚想…」→ 抓（修复前漏抓）', has3P('阿晚想和你一起看电影', '阿晚'));
ck('🔴 单字名「岚岚会…」→ 抓', has3P('岚会一直陪着你的', '岚'));

// ── ③ 全动词覆盖 + 只对【自己的】名生效 ─────────────────────────────────────────────
console.log('\n— ③ 动词覆盖 + 不误伤他人名/无动词 —');
for (const v of ['觉得', '认为', '想', '以为', '感到', '希望', '会', '要', '想要', '打算']) {
  ck(`星禾「星禾${v}…」→ 抓`, has3P(`星禾${v}怎样怎样`, '星禾'));
}
ck('星禾角色·文里出现「溪语觉得」（他人名）→ 不抓（非自称）', !has3P('溪语觉得你很好', '星禾'));
ck('星禾角色·「星禾是谁呀」（有名无自称动词）→ 不抓', !has3P('星禾是谁呀', '星禾'));
ck('星禾角色·「我觉得今天很好」（正确第一人称）→ 不抓', !has3P('我觉得今天很好', '星禾'));

// ── ④ 正则元字符转义（名含 . 等）─────────────────────────────────────────────────
console.log('\n— ④ 正则元字符转义 —');
ck('名"A.B"·「A.B觉得…」→ 抓（字面命中）', has3P('A.B觉得不错', 'A.B'));
ck('🔴 名"A.B"·「AxB觉得…」→ 不抓（. 被转义·非通配）', !has3P('AxB觉得不错', 'A.B'));

// ── ⑤ fail-open：空/纯空白/缺 name ─────────────────────────────────────────────────
console.log('\n— ⑤ fail-open（空名不崩不误报）—');
ck('空 name → 不崩·「觉得…」不误报', (() => { try { return !has3P('觉得今天很好', ''); } catch { return false; } })());
ck('纯空白 name → 不崩·不误报', (() => { try { return !has3P('  觉得  ', '   '); } catch { return false; } })());
ck('缺 name（companion={}）→ 不崩·reasons 无 self_third_person',
  (() => { try { return !checkPersonaConsistency('觉得', { companion: {} }).reasons.includes('self_third_person'); } catch { return false; } })());
ck('缺 companion（context={}）→ 不崩', (() => { try { checkPersonaConsistency('随便一句', {}); return true; } catch { return false; } })());

// ── ⑥ sanitize 同步动态化（含转义）─────────────────────────────────────────────────
console.log('\n— ⑥ sanitize 动态化 —');
ck('sanitize 星禾「星禾觉得开心」→「我觉得开心」', sanitizeReplyByGuard('星禾觉得开心', { companion: { name: '星禾' } }) === '我觉得开心');
ck('sanitize 溪语「溪语会等你」→「我会等你」', sanitizeReplyByGuard('溪语会等你', { companion: { name: '溪语' } }) === '我会等你');
ck('sanitize 名"A.B"·「AxB觉得」→ 不误改（. 转义）', sanitizeReplyByGuard('AxB觉得开心', { companion: { name: 'A.B' } }) === 'AxB觉得开心');
ck('sanitize 空名 → 不崩·原样', sanitizeReplyByGuard('觉得开心', { companion: { name: '' } }) === '觉得开心');

// ── ⑦ 🔴 坏版本验红：旧硬编码正则对「星禾」漏抓 vs 新检测命中 ──────────────────────────
console.log('\n— ⑦ 🔴 坏版本验红（旧硬编码漏抓·新动态命中）—');
{
  // 修复前的写死实现（照搬旧 SELF_THIRD_PERSON），内嵌以自证回归被此修复关闭：
  const OLD_HARDCODED = [/溪语觉得|溪语(?:认为|想|以为|感到|希望)/, /溪语(?:会|要|想要|打算)/];
  const oldCatches = (reply) => OLD_HARDCODED.some(re => re.test(reply));
  ck('坏版本(旧硬编码) 对「星禾觉得…」漏抓 = bug 复现', !oldCatches('星禾觉得今天很开心'));
  ck('真版本(动态) 对同句命中 = bug 已修', has3P('星禾觉得今天很开心', '星禾'));
  ck('两版本对「溪语觉得…」一致命中（修复不伤既有覆盖）', oldCatches('溪语觉得好') && has3P('溪语觉得好', '溪语'));
}

console.log(`\n${f === 0 ? '✅' : '🔴'} persona_self_third_person_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
