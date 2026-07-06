/**
 * d4_emotion_engine_smoke.mjs —— 情绪引擎基础（批E·E3·E0c 闸 + 三段半衰 + 铁线·确定性零 LLM）
 *
 * ① emotionEngineOn 三态：OFF 默认(字节一致地基) / WHITELIST dogfood / ON 全量 / 无 companion→OFF
 * ② 三段半衰：快<中<慢 · 慢层 cap(sadness 高 imp 不拖) · 反刍减速 · 怒退悲显(demo 形状)
 * ③ 单调性：纯衰减绝不反向(缺席不加重·铁线)
 * ④ 铁线枚举：contempt 不在情绪枚举(结构排除) · 5 正 5 负
 *
 * 🔴 坏版本红验：emotionHalfLifeHours 去慢层 cap → sadness imp2 半衰翻倍(拖 5 天·红)。
 */
import { emotionEngineOn, emotionHalfLifeHours, decayEmotionIntensity, negativeEmotionSum,
         EMO_POSITIVE, EMO_NEGATIVE, EMOTIONS, EMO_HL, EMO_SLOW_CAP } from '../src/emotion_engine.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  🔴 FAIL', m)); };
const r1 = (x) => Math.round(x * 10) / 10;
const save = { ...process.env };
const setEnv = (o) => { for (const k of ['EMOTION_ENGINE', 'EMOTION_ENGINE_WHITELIST']) delete process.env[k]; Object.assign(process.env, o); };

console.log('── ① emotionEngineOn 三态 ──');
setEnv({});
ok(emotionEngineOn(9001) === false, '① 默认(env 未设)→OFF(字节一致地基)');
setEnv({ EMOTION_ENGINE: '1' });
ok(emotionEngineOn(9001) === false, '① 开关开但无白名单→保守 OFF(须显式名单)');
setEnv({ EMOTION_ENGINE: '1', EMOTION_ENGINE_WHITELIST: '9001,9002' });
ok(emotionEngineOn(9001) === true, '① 白名单内 companion→ON(dogfood)');
ok(emotionEngineOn(9003) === false, '① 白名单外→OFF');
ok(emotionEngineOn(null) === false, '① 白名单模式无 companion 上下文→OFF');
setEnv({ EMOTION_ENGINE: '1', EMOTION_ENGINE_WHITELIST: '*' });
ok(emotionEngineOn(9003) === true && emotionEngineOn(null) === true, '① 白名单=*→ON 全量');
setEnv(save);

console.log('── ②三段半衰 + 慢层 cap + 怒退悲显 ──');
{
  const dt = 3;
  const a = decayEmotionIntensity({ emotion: 'annoyance', intensity: 100, at: Date.now() - dt * 3600e3 });
  const u = decayEmotionIntensity({ emotion: 'upset', intensity: 100, at: Date.now() - dt * 3600e3 });
  const s = decayEmotionIntensity({ emotion: 'sadness', intensity: 100, at: Date.now() - dt * 3600e3 });
  console.log(`  3h: annoyance ${r1(a)} / upset ${r1(u)} / sadness ${r1(s)}`);
  ok(a < u && u < s, '② 快<中<慢');
  // 慢层 cap：imp2 sadness 半衰 = slow×1.5（非 ×2）
  ok(emotionHalfLifeHours('sadness', 2, false) === EMO_HL().slow * EMO_SLOW_CAP(), '② sadness 慢层 cap ×1.5(非 ×2·防拖 5 天)');
  ok(emotionHalfLifeHours('upset', 2, false) === EMO_HL().mid * 2, '② 中层 upset 无 cap(×2 照用)');
  // 怒退悲显：同注 upset+sadness 12h 后 upset<sadness
  const u12 = decayEmotionIntensity({ emotion: 'upset', intensity: 90, importance: 2, unresolved: true, at: Date.now() - 12 * 3600e3 });
  const s12 = decayEmotionIntensity({ emotion: 'sadness', intensity: 90, importance: 2, unresolved: true, at: Date.now() - 12 * 3600e3 });
  ok(u12 < s12, `② 怒退悲显(upset ${r1(u12)}<sadness ${r1(s12)}·"不气了就是还闷闷的")`);
  // 反刍减速
  ok(emotionHalfLifeHours('upset', 1, true) === EMO_HL().mid * 3, '② 未决 upset 半衰 ×3(反刍)');
  ok(emotionHalfLifeHours('upset', 1, false) === EMO_HL().mid, '② 解决 upset 半衰复原');
}

console.log('── ③ 单调性(缺席绝不反向) ──');
{
  let prev = 100, mono = true;
  for (let h = 0; h <= 48; h += 2) { const v = decayEmotionIntensity({ emotion: 'upset', intensity: 100, at: Date.now() - h * 3600e3 }); if (v > prev + 1e-9) mono = false; prev = v; }
  ok(mono, '③ upset 48h 轨迹单调不增(无输入=只衰减)');
}

console.log('── ④ 铁线枚举(无 contempt·5 正 5 负) ──');
ok(!EMOTIONS.includes('contempt'), '🔴④ contempt 不在情绪枚举(轻蔑轨道结构排除)');
ok(EMO_POSITIVE.length === 5 && EMO_NEGATIVE.length === 5, '④ 5 正 5 负(OCC 简化)');
ok(EMO_NEGATIVE.includes('upset') && EMO_NEGATIVE.includes('sadness'), '④ upset/sadness 在负面枚举');

console.log('── ⑤ negativeEmotionSum ──');
{
  const now = new Date();
  const pulses = [
    { emotion: 'upset', intensity: 40, at: now.getTime() },
    { emotion: 'sadness', intensity: 30, at: now.getTime() },
    { emotion: 'joy', intensity: 50, at: now.getTime() },   // 正面不计
  ];
  const s = negativeEmotionSum(pulses, now);
  ok(Math.abs(s - 70) < 0.5, `⑤ 负面和 ≈70(upset40+sadness30·joy 不计)·得 ${r1(s)}`);
}

console.log(`\n══ d4_emotion_engine smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
