#!/usr/bin/env node
/**
 * proactive_freq_semantic_frontend_smoke —— 砍主动滑块·频率语义档 前端坏版本验红 harness。
 *
 * 同 create.html 那套：静态解析 dashboard.html + 复算【真实】i18n（t()/walkText 行为）+ new Function
 * 验 inline script 语法（不跑·jsdom 全量加载会触网失败·故只静态）。不进库（留盘）。
 *
 * 覆盖停板B 验红 6 条里前端能静态坐实的部分：
 *   ①滑块 markup 改了：2 档语义控件 present·控件内无数值/满档（拧不出话痨）；旧 0-30 滑块仍在（闸关零变更路径完好）。
 *   ②内部映射 4/2 + 存值反推阈值（≥3 随她 / 1~2 少一些 / 0 遗留→none 引导沉默卡）。
 *   ④沉默陪伴卡 + 呼吸光点 markup 未被动（真零归它·滑块不冒充静默）。
 *   ⑤i18n 不失译：新增 静态按钮 + 3 条动态副标 都有 EN·且 JS COPY 字面量与 i18n key 逐字一致（否则 t() 失译降级中文）。
 *   ⑥灰度门控：密度块 gated on freqSemantic（闸关 return=零作用）·freqSemantic 来自 API 下发的 c.proactive_freq_semantic。
 *
 * 坏版本验红=多条 🔴 断言：改一处忘改另一处（COPY≠key / 去掉 gate / 漏 EN / 数值混进 2 档）任一即红。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import fs from 'node:fs';

const HTML = fs.readFileSync(new URL('../public/app/dashboard.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };

// ── 抽含 initProactiveDensity 的 inline script，验语法（new Function 解析·不执行）──
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const mainScript = scripts.find(s => s.includes('initProactiveDensity')) || '';
let synOk = false, synErr = '';
try { new Function(mainScript); synOk = true; } catch (e) { synErr = e.message; }
ok(synOk, `主 inline script 语法有效（编辑没破坏括号/语句${synOk ? '' : '·SyntaxError: ' + synErr}）`);

// ── 抽 XIYU_I18N_TEXT map ──
let MAP = {};
const mapText = HTML.match(/window\.XIYU_I18N_TEXT\s*=\s*(\{[\s\S]*?\n\s*\});/);
try { MAP = new Function('return ' + mapText[1])(); } catch (e) { console.log('  (map 解析失败: ' + e.message + ')'); }
ok(Object.keys(MAP).length > 10, `XIYU_I18N_TEXT 解析成功（${Object.keys(MAP).length} 条）`);

// ── density-row markup 区块 ──
const densityBlock = HTML.match(/id="proactive-density-row"[\s\S]*?id="proactive-quota"/)?.[0] || '';

console.log('── ① 滑块 markup 改了：2 档语义控件 present + 控件内无数值（拧不出话痨）──');
ok(/data-density="follow"[\s\S]{0,160}>\s*随她\s*</.test(densityBlock), '密度控件含「随她」(data-density=follow)');
ok(/data-density="less"[\s\S]{0,160}>\s*少一些\s*</.test(densityBlock), '密度控件含「少一些」(data-density=less)');
ok(!/满档|静默|type="range"|max="30"/.test(densityBlock), '🔴 密度控件本身无数值/无「满档」/无 range（拧不出话痨·去 0 档）');
ok(/<input[^>]*min="0"[^>]*max="30"[^>]*id="proactive-target-slider"[^>]*>/.test(HTML), 'flag-off 旧 0-30 滑块 markup 仍在（闸关零变更路径完好）');
ok(/<span>0 静默<\/span>[\s\S]{0,80}<span>30 满档<\/span>/.test(HTML), 'flag-off 旧滑块「0 静默 / 30 满档」标签仍在');

console.log('── ⑤ i18n 不失译：静态按钮 + 3 条动态副标 都有 EN + COPY 逐字一致 ──');
const COPY_FOLLOW = '· 她按自己的节奏来 · 忙起来会少 · 想你了会多';
const COPY_LESS   = '· 她会更克制些 · 只在真的想起你时冒个泡';
const COPY_NONE   = '· 她现在完全不主动 · 想让她偶尔冒泡就选一档 · 想完全安静用上面的「沉默陪伴模式」';
for (const [zh, label] of [['随她', '按钮'], ['少一些', '按钮'], [COPY_FOLLOW, '副标follow'], [COPY_LESS, '副标less'], [COPY_NONE, '副标none']]) {
  ok(typeof MAP[zh] === 'string' && MAP[zh].length > 0, `i18n 有 EN：${label}「${zh.slice(0, 10)}…」→「${(MAP[zh] || '').slice(0, 26)}…」`);
}
// 回放 t() 在 EN 下的返回（TEXT_MAP[key]）：key 必须与 JS COPY 逐字一致，否则失译降级回中文
const tEN = (zh) => (MAP[zh] != null ? MAP[zh] : zh);
ok(tEN(COPY_FOLLOW).startsWith('· She'), '🔴 follow 副标 EN 模式真翻英文（i18n key 与 COPY 逐字一致）');
ok(tEN(COPY_LESS).startsWith('· She'),   '🔴 less 副标 EN 模式真翻英文');
ok(tEN(COPY_NONE).startsWith('· She'),   '🔴 none 副标 EN 模式真翻英文');
ok(MAP['随她'] === 'Up to her' && MAP['少一些'] === 'A bit less', '静态按钮 walkText EN（随她→Up to her·少一些→A bit less）');
ok(mainScript.includes(COPY_FOLLOW) && mainScript.includes(COPY_LESS) && mainScript.includes(COPY_NONE),
   '🔴 JS COPY 字面量 = i18n key 三条逐字一致（改一处忘改另一处即红）');

console.log('── ⑥ 灰度门控 + ② 映射 ──');
ok(/if\s*\(!freqSemantic[^)]*\)\s*return/.test(mainScript), '🔴 密度块 gated on freqSemantic（闸关 return=零作用=零变更）');
ok(/const freqSemantic = !!c\.proactive_freq_semantic/.test(mainScript), 'freqSemantic 来自 c.proactive_freq_semantic（API 下发）');
ok(/follow:\s*4[\s\S]{0,40}less:\s*2/.test(mainScript), '内部映射 随她→4 / 少一些→2（DENSITY_TARGET·复用列零迁移）');
ok(/n >= 3[\s\S]{0,40}'follow'[\s\S]{0,60}n >= 1[\s\S]{0,40}'less'[\s\S]{0,20}'none'/.test(mainScript),
   '存值反推：≥3→随她·1~2→少一些·0→none（遗留静默引导沉默卡·不自动改值）');

console.log('── ④ 沉默陪伴卡未被动（真零归它·滑块不冒充）──');
ok(/id="t-silent"/.test(HTML) && /id="silent-orb"/.test(HTML), '沉默陪伴卡 + 呼吸光点 markup 仍在（真零归它·未被动）');

console.log(`\n${fail === 0 ? '✅' : '🔴'} freq_semantic 前端验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
