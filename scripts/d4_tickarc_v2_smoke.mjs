/**
 * d4_tickarc_v2_smoke.mjs —— tickArcOnTimeV2 手术（批E·E3 Phase3B·neglect 阶梯退役·确定性零 LLM）
 *
 * ① V2 无 neglect：normal/hurt/cold 喂 dormant(neg=6) → 全 noop（不造 scar/cold/withdrawing）·Legacy 对照会升级
 * ② V2 保留 faded：hurt + 互动≥5 + sinceEvent≥72h → normal 'faded'（互动消化=事件性·非缺席）
 * ③ V2 保留 ops_clamp：withdrawing + maxState=normal → 'ops_clamp' → normal（保险丝对残留态生效）
 * ④ V2 safe_mode 封顶不破（faded 在 safeMode 下照走 normal）
 * ⑤ 🔴 静态锁：V2 函数体（剥注释后）零 neglectStage / NEGLECT_IDX / 独立 neg 读取（防手滑回渗）
 * ⑥ 分派 fork：闸 OFF → Legacy(dormant 升级)；闸 ON → V2(dormant noop)
 *
 * 🔴 坏版本红验：V2 回填 neglect 阶梯（hurt+neg≥4→cold）→ ①hurt 升级、⑤静态锁双红。
 */
process.env.EMOTION_ENGINE = '1';
process.env.EMOTION_ENGINE_WHITELIST = '*';
import { readFileSync } from 'node:fs';
import { tickArcOnTime, tickArcOnTimeV2, tickArcOnTimeLegacy } from '../src/relationship_arc.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const NOW = new Date('2026-07-05T12:00:00Z');
const base = (over) => ({ neglectStage: 'dormant', interactionsSinceEvent: 0, now: NOW, ...over });

console.log('── ① V2 无 neglect（dormant 不升级）──');
{
  ok(tickArcOnTimeV2(base({ state: 'normal' })).state === 'normal', '① V2 normal+dormant → 不造 scar');
  ok(tickArcOnTimeV2(base({ state: 'hurt' })).state === 'hurt', '① V2 hurt+dormant → 不升 cold');
  ok(tickArcOnTimeV2(base({ state: 'cold' })).state === 'cold', '① V2 cold+dormant → 不升 withdrawing');
  // Legacy 对照：同输入会升级（证明退役是真差异非空操作）
  ok(tickArcOnTimeLegacy(base({ state: 'hurt', neglectStage: 'withdrawn' })).state === 'cold',
     '① Legacy 对照 hurt+withdrawn → cold（退役面确实存在）');
  ok(tickArcOnTimeLegacy(base({ state: 'normal' })).state === 'normal_with_scar',
     '① Legacy 对照 normal+dormant → scar（V2 已砍此路）');
}

console.log('── ② V2 保留 faded（互动消化）──');
{
  const r = tickArcOnTimeV2(base({
    state: 'hurt', interactionsSinceEvent: 5,
    openEvent: { created_at: new Date(NOW.getTime() - 73 * 3600e3).toISOString() },
  }));
  ok(r.state === 'normal' && r.reason === 'faded', '② hurt+互动5+73h → faded normal（事件性出口保留）');
}

console.log('── ③ V2 保留 ops_clamp ──');
{
  const r = tickArcOnTimeV2(base({ state: 'withdrawing', maxState: 'normal' }));
  ok(r.state === 'normal' && r.reason === 'ops_clamp', '③ withdrawing+maxState=normal → ops_clamp（保险丝保留）');
}

console.log('── ④ V2 safe_mode 封顶不破 ──');
{
  const r = tickArcOnTimeV2(base({
    state: 'hurt', safeMode: true, interactionsSinceEvent: 5,
    openEvent: { created_at: new Date(NOW.getTime() - 73 * 3600e3).toISOString() },
  }));
  ok(r.state === 'normal', '④ safeMode 下 faded 照走 normal（封顶不误伤正常出口）');
}

console.log('── ⑤ 🔴 静态锁：V2 体零 neg 读取 ──');
{
  const src = readFileSync(new URL('../src/relationship_arc.mjs', import.meta.url), 'utf8');
  const sig = 'export function tickArcOnTimeV2(ctx = {}) {';
  const start = src.indexOf(sig);
  const end = src.indexOf('\n}\n', start);   // 顶层函数闭合 } 在行首
  let body = src.slice(start, end);
  // 剥注释（死文本≠真读取·同 Phase2b ⑤ 教训）：块注释 + 行注释
  body = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(end > start, '⑤ 定位到 V2 函数体');
  ok(!/neglectStage/.test(body), '🔴⑤ V2 体（剥注释）无 neglectStage 读取');
  ok(!/NEGLECT_IDX/.test(body), '🔴⑤ V2 体无 NEGLECT_IDX 读取');
  ok(!/\bneg\b/.test(body), '🔴⑤ V2 体无独立 neg 变量读取');
}

console.log('── ⑥ 分派 fork（闸控双路径）──');
{
  const ctx = base({ state: 'hurt', neglectStage: 'withdrawn', companionId: 9001 });
  process.env.EMOTION_ENGINE = '1';
  ok(tickArcOnTime(ctx).state === 'hurt', '⑥ 闸 ON → V2（hurt+withdrawn 不升级）');
  process.env.EMOTION_ENGINE = '0';
  ok(tickArcOnTime(ctx).state === 'cold', '⑥ 闸 OFF → Legacy（hurt+withdrawn → cold·字节一致）');
  process.env.EMOTION_ENGINE = '1';
}

console.log(`\n══ d4_tickarc_v2 smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
