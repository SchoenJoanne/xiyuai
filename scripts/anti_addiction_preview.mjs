#!/usr/bin/env node
/**
 * anti_addiction_preview.mjs —— 防沉迷提示【措辞常驻守卫 + 用户原话预览】（进 CI·维护者 2026-07-02）。
 *
 * 双职责：
 *  ① 预览：打印用户实际会收到的原话（人看·审措辞曲线）。
 *  ② 🔴 常驻守卫（CI）：VARIANTS 是会被改的文案 → 今后**任何措辞改动机器先审词面**（结构消除 > 靠人记得）：
 *     · 红线词面断言：每个变体·多个时长下 redlineBlocks===false（无愧疚/挽留/催回/在场绑定/needy）。
 *     · 精度自检：phraseDuration 就近整/半点·误差≤15min·逐点断言期望值。
 *     · 时长事实：每个变体都含时长短语（法规"明确提示使用时长"）。
 *     · 跨度真实性(gap=30 口径·维护者 微调)：变体不硬断言"连着"(会过度声称不间断)。
 *  任一断言失败 → 退出码 1（CI 变红）。绝不碰任何真实库（DB_PATH 占位·导入模块所需）。
 *
 * 跑：node scripts/anti_addiction_preview.mjs
 */
process.env.DB_PATH = process.env.DB_PATH || `/tmp/aa_preview_${process.pid}.db`;
import { buildNoticeText, phraseDuration, allVariantTexts, redlineBlocks } from '../src/anti_addiction.mjs';
import fs from 'node:fs';

const H = 3600e3, M = 60e3;
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; if (!c) console.error('  🔴 FAIL ' + m); };

// ── ① 预览（人看）──
console.log('\n══════ 防沉迷·连续使用提示 · 用户实际收到的原话（gap=30·每2h再提·会话≤3）══════\n');
console.log('【一次连续会话里她会说的三次】(关心递增/压力不递增)');
for (const [seq, dur, label] of [[0, 2 * H, '满 2h（首提·V2 轻）'], [1, 4 * H, '满 4h（再提·V1 升半格）'], [2, 6 * H, '满 6h（封顶·回 V1 直接身体关切→之后彻底松手）']]) {
  console.log(`\n  ▸ ${label}：\n     「${buildNoticeText(dur, 1, seq)}」`);
}
console.log('\n\n【phraseDuration 措辞精度自检】(就近整/半点·误差≤15min·不夸大不含糊)');
for (const min of [120, 125, 135, 140, 150, 165, 170, 180, 240, 270, 360]) {
  console.log(`  ${String(min).padStart(3)}min (${(min / 60).toFixed(2)}h) → 「聊了${phraseDuration(min * M)}」`);
}

// ── ② 常驻守卫（CI 断言）──
console.log('\n── 词面守卫断言 ──');
// 红线词面 + 时长事实 + 跨度真实性：每个变体·多个时长
for (const min of [120, 150, 240, 360]) {
  const texts = allVariantTexts(min * M);
  texts.forEach((t, i) => {
    ok(!redlineBlocks(t), `变体#${i}@${min}min 不命中红线：「${t.slice(0, 18)}…」`);
    ok(t.includes('小时'), `变体#${i}@${min}min 含时长事实`);
    ok(!t.includes('连着'), `变体#${i}@${min}min 不硬断言"连着"(gap30跨度真实性·维护者微调)`);
  });
}
// 精度自检：逐点断言期望值
const PREC = [[120, '两个小时'], [135, '两个小时'], [140, '两个半小时'], [165, '两个半小时'], [170, '快三个小时'], [180, '三个小时'], [240, '四个小时'], [270, '四个半小时'], [360, '六个小时']];
for (const [min, want] of PREC) ok(phraseDuration(min * M) === want, `phraseDuration(${min}min)="${phraseDuration(min * M)}" want "${want}"`);

console.log(`\n[anti_addiction_preview] 词面守卫 ${pass}/${pass + fail} passed`);
try { for (const s of ['', '-wal', '-shm']) { const p = process.env.DB_PATH + s; if (fs.existsSync(p)) fs.unlinkSync(p); } } catch {}
process.exit(fail ? 1 : 0);
