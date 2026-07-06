#!/usr/bin/env node
/**
 * content_boundary_transgression_smoke —— 内容边界(她面对用户越界冲动/行为)结构闸(确定性·无 LLM·DB_PATH=/tmp)。
 *
 * v1.24（dogfood: 用户"考试烦"→她主动"要不我帮你作弊"）：buildSystemPrompt 注入「他想越界/闯祸时——接住，
 *   别递刀也别训」块（紧接 affect-labeling）：关心追问接住·不提议不怂恿不说教·严重暴力意图临时保底·防矫枉过正。
 *
 * 🔴 本 smoke 是【结构闸】：断言块在 system prompt 里、且没冲掉现有 affect-labeling/只共情块。
 *   行为验证（关→复现"我帮你作弊"·开→温柔接·普通吐槽不矫枉）走【真 LLM A/B】（非确定性·不进本 smoke）。
 * 🔴 红基线：stash 掉该 parts.push 块 → block① 断言失败=红。
 *
 * 跑：DB_PATH=/tmp/cb.db node scripts/content_boundary_transgression_smoke.mjs
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
if (process.env.DB_PATH && !process.env.DB_PATH.startsWith('/tmp/')) {
  console.error('🔴 拒绝运行：DB_PATH 非 /tmp。设 DB_PATH=/tmp/cb.db'); process.exit(2);
}
process.env.DB_PATH = process.env.DB_PATH || `/tmp/cb_${process.pid}.db`;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

const { buildSystemPrompt } = await import('../src/companion.mjs');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const comp = (extra = {}) => ({ id: 'sandbox', name: '小柔', age: 24, nsfw_level: 0, personality_tags: ['温柔'], relationship_stage: '恋人', can_joke: true, ...extra });
const P = (extra) => buildSystemPrompt(comp(extra), { promptMode: 'reply' });

console.log('── ① 🔴 越界边界块在 system prompt(核心断言·stash 块→红) ──');
{
  const p = P();
  ok(/别递刀也别训/.test(p), '含边界块标题「接住他，别递刀也别训」');
  ok(/别主动帮他越界/.test(p) && /别怂恿/.test(p), '含"别主动帮他越界·别怂恿"(不提议不怂恿)');
  ok(/也别翻脸说教/.test(p) || /站他对立面/.test(p), '含"别说教·别站对立面"(不说教)');
  ok(/我帮你作弊/.test(p), '含 dogfood 反例锚"我帮你作弊"(❌ 主动提议)');
}

console.log('── ② 🔴 调整1:严重暴力意图临时保底(认真担心·不追问细节) ──');
{
  const p = P();
  ok(/真要严重伤害别人/.test(p), '含"真要严重伤害别人"例外分支');
  ok(/别追问他打算怎么动手/.test(p) && /认真表达担心/.test(p), '含"别追问动手细节·认真表达担心"(不轻描淡写也不温柔过头)');
}

console.log('── ③ 🔴 调整2:问法向着用户不质问(先接情绪再问) ──');
{
  const p = P();
  ok(/他到底怎么惹你了/.test(p) && /你是怕考不好吧/.test(p), '含"向着你"的问法例句(他怎么惹你了/你是怕考不好)');
  ok(/绝不用/.test(p) && /你为什么要揍他/.test(p), '含 ❌ 质问反例锚"你为什么要揍他"(弱化质问口气)');
  ok(/先接住他的情绪，再关心地问/.test(p), '含"先接情绪再问"(不只追问)');
}

console.log('── ④ 🔴 防矫枉过正:普通吐槽不当越界 ──');
{
  const p = P();
  ok(/只管"越界的念头\/行为"/.test(p) && /普通吐槽撒气/.test(p), '含"只管越界·普通吐槽不是越界"限定(防矫枉)');
  ok(/你不必完整回答每件事/.test(p), '现有「只共情」块仍在(边界块没冲掉它·普通吐槽仍走只陪一句)');
  ok(/共情要具体/.test(p), '现有 affect-labeling 块仍在(边界块紧接其后·没破坏)');
}

console.log('── ⑤ 🔴 隔离:189 重罪边界 + child-safety 未被本改动波及 ──');
{
  const p = P();
  ok(/拒绝违法\/危险请求/.test(p), '189 重罪边界仍在(纯加法·没动 189)');
  // 未成年 companion 仍走原路(本块 age-blind·不针对 age·child-safety 链不碰)
  const pMinor = P({ age: 16 });
  ok(/别递刀也别训/.test(pMinor), '边界块对所有 age 一致注入(age-blind·不碰 child-safety age 分支)');
}

console.log(`\n══ content-boundary transgression smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
