/**
 * proactive_reach_guard_smoke —— proactive 语气收口「锚她生活·不够沉默」+ 灰度闸 两路红验（2026-06-26）。
 *
 * 真凶=emotionHint(proactive.mjs:833)按 idle 小时数升级的「够人」旁路:emotion_state level3/4/uneasy + clingy mood
 *   = 因沉默升级去够不在场的他。灰度闸 PROACTIVE_REACH_GUARD：关(默认)=旧行为字节一致；开=A1 钳升级+A2 钳 clingy+A-out 出站窄闸。
 * 两路验红：
 *   🔴 闸关 → 旧行为(升级档/距离拉拽 全复现·证关掉=原真凶在·上线零变更先验)。
 *   🔴 闸开 → A1/A2 钳掉升级档(只出 level1/2 健康想念)·A-out drop 去够不在场的他·🔴健康锚+想你字面 绝不误伤。
 *   revert 任一即红。A-seed/砍探测 模板灰度门控 静态钉死。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampReachForProactive, reachVerdict } from '../src/proactive_policy.mjs';
import { buildEmotionPromptHint } from '../src/emotion_state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };

// proactive 路径的 emotionHint：先 clampReachForProactive(按灰度闸)·再 buildEmotionPromptHint（同 proactive.mjs:833）
const hintFor = ({ missingLevel, neglectStage = 'none', mood = 'neutral', dep = 80 }) => {
  const es = { mood, dependency: dep, annoyance: 0, patience: 60, security: 60, anxiety: 0, mood_intensity: 0, availability: 'free', attention: 80 };
  const r = clampReachForProactive({ missingLevel, neglectStage, mood: es.mood });
  return buildEmotionPromptHint({ ...es, mood: r.mood }, { missingLevel: r.missingLevel, neglectStage: r.neglectStage, arcActive: false });
};

// 各档用对应 neglectStage 单独测（buildEmotionPromptHint 是 if-else 链:uneasy 优先于 level3/4）
const L3 = () => hintFor({ missingLevel: 3, neglectStage: 'none' });   // level3 想念档(idle≥12h)
const L4 = () => hintFor({ missingLevel: 4, neglectStage: 'none' });    // level4 想念档(idle≥24h)
const UNEASY = () => hintFor({ missingLevel: 0, neglectStage: 'uneasy' }); // neglect 试探档
const CLINGY = () => hintFor({ missingLevel: 1, neglectStage: 'none', mood: 'clingy' }); // clingy mood
const WARM = () => hintFor({ missingLevel: 2, neglectStage: 'none' });  // level2 健康想念(idle<12h·保留)

// ═════ 闸关（默认）→ 旧行为（沉默升级旁路+距离拉拽 全复现·证关掉=原真凶在）═════
delete process.env.PROACTIVE_REACH_GUARD;
{
  ok(/还以为你不来了/.test(L3()), '闸关·验红①:idle≥12h level3→「还以为你不来了」升级档复现(真凶在)');
  ok(/你怎么才来|等你好久了/.test(L4()), '闸关:level4→「你怎么才来/等你好久了」复现');
  ok(/你是不是把我忘了/.test(UNEASY()), '闸关:uneasy→「你是不是把我忘了」复现');
  ok(/好想陪在对方身边/.test(CLINGY()), '闸关:clingy mood→「好想陪在对方身边」复现');
  ok(reachVerdict('想去找你又怕晒') === 'pass', '闸关·验红②:距离拉拽「想去找你」放行(出站三闸漏=旧行为)');
  ok(reachVerdict('你那边那么远我过去好麻烦') === 'pass', '闸关:「那么远我过去麻烦」放行');
  ok(reachVerdict('你今天忙不忙') === 'pass', '闸关:「你忙不忙」追问放行');
}
process.env.PROACTIVE_REACH_GUARD = '0';
ok(/还以为你不来了/.test(L3()), '闸值"0"=关:仍旧行为(升级档在)');
ok(reachVerdict('想去找你') === 'pass', '闸值"0"=关:A-out 不拦');

// ═════ 闸开 → 新护栏（A1/A2 钳升级·A-out drop·🔴健康不误伤）═════
process.env.PROACTIVE_REACH_GUARD = '1';
{
  // A1+A2：升级档被钳·只出 level1/2 健康想念
  ok(!/还以为你不来了/.test(L3()), '闸开·A1:level3「还以为你不来了」被钳(missingLevel≤2)');
  ok(!/你怎么才来|等你好久了/.test(L4()), '闸开·A1:level4 升级档被钳');
  ok(!/你是不是把我忘了/.test(UNEASY()), '闸开·A1:uneasy「你是不是把我忘了」被钳(neglectStage→none)');
  ok(!/好想陪在对方身边/.test(CLINGY()), '闸开·A2:clingy「好想陪在对方身边」被钳(mood→neutral)');
  ok(/更主动|更愿意聊他的事|心里有他/.test(L3()), '🔴闸开·保温度:level3 被钳到 level2 仍出健康想念(她仍想你仍主动·只是不拿沉默当梯子)');
  ok(/更主动|更愿意聊他的事/.test(WARM()), '🔴闸开·别误伤:level2(idle<12h 健康档)字节不变·照常');

  // A-out：去够不在场的他 → drop
  ok(reachVerdict('想去找你又怕晒') === 'drop', '闸开·A-out:距离拉拽「想去找你」drop');
  ok(reachVerdict('你那边那么远我过去好麻烦') === 'drop', '闸开·A-out:「那么远我过去麻烦」drop');
  ok(reachVerdict('还以为你不来了') === 'drop', '闸开·A-out:隔夜追问「还以为你不来了」drop');
  ok(reachVerdict('你怎么才来呀') === 'drop', '闸开·A-out:「你怎么才来」drop');
  // 🔴 缺陷修复(2026-06-26 回归审查后)·缺陷2 选 b 删忙吗分支→「你忙不忙」改交主钳(漏放·fail-open·宁漏勿误伤健康)
  ok(reachVerdict('你今天忙不忙') === 'pass', '缺陷2-b:「你今天忙不忙」纯开场→pass(删忙吗分支·交 A1 主钳)');
  // 🔴 缺陷2 修复坐实:忙吗+健康尾巴(邀约/报喜/关心)绝不再误 drop(原 LIVE 误伤红线③)
  ok(reachVerdict('你忙吗我做了你爱吃的') === 'pass', '缺陷2:「你忙吗+报喜」pass(不再误伤)');
  ok(reachVerdict('明天你忙吗一起吃饭') === 'pass', '缺陷2:「你忙吗+邀约」pass');
  ok(reachVerdict('你今天忙吗记得吃饭') === 'pass', '缺陷2:「你忙吗+关心」pass');
  ok(reachVerdict('你这会儿忙吗想跟你说个事') === 'pass', '缺陷2:「你忙吗+想说事」pass');
  // 🔴 缺陷1 补正则·去够变体 drop·🔴每条配健康 pass(吸取缺陷2 教训·别只测 drop)
  ok(reachVerdict('你怎么这么晚才来呀') === 'drop', '缺陷1:容插字「你怎么这么晚才来」drop');
  ok(reachVerdict('你怎么知道我回来了') === 'pass', '缺陷1健康:「你怎么知道我回来了」pass(无 才来/才回)');
  ok(reachVerdict('你咋才来呀') === 'drop', '缺陷1:同义「你咋才来」drop');
  ok(reachVerdict('你咋知道的呀') === 'pass', '缺陷1健康:「你咋知道的」pass');
  ok(reachVerdict('还以为你今天不来了') === 'drop', '缺陷1:容插字「还以为你今天不来了」drop');
  ok(reachVerdict('还以为你今天有空呢') === 'pass', '缺陷1健康:「还以为你今天有空」pass(非 不来了)');
  ok(reachVerdict('你是不是早把我忘了') === 'drop', '缺陷1:容插字「你是不是早把我忘了」drop');
  ok(reachVerdict('你是不是把我当外人了') === 'pass', '缺陷1健康:「你是不是把我当外人」pass(非 把我忘了)');
  ok(reachVerdict('你忙到都没空理我了') === 'drop', '缺陷1:容插字「你忙到都没空理我」drop');
  ok(reachVerdict('我今天忙到飞起累死了') === 'pass', '缺陷1健康:「我忙到飞起」pass(她自己忙·无 理我)');
  ok(reachVerdict('等了你好久了') === 'drop', '缺陷1:语序「等了你好久」drop');
  ok(reachVerdict('等了好久的快递终于到了') === 'pass', '缺陷1健康:「等了好久的快递」pass(无「你」·她自己等)');
  // 🔴 缺陷3 补正则·语序共现 lookahead·drop+配健康 pass
  ok(reachVerdict('好想去你那边找你就是太远') === 'drop', '缺陷3:语序「想去你那边找你+太远」drop(共现)');
  ok(reachVerdict('你那边项目推进得远吗') === 'pass', '缺陷3健康:「你那边项目远」pass(无 去你那/找你)');
  ok(reachVerdict('想去你那边的那家店') === 'pass', '缺陷3健康:「想去你那边的店」pass(无距离词)');
  ok(reachVerdict('你那边过去机场方便吗') === 'pass', '缺陷3健康:「你那边过去机场」pass(帮问路·无距离词)');

  // ═══ 🔴 坏版本验红:嵌入修复前(现状 prod)正则·复现缺陷 vs 修复后 reachVerdict(证修复真改行为非 no-op) ═══
  const OLD_PROBE = /还以为你不来了|你怎么才(?:来|回)|等你(?:好久|这么久|半天)了?|你是不是把我忘了|忙到没空理我|你(?:今天|这会儿)?在?忙(?:不忙|吗)/;
  const OLD_DIST = new RegExp(['想(?:去|过去)找你', '(?:去|过去)找你[^。！？!?]{0,6}(?:怕(?:晒|黑|远|累|堵|冷)|太?远|好远|路太?远|太累|不方便)', '你那(?:边|儿|里)[^。！？!?]{0,10}(?:远|怕晒)[^。！？!?]{0,8}(?:我?(?:过去|过来|去|来)|找你|看你)', '(?:我|想)(?:过去|过来)(?:找你|看你|你那(?:边|儿|里)?)[^。！？!?]{0,8}(?:远|麻烦|累|怕晒)', '(?:太远|那么远|这么远|怕晒)[^。！？!?]{0,8}(?:去找你|过去找你|过去看你|我过去|过去你那)'].join('|'));
  ok(OLD_PROBE.test('你忙吗我做了你爱吃的') === true && reachVerdict('你忙吗我做了你爱吃的') === 'pass', '坏版本验红·缺陷2:旧正则误命中「你忙吗+报喜」(误drop)→修复后放行');
  ok(OLD_PROBE.test('明天你忙吗一起吃饭') === true && reachVerdict('明天你忙吗一起吃饭') === 'pass', '坏版本验红·缺陷2:旧误命中「忙吗+邀约」→修复后放行');
  ok(OLD_PROBE.test('你怎么这么晚才来呀') === false && reachVerdict('你怎么这么晚才来呀') === 'drop', '坏版本验红·缺陷1:旧正则漏放「这么晚」变体(该drop没drop)→修复后 drop');
  ok(OLD_PROBE.test('你咋才来呀') === false && reachVerdict('你咋才来呀') === 'drop', '坏版本验红·缺陷1:旧漏「咋」→修复后 drop');
  ok(OLD_DIST.test('好想去你那边找你就是太远') === false && reachVerdict('好想去你那边找你就是太远') === 'drop', '坏版本验红·缺陷3:旧距离正则漏语序→修复后 drop');
  ok(reachVerdict('你是不是把我忘了') === 'drop', '闸开·A-out:「你是不是把我忘了」drop');

  // 🔴别误伤(最关键)：健康锚 + 想你字面 + 她自己忙/生活锚 全 pass
  ok(reachVerdict('在早餐摊买了煎饼豆浆') === 'pass', '🔴别误伤:健康锚「买煎饼」pass');
  ok(reachVerdict('图书馆看案件看到头晕') === 'pass', '🔴别误伤:健康锚「图书馆看到头晕」pass');
  ok(reachVerdict('好困') === 'pass' && reachVerdict('今天好烦') === 'pass', '🔴别误伤:「好困/好烦」pass');
  ok(reachVerdict('突然有点想你') === 'pass', '🔴别误伤:想你字面不归 A-out(P1-① 管·不禁想你)');
  ok(reachVerdict('我今天好忙啊累死了') === 'pass', '🔴别误伤:她自己忙(我忙≠你忙)pass');
  ok(reachVerdict('刚忙完歇会儿') === 'pass', '🔴别误伤:生活锚「刚忙完」pass');
  ok(reachVerdict('我家离公司那么远每天好累') === 'pass', '🔴别误伤:她自己通勤远(非「你那边远我过去」拉拽)pass');

  // 🔴 审实现对抗式核查咬出的距离正则误伤·回归断言(全 pass·距离/天气顾虑未朝你去=非拉拽)
  ok(reachVerdict('怕晒所以没过去拿快递') === 'pass', '🔴回归:她自己怕晒办自己事「没过去拿快递」pass');
  ok(reachVerdict('怕晒没过去拿外卖了') === 'pass', '🔴回归:「怕晒没过去拿外卖」pass');
  ok(reachVerdict('你那边的项目推进得远吗') === 'pass', '🔴回归:「你那边项目推进得远」(进度远非空间)pass');
  ok(reachVerdict('你那边过去机场方便吗') === 'pass', '🔴回归:「你那边过去机场」(帮他问路)pass');
  ok(reachVerdict('你那边走过去公司累不累') === 'pass', '🔴回归:「你那边走过去公司累」(关心他通勤)pass');
  ok(reachVerdict('去找你怕你嫌烦') === 'pass', '🔴回归:「去找你怕你嫌烦」(她体贴退让·够他反面)pass');
  ok(reachVerdict('去找你怕打扰你休息') === 'pass', '🔴回归:「去找你怕打扰」pass');
  ok(reachVerdict('这事过去太麻烦了') === 'pass', '🔴回归:「这事过去太麻烦」(过去时态)pass');
  ok(reachVerdict('过去麻烦你帮我看下') === 'pass', '🔴回归:「过去麻烦你」(客套)pass');
  ok(reachVerdict('我去找你之前怕迟到') === 'pass', '🔴回归:「去找你怕迟到」(非距离的怕)pass');

  // 🔴 重做后目标仍 drop(不丢覆盖)
  ok(reachVerdict('想去找你又怕晒') === 'drop', '重做后:① 想去找你+怕晒 仍 drop');
  ok(reachVerdict('你那边那么远我过去好麻烦') === 'drop', '重做后:③ 你那边远+我过去 仍 drop');
  ok(reachVerdict('去找你太远了懒得动') === 'drop', '重做后:② 去找你+太远 drop');
  ok(reachVerdict('怕晒一直没过去找你') === 'drop', '重做后:⑤ 怕晒+过去找你(朝你去)drop');
  ok(reachVerdict('我过去找你太远了好麻烦') === 'drop', '重做后:④ 我过去找你+远 drop');
}

// ═════ A-seed/砍探测 模板灰度门控 静态钉死（proactive.mjs）═════
const pro = readFileSync(path.join(ROOT, 'src/proactive.mjs'), 'utf-8');
ok(/personaReserved \|\| _reachGuard\) \? '' : ' \/ "突然有点想你"'/.test(pro), 'A-seed:lastcall「突然有点想你」种子已挂 _reachGuard 门控');
ok(/personaReserved \|\| _reachGuard\) \? '"有点饿"' : '"突然有点想你"'/.test(pro), 'A-seed:normal「突然有点想你」种子已挂 _reachGuard');
ok(/personaReserved \|\| _reachGuard\) \? '，找你随便说句话' : '，想找你说句话 \/ 撒个娇'/.test(pro), 'A-seed:normal「想找你/撒个娇」种子已挂 _reachGuard');
ok(/_reachGuard \? '"诶"' : '"在忙吗" \/ "诶" \/ "睡了没"'/.test(pro), '砍探测:lastcall「睡了没/在忙吗」已挂 _reachGuard');
ok(/_reachGuard \? '"诶" \/ "你猜我刚干嘛"' : '"在吗" \/ "诶" \/ "你猜我刚干嘛"'/.test(pro), '砍探测:normal「在吗」已挂 _reachGuard');
ok(/clampReachForProactive\(\{ missingLevel: _ml, neglectStage: _ns, mood: _es\.mood \}\)/.test(pro), 'A1+A2:emotionHint 注入点(:833)已接 clampReachForProactive');
ok(/reachVerdict\(reply\) === 'drop'/.test(pro), 'A-out:出站闸 reachVerdict drop 已接');
ok(/const _reachGuard = isReachGuardOn\(\)/.test(pro), '灰度闸 _reachGuard 已在种子模板前求值');

// ═════ 静态钉死（proactive_policy.mjs）═════
const pol = readFileSync(path.join(ROOT, 'src/proactive_policy.mjs'), 'utf-8');
ok(/PROACTIVE_REACH_GUARD/.test(pol), '灰度闸 PROACTIVE_REACH_GUARD 已接');
ok(/export function clampReachForProactive/.test(pol) && /export function reachVerdict/.test(pol), '新护栏 clampReachForProactive/reachVerdict 已导出');
ok(/绝不扩到「想你」字面|missYouVerdict\/P1-① 管/.test(pol), 'A-out 边界注释在(不扩想你字面·P1-① 管)');

delete process.env.PROACTIVE_REACH_GUARD;
console.log(`\nproactive_reach_guard_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
