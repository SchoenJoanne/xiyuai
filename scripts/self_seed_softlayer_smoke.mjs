/**
 * self_seed_softlayer_smoke —— PR-3.2 C3 自有事实软常驻层红色验证。
 * 纯函数零真网络零 DB：buildSystemPrompt 零依赖纯函数 + selectSelfSeedSoftItems 纯转换。
 *
 * 治"乙"：开放问句（intent=none）C2 不召回 → 软常驻层让 seed 始终可见，她不凭空编。
 *
 * 红验（烧坏版本必须红）：
 *   ① reply prompt【含】软段（includeSelfSeedSoftLayer:true + items）
 *   ② 默认安全：不传 flag（proactive/playground/将来新路径）→【不含】软段（静态 + 运行时双钉）
 *   ③ null/坏 meta → selectSelfSeedSoftItems=[] → 软段不渲染
 *   ④ values-only meta → 软段子集过滤后 [] → 不渲染（不灌 values·防刻板）
 *   ⑤ 软/硬同源：软段 father/work content 与 seedMetaToFactItems 全集字节一致（不矛盾）
 */
import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '../src/companion.mjs';
import { seedMetaToFactItems, selectSelfSeedSoftItems } from '../src/character_seed.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

const baseC = { id: 1, name: '溪语', age: 21, relationship_stage: '恋人', affection_level: 70 };
const SOFT_HEADER = '【关于你自己';

// 模拟 commit B 生成的 meta（father 含职业 cue「开出租」→ family.father_occupation；work→profile.occupation）
const meta = {
  v: 1,
  character_core: { inner_summary: '嘴硬心软，最怕被忽略', trait_causes: [], formative_chain: '小时候爸爸常跑夜班不在家' },
  self_facts: {
    family: [{ who: '爸爸', detail: '开出租车跑夜班', influence_on_her: '懂事早' }],
    work: { what: '在咖啡馆做咖啡师', influence_on_her: '喜欢稳定的小日子' },
    growth: [],
  },
  values_core: {},
};

// ── 1. reply path：flag true + items → 含软段 + 真值在场 ──────────────────────
{
  const items = selectSelfSeedSoftItems(meta);
  const sys = buildSystemPrompt(baseC, { promptMode: 'reply', includeSelfSeedSoftLayer: true, selfSeedItems: items });
  ok(sys.includes(SOFT_HEADER), '① reply：includeSelfSeedSoftLayer:true → 含【关于你自己】软段');
  ok(sys.includes('开出租车跑夜班'), '① reply：父亲职业真值在场（治"你爸做什么的"开放问句）');
  ok(sys.includes('在咖啡馆做咖啡师'), '① reply：她自己职业真值在场');
  ok(sys.includes('别临时编') || sys.includes('别每次说不一样'), '① reply：★ 开放问句按真答不编 在场（治乙核心）');
  ok(sys.includes('聊到时自然说'), '① reply：软框架措辞（非 C2 硬 canonical）');
  ok(sys.indexOf(SOFT_HEADER) > sys.indexOf('你叫溪语'), '① 软段非头插（在核心身份之后）');
}

// ── 2. 默认安全：不传 flag → 不含软段（即便 items 漏传也不渲染=双保险）───────────
{
  const items = selectSelfSeedSoftItems(meta);
  const sysNoFlag = buildSystemPrompt(baseC, { promptMode: 'proactive' });                       // proactive 不传 → 默认 false
  ok(!sysNoFlag.includes(SOFT_HEADER), '② 默认安全：不传 includeSelfSeedSoftLayer → 不含软段');
  const sysItemsButNoFlag = buildSystemPrompt(baseC, { selfSeedItems: items });                  // 传了 items 但没开 flag
  ok(!sysItemsButNoFlag.includes(SOFT_HEADER), '② 双保险：有 items 但 flag 默认 false → 仍不渲染');
}

// ── 3. null/坏 meta → 子集 [] → 不渲染 ──────────────────────────────────────
{
  ok(selectSelfSeedSoftItems(null).length === 0, '③ null meta → 子集 []');
  ok(selectSelfSeedSoftItems('{坏 json').length === 0, '③ 坏 meta → 子集 []');
  const sys = buildSystemPrompt(baseC, { promptMode: 'reply', includeSelfSeedSoftLayer: true, selfSeedItems: selectSelfSeedSoftItems(null) });
  ok(!sys.includes(SOFT_HEADER), '③ null meta：reply 也不渲染（empty items 静默）');
}

// ── 4. values-only meta → 子集过滤后 [] → 不渲染（不灌 values/trait/growth·防刻板）──
{
  const valuesOnly = { v: 1, character_core: null, self_facts: null, values_core: { life_attitude: { text: '随性而活', derived_from: ['x'] } } };
  const soft = selectSelfSeedSoftItems(valuesOnly);
  ok(soft.length === 0, '④ values-only → 软子集 [](values.* 不在 SOFT_SLOTS)');
  // 反向佐证：全集确实产出了 values 项（证明是 SOFT_SLOTS 子集过滤掉的，不是 meta 本身空）
  ok(seedMetaToFactItems(valuesOnly).some(i => i.slot.startsWith('values.')), '④ 反证：全集有 values 项（被软子集刻意过滤）');
}

// ── 5. 软/硬同源：软段 father/work content 与全集字节一致 ─────────────────────
{
  const full = seedMetaToFactItems(meta);
  const soft = selectSelfSeedSoftItems(meta);
  const fFull = full.find(i => i.slot === 'family.father_occupation');
  const fSoft = soft.find(i => i.slot === 'family.father_occupation');
  ok(fFull && fSoft && fSoft.content === fFull.content, '⑤ 软硬同源：father content 字节一致');
  const wFull = full.find(i => i.slot === 'profile.occupation');
  const wSoft = soft.find(i => i.slot === 'profile.occupation');
  ok(wFull && wSoft && wSoft.content === wFull.content, '⑤ 软硬同源：work content 字节一致');
  // 软子集是全集真子集（不新增、不改写）
  ok(soft.every(s => full.some(f => f.slot === s.slot && f.content === s.content)), '⑤ 软子集 ⊆ 全集（不另造）');
}

// ── 6. 静态钉死（必改1 两 smoke）：reply 开软段 / proactive·playground 不开 ──────
{
  const botSrc = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
  const proSrc = readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
  const pgSrc  = readFileSync(new URL('../src/playground.mjs', import.meta.url), 'utf8');
  ok(/buildSystemPrompt\([^)]*includeSelfSeedSoftLayer:\s*true/s.test(botSrc), '⑥ bot.mjs：reply 显式 includeSelfSeedSoftLayer:true');
  ok(!/includeSelfSeedSoftLayer/.test(proSrc), '⑥ proactive.mjs：不传 includeSelfSeedSoftLayer（默认安全·软段不漏进 proactive）');
  ok(!/includeSelfSeedSoftLayer/.test(pgSrc), '⑥ playground.mjs：不传 includeSelfSeedSoftLayer（默认安全）');
}

console.log(`\nself_seed_softlayer_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
