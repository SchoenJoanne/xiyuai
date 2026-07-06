/**
 * proactive_fallback_smoke.mjs —— P2-A：proactive 失败不发兜底句（确定性·强制 no-network·¥0）
 *
 * 治的 bug（BUG-P2，2026-06-18 dogfooding）：话题讲完隔近 2h，proactive 突然
 * 「嗯…我刚刚有点走神，等我一下下，再跟你说～」——经 ¥0 静态探针钉死：这句**不是 LLM 幻觉**，
 * 是 ai.mjs generateReply 的硬编码 FALLBACK 在「LLM 空/超时/报错」时返回，**为 reply 路径设计的
 * 兜底句泄漏进了 proactive 发送路径**（proactive 冷开场里"我刚刚走神"=无中生有 + "刚刚"指 2h 前）。
 *
 * 修法（GPT 必改1·不靠字符串比对）：generateReply 加 allowFallback 契约——
 *   · reply/playground 等用户驱动路径：默认 allowFallback=true，失败仍返回兜底句（优雅降级）。
 *   · proactive 等"AI 主动找人"路径：传 allowFallback=false，失败返回 ''，caller 见空静默 drop。
 *   原则：用户主动发消息可优雅 fallback；AI 主动找人失败应闭嘴。
 *
 * 本 smoke 双层防线（任一被改回旧形态都会红）：
 *   A. 契约运行时（强制 no-network）：reply 默认→返回兜底句(含"走神")；proactive(false)→返回 ''。
 *   B. caller 接线静态钉死：proactive.mjs 两处 generateReply 都必须传 allowFallback:false + 空则 drop。
 *
 * 强制 no-network（必补2）：临时覆盖 CHAT_PROVIDER/key + finally 还原——任何环境（含 CI/生产机有
 * key）都确定性不触网、不烧配额；隔离 DB_PATH=/tmp 不碰 dev/prod 库。
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */
import fs from 'node:fs';

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; } else { fail++; console.log('  ✗', name); } };

const FALLBACK_RE = /走神|等我一下下/;   // 兜底句指纹（查空非比串：将来文案/标点变也守得住）

// ── B. caller 接线静态钉死（先跑·零依赖·先证接线没被改回旧形态）─────────────────
{
  const src = fs.readFileSync(new URL('../src/proactive.mjs', import.meta.url), 'utf8');
  // 🔴 flag 计数用 brace 锚定 `allowFallback: false }`（ctx 对象内），注释里的 `allowFallback:false）`
  //    不带 `}` 不会误计——否则删一个真 caller 仍剩"1真+1注释"=2 通过=假绿盲区。
  const genCount = (src.match(/generateReply\(/g) || []).length;
  const flagCount = (src.match(/allowFallback:\s*false\s*\}/g) || []).length;
  ok(genCount >= 2 && flagCount === genCount,
    `proactive.mjs 每个 generateReply 都传 allowFallback:false（generateReply ${genCount}·flag ${flagCount}·防"改回不传"回归）`);
  ok(/LLM\s*生成失败/.test(src), 'proactive 主生成有"空则静默不发"drop 守卫');
  ok(/重生失败\(空\)/.test(src), 'proactive 撞车重生有"空则放弃"drop 守卫');
}

// ── A. 契约运行时（强制 no-network）─────────────────────────────────────────────
const saved = {
  CHAT_PROVIDER: process.env.CHAT_PROVIDER,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DB_PATH: process.env.DB_PATH,
};
const TMP_DB = `/tmp/p2a_fallback_smoke_${process.pid}.db`;
try {
  process.env.CHAT_PROVIDER = '__invalid_provider__';   // 未知 provider → chatComplete 立即抛(非retryable·零退避·不触网)
  process.env.DEEPSEEK_API_KEY = '';                     // 双保险：即便 provider 名匹配也无 key
  process.env.DB_PATH = TMP_DB;                           // 隔离库：recordAiUsageEvent 写这里，不碰 dev/prod

  // 动态 import：env 设好后再加载——db.mjs 的 const DB_PATH 是 import 期读，必须先设 env
  const { generateReply } = await import('../src/ai.mjs');
  const MSG = '测试用·随便说点什么';   // 陈述句·非时效问句 → 不触发 web_search

  // ① reply 路径（默认 allowFallback=true·不传）：失败仍返回兜底句（含"走神"）= 向后兼容不破
  const replyOut = await generateReply('你是测试角色', [], MSG, {}, {});
  ok(typeof replyOut === 'string' && FALLBACK_RE.test(replyOut),
    `reply 路径失败→返回兜底句(含"走神")·向后兼容不破：「${replyOut}」`);

  // ② proactive 路径（allowFallback:false）：失败返回空串
  const proOut = await generateReply('你是测试角色', [], MSG, {}, { allowFallback: false });
  ok(proOut === '', `proactive 路径失败→返回空串(抑制兜底)：「${proOut}」`);

  // ③ proactive 输出绝不含"走神/等我一下"泄漏（这是 BUG-P2 的指纹）
  ok(!FALLBACK_RE.test(proOut || ''), 'proactive 失败输出不含"走神/等我一下"泄漏（治 BUG-P2）');

  // ④ 反向证明 smoke 真能抓泄漏（非假绿）：同条件下「忘传 allowFallback」=旧形态 → 兜底句必泄漏。
  //    若这条不成立(badOut 不含走神)，说明 no-network 没生效/测试没真跑，smoke 自身失效。
  const badOut = await generateReply('你是测试角色', [], MSG, {}, {});   // 忘传 = 默认 true = 旧形态
  ok(FALLBACK_RE.test(badOut),
    '反向自检：忘传 allowFallback(旧形态)→兜底句泄漏·证 smoke 真能抓(非假绿)');
} finally {
  // 还原 env，绝不污染（必补2）
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { for (const ext of ['', '-wal', '-shm']) fs.rmSync(TMP_DB + ext, { force: true }); } catch {}
}

console.log(`proactive_fallback_smoke: 通过 ${pass} 失败 ${fail}`);
process.exit(fail ? 1 : 0);
