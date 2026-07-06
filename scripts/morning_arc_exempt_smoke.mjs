/**
 * morning 免 arc-skip + 空兜底 红验（2026-06-22）：坏版本验红 + 蒙特卡洛 + 隔离锁 + 兜底模板 + 空检测。
 *
 * 🔴 背景：morning 是「她还在」的基本温暖·受伤/冷战态照发（语气由 buildArcToneDirective 收敛成安静早安），
 *    绝不被 arc 降频 skip 压成「消失」=越过矜持滑冷淡。仅 morning 免 arc 频率 skip；normal/away_probe
 *    的 arc 降频概率不变（away_probe 受伤时该受压）。arc skip 率（代码 rng()>X）：hurt 30%/cold 60%/withdrawing 85%。
 *
 * 运行：DB_PATH=/tmp/morning_arc_smoke.db node scripts/morning_arc_exempt_smoke.mjs
 */
import { getArcProactivePolicy } from '../src/relationship_arc_runtime.mjs';
import { createCompanion, setArcState, getCompanionById } from '../src/db.mjs';
import { morningFallbackByArc } from '../src/proactive.mjs';

if (!(process.env.DB_PATH || '').startsWith('/tmp/')) { console.error('🔴 DB_PATH 须为 /tmp（不碰生产）'); process.exit(1); }
let fail = 0; const mark = (ok) => (ok ? '✓' : '✗');

// ── seed：各 arc 态一个 secure companion ──
function seed(arc) {
  const id = createCompanion(`syn_${arc}_${Date.now()%1e6}`, `synbot_${arc}`, { name: `测试${arc}`, attachment_style: 'secure' });
  const cid = id?.id ?? id;
  setArcState(cid, arc);
  return getCompanionById(cid);
}
const C = { hurt: seed('hurt'), cold: seed('cold'), withdrawing: seed('withdrawing') };
const SKIP_RATE = { hurt: 0.30, cold: 0.60, withdrawing: 0.85 };   // 代码 rng()>0.7/0.4/0.15
const ALWAYS = () => 1.0;   // rng=1.0 → 任何 rng()>threshold 必 true（最坏情况·必 skip）

// ── ① 坏版本验红：同 rng=1.0·非 morning(旧待遇)被 arc skip 拦复现 → morning(开豁免)必过 ──
console.log('— ① 坏版本验红：rng=1.0 下 normal 被 arc skip 拦(复现) → morning 免拦必过 —');
for (const arc of ['hurt', 'cold', 'withdrawing']) {
  const normalSkipped  = getArcProactivePolicy(C[arc], 'normal',  ALWAYS).skip === true;   // 坏版本/复现
  const morningSkipped = getArcProactivePolicy(C[arc], 'morning', ALWAYS).skip === true;   // 开豁免
  const ok = normalSkipped && !morningSkipped; if (!ok) fail++;
  console.log(`${mark(ok)} ${arc.padEnd(11)} normal被skip拦=${normalSkipped}(复现bug) → morning免拦=${!morningSkipped}`);
}

// ── ① 蒙特卡洛 1000×：morning skip 恒 0%·对照 normal/away_probe 维持 arc 概率(隔离) ──
console.log('\n— ① 蒙特卡洛 1000×：morning_skip=0% · normal/away_probe 维持 arc skip 率 —');
const N = 1000;
const rate = (c, kind) => { let s = 0; for (let i = 0; i < N; i++) if (getArcProactivePolicy(c, kind).skip) s++; return s / N; };
for (const arc of ['hurt', 'cold', 'withdrawing']) {
  const m = rate(C[arc], 'morning'), n = rate(C[arc], 'normal'), a = rate(C[arc], 'away_probe');
  const exp = SKIP_RATE[arc];
  const ok = m === 0 && Math.abs(n - exp) < 0.07 && Math.abs(a - exp) < 0.07; if (!ok) fail++;
  console.log(`${mark(ok)} ${arc.padEnd(11)} morning=${(m*100).toFixed(0)}%(应0) · normal=${(n*100).toFixed(0)}% away_probe=${(a*100).toFixed(0)}%（应≈${exp*100}%）`);
}

// ── 隔离锁：morning 的 oliveBranch 恒 false（不碰/不消耗 olive 配额）──
console.log('\n— 隔离锁：morning arcPolicy.oliveBranch 恒 false（不消耗 olive 配额）—');
for (const arc of ['hurt', 'cold', 'withdrawing']) {
  const ob = getArcProactivePolicy(C[arc], 'morning').oliveBranch;
  const ok = ob === false; if (!ok) fail++;
  console.log(`${mark(ok)} ${arc.padEnd(11)} oliveBranch=${ob}`);
}

// ── ③b 兜底模板（确定性·真地板·定调锁定）──
console.log('\n— ③b 空兜底模板（定调锁）—');
for (const [arc, want] of [['hurt', '早安。今天也好好的。'], ['cold', '早安。'], ['withdrawing', '…早。'], ['normal', '早安~'], ['repairing', '早安~']]) {
  const got = morningFallbackByArc(arc); const ok = got === want; if (!ok) fail++;
  console.log(`${mark(ok)} ${arc.padEnd(11)} "${got}"`);
}

// ── ③b 空检测：去标点空白后=0 才兜·裸「早」/「…早~」保留(不抬假) ──
console.log('\n— ③b 空检测：纯空/标点→兜底 · 有字→保留 —');
const isEmpty = (s) => (s || '').replace(/[\s\p{P}~～]/gu, '').length === 0;
for (const s of ['', '   ', '…', '。。', '~', '～', '...']) { const ok = isEmpty(s) === true;  if (!ok) fail++; console.log(`${mark(ok)} 判空→兜底 "${s}"`); }
for (const s of ['早', '…早', '…早~', '早安', '早安😊', '嗯…早']) { const ok = isEmpty(s) === false; if (!ok) fail++; console.log(`${mark(ok)} 有字→保留 "${s}"`); }

console.log(fail ? `\n✗ FAIL ${fail}` : '\n✓ ALL PASS');
process.exit(fail ? 1 : 0);
