/**
 * d2_render_tier_smoke.mjs —— §14 记忆时间分层详略渲染（批D·件②·D2-2·确定性零 LLM）
 *
 * 验 design_D2 D2-2「近三月详细·越远越少」：buildSystemPrompt 的【你记得的关于他的片段】按 created_at 分层：
 *   ① ≤30 天：原文全文（含完整内容·无前缀）
 *   ② 31-90 天：一句化（截首句）+ 前缀「（有段时间了）」·首句后内容不出现
 *   ③ >90 天：仅大事(imp≥8‖locked)·前缀「（几个月前）」·非大事【不渲染】
 *   ④ >90 天大事上限 2 条（第 3 条大事不渲染）
 *   ⑤ 前缀内联 CI 字节锁（companion.mjs 源含精确前缀串·决议 297③）
 *
 * 🔴 坏版本红验：companion.mjs §14 去分层（回退 memories.map 全文）→ ②截断/③丢弃/④上限 全红。
 */
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '../src/companion.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const iso = (days) => new Date(Date.now() - days * 86400000).toISOString();
const baseC = { id: 1, name: '溪语', age: 22, relationship_stage: '恋人', affection_level: 70 };
const sysOf = (memories) => buildSystemPrompt(baseC, { memories, promptMode: 'reply' });

console.log('── ①②③ 三层渲染 ──');
{
  const sys = sysOf([
    { memory_type: 'event', content: '昨天一起吃了火锅特别开心还约了下次', importance: 5, created_at: iso(10) },   // ≤30 全文
    { memory_type: 'event', content: '爬山那次真开心。后面细节一大堆本该被一句化截断不出现', importance: 6, created_at: iso(60) }, // 31-90
    { memory_type: 'event', content: '我们第一次见面的纪念日那天', importance: 9, created_at: iso(100) },            // >90 major
    { memory_type: 'event', content: '随口提过想喝奶茶而已的小事', importance: 5, created_at: iso(100) },            // >90 非major→丢
  ]);
  ok(sys.includes('【你记得的关于他的片段】'), '段头在场');
  ok(sys.includes('昨天一起吃了火锅特别开心还约了下次'), '① ≤30 天原文全文（完整内容在场）');
  ok(sys.includes('（有段时间了）'), '② 31-90 天带「（有段时间了）」前缀');
  ok(sys.includes('（有段时间了）爬山那次真开心。'), '② 31-90 天一句化=截首句');
  ok(!sys.includes('后面细节一大堆'), '② 首句后内容被一句化丢弃（非全文）');
  ok(sys.includes('（几个月前）'), '③ >90 天大事带「（几个月前）」前缀');
  ok(sys.includes('（几个月前）我们第一次见面的纪念日那天'), '③ >90 大事(imp9)渲染');
  ok(!sys.includes('随口提过想喝奶茶'), '🔴③ >90 非大事(imp5)【不渲染】=越远越少');
}

console.log('── ④ >90 天大事上限 2 条 ──');
{
  const sys = sysOf([
    { memory_type: 'event', content: '大事甲纪念日', importance: 9, created_at: iso(100) },
    { memory_type: 'event', content: '大事乙搬家日', importance: 8, created_at: iso(120) },
    { memory_type: 'event', content: '大事丙表白日', importance: 9, created_at: iso(150) },
  ]);
  const farCount = (sys.match(/（几个月前）/g) || []).length;
  ok(farCount === 2, `④ >90 天大事只渲染 2 条（实得 ${farCount}）`);
  ok(sys.includes('大事甲') && sys.includes('大事乙') && !sys.includes('大事丙'), '④ 前 2 条大事入选·第 3 条不渲染');
}

console.log('── ⑤ 全>90非大事 → 段不渲染（空段防护） ──');
{
  const sys = sysOf([
    { memory_type: 'event', content: '很久前的琐事一', importance: 4, created_at: iso(200) },
    { memory_type: 'event', content: '很久前的琐事二', importance: 3, created_at: iso(300) },
  ]);
  ok(!sys.includes('【你记得的关于他的片段】'), '⑤ 全部 >90 非大事被丢 → 段整体不渲染（无空段）');
}

console.log('── ⑥ 无 created_at → fail-safe 当近期全文 ──');
{
  const sys = sysOf([{ memory_type: 'fact', content: '缺日期的记忆不该被误藏', importance: 6 }]);
  ok(sys.includes('缺日期的记忆不该被误藏') && !sys.includes('（有段时间了）'), '⑥ 无 created_at → 全文（不误藏·不加前缀）');
}

console.log('── ⑦ 前缀内联 CI 字节锁（companion.mjs 源含精确串·决议 297③） ──');
{
  const src = readFileSync(new URL('../src/companion.mjs', import.meta.url), 'utf8');
  ok(src.includes('（有段时间了）'), '⑦ 源含精确前缀「（有段时间了）」');
  ok(src.includes('（几个月前）'), '⑦ 源含精确前缀「（几个月前）」');
  ok(/MEM_FAR_MAJOR_CAP\s*=\s*2/.test(src), '⑦ >90 大事上限常量=2 在源');
}

console.log(`\n══ d2_render_tier smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
