#!/usr/bin/env node
/**
 * content_no_fabrication_smoke —— ②凭空用户态·结构闸(确定性·无 LLM·DB_PATH=/tmp)。
 *
 * v1.25（dogfood: proactive/reply 凭空编用户即时态/习惯——"今天喝酒了没?"(从没提过喝酒)/"手边是不是还放着游戏
 *   手柄呢?"(凭空断定手边有啥)→用户觉得"她在瞎猜我"）：buildSystemPrompt 公共段追加「关心他，但别凭空编他此刻
 *   在干嘛」块，两路径(reply+proactive)通治：砍凭空断定用户即时态/习惯·放行不预设答案的开放关心。
 *
 * 🔴 本 smoke 是【结构闸】：断言块在 reply+proactive 两路径 system prompt 里、放行例句显式在(锁分寸)、没冲掉现有段。
 *   行为验证（关→复现凭空编手柄/喝酒·开→只基于对话·且开放关心仍能问）走【真 LLM A/B】(非确定性·不进本 smoke)。
 * 🔴🔴 放行清单锁(block③)：把"累不累/吃了没/在干嘛"这几句放行例句钉死——未来若有人把措辞写重、删掉放行清单
 *   (矫枉过正=她连关心都不敢问)，本 smoke 立刻红。这是②最怕的回归方向。
 * 🔴 红基线：stash 掉该 parts.push 块 → block①②③ 断言失败=红（git worktree 坏版本验红已跑）。
 *
 * 跑：DB_PATH=/tmp/nf.db node scripts/content_no_fabrication_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/nf.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/nf_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { buildSystemPrompt } = await import('../src/companion.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const comp = (extra = {}) => ({ id: 'sandbox', name: '小柔', age: 24, nsfw_level: 0, personality_tags: ['温柔'], relationship_stage: '恋人', can_joke: true, ...extra });
const Preply = (extra) => buildSystemPrompt(comp(extra), { promptMode: 'reply' });
const Pproa = (extra) => buildSystemPrompt(comp(extra), { promptMode: 'proactive' });

console.log('── ① 🔴 anti-凭空块在 system prompt(核心断言·stash 块→红) ──');
{
  const p = Preply();
  ok(/别凭空编他此刻在干嘛/.test(p), '含块标题「关心他，但别凭空编他此刻在干嘛」');
  ok(/只依据\*\*最近对话里他真说过的\*\*/.test(p), '含"只依据最近对话里他真说过的"(来源闸)');
  ok(/别凭空断定他此刻正在做什么/.test(p) && /手边有什么/.test(p), '含"别凭空断定此刻在做什么·手边有什么"(砍即时态)');
  ok(/游戏手柄/.test(p) && /今天又喝酒了没/.test(p), '含 dogfood 反例锚(游戏手柄/今天又喝酒了没)');
}

console.log('── ② 🔴 两路径通治:proactive 路径也带本块(落公共段·非 proactive-only) ──');
{
  const p = Pproa();
  ok(/别凭空编他此刻在干嘛/.test(p), 'proactive systemPrompt 也含本块(759「关心他正在忙的事」裸区已补)');
}

console.log('── ③ 🔴🔴 放行清单锁(分寸命门·删放行=矫枉过正回归→红) ──');
{
  const p = Preply();
  ok(/你今天累不累/.test(p), '✅放行:「你今天累不累」在(没变哑巴)');
  ok(/吃了没/.test(p), '✅放行:「吃了没」在');
  ok(/在干嘛呢/.test(p), '✅放行:「在干嘛呢」在');
  ok(/不预设答案/.test(p), '含"开放地关心、不预设答案"框架(放行开放问句)');
  ok(/\*\*凭空断定\*\*.*砍.*\*\*开放询问\*\*.*放行/s.test(p), '含"凭空断定(砍)vs 开放询问(放行)"分寸句');
}

console.log('── ④ 🔴 隔离:纯加法没冲掉现有关心/共情簇 ──');
{
  const p = Preply();
  ok(/共情要具体/.test(p), '现有 affect-labeling 块仍在');
  ok(/别递刀也别训/.test(p), '现有内容边界块(v1.24)仍在');
  ok(/接住他 \+ 互相掏心/.test(p), '现有 turning-toward/掏心块仍在(本块插在其前·没顶掉)');
  ok(/你不必完整回答每件事/.test(p), '现有「只共情不 fix」块仍在');
}

console.log('── ⑤ 🔴 age-blind:对所有 age 一致注入(不碰 child-safety age 分支) ──');
{
  ok(/别凭空编他此刻在干嘛/.test(Preply({ age: 16 })), '未成年 companion 也一致注入(age-blind·不针对 age)');
  ok(/别凭空编他此刻在干嘛/.test(Pproa({ age: 16 })), 'proactive 未成年也一致注入');
}

console.log(`\n══ content-no-fabrication smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
