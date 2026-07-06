#!/usr/bin/env node
/**
 * skill_kind_smoke —— current_works 加 skill(学技能) 品类 Step1 坏版本验红（确定性·DB_PATH=/tmp）。
 *
 * 🔴 挫折选 A（不显式提·progress 纯成就·真实感靠"刚开始学还手忙脚乱"早期 stage）。灰度闸 WORKS_SKILL 默认关。
 * 8 块：①单调推进不回退 ②挫折非 state 不博同情 ③免验不虚构 ④和 craft 不混 ⑤不额外加槽 ⑥gen 自我导向
 *      ⑦归档召回 ⑧🔴不碰现有 5 品类/灰度闸关零变更/不碰社交圈
 *
 * 跑：DB_PATH=/tmp/skill.db node scripts/skill_kind_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/skill.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/skill_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
const fs = await import('node:fs');
const {
  worksConfig, isSkillKindOn, requiresVerification, lifecycleDays, progressStageNote,
  buildWorksPromptHint, buildScheduleWorksHint, buildWorkArchiveMemory, buildWorkGenPrompt,
} = await import('../src/current_works.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const src = () => fs.readFileSync(new URL('../src/current_works.mjs', import.meta.url), 'utf8');
const COMPLAIN_RE = /想放弃|好累|太累|撑不住|安慰我|鼓励我|陪陪我|别嫌我|求.*抱抱|好难.*要不/;

console.log('── ① 单调推进不回退（ratio↑→stage idx 单调非降）──');
const idxOf = (r) => ['刚开始学还手忙脚乱', '慢慢摸到点门道', '练得有模有样了', '已经挺像样了'].indexOf(progressStageNote('skill', r));
const seq = [0, 0.1, 0.19, 0.2, 0.49, 0.5, 0.79, 0.8, 0.99, 1].map(idxOf);
ok(seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[0] === 0 && seq[seq.length - 1] === 3, `🔴 skill 进度单调升不回退：${seq.join('')}`);
ok(lifecycleDays('skill', new Date('2026-06-01').toISOString()) >= 30 && lifecycleDays('skill', new Date('2026-06-01').toISOString()) <= 60, '🔴 skill lifecycleDays ∈ [30,60]（比 book/craft 长）');

console.log('── ② 🔴 挫折非 state 不博同情（progress 纯成就·gen 不提挫折）──');
ok(['刚开始学还手忙脚乱', '慢慢摸到点门道', '练得有模有样了', '已经挺像样了'].every(s => !COMPLAIN_RE.test(s)), '🔴 skill 4 阶段文案无抱怨/求安慰词');
ok(!/挫折|想放弃|好累|瓶颈|求.*安慰|诉苦/.test(src().slice(src().indexOf("skill:  ['刚开始学"), src().indexOf("skill:  ['刚开始学") + 120)), '🔴 PROGRESS_STAGES.skill 区无挫折/博同情措辞');
{ process.env.WORKS_SKILL = '1';
  const gp = buildWorkGenPrompt({ age: 22, personality_tags: '["文静"]' }).prompt;
  ok(!/挫折|想放弃|好累|求.*(安慰|鼓励)|诉苦|瓶颈/.test(gp), '🔴 gen prompt(skill on) 不引入挫折/博同情'); }

console.log('── ③ 免验不虚构（skill 不进 VERIFIABLE·零 webSearch）──');
ok(requiresVerification('skill', '吉他') === false, '🔴 requiresVerification(skill,吉他)=false→skip(免验·零 webSearch)');
ok(requiresVerification('book', '活着') === true, '对照：book 仍需验证(没误伤现有品类)');

console.log('── ④ 🔴 和 craft 不混（在学 vs 手上在·gen 区分）──');
const skillHint = buildWorksPromptHint([{ kind: 'skill', title: '吉他', verify_status: 'skip', progress_note: '练得有模有样了' }]);
ok(/在学吉他/.test(skillHint) && !/手上在吉他/.test(skillHint), '🔴 skill 渲染"在学吉他"(非"手上在吉他")');
ok(/手上在织围巾/.test(buildWorksPromptHint([{ kind: 'craft', title: '织围巾', verify_status: 'skip' }])), '对照：craft 仍"手上在织围巾"(没被 skill 抢)');
ok(/在学吉他/.test(buildScheduleWorksHint([{ kind: 'skill', title: '吉他', verify_status: 'skip' }])), '日程 hint skill 动词"在学"');
{ process.env.WORKS_SKILL = '1';
  ok(/持续在练的一种能力|不是做一件东西|和 craft/.test(buildWorkGenPrompt({ age: 22 }).prompt), '🔴 gen prompt 明确 skill=持续能力·非做一件东西(区分 craft)'); }

console.log('── ⑤ 不额外加槽（maxActive=2 不变）──');
ok(worksConfig().maxActive === 2, '🔴 maxActive=2(skill 和 book/craft 抢槽·不堆太满)');

console.log('── ⑥ gen 自我导向（不涉用户/不社交八卦）──');
{ process.env.WORKS_SKILL = '1';
  const gp = buildWorkGenPrompt({ age: 22 }).prompt;
  ok(/她自己学的|与当前聊天的人无关/.test(gp) && /不.*社交八卦|不是社交八卦/.test(gp), '🔴 gen prompt skill 自我导向(她自己学·不涉用户·不社交八卦)'); }

console.log('── ⑦ 归档召回（skill 完结归档成 event 记忆）──');
const arch = buildWorkArchiveMemory({ kind: 'skill', title: '吉他', verify_status: 'skip', progress_note: '能弹几首了' }, false);
ok(arch.memoryType === 'event' && /学了阵吉他/.test(arch.content), `🔴 skill 归档 event 记忆："${arch.content}"`);
ok(/学吉他学了半截放下了/.test(buildWorkArchiveMemory({ kind: 'skill', title: '吉他', verify_status: 'skip' }, true).content), 'skill dropped 归档"半截放下"(非"做了一半")');

console.log('── ⑧ 🔴 不碰现有 5 品类 / 灰度闸关零变更 / 不碰社交圈 ──');
ok(/在看《活着》/.test(buildWorksPromptHint([{ kind: 'book', title: '活着', verify_status: 'verified' }])), 'book 渲染没被 skill 改动');
ok(progressStageNote('craft', 0.5) === '做了一半了' && progressStageNote('book', 0.1) === '才翻开没几页', '现有品类 progress 文案不变');
// 灰度闸关：gen prompt 退回旧 kindEnum(无 skill)=零变更
delete process.env.WORKS_SKILL;
ok(isSkillKindOn() === false, 'setup：WORKS_SKILL 默认关');
const gpOff = buildWorkGenPrompt({ age: 22 }).prompt;
ok(/"kind":"book\|series\|anime\|game\|craft"/.test(gpOff) && !/skill/.test(gpOff), '🔴 闸关：gen prompt kindEnum 无 skill(字节一致旧行为·零 skill 生成)');
process.env.WORKS_SKILL = '1';
ok(/"kind":"book\|series\|anime\|game\|craft\|skill"/.test(buildWorkGenPrompt({ age: 22 }).prompt), '🔴 闸开：gen prompt kindEnum 含 skill');
ok(!/social_circle|buildSocialPromptHint|companion_social/.test(src()), '🔴 current_works.mjs 不碰社交圈(零 social import)');

try { for (const f of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* 尽力 */ }
console.log(`\n${fail === 0 ? '✅' : '🔴'} skill_kind 验红: ${pass}/${pass + fail} 通过·${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
