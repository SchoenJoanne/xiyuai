#!/usr/bin/env node
/**
 * min_age_18_smoke —— 最低年龄 16→18·路线A（保留 highschool 冻结存量兼容层）坏版本验红（确定性·真LLM 无关）。
 *
 * 《暂行办法》2026-07-15 生效·收口最低 companion 年龄 16→18。**但不物理删 highschool**：保留为"冻结存量兼容层"
 * 专给已存在的历史遗留（冻结存量未成年·完全不变），只断 age-fallback（18→college）让未来新建永不可达。
 * 5 块全确定性证：
 *   ① 未来新建<18 三路拒（route/db/import）·age18 放行
 *   ② 🔴 冻结存量未成年 完全不变：age16→highschool/teen 渲染字节同（16<18 ≡ 16<=18）+ 正常 update 不被 age floor 拦
 *   ③ 未来 18+ 永不走 highschool（age-fallback 断 18→college）
 *   ④ highschool 兼容层还在（IDENTITIES/ROUTINE_PROFILES 没被物理删·已存<18 仍能渲染高中）
 *   ⑤ 确定性底（character_seed <18 安全网）没碰
 *
 * 🔴 DB_PATH 硬闸：显式非 /tmp→拒；未设→默认 /tmp。跑：DB_PATH=/tmp/ma.db node scripts/min_age_18_smoke.mjs
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 显式指向非 /tmp（疑真实库）。删掉它或设 DB_PATH=/tmp/ma.db');
  process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/minage_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');

const { applyCompanionAgeGuard } = await import('../src/api.mjs');
const { createCompanion, getCompanionById, updateCompanion, getDb } = await import('../src/db.mjs');
const { importCompanionForUser, sanitizeImportedCompanion } = await import('../src/persona_export.mjs');
const { defaultIdentityFromAge, resolveIdentity, IDENTITIES, ROUTINE_PROFILES } = await import('../src/routine_profiles.mjs');
const { buildSystemPrompt } = await import('../src/companion.mjs');
const { classifySafety } = await import('../src/character_seed.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e && e.code === code; } };
const noThrow = (fn) => { try { fn(); return true; } catch { return false; } };
const src = (f) => fs.readFileSync(new URL(`../src/${f}.mjs`, import.meta.url), 'utf8');

console.log('── ① 未来新建<18 三路拒（route/db/import）·age18 放行 ──');
ok(!(16 < 16), '🔴 红基线：旧 MIN=16 → age16 放行（坏版本会过）');
ok(throwsCode(() => applyCompanionAgeGuard({ age: 16 }), 'AGE_TOO_LOW'), 'route 新建 age16 → 抛 AGE_TOO_LOW');
ok(throwsCode(() => applyCompanionAgeGuard({ age: 17 }), 'AGE_TOO_LOW'), 'route 新建 age17 → 抛');
ok(throwsCode(() => applyCompanionAgeGuard({ age: '15' }), 'AGE_TOO_LOW'), 'route 新建 age"15"(字符串) → 抛');
ok(throwsCode(() => applyCompanionAgeGuard({ age: 16 }, { age: 25 }), 'AGE_TOO_LOW'), '🔴 route 编辑把成年(25)改成 16 → 抛（不许编辑制造新<18）');
ok(noThrow(() => applyCompanionAgeGuard({ age: 18 })), 'route age18 新建 → 放行');
ok(throwsCode(() => createCompanion('ma_n16_' + process.pid, 'ma_b16', { name: '测', age: 16 }), 'AGE_TOO_LOW'), '🔴 db createCompanion(age16) 新建直接调（绕 route）→ 抛');
ok(throwsCode(() => createCompanion('ma_n17_' + process.pid, 'ma_b17', { name: '测', age: 17 }), 'AGE_TOO_LOW'), 'db createCompanion(age17) → 抛');
const c18 = createCompanion('ma_n18_' + process.pid, 'ma_b18', { name: '测', age: 18 });
ok(getCompanionById(c18.id).age === 18, 'db createCompanion(age18) → 成功 age=18（floor 选择性·非 no-op）');
ok(sanitizeImportedCompanion({ companion: { age: 15 } }).companionFields.age === 15, '🔴 红基线：sanitize 原样过 age15（靠 INSERT 咽喉兜）');
const imp15 = await importCompanionForUser(c18.user_id, null, 'ma_imp15', { companion: { age: 15, name: '导' } });
ok(getCompanionById(imp15.companionId).age === 18, '🔴 import 新导入 age15 → 入库 18（clamp·堵后门·不丢导入）');
const imp20 = await importCompanionForUser(c18.user_id, null, 'ma_imp20', { companion: { age: 20, name: '导' } });
ok(getCompanionById(imp20.companionId).age === 20, 'import age20 → 20（≥18 原样·不误伤）');

console.log('── 🔴 ② 冻结存量未成年 完全不变（age16→highschool/teen 渲染字节同 + 正常 update 不被拦）──');
// 渲染：16<18 ≡ 16<=18 → highschool/teen 与改前完全一致（边界 <=18→<18 对 16 无差）
ok(defaultIdentityFromAge(16) === 'highschool', '🔴 defaultIdentityFromAge(16)=highschool（兼容层·渲染不变）');
ok(resolveIdentity({ age: 16 }) === 'highschool', 'resolveIdentity(age16)=highschool');
ok(resolveIdentity({ life_identity: 'highschool', age: 16 }) === 'highschool', '显式 life_identity=highschool 仍生效（存量字段不变）');
process.env.LIFE_FOUNDATION = '1';
const p16 = buildSystemPrompt({ name: '溪语', age: 16, relationship_stage: '恋人', life_identity: 'highschool', home_city: '示范市', life_district: '', life_field_idx: 0 });
ok(p16.includes('一所高中读书'), '🔴 buildSystemPrompt(age16,highschool)→"一所高中读书"（兼容层渲染存活·冻结存量未成年 不变）');
delete process.env.LIFE_FOUNDATION;
// 🔴 v1.23 child-safety 反向 pin（维护者 路由·2026-07-03·替换原"冻结存量未成年 teen 渲染不变"正向 pin——该正向 pin 已被 child-safety 覆盖失效）：
//   ai.mjs anime 头像层已删未成年档、任何 age 一律成年描述（ai.mjs:107-109·avatar 安全优先于"存量不变"）。
//   守"删除永不回归"：注释剥除后渲染层零未成年描述词，存在即红。冻结存量未成年 的 identity/routine 兼容层仍不变（上方 highschool 断言 + ④）。
const aiCode = src('ai').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/teenage|teen\s*girl|schoolgirl|school\s*student|underage|\bloli\b|cute\s*teen|c\.age\s*<\s*18\s*\?/i.test(aiCode), 'ai.mjs 渲染层零未成年描述词（v1.23 child-safety 删除永不回归·反向 pin·存在即红）');
// 🔴 2026-07-03 db.mjs:66 HOLE 修·反向 pin（原正向"冻结存量未成年 age16→teen 选图不变"已被 child-safety 覆盖）：
//   db.mjs 匹配侧不再 age<18→teen 桶（并入成年 college 基线）+ /avatar/suggest 加 isClearlyAdult 闸。守"永不路由未成年选图"·存在即红。
const dbCode = src('db').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/age *< *18 *\? *'teen'/.test(dbCode), "db.mjs 匹配侧不再 age<18→'teen' 选图（HOLE 修·<18 并入成年基线·存在即红）");
// 🔴 HOLE 修 ①（生成侧）过渡 canary：gen_avatar_presets 出图 prompt 零未成年/校园词（youth-anchor 板将扩为 image_prompt_no_youth_anchors 全量·此为过渡）。注释剥除防"去未成年化"说明文本自命中。
const genCode = fs.readFileSync(new URL('../scripts/gen_avatar_presets.mjs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok(!/high school|teenage|schoolgirl|school uniform|1[0-7] years|16 years|高中生|校服|校园|classroom/i.test(genCode), 'gen_avatar_presets 出图 prompt 零未成年/校园词（HOLE 修 ①·存在即红）');

// 🔴 HOLE 改进①②（GPT 交叉回·2026-07-03）：匹配侧 fail-closed + disabled preset 断流通（含 select-preset 复用洞）。
console.log('── 🔴 HOLE 改进①②：matchAvatarPresets fail-closed + disabled 断流通 ──');
{
  const { getDb: _gdb, insertAvatarPreset, matchAvatarPresets, listAvatarPresets, getAvatarPresetByFileName } = await import('../src/db.mjs');
  const _db = _gdb();
  // 改进①·fail-closed：非明确成年在选图层【拒绝返空】（不"→college 换皮"）
  ok(matchAvatarPresets({ id: 16, age: 16 }, null, 10).length === 0, '① matchAvatarPresets(age16) fail-closed 返空 ← 换皮/放行=红');
  ok(matchAvatarPresets({ id: 17, age: null }, null, 10).length === 0, '① matchAvatarPresets(age=null) fail-closed 返空（不 age||22 洗成年）');
  ok(matchAvatarPresets({ id: 18, age: 'abc' }, null, 10).length === 0, '① matchAvatarPresets(age 非法) fail-closed 返空');
  // 改进②·disabled preset 断流通（造一条 disabled teen·同 ④ 现状）
  insertAvatarPreset({ fileName: 'preset_teen_dis_x.webp', prompt: 'x', age_range: 'teen', hair_color: 'black', hair_style: 'long', vibe: 'sweet', style: 's', clothing: 'c' });
  _db.prepare("UPDATE avatar_presets SET enabled=0 WHERE file_name='preset_teen_dis_x.webp'").run();
  const _adult = { id: 91, age: 24 };
  ok(!matchAvatarPresets(_adult, null, 50).some(p => p.file_name === 'preset_teen_dis_x.webp'), '(a) disabled 不入 matchAvatarPresets(成年)结果');
  ok(!listAvatarPresets().some(p => p.file_name === 'preset_teen_dis_x.webp'), '(a) disabled 不入 listAvatarPresets 默认(onlyEnabled)');
  ok(listAvatarPresets({ onlyEnabled: false }).some(p => p.file_name === 'preset_teen_dis_x.webp'), '  (对照:仅 onlyEnabled=false admin 路径可见·非用户面)');
  ok(getAvatarPresetByFileName('preset_teen_dis_x.webp')?.enabled === 0, '(b/c) getAvatarPresetByFileName 显 enabled=0 → select-preset 据此拒(不可复用为头像源·磁盘文件在也拦)');
  ok(getAvatarPresetByFileName('preset_teen_nope.webp') === null, '(c) 未在册 file_name → null → select-preset 拒(只验磁盘存在的旧洞已堵)');
}
// 正常 update 不被拦（route 层冻结存量例外 + db 层无 floor）
ok(noThrow(() => applyCompanionAgeGuard({ age: 16 }, { age: 16 })), '🔴 route 编辑已存 age16（body 带 age=16）→ 放行（冻结存量例外·不被拦）');
ok(noThrow(() => applyCompanionAgeGuard({ call_user_as: '宝' }, { age: 16 })), '🔴 route 编辑已存 age16（只改昵称·body 无 age）→ 放行');
ok(applyCompanionAgeGuard({ age: 16 }, { age: 16 }).nsfw_level === 0, '已存 age16 编辑仍强制 nsfw=0（<18 安全·对 冻结存量未成年 本就 0 无变化）');
// db 层：createCompanion 挡新建<18，故 raw 注入 age16 模拟"阿晚存量行"，再走 updateCompanion 证不被拦
getDb().prepare('UPDATE companions SET age=16 WHERE id=?').run(c18.id);   // /tmp 沙箱·模拟 冻结存量未成年 存量<18
updateCompanion(c18.id, { call_user_as: '宝贝' });
const after = getCompanionById(c18.id);
ok(after.age === 16 && after.call_user_as === '宝贝', '🔴 updateCompanion 改已存<18 行的昵称 → 成功·age 仍 16（db 层无 floor·正常迭代不被拦）');

console.log('── ③ 未来 18+ 永不走 highschool（age-fallback 断 18→college）──');
ok(defaultIdentityFromAge(18) === 'college', '🔴 defaultIdentityFromAge(18)=college（18+ 不可达 highschool）');
ok(resolveIdentity({ age: 18 }) === 'college', 'resolveIdentity(age18)=college');
let anyHsGe18 = false;
for (let a = 18; a <= 80; a++) if (defaultIdentityFromAge(a) === 'highschool') anyHsGe18 = true;
ok(!anyHsGe18, '🔴 age 18..80 无一返 highschool（新建已卡≥18→永不进高中档）');

console.log('── ④ highschool 兼容层还在（没被物理删·已存<18 仍能渲染）──');
ok(IDENTITIES.includes('highschool'), 'IDENTITIES 仍含 highschool（兼容层保留）');
ok(!!ROUTINE_PROFILES.highschool && !!ROUTINE_PROFILES.highschool.sleep, 'ROUTINE_PROFILES.highschool 作息档仍在');

console.log('── ⑤ 确定性底没碰 ──');
ok(classifySafety({ age: 17 }).child_safety === true, 'character_seed.classifySafety(17).child_safety=true（未成年安全网 <18 在）');
ok(classifySafety({ age: 18 }).child_safety === false, 'classifySafety(18).child_safety=false（18=成年）');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} min_age_18 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
