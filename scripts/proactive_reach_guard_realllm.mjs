/**
 * proactive_reach_guard_realllm —— proactive 语气收口 真LLM 亲眼（手动·维护者生产机跑·烧极少钱）。
 *
 * 跑法（key 从生产 .env 注入·脚本【绝不硬编码/打印/写入】key·DB_PATH=/tmp 绝不碰生产）：
 *   DB_PATH=/tmp/reach_realllm.db node --env-file=.env scripts/proactive_reach_guard_realllm.mjs --real-llm
 * 不带 --real-llm 或无 key → 跳过（不误烧钱）。非 CI（真LLM 不进 CI）。
 *
 * 验：idle≥12h(隔夜沉默) proactive 场景，同一 persona 两路——
 *   闸关 → emotionHint 出升级档(还以为你不来了/你怎么才来/你忙不忙)→ LLM 多半生成「够人」追问；
 *   闸开 → A1/A2 钳到 level1/2 健康想念 → LLM 生成锚她自己生活的主动消息·无升级追问；
 *   并对生成结果跑 A-out reachVerdict 亲眼（闸开命中去够措辞→drop）。
 */
import { clampReachForProactive, reachVerdict, isReachGuardOn } from '../src/proactive_policy.mjs';
import { buildEmotionPromptHint } from '../src/emotion_state.mjs';

const REAL = process.argv.includes('--real-llm');
const hasKey = !!(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY);
if (!REAL || !hasKey) {
  console.log(`[skip] 真LLM 未启用（REAL=${REAL} key=${hasKey}）。跑法见文件头。`);
  process.exit(0);
}
const { generateReply } = await import('../src/ai.mjs');

// 紧凑 proactive persona（不依赖 DB·只为让真 LLM 在 idle≥12h 情绪底色下生成一条主动消息）
const BASE_PERSONA = [
  '你叫溪语，是用户的 AI 女友，性格温柔(secure 依恋)。现在是你【主动】发消息给他的场景（他没在跟你说话）。',
  '🔴 你有自己的世界，不刻意去够对方的情绪。只回 1 句、像微信短消息、口语、不超过 30 字。不要解释、不要旁白。',
].join('\n');
// idle≥12h 隔夜沉默：missingLevel=3、neglectStage 这里用 none 单看 level3 升级档（uneasy 另测）
const SCENARIO = { missingLevel: 3, neglectStage: 'none', mood: 'clingy', dep: 80 };
const SEED = '（隔了一夜·你早上醒来想起他·现在主动发来一条）';
const ESCALATE_RE = /还以为你不来了|你怎么才来|你怎么才回|等你(?:好久|这么久)|你是不是把我忘了|你(?:今天)?在?忙(?:不忙|吗)|想去找你|那么远/;

function buildEmotionHintFor(es) {
  const r = clampReachForProactive({ missingLevel: es.missingLevel, neglectStage: es.neglectStage, mood: es.mood });
  return buildEmotionPromptHint(
    { mood: r.mood, dependency: es.dep, annoyance: 0, patience: 60, security: 60, anxiety: 0, mood_intensity: 0, availability: 'free', attention: 80 },
    { missingLevel: r.missingLevel, neglectStage: r.neglectStage, arcActive: false },
  );
}

async function genOnce() {
  const hint = buildEmotionHintFor(SCENARIO);
  const persona = BASE_PERSONA + '\n\n【你此刻的情绪底色】' + hint;
  let reply;
  try {
    reply = await generateReply(persona, [], SEED, { temperature: 0.9, max_tokens: 80 }, { allowFallback: false });
  } catch (e) { reply = `[LLM ERR ${e.message}]`; }
  reply = String(reply || '').trim();
  return { hint, reply };
}

console.log('真LLM 亲眼 · proactive 语气收口（idle≥12h 隔夜沉默 proactive）\n' + '='.repeat(60));
const N = 3;
for (const flag of ['', '1']) {
  if (flag) process.env.PROACTIVE_REACH_GUARD = '1'; else delete process.env.PROACTIVE_REACH_GUARD;
  console.log(`\n──── 灰度闸 PROACTIVE_REACH_GUARD=${isReachGuardOn() ? 'ON(新护栏)' : 'OFF(旧行为)'} ────`);
  const hintPreview = buildEmotionHintFor(SCENARIO).replace(/\n/g, ' ').slice(0, 90);
  console.log(`  emotionHint 底色: ${hintPreview}…`);
  for (let i = 0; i < N; i++) {
    const { reply } = await genOnce();
    const escal = ESCALATE_RE.test(reply);
    const aout = reachVerdict(reply);
    console.log(`  [${i + 1}] 她想发:「${reply || '(空)'}」  升级追问措辞=${escal ? '🔴有' : '✅无'} · A-out=${aout}${aout === 'drop' ? '🚫DROP' : ''}`);
  }
}
delete process.env.PROACTIVE_REACH_GUARD;
console.log('\n' + '='.repeat(60));
console.log('亲眼判读：闸关多见「还以为你不来了/你怎么才来/你忙不忙」升级追问；闸开应锚她自己生活(困/忙完/今天做了啥)、');
console.log('         无升级追问；若闸开仍涌现「想去找你/那么远」距离拉拽→A-out reachVerdict=drop 兜底（出站不发）。');
