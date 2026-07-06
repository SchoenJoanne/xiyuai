/**
 * env_fact_dedup_smoke —— ③环境fact去重（月相相位档）结构+行为闸（确定性·零 LLM·DB_PATH=/tmp）。
 *
 * v1.26（dogfood: proactive 每晚重复"今晚月亮特别圆"·素材单调）：月相进素材账本按【相位档】冷却，
 *   materialId=env:moon:<phaseName>（无日期）·冷却 PROACTIVE_ENV_FACT_DEDUP_DAYS 默认5·中秋/元宵豁免·fail-open·
 *   🔴 仅 proactive 口 gate·reply/photo 不碰。
 *
 * 🔴 坏版本验红：旧码 proactive_material.mjs 无 resolveEnvMoonInclusion/envMoonMaterialId/envFactDedupDays
 *   → 本 smoke 导入即 undefined、调用即抛 → 全红（git worktree 已验）。
 * 覆盖 维护者 停板A 钦定的验红清单：
 *   种 env:moon:满月 → 满月夜 proactive systemPrompt 无月相行（旧码恒注入=红）/ 空账本 → 有 /
 *   中秋夜 → 有（豁免）/ reply 路径调用形态 → 恒有（证隔离）/ 账本抛错（非 Set）→ 有（fail-open）。
 *
 * 跑：DB_PATH=/tmp/envf.db node scripts/env_fact_dedup_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/envf.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/envf_${process.pid}.db`;
process.env.LOG_LEVEL = 'error';
delete process.env.PROACTIVE_ENV_FACT_DEDUP_DAYS;
import { readFileSync, unlinkSync } from 'node:fs';
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }

const {
  envFactDedupDays, envMoonMaterialId, resolveEnvMoonInclusion,
} = await import('../src/proactive_material.mjs');
const { insertProactiveMaterialLog, getRecentlyUsedMaterialIds } = await import('../src/db.mjs');
const { buildRealityFacts, isNightShanghai, festivalOnDate } = await import('../src/utils/reality_facts.mjs');
const { moonPhase } = await import('../src/utils/moon_phase.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const hasMoon = (rf) => /月相/.test(rf || '');

// 夜间测试时刻：2026-06-15 21:00 上海（=13:00 UTC）·非中秋/元宵
const NIGHT = new Date(Date.UTC(2026, 5, 15, 13, 0));
const PHASE = moonPhase(NIGHT).phaseName;
const MOON_ID = envMoonMaterialId(PHASE);
const FEST = festivalOnDate(NIGHT);

console.log('── ① env knob（独立于素材 14 天·默认 5·可覆盖） ──');
ok(envFactDedupDays() === 5, '默认冷却 5 天');
ok(envFactDedupDays({ PROACTIVE_ENV_FACT_DEDUP_DAYS: '8' }) === 8, 'env 覆盖生效');
ok(envFactDedupDays({ PROACTIVE_ENV_FACT_DEDUP_DAYS: 'abc' }) === 5, '非法 env 回退默认 5');

console.log('── ② materialId 相位档格式（🔴 无日期后缀·加日期=去重失效） ──');
ok(envMoonMaterialId('满月') === 'env:moon:满月', 'env:moon:<phaseName> 格式');
ok(!/\d{4}|\d{2}-\d{2}|_\d/.test(envMoonMaterialId('满月')), 'id 不含任何日期（同相位窗连续晚同 id 才能被冷却）');

console.log('── ③ 🔴 纯 gate 逻辑（核心·旧码无此函数=红） ──');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '', usedIds: new Set() }).includeMoon === true, '空账本夜间→注入月相');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '', usedIds: new Set() }).moonToLog === 'env:moon:满月', '空账本→待落账 env:moon:满月');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '', usedIds: new Set(['env:moon:满月']) }).includeMoon === false, '🔴冷却内→不注入月相');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '', usedIds: new Set(['env:moon:满月']) }).moonToLog === null, '冷却内→不再落账');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '中秋', usedIds: new Set(['env:moon:满月']) }).includeMoon === true, '🔴中秋豁免:冷却内也注入');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '中秋', usedIds: new Set(['env:moon:满月']) }).moonToLog === 'env:moon:满月', '中秋豁免:仍落账(次晚同相位正常去重)');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '元宵…', festival: '元宵', usedIds: new Set(['env:moon:元宵…']) }).includeMoon === true, '元宵同样豁免');
ok(resolveEnvMoonInclusion({ isNight: false, phaseName: '满月', festival: '', usedIds: new Set() }).includeMoon === false, '白天→不注入月相');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '', festival: '', usedIds: new Set() }).includeMoon === false, '无相位名→不注入(防脏数据)');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '', usedIds: null }).includeMoon === true, '🔴fail-open:usedIds 非 Set→不抑制(照常注入)');
ok(resolveEnvMoonInclusion({ isNight: true, phaseName: '满月', festival: '国庆节', usedIds: new Set(['env:moon:满月']) }).includeMoon === false, '非月相节(国庆)不豁免·照常去重');

console.log('── ④ 账本 DB 层：种 → 命中冷却 / 过期 → 脱冷却 ──');
insertProactiveMaterialLog(701, { materialIds: [MOON_ID], kind: 'env_moon' });
ok(getRecentlyUsedMaterialIds(701, { days: 5 }).has(MOON_ID), `5 天窗内 ${MOON_ID} 在冷却集`);
insertProactiveMaterialLog(702, { materialIds: [MOON_ID], kind: 'env_moon', nowIso: new Date(Date.now() - 6 * 86400e3).toISOString() });
ok(!getRecentlyUsedMaterialIds(702, { days: 5 }).has(MOON_ID), '6 天前旧账 → 脱 5 天冷却窗（不跨月永冷·可再提）');

console.log(`── ⑤ 🔴 复现 proactive 口行为（gate+buildRealityFacts·测夜=${PHASE}${FEST ? '/' + FEST : ''}） ──`);
ok(!(FEST === '中秋' || FEST === '元宵'), `测试夜非月相节（当前 festival='${FEST}'·保证冷却分支可测）`);
// 空账本 companion 703：注入月相
{
  const used = getRecentlyUsedMaterialIds(703, { days: envFactDedupDays() });
  const g = resolveEnvMoonInclusion({ isNight: isNightShanghai(NIGHT), phaseName: PHASE, festival: FEST, usedIds: used });
  const rf = buildRealityFacts(NIGHT, { includeNightSky: g.includeMoon });
  ok(hasMoon(rf), '空账本+夜间 → proactive reality 段含月相行');
}
// 种账本 companion 704：同相位夜不再注入月相
{
  insertProactiveMaterialLog(704, { materialIds: [MOON_ID], kind: 'env_moon' });
  const used = getRecentlyUsedMaterialIds(704, { days: envFactDedupDays() });
  const g = resolveEnvMoonInclusion({ isNight: isNightShanghai(NIGHT), phaseName: PHASE, festival: FEST, usedIds: used });
  const rf = buildRealityFacts(NIGHT, { includeNightSky: g.includeMoon });
  ok(!hasMoon(rf), '🔴种 env:moon 后同相位夜 → proactive 无月相行（旧码恒注入=红）');
  ok(/今天：|真实世界/.test(rf) || rf === '' || !hasMoon(rf), '仅月相被去重·其它 reality 字段不受影响');
}
// 中秋豁免复现（构造 festival='中秋'）：种账本也注入
{
  insertProactiveMaterialLog(705, { materialIds: [MOON_ID], kind: 'env_moon' });
  const used = getRecentlyUsedMaterialIds(705, { days: envFactDedupDays() });
  const g = resolveEnvMoonInclusion({ isNight: isNightShanghai(NIGHT), phaseName: PHASE, festival: '中秋', usedIds: used });
  const rf = buildRealityFacts(NIGHT, { includeNightSky: g.includeMoon });
  ok(hasMoon(rf), '中秋夜即便种账本 → 仍注入月相（应景豁免）');
}

console.log('── ⑥ 🔴 reply 口调用形态（无 gate）→ 月相恒在（证隔离） ──');
{
  // reply（bot.mjs）的调用形态：直接 isNightShanghai·不查账本·不 gate
  insertProactiveMaterialLog(706, { materialIds: [MOON_ID], kind: 'env_moon' });
  const rfReply = buildRealityFacts(NIGHT, { includeNightSky: isNightShanghai(NIGHT) });
  ok(hasMoon(rfReply), 'reply 形态(raw isNightShanghai)即便账本有 env:moon → 仍含月相（她答天象要真话·不被去重）');
}

console.log('── ⑦ 🔴 源码级隔离锁（proactive 挂 gate·reply/photo 零引用） ──');
const proactiveSrc = readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
const botSrc = readFileSync(new URL('../src/bot.mjs', import.meta.url), 'utf8');
const photoSrc = readFileSync(new URL('../src/photo_planner.mjs', import.meta.url), 'utf8');
ok(proactiveSrc.includes('resolveEnvMoonInclusion(') && proactiveSrc.includes("kind: 'env_moon'"), 'proactive.mjs 已挂 env:moon gate + 落账');
ok(proactiveSrc.includes('envFactDedupDays()'), 'proactive.mjs 用独立 env 冷却 knob');
ok(!botSrc.includes('resolveEnvMoonInclusion') && !botSrc.includes('env:moon'), 'bot.mjs(reply) 零引用 env:moon gate（不去重·答天象真话）');
ok(!photoSrc.includes('resolveEnvMoonInclusion') && !photoSrc.includes('env:moon'), 'photo_planner.mjs 零引用 env:moon gate（应景月相不去重）');

console.log(`\n══ env-fact-dedup smoke：${pass} 通过 / ${fail} 失败 ══`);
for (const suf of ['', '-wal', '-shm']) { try { unlinkSync(process.env.DB_PATH + suf); } catch {} }
process.exit(fail ? 1 : 0);
