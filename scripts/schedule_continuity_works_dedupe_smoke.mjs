#!/usr/bin/env node
/**
 * schedule_continuity_works_dedupe_smoke —— 日程生成 P1（continuity/works 双重注入打架）修复 坏版本验红。
 *   确定性·无 LLM·DB_PATH=/tmp·合成名（绝不碰生产）。
 *
 * P1：每日 00:30 生成 daily_schedule 的 prompt 里，两个事实源对同一部作品各报一套进度——
 *   continuity（昨日生活线·plan_tasks.mjs）喂"昨天追《X》到第7集"（旧集数），
 *   worksScheduleHint（作品档案·current_works.mjs）喂"在追《X》（追到第8集）"（档案新集数）。
 *   LLM 在 temp=0.1 下收到两套数字 → 进度漂移/自相矛盾，且削弱了 works 作为"进度单一事实源"的防漂移初衷。
 *
 * 修（方案A·只动注入逻辑·不动日程生成结构）：
 *   作品进度【单一权威源=works】。continuity 注入前 filterContinuityThreadsByWorks() 过滤掉与 active works
 *   标题重名的昨日条目——作品类延续归 works 独家，continuity 只承接"非作品类"生活事件（去图书馆/和朋友吃饭…）。
 *   🔴 冻结存量未成年(age<18)：filter 内部直接放行不过滤·运行时 byte-identical。
 *
 * 🔴 红基线：本 smoke 在【旧版本】必失败——
 *   ① 旧版无 filterContinuityThreadsByWorks → import 即 crash（红）；
 *   ② 即便 filter 被改成 no-op（返回全部），block ① 的"修后单一口径"断言会失败（continuity 仍含旧集数=红）。
 *   验证方式：git stash 改动后跑本 smoke 应 🔴 红（见对应 PR）。
 *
 * 跑：DB_PATH=/tmp/sched.db node scripts/schedule_continuity_works_dedupe_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/sched.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/sched_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { filterContinuityThreadsByWorks } = await import('../src/plan_tasks.mjs');
const { buildScheduleWorksHint } = await import('../src/current_works.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);

// 一部 active 作品（档案权威进度=第8集）。works 渲染 hint 用真实 buildScheduleWorksHint（不模拟）。
const WORKS = [{ title: '间谍过家家', kind: 'anime', verify_status: 'verified', progress_note: '追到第8集' }];
const WORKS_HINT = buildScheduleWorksHint(WORKS);
// 昨日 daily_schedule 的 importance≥5 活动串（continuity 的原料）：含"追《间谍过家家》到第7集"旧集数 + 非作品事件。
const Y_THREADS = ['晚上追《间谍过家家》到第7集', '和闺蜜逛街吃火锅', '帮室友改简历到很晚', '去图书馆借了两本书'];

console.log('── ① 🔴 复现双锚红基线 + 修后单一口径（real buildScheduleWorksHint + filter）──');
{
  ok(WORKS_HINT.includes('第8集') && WORKS_HINT.includes('间谍过家家'),
    `works 档案 hint 报"第8集"（权威源·实测含=${WORKS_HINT.includes('第8集')}）`);
  // 修前（不过滤·旧行为）：continuity + works 拼起来同时含 第7集 与 第8集 = 双锚打架（证 bug 真实存在）
  const blobBefore = Y_THREADS.join('；') + WORKS_HINT;
  ok(blobBefore.includes('第7集') && blobBefore.includes('第8集'),
    '修前：日程 prompt 同时含【第7集(continuity)】与【第8集(works)】= 双锚矛盾（旧行为）');
  // 修后（filter·成年）：continuity 去掉作品重名条目
  const r = filterContinuityThreadsByWorks(Y_THREADS, WORKS, { age: 22 });
  ok(r.dropped.includes('晚上追《间谍过家家》到第7集'), '修后：追《间谍过家家》第7集条目被 filter 丢弃（dropped）');
  ok(!r.kept.some((t) => t.includes('间谍过家家')), '修后：continuity 不再出现"间谍过家家"（作品归 works 独家）');
  const blobAfter = r.kept.join('；') + WORKS_HINT;
  ok(!blobAfter.includes('第7集') && blobAfter.includes('第8集'),
    '🔴 修后：日程 prompt 单一口径——只剩 works 的"第8集"，旧"第7集"消失');
}

console.log('── ② 🔴 不误伤：非作品类生活事件原样保留，只过滤作品重名 ──');
{
  const r = filterContinuityThreadsByWorks(Y_THREADS, WORKS, { age: 22 });
  for (const ev of ['和闺蜜逛街吃火锅', '帮室友改简历到很晚', '去图书馆借了两本书']) {
    ok(r.kept.includes(ev), `非作品事件保留：「${ev}」`);
  }
  ok(r.kept.length === 3 && r.dropped.length === 1, `只过滤 1 条作品重名（kept=${r.kept.length} dropped=${r.dropped.length}）`);
  // 全是非作品事件 → 一条不丢
  const pureLife = ['早上跑步', '中午和同事吃工作餐', '晚上看了场画展'];
  const r2 = filterContinuityThreadsByWorks(pureLife, WORKS, { age: 22 });
  ok(eqArr(r2.kept, pureLife) && r2.dropped.length === 0, '纯生活事件（无作品名）：一条不丢·dropped 空');
}

console.log('── ③ 🔴 日程质量不降：正常 companion（无重名冲突）byte-identical ──');
{
  // works 为空 → 不过滤（worksHint 也空·原行为）
  const rEmpty = filterContinuityThreadsByWorks(Y_THREADS, [], { age: 22 });
  ok(eqArr(rEmpty.kept, Y_THREADS) && rEmpty.dropped.length === 0, 'works 为空 → kept 原样（零误伤）');
  // 有 works 但昨日无任何重名 → kept 原样
  const noOverlap = ['报名了瑜伽课', '修好了自行车', '给家里打电话'];
  const rNo = filterContinuityThreadsByWorks(noOverlap, WORKS, { age: 22 });
  ok(eqArr(rNo.kept, noOverlap) && rNo.dropped.length === 0, '有 works 但昨日无重名 → kept 原样（正常 companion 不变）');
  // 空/异常输入稳健
  ok(eqArr(filterContinuityThreadsByWorks([], WORKS, { age: 22 }).kept, []), '空 threads → 空（稳健）');
  ok(eqArr(filterContinuityThreadsByWorks(null, WORKS, { age: 22 }).kept, []), 'null threads → 空（稳健·不抛）');
}

console.log('── ④ 🔴 冻结存量未成年(age<18) 排除：不过滤·byte-identical ──');
{
  const rMinor = filterContinuityThreadsByWorks(Y_THREADS, WORKS, { age: 16 });
  ok(eqArr(rMinor.kept, Y_THREADS) && rMinor.dropped.length === 0 && rMinor.skipped === 'minor',
    `age=16 → 不过滤（kept 原样含"间谍过家家"·skipped=minor）`);
  ok(filterContinuityThreadsByWorks(Y_THREADS, WORKS, { age: 16 }).kept.some((t) => t.includes('间谍过家家')),
    '🔴 冻结存量未成年 continuity 保持原行为（作品条目仍在·绝不改其运行时表现）');
  // 成年同输入会过滤——对照证明 age 门槛真实生效（非摆设）
  ok(!filterContinuityThreadsByWorks(Y_THREADS, WORKS, { age: 18 }).kept.some((t) => t.includes('间谍过家家')),
    '对照：age=18 同输入会过滤（证 age<18 门槛真实生效）');
}

console.log('── ⑤ 边界稳健：1 字标题不过度匹配 / 多作品 / 题材名(generic) ──');
{
  // 1 字标题（异常数据）→ 不参与匹配（防"我很活泼"被某 1 字标题误删）
  const rShort = filterContinuityThreadsByWorks(['今天很开心', '看了部电影'], [{ title: '开' }], { age: 22 });
  ok(eqArr(rShort.kept, ['今天很开心', '看了部电影']), '1 字标题"开"被忽略（len<2 不匹配·防过度删除）');
  // 多作品：各自命中各自过滤
  const multi = [{ title: '间谍过家家', kind: 'anime' }, { title: '活着', kind: 'book' }];
  const rMulti = filterContinuityThreadsByWorks(['追《间谍过家家》', '读《活着》到一半', '和朋友爬山'], multi, { age: 22 });
  ok(eqArr(rMulti.kept, ['和朋友爬山']) && rMulti.dropped.length === 2, '多作品：两条作品类均被过滤·生活事件留');
  // generic（题材名作 title）也归 works：昨日"看推理小说"被过滤
  const rGen = filterContinuityThreadsByWorks(['睡前看推理小说', '整理了书桌'], [{ title: '推理小说', verify_status: 'generic' }], { age: 22 });
  ok(rGen.kept.includes('整理了书桌') && rGen.dropped.includes('睡前看推理小说'), 'generic 题材名重名也归 works 过滤');
}

console.log(`\n══ schedule continuity/works dedupe smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
