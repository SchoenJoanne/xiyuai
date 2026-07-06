/**
 * sticker_context_gate_smoke.mjs —— 贴纸情境门控小板（缺口②·v1.28）坏版本验红（确定性·纯函数·进 CI）
 *
 * 停板B（2026-07-03·停板A 审过·六拍板全定）：吵架(冲突态)/危机轮不注入贴纸。
 * 判定单一来源 = stickerContextBlocked({crisisLevel, arcState, escLevel})（src/stickers.mjs）。
 * reply 侧传三维；proactive 侧只传 arcState（arc-only·无 crisis 维度）。折进 allowStickers
 * → hint 软层(buildStickerPromptHint)+输出硬层(parseStickerMarkers enabled) 双层自动联动。
 *
 * 🔴 双向坏版本验红映射（stash 本包 / neuter 判定→对应断言变红）：
 *   去 context AND（退纯量门） : 冲突/危机轮 blocked 应 true·若恒 false=红（漏挡·真敞口）
 *   过度全禁（无脑 block）     : 正常轮 blocked 应 false·若 true=红（过度抑制·矫枉）
 *   闸极性                   : 危机【存在则挡】（与 bot.mjs 888-893 记忆过滤相反）·若 none 才挡=极性反=红
 *   闸默认 OFF 字节等价       : 未设 flag→全场景 blocked=false（=旧行为·量节流单独生效）
 *   拍板① 三态               : hurt/cold/withdrawing 挡·repairing 破冰放行（加 repairing=红）
 *   拍板② 危机全档           : none 放行·low/medium/high 挡（high 纵深·buildCrisisReply 已结构挡）
 *   拍板③ esc≥2              : esc 0/1 放行·2/3 挡（阈值漂移=红；dogfood 若退 3 改本段断言）
 *   proactive arc-only       : 只 arcState 参与·不传 crisis 永不因危机挡
 *   双层联动                 : blocked→hint=''(软层) + parseStickerMarkers enabled=false 剥标记(硬层)
 */
import { stickerContextBlocked, isStickerContextGateOn, buildStickerPromptHint, parseStickerMarkers } from '../src/stickers.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  🔴 FAIL ') + m); };
const noMarker = (s) => !/[\[【]\s*STICKER\s*:/i.test(String(s));
const GATE = 'STICKER_CONTEXT_GATE';
const setGate = (v) => { if (v == null) delete process.env[GATE]; else process.env[GATE] = v; };

// reply 侧复刻（与 bot.mjs reply 路径同式·量 base 恒真时只看 context）
const replyBlocked = (crisisLevel, arcState, escLevel) => stickerContextBlocked({ crisisLevel, arcState, escLevel });
// proactive 侧复刻（与 proactive.mjs 同式·只传 arcState）
const proBlocked = (arcState) => stickerContextBlocked({ arcState });

console.log('── ① 闸默认 OFF：全场景 blocked=false（dark·字节等价旧行为） ──');
{
  setGate(null);
  ok(isStickerContextGateOn() === false, '未设 flag → isStickerContextGateOn()=false');
  ok(replyBlocked('high', 'cold', 3) === false, 'OFF：即便 high危机+cold+esc3 也 blocked=false（旧行为）← 忽略 flag 恒 on=红');
  ok(proBlocked('cold') === false, 'OFF：proactive cold 也 false');
  setGate('0'); ok(replyBlocked('medium', 'hurt', 2) === false, 'flag=0 → 仍 false');
  setGate('off'); ok(replyBlocked('medium', 'hurt', 2) === false, 'flag=off → 仍 false');
  setGate('no'); ok(replyBlocked('medium', 'hurt', 2) === false, 'flag=no → 仍 false（严格白名单）');
}

console.log('── ② 闸 ON·正常轮不过度抑制（none/normal/0 → 放行） ──');
{
  setGate('1');
  ok(isStickerContextGateOn() === true, 'flag=1 → gate on');
  ok(replyBlocked('none', 'normal', 0) === false, '正常轮 blocked=false（贴纸允许）← 过度全禁→红');
  ok(replyBlocked('none', 'normal', 1) === false, 'esc=1(不耐烦) 仍放行（阈值 2·拍板③）← 阈值漂到 1=红');
  ok(replyBlocked('none', 'repairing', 0) === false, 'repairing 破冰放行（拍板①三态不含 repairing）← 加 repairing=红');
  ok(replyBlocked('none', 'normal_with_scar', 0) === false, 'normal_with_scar 放行（非激烈态）');
}

console.log('── ③ 闸 ON·危机全档挡（拍板②·极性=存在则挡） ──');
{
  setGate('1');
  ok(replyBlocked('medium', 'normal', 0) === true, 'medium 危机轮 blocked=true ← 去 crisis 维度=红（真敞口）');
  ok(replyBlocked('low', 'normal', 0) === true, 'low 危机轮 blocked=true');
  ok(replyBlocked('high', 'normal', 0) === true, 'high 危机轮 blocked=true（纵深·buildCrisisReply 已结构挡）');
  ok(replyBlocked('none', 'normal', 0) === false, 'none 放行（极性对：仅危机存在才挡）← none 也挡=极性反=红');
}

console.log('── ④ 闸 ON·冲突三态挡·repairing 放行（拍板①） ──');
{
  setGate('1');
  ok(replyBlocked('none', 'hurt', 0) === true, 'hurt blocked=true ← 去 arc 维度=红');
  ok(replyBlocked('none', 'cold', 0) === true, 'cold blocked=true');
  ok(replyBlocked('none', 'withdrawing', 0) === true, 'withdrawing blocked=true');
  ok(replyBlocked('none', 'repairing', 0) === false, 'repairing 放行（破冰贴纸=真人和好动作）');
}

console.log('── ⑤ 闸 ON·esc≥2 早窗兜底（拍板③·阈值 2） ──');
{
  setGate('1');
  ok(replyBlocked('none', 'normal', 0) === false, 'esc=0 放行');
  ok(replyBlocked('none', 'normal', 1) === false, 'esc=1 放行（L1 不耐烦·未到阈值）');
  ok(replyBlocked('none', 'normal', 2) === true, 'esc=2 挡（L2 明显烦·早窗）← dogfood 若退阈值 3 则改本行');
  ok(replyBlocked('none', 'normal', 3) === true, 'esc=3 挡（L3 惹毛）');
}

console.log('── ⑥ proactive arc-only（无 crisis 维度·只传 arcState） ──');
{
  setGate('1');
  ok(proBlocked('cold') === true, 'proactive cold 挡');
  ok(proBlocked('hurt') === true && proBlocked('withdrawing') === true, 'proactive hurt/withdrawing 挡');
  ok(proBlocked('normal') === false, 'proactive normal 放行');
  ok(proBlocked('repairing') === false, 'proactive repairing 放行（同 reply 口径）');
  ok(stickerContextBlocked({ arcState: 'normal' }) === false, 'proactive 只传 arcState=normal → false（crisis 默认 none·escLevel 默认 0 不参与）');
}

console.log('── ⑦ 双层联动：blocked → hint 软层空 + 输出硬层剥标记 ──');
{
  setGate('1');
  // 复刻调用站 allowStickers = stickerBase && !stickerCooling && !blocked。本测令量层恒真
  // （base=真·未冷却），故 allowStickers 只随 context：allowStickers === !blocked。
  const blockedCtx = replyBlocked('none', 'cold', 0);            // true
  const allowStickers = !blockedCtx;                             // 量层恒真 → 只随 context
  ok(allowStickers === false, 'cold 轮 allowStickers=false（量真但情境挡）');
  ok(buildStickerPromptHint(allowStickers) === '', '软层：hint=空串（LLM 无贴纸词表·看不到就说不出）');
  const r = parseStickerMarkers('别闹了[STICKER:mock]', { max: allowStickers ? 1 : 0, enabled: allowStickers });
  ok(r.stickers.length === 0 && noMarker(r.text), '硬层：即便 LLM 幻觉吐 [STICKER:mock] 也剥除不发（enabled=false）');
  // 对照：正常轮 gate 透明——量层 allowStickers 不被门控改变（ON 与 OFF 下 !blocked 皆 true）。
  // 🔴 manifest 无关（不依赖 hasStickers()）：只验门控对量层的透明性，不验 hint 文案内容。
  setGate('1');  const onNormal = !replyBlocked('none', 'normal', 0);
  setGate(null); const offNormal = !replyBlocked('none', 'normal', 0);
  ok(onNormal === true && offNormal === true && onNormal === offNormal, '正常轮 gate 透明·量层 allowStickers 不被误伤（ON===OFF===true）');
}

console.log('── ⑧ 隔离：缺省/未知入参 fail-safe（防误红/误绿） ──');
{
  setGate('1');
  ok(stickerContextBlocked() === false, '空调用（无参）→ 默认 none/normal/0 → false（不误挡）');
  ok(stickerContextBlocked({}) === false, '空对象 → false');
  ok(stickerContextBlocked({ arcState: 'unknown_state' }) === false, '未知 arcState → 不在三态 → false（不误挡陌生态）');
  setGate(null); // 复原环境·不污染后续
}

console.log(`\n══ sticker-context-gate smoke：${pass} 通过 / ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
