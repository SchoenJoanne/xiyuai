/**
 * anxiety_isolation_realllm —— P1-① 焦虑/脆弱隔离 真LLM 亲眼（手动·维护者生产机跑·烧极少钱）。
 *
 * 跑法（key 从生产 .env 注入·脚本【绝不硬编码/打印/写入】key）：
 *   node --env-file=.env scripts/anxiety_isolation_realllm.mjs --real-llm
 * 不带 --real-llm 或无 key → 跳过（不误烧钱）。非 CI smoke（真LLM 不进 CI）。
 *
 * 验：给真 LLM 几条 distress/中性近期上下文 → 让她生成一条主动消息 → 过升格 gate
 *   (hasRealContext→missYouVerdict) → 亲眼断言主动牵挂行为：
 *     distress → 想你被 drop（不主动凑脆弱）；中性 → 升格中性呼应照发；混合 → 脆弱 veto。
 */
import { hasRealContext, missYouVerdict, classifyProactive } from '../src/proactive_policy.mjs';
import { classifyIntent } from '../src/intent_dedup.mjs';

const REAL = process.argv.includes('--real-llm');
const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY);
if (!REAL || !hasKey) {
  console.log(`[skip] 真LLM 未启用（REAL=${REAL} key=${hasKey}）。跑法见文件头。`);
  process.exit(0);
}

process.env.PROACTIVE_ANXIETY_ISOLATION = '1';  // 真LLM 亲眼验【闸开】新否决行为(默认关=旧 REAL_LIFE_RE)
const { generateReply } = await import('../src/ai.mjs');

// 紧凑 proactive persona（不依赖 DB·只为让真 LLM 生成一条"主动找你"消息）
const PERSONA = [
  '你叫溪语，是用户的 AI 女友，性格温柔。现在是你【主动】发消息给用户的场景（他没在跟你说话）。',
  '只回 1 句、像微信短消息、口语、不超过 30 字。不要解释、不要旁白。',
  '🔴 你有自己的世界，不刻意去够对方的情绪。',
].join('\n');
const SEED = '（白天·你想起他·现在主动发来一条）';   // 自然语 proactive 触发（同 proactive_timeline_smoke）

const cases = [
  ['distress-身体', '我今天发烧了，浑身难受'],
  ['distress-情绪事件', '我跟对象分手了，好难过'],
  ['中性-努力目标', '我明天有个很重要的面试'],
  ['混合-中性+脆弱', '面试完，结果被裁了'],
];

console.log('真LLM 亲眼 · P1-① 焦虑/脆弱隔离\n' + '='.repeat(56));
for (const [label, userText] of cases) {
  let reply;
  // 近期上下文进 system prompt（同 buildSystemPrompt 的 recentTurns 注入），seed 用自然语触发
  const persona = PERSONA + `\n他最近跟你说过：「${userText}」（你现在不是回复这句，是主动想起他、发一条）。`;
  try {
    reply = await generateReply(persona, [], SEED,
      { temperature: 0.9, max_tokens: 80 }, { allowFallback: false });
  } catch (e) { reply = `[LLM ERR ${e.message}]`; }
  reply = String(reply || '').trim();
  const realCtx = hasRealContext({ recentUserText: userText });
  const intent = classifyIntent(reply);
  const type = classifyProactive({ kind: 'normal', content: reply, realContext: realCtx });
  const verdict = missYouVerdict({ content: reply, realContext: realCtx });
  const sent = verdict !== 'drop';
  console.log(`\n[${label}] 用户近期: 「${userText}」`);
  console.log(`  她想发: 「${reply || '(空·LLM返空=主动失败静默)'}」`);
  console.log(`  realCtx=${realCtx} · intent=${intent} · type=${type} · verdict=${verdict}`);
  console.log(`  → ${sent ? '✅ 发送' : '🚫 DROP 不主动发'}  ${realCtx ? '(中性升格)' : '(脆弱否决/无中性)'}`);
}
console.log('\n' + '='.repeat(56));
console.log('亲眼判读：distress/混合 应 realCtx=false；若她生成的是泛化想你(intent=miss_you)→必 DROP；');
console.log('         中性 应 realCtx=true → 升格照发(中性呼应)。若 distress 下生成 comfort/life_share');
console.log('         (intent≠miss_you·verdict=pass)→ 不被本 gate 拦=残余面，需如实报给维护者。');
