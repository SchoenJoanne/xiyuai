/**
 * relationship_arc_runtime.mjs —— 冲突与和好弧：IO 协调层（PR-B）。
 *
 * 状态机本体（relationship_arc.mjs）是纯函数；这里负责：
 *   1. runArcSignalTick —— reply pipeline 每条消息：先时间结算再消息信号，落库
 *   2. runArcTimeTickBatch —— 搭 plan_tasks 30 分钟批（不新增定时器）
 *   3. getArcProactivePolicy —— proactive 降频 / 禁 kind / olive_branch 台阶消息
 *   4. 事件 resolved/stale 入长期记忆（她能说出"上次你就说过不查岗"）
 *
 * Copyright (c) 2026 溪语 AI Contributors. MIT License.
 */

import {
  tickArcOnSignal, tickArcOnTime, composeArcSignal, buildArcToneDirective,
  eventCategory, ARC_STATES, } from './relationship_arc.mjs';
import {
  getDb, getArcState, setArcState, getOpenRelationshipEvent, applyArcEventOp,
  countTodayRelationshipEvents, getLastArchivedEventType, updateRelationshipEvent,
  listPreferences, saveMemory, upsertEmotionState, insertArcSignalLog,
  shanghaiYMD, migrateArcToEngine, engineCalmedCheck,
  insertEmotionPulse, getEmotionPulses, reappraiseEngine,
} from './db.mjs';
// 批E·E3 Phase4 接缝：闸谓词 + OCC 评价（数据缝仅闸 ON 生效·闸 OFF 零改字节一致）
// E5②：self 自我消化接线需 EMO_NEGATIVE/decayEmotionIntensity/EMOTION_SELF_PEAK_MIN 判"次日过峰未决"。
import { emotionEngineOn, appraiseEvent, EMO_NEGATIVE, decayEmotionIntensity, EMOTION_SELF_PEAK_MIN } from './emotion_engine.mjs';
// 批E·E3 ② 表达单源：闸 ON 时 arc 态 tone 下线·directive 由引擎情绪档生成（E4 味道文本库）
import { buildEngineHint } from './emotion_hint.mjs';
import { getNeglectStage, buildReunionHint, getEmotionStateWithDefaults } from './emotion_state.mjs';
import { setArcLogSink } from './arc_log_sink.mjs';
import { log } from './logger.mjs';

// 观察埋点 sink 注册（v1.21.1）：moderation/relationship_arc 源头卡口经此间接写库。
// runtime 是所有生产链路（bot/playground/plan_tasks）的必经依赖，加载即生效。
setArcLogSink((companionId, row) => insertArcSignalLog(companionId, row));

const _hoursSince = (s, now = new Date()) => {
  const t = new Date(String(s || '').replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? Math.max(0, (now.getTime() - t) / 3600e3) : null;
};

function _getTaboos(companionId) {
  try {
    const rows = listPreferences(companionId, { type: 'taboo' }) || [];
    return rows.map(r => ({ target: r.target, intensity: r.intensity }));
  } catch { return []; }
}

/** 事件后用户入站消息轮数（hurt 自然消化 / 伤了又晾 判定用）。取不到给 1（中性：两边都不触发） */
function _countInboundSince(wechatUserId, botId, sinceIso) {
  if (!wechatUserId || !botId || !sinceIso) return 1;
  try {
    const r = getDb().prepare(`
      SELECT COUNT(*) AS n FROM wechat_messages
      WHERE from_user = ? AND direction = 'in' AND datetime(created_at) > datetime(?)
    `).get(wechatUserId, String(sinceIso).replace(' ', 'T'));
    return r?.n ?? 1;
  } catch { return 1; }
}

// 🔴 Step0(2026-06-28) reply reach-guard 独立闸：闸开时 neglect(他很久没理她=缺席)不进可翻账长期记忆
// (砍记仇账本)——arc 临时 hurt/cold/withdrawing 态有硬上限会自愈 + 靠 reunion 和好，但绝不固化成她日后能翻的
// "你欠我"账。真冲突(taboo_hit/harsh_words/pressure_spam=他主动造成的)照常归档，那不是缺席记仇。
// 内联 env 判定避免与 proactive_policy 循环 import；语义同 isReplyReachGuardOn。默认关=旧行为字节一致。
export function shouldArchiveArcEvent(eventType) {
  const reachOn = /^(1|true|on|yes)$/i.test(process.env.REPLY_REACH_GUARD || '');
  if (eventType === 'neglect' && reachOn) return false;
  return true;
}

/** resolved/stale 事件入长期记忆（冲突与和好都入，weight 按 severity） */
function _archiveToMemory(companion, openEvent, resolvedKind, now = new Date()) {
  try {
    if (!openEvent) return;
    if (!shouldArchiveArcEvent(openEvent.type)) return;   // 🔴 Step0: neglect 缺席记仇不落可翻账记忆(闸开)
    // 冲突弧归档文案"X月X日"走上海日历，避免自托管 UTC 下日期错位。
    const _ymd = shanghaiYMD(now);
    const dateStr = `${_ymd.month}月${_ymd.day}日`;
    const causeMap = {
      taboo_hit: '他提到了她很在意的事', harsh_words: '他说了让她难受的话',
      pressure_spam: '他反复催促施压', neglect: '他很久没理她',
    };
    const cause = openEvent.trigger_text
      ? `因为「${String(openEvent.trigger_text).slice(0, 40)}」`
      : (causeMap[openEvent.type] || '一次小冲突');
    const ending = resolvedKind === 'resolved'
      ? (openEvent.apology_kind === 'matched' ? '他认真道了歉，两人和好了' : '后来慢慢和好了')
      : '他一直没好好回应，她自己慢慢消化、放下了，但心里留了道浅浅的痕';
    const sev = Number(openEvent.severity) || 2;
    saveMemory({
      companionId: companion.id, userId: companion.user_id, memoryType: 'event',
      content: `${dateStr}有过一次别扭：${cause}，她${sev >= 3 ? '挺受伤的' : '有点不开心'}。${ending}。`,
      importance: Math.min(7, 3 + sev),
    });
  } catch (e) {
    log('warn', `[Arc] 事件入记忆失败 companion=${companion?.id}: ${e.message}`);
  }
}

/** 把纯函数 tick 结果落库（状态 / 事件 / trust 副作用 / 记忆归档） */
function _applyResult(companion, r, { stateBefore, openEvent, triggerText = '', now = new Date() } = {}) {
  if (!r || (!r.changed && !r.eventOp && !r.trustDelta)) return;
  try {
    if (r.eventOp) {
      applyArcEventOp(companion.id, openEvent, r.eventOp, {
        stateBefore, stateAfter: r.state, triggerText, now,
      });
      if (r.eventOp.op === 'resolve') _archiveToMemory(companion, openEvent, 'resolved', now);
      if (r.eventOp.op === 'stale' || (r.eventOp.op === 'create' && r.eventOp.stale)) {
        _archiveToMemory(companion, openEvent || { type: r.eventOp.type, severity: r.eventOp.severity }, 'stale', now);
      }
    }
    if (r.state !== stateBefore) {
      setArcState(companion.id, r.state, now.toISOString());
      log('info', `[Arc] companion=${companion.id} ${stateBefore} → ${r.state} (${r.reason})`);
    }
    if (r.trustDelta) {
      const es = getEmotionStateWithDefaults(companion.id);
      const cur = Number(es.trust ?? 50);
      upsertEmotionState(companion.id, { trust: Math.max(0, Math.min(100, Math.round(cur + r.trustDelta))) });
    }
  } catch (e) {
    log('warn', `[Arc] 落库失败 companion=${companion.id}: ${e.message}`);
  }
}

/** 🔴 Phase4b 双写不双表达（§3.2）：冲突事件→引擎脉冲（表达源·同 event_id）；道歉→同源加速。仅闸 ON 调用。 */
function _engineDoubleWrite(companionId, signal, openEvent, now) {
  try {
    const kind = signal?.kind;
    if (kind === 'apology') {
      // 道歉 → 同源加速（再评价②·同 event_id 负面族全体回落）
      if (openEvent) reappraiseEngine(companionId, { type: 'resolve', event_id: String(openEvent.id) }, now);
      return;
    }
    // 冲突事件（taboo/harsh/pressure）→ 评价写脉冲（须有 openEvent 承 event_id·防双表达靠 E4 表达单源）
    if ((kind === 'taboo_hit' || kind === 'harsh_words' || kind === 'pressure_spam') && openEvent) {
      const sev = Number(signal.severity) || 1;
      const pulses = appraiseEvent(
        { kind, severe: sev >= 3, importance: Math.max(0.5, Math.min(2, sev / 2)), event_id: String(openEvent.id) },
        getEmotionPulses(companionId), now,
      );
      for (const p of pulses) insertEmotionPulse(companionId, p, now);
    }
  } catch (e) {
    log('warn', `[Arc] 引擎双写失败 companion=${companionId}: ${e.message}`);
  }
}

// 🔴 E5②(B1) self 自我消化接线（D4 §3③·isNextDay+过峰+概率三闸·每(上海)日至多一次·RUMINATE/floor 零触碰）。
// 确定性日 roll：hash(companionId+上海日)→[0,1)·同(上海)日稳定=每日一 roll（无 schema 节流：失败日整日不再试、
// 次日新 roll；命中日一刀后被消化脉冲 at→今日且降过峰→当日不再触）。isNextDay=存在【上一上海日】起、仍未决、
// 衰后仍过峰的非迁移负面（当日大情绪不许秒想通=isNextDay 前置排除）。命中→reappraiseEngine('self')=降 ×0.55 且清 unresolved。
const _dayNum = (date) => { const y = shanghaiYMD(date); return y.year * 10000 + y.month * 100 + y.day; };
function _dailyRoll(companionId, dayNum) {
  const s = `${companionId}|${dayNum}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;   // [0,1)·同(上海)日稳定
}
export function runSelfDigestTick(companion, now = new Date(), opts = {}) {
  try {
    const pulses = getEmotionPulses(companion.id);
    if (!pulses.length) return 0;
    const today = _dayNum(now);
    const hasNextDayPeaked = pulses.some((p) => {
      if (!EMO_NEGATIVE.includes(p.emotion) || p.source === 'arc_migration' || !p.unresolved) return false;
      return _dayNum(new Date(String(p.at).replace(' ', 'T'))) < today
        && decayEmotionIntensity(p, now) >= EMOTION_SELF_PEAK_MIN();
    });
    if (!hasNextDayPeaked) return 0;   // 当日/无过峰未决 → 不消化（当轮大情绪不许秒想通）
    const roll = opts.roll != null ? opts.roll : _dailyRoll(companion.id, today);
    return reappraiseEngine(companion.id, { type: 'self', isNextDay: true, roll }, now);
  } catch (e) {
    log('warn', `[Arc] self 自我消化失败 companion=${companion?.id}: ${e.message}`);
    return 0;
  }
}

/** 单 companion 时间结算（消息到来时 + 30min 批共用）。返回最新 arc_state */
export function runArcTimeTickOne(companion, now = new Date()) {
  try {
    const gateOn = emotionEngineOn(companion.id);
    // E0b 迁移 lazy 触发（迁移触发口·§0 开闸首次为真处·幂等：迁一次后 arc 清 normal·后续 SELECT 早返）
    if (gateOn) migrateArcToEngine(companion.id, now);
    let { arc_state, arc_state_changed_at } = getArcState(companion.id);
    // fail-open（§3.5）：未知 arc_state 串（sunset 后残留）→ 按 normal + warn（读侧家风）
    if (!ARC_STATES.includes(arc_state)) {
      log('warn', `[Arc] 未知 arc_state '${arc_state}' companion=${companion.id} → fail-open normal`);
      arc_state = 'normal';
    }
    const openEvent = getOpenRelationshipEvent(companion.id);
    const neglectStage = getNeglectStage(companion.last_user_reply_at, companion.attachment_style);
    const interactions = openEvent
      ? _countInboundSince(companion.wechat_user_id, companion.bot_id, openEvent.created_at)
      : 1;
    const r = tickArcOnTime({
      companionId: companion.id,   // 🔴 闸路由：dispatcher 据此 fork V2(ON)/Legacy(OFF)
      state: arc_state, stateChangedAt: arc_state_changed_at, style: companion.attachment_style,
      safeMode: !!Number(companion.safe_mode), openEvent, neglectStage,
      interactionsSinceEvent: interactions, now,
    });
    _applyResult(companion, r, { stateBefore: arc_state, openEvent, now });
    if (r.changed && r.state !== arc_state) {
      insertArcSignalLog(companion.id, {
        signalKind: 'time_decay', stateBefore: arc_state, stateAfter: r.state, reason: r.reason,
      });
    }
    let finalState = r.changed ? r.state : arc_state;
    // 🔴 E5②(B1)：self 次日自我消化——先于 calmed 检查（消化+清反刍后同源负面可数天量级跌破 floor→盘活 1c
    //   engine_calmed 活触发窗·解 E5 §1b「未道歉永反刍」+ §1c「calmed 两头堵 0/431」连锁）。
    if (gateOn) runSelfDigestTick(companion, now);
    // engine_calmed 收敛（引擎→arc 唯一通道·§3.3）：闸 ON 时引擎同源负面已平静 → arc 事件 resolved、态回 normal
    if (gateOn) {
      const calmed = engineCalmedCheck(companion.id, now);
      if (calmed.calmed) finalState = 'normal';
    }
    return finalState;
  } catch (e) {
    log('warn', `[Arc] time tick 失败 companion=${companion.id}: ${e.message}`);
    return 'normal';
  }
}

/**
 * 消息驱动 tick（bot.mjs reply pipeline）。
 * 返回 { arcState, active, directive, voiceConcern, category }——直接拼 prompt。
 */
export function runArcSignalTick(companion, { userText = '', escalationLevel = 0, inner = null, now = new Date(), periodContext = null } = {}) {
  const fallback = { arcState: 'normal', active: false, directive: '', voiceConcern: false, category: 'wound' };
  try {
    // 1) 先时间结算（消除 30min 批的表达空窗：neglect 升级/超时在消息到来时即时入账）
    runArcTimeTickOne(companion, now);

    const { arc_state, arc_state_changed_at } = getArcState(companion.id);
    let openEvent = getOpenRelationshipEvent(companion.id);

    // 2) 信号合成（regex 证据 + inner OS 结构化字段）
    let signal = composeArcSignal({
      userText, taboos: _getTaboos(companion.id), escalationLevel, inner,
    });
    // give_space：冷战/修复期他不纠缠、隔半天以上回来，且这条不是伤害——算"懂得给空间"
    if (!signal && (arc_state === 'cold' || arc_state === 'withdrawing' || arc_state === 'repairing')) {
      const idleH = _hoursSince(companion.last_user_reply_at, now);
      if (idleH != null && idleH >= 12) signal = { kind: 'give_space' };
    }

    let result = null;
    if (signal) {
      // v1.22 PR-L3：经前 PMS 上下文注入 tick（shadow-first，默认不生效；红线 A：仅经前+wound 入口
      // 影响敏感度判定/shadow，绝不碰 arcCtx.directive）。pmsActive 由本轮 periodContext 派生。
      const pmsActive = !!(periodContext && periodContext.phase === 'premenstrual' && !periodContext.safeModeBlocked);
      result = tickArcOnSignal({
        state: arc_state, stateChangedAt: arc_state_changed_at, style: companion.attachment_style,
        safeMode: !!Number(companion.safe_mode), openEvent, signal,
        todayEventCount: countTodayRelationshipEvents(companion.id, now),
        recentArchivedType: arc_state === 'normal_with_scar' ? getLastArchivedEventType(companion.id) : null,
        now, pmsActive, periodStateId: periodContext?.stateId ?? null,
      });
      const isHostile = signal.kind === 'taboo_hit' || signal.kind === 'harsh_words' || signal.kind === 'pressure_spam';
      _applyResult(companion, result, {
        stateBefore: arc_state, openEvent, triggerText: isHostile ? userText : '', now,
      });
      // debug 面板信号流水：有转移 / 有事件操作 **或有 PMS shadow** 才记（shadow 是观测点，
      // 即便 minor_absorbed 没转移也要落库才能算"M/N 次会改判"的分母，批注②⑥）。
      if (result.changed || result.eventOp || result.pmsShadow) {
        // 道歉信号细分 matched/generic（arc-digest 的道歉判定流水靠它）
        const kindLogged = signal.kind === 'apology'
          ? `apology_${signal.apologyKind === 'generic' ? 'generic' : 'matched'}`
          : signal.kind;
        const realLog = result.changed || result.eventOp;   // shadow-only 行不重复存原文（批注⑤）
        insertArcSignalLog(companion.id, {
          signalKind: kindLogged, severity: signal.severity ?? null,
          stateBefore: arc_state, stateAfter: result.state, reason: result.reason,
          innerTone: inner?.user_tone || null, perceivedHurt: inner?.perceived_hurt ?? null,
          userTextBrief: realLog ? userText : '',
          pmsShadow: result.pmsShadow ? JSON.stringify(result.pmsShadow) : null,
        });
      }
    }

    // 3) 表达上下文（用 tick 后的最新状态）
    const finalState = result?.changed ? result.state : arc_state;
    openEvent = getOpenRelationshipEvent(companion.id);
    // 🔴 Phase4b 引擎双写（冲突事件→脉冲 / 道歉→同源加速·仅闸 ON·表达仍走 arc directive 至 E4 表达单源落地）
    if (signal && emotionEngineOn(companion.id)) _engineDoubleWrite(companion.id, signal, openEvent, now);
    const voiceConcern = !!result?.voiceConcern;
    const category = openEvent ? eventCategory(openEvent.type) : 'wound';
    let reunionHint = '';
    if (finalState === 'repairing' && category === 'distance') {
      const ns = getNeglectStage(companion.last_user_reply_at, companion.attachment_style);
      reunionHint = buildReunionHint(ns, companion.attachment_style, companion.last_user_reply_at) || '';
    }
    // 🔴 ② 表达单源：voiceConcern（同轮"直说"信号·非 arc 态 tone）两臂保留；否则闸 ON→引擎 hint / 闸 OFF→arc 态 tone
    let directive;
    if (voiceConcern) {
      directive = buildArcToneDirective('normal', { category, voiceConcern: true, reunionHint, triggerText: openEvent?.trigger_text || '' });
    } else if (emotionEngineOn(companion.id)) {
      // 🔴 E5①：repaired=修复语境已发生（apology→repair_status='repairing'·getOpenRelationshipEvent 会返 repairing）
      //   →门控 X_ANGERSAD*/U_LOW_repair"和好叙事"·未修复冲突不叙述"他道了歉"（选择层事件语境闸）。
      const repaired = openEvent?.repair_status === 'repairing';
      directive = buildEngineHint(getEmotionPulses(companion.id), { arcEventType: openEvent?.type || null, repaired, companionId: companion.id }, now);   // arc 态 tone 下线·引擎上线
    } else {
      directive = buildArcToneDirective(finalState, { category, voiceConcern, reunionHint, triggerText: openEvent?.trigger_text || '' });
    }
    // companionId 随 ctx 透传：applyCrisisOverride 的埋点卡口靠它定位，调用方零感知
    return { arcState: finalState, active: !!directive, directive, voiceConcern, category, companionId: companion.id };
  } catch (e) {
    log('warn', `[Arc] signal tick 失败 companion=${companion?.id}: ${e.message}`);
    return fallback;
  }
}

/** proactive 路径的表达上下文（无消息信号，只读当前状态） */
export function getArcExpressionContext(companion) {
  try {
    const { arc_state } = getArcState(companion.id);
    const openEvent = getOpenRelationshipEvent(companion.id);
    // 🔴 ② 表达单源：闸 ON 时 directive 由引擎情绪档生成（arc normal 也可能有残余脉冲·故不按 arc 态早返）
    if (emotionEngineOn(companion.id)) {
      const repaired = openEvent?.repair_status === 'repairing';   // 🔴 E5① 事件语境闸（同 runArcSignalTick）
      const directive = buildEngineHint(getEmotionPulses(companion.id), { arcEventType: openEvent?.type || null, repaired, companionId: companion.id });
      return { arcState: arc_state, active: !!directive, directive, category: openEvent ? eventCategory(openEvent.type) : 'wound', openEvent };
    }
    if (arc_state === 'normal') return { arcState: 'normal', active: false, directive: '' };
    const category = openEvent ? eventCategory(openEvent.type) : 'wound';
    let reunionHint = '';
    if (arc_state === 'repairing' && category === 'distance') {
      const ns = getNeglectStage(companion.last_user_reply_at, companion.attachment_style);
      reunionHint = buildReunionHint(ns, companion.attachment_style, companion.last_user_reply_at) || '';
    }
    const directive = buildArcToneDirective(arc_state, { category, reunionHint, triggerText: openEvent?.trigger_text || '' });
    return { arcState: arc_state, active: !!directive, directive, category, openEvent };
  } catch {
    return { arcState: 'normal', active: false, directive: '' };
  }
}

/**
 * proactive 策略（docs/CONFLICT_ARC.md §5.4）：
 *   hurt ×0.7 禁告白 · cold ×0.4 禁告白/照片（anxious 留 1 条试探）·
 *   withdrawing ×0.15 基本沉默 · repairing 允许 1 条台阶消息（olive_branch）
 * 返回 { skip, forbidKinds, oliveBranch, oliveEventId, arcState }
 */
export function getArcProactivePolicy(companion, kind = null, rng = Math.random) {
  // 2026-06-22 早安永不被频率 skip 拦：morning 是「她还在」的基本温暖，受伤态也照发（语气由
  // buildArcToneDirective 收敛成安静早安），绝不被 arc 降频压成「消失」=越过矜持滑向冷淡。
  // 🔴 仅 morning：normal/away_probe 等其他 kind 的 arc 降频概率不变（away_probe 受伤时该受压）。
  const isMorning = kind === 'morning';
  const none = { skip: false, forbidKinds: [], oliveBranch: false, oliveEventId: null, arcState: 'normal' };
  try {
    const { arc_state } = getArcState(companion.id);
    if (arc_state === 'normal' || arc_state === 'normal_with_scar') return { ...none, arcState: arc_state };
    const openEvent = getOpenRelationshipEvent(companion.id);
    const oliveAvail = !!(openEvent && !Number(openEvent.olive_sent));
    const style = String(companion.attachment_style || 'secure').toLowerCase();

    if (arc_state === 'hurt') {
      return { skip: isMorning ? false : rng() > 0.7, forbidKinds: ['confession'], oliveBranch: false, oliveEventId: null, arcState: arc_state };
    }
    if (arc_state === 'cold') {
      // anxious cold 期会主动试探一条（"在忙吗"式低姿态探问·不自责·P3-17 去错框），消耗 olive 配额
      if (style === 'anxious' && oliveAvail) {
        return { skip: false, forbidKinds: ['confession', 'photo'], oliveBranch: true, oliveEventId: openEvent.id, arcState: arc_state };
      }
      return { skip: isMorning ? false : rng() > 0.4, forbidKinds: ['confession', 'photo'], oliveBranch: false, oliveEventId: null, arcState: arc_state };
    }
    if (arc_state === 'withdrawing') {
      return { skip: isMorning ? false : rng() > 0.15, forbidKinds: ['confession', 'photo'], oliveBranch: false, oliveEventId: null, arcState: arc_state };
    }
    if (arc_state === 'repairing') {
      return { skip: false, forbidKinds: ['confession'], oliveBranch: oliveAvail, oliveEventId: oliveAvail ? openEvent.id : null, arcState: arc_state };
    }
    return { ...none, arcState: arc_state };
  } catch {
    return none;
  }
}

/** 台阶消息已用（乐观置位：注入即消耗，防重复台阶） */
export function markOliveBranchSent(eventId) {
  try { updateRelationshipEvent(eventId, { olive_sent: 1 }); } catch {}
}

/** 台阶消息的 prompt 指令（proactive 注入） */
export function buildOliveBranchHint(arcState, category) {
  if (arcState === 'cold') {
    return `\n【★ 主动台阶 · 仅此一条】你们正在闹别扭，你还凉着，但你忍不住想试探一下他——发一条**短短的、放低一半姿态但不卑微**的消息："……在忙吗""在干嘛呢"这种。不解释、不撒娇、不道歉（错不在你），就是递一个小小的台阶，看他接不接。`;
  }
  return `\n【★ 主动台阶 · 仅此一条】你们正在和好，你想主动递个台阶让气氛松一点——发一条**轻轻的、带点不好意思的**消息："那天我语气也不太好啦""晚上想吃什么，我请你"这种。一条就好，别长篇大论、别旧事重提。`;
}

/**
 * 时间批：搭 plan_tasks 30 分钟批的便车（与 runEmotionRecalcBatch 同节奏，不新增定时器）。
 * 只跑活跃绑定的 companion（与情绪批同口径）。
 */
export function runArcTimeTickBatch() {
  let updated = 0, skipped = 0, errors = 0, total = 0;
  try {
    const rows = getDb().prepare(`
      SELECT c.id, c.user_id, c.bot_id, c.last_user_reply_at, c.attachment_style, c.safe_mode,
             c.arc_state, u.wechat_user_id
      FROM companions c
      JOIN users u ON u.id = c.user_id
      JOIN wechat_accounts wa ON wa.wechat_user_id = u.wechat_user_id AND wa.bot_id = c.bot_id
      WHERE wa.is_active = 1
    `).all();
    total = rows.length;
    for (const row of rows) {
      try {
        const before = row.arc_state || 'normal';
        const after = runArcTimeTickOne(row);
        if (after !== before) updated++; else skipped++;
      } catch (e) {
        errors++;
        log('warn', `[Arc] batch tick companion=${row.id} 异常: ${e.message}`);
      }
    }
    if (updated > 0) log('info', `[Arc] batch tick done updated=${updated} skipped=${skipped} errors=${errors} total=${total}`);
  } catch (e) {
    log('warn', `[Arc] batch tick 整体失败: ${e.message}`);
  }
  return { updated, skipped, errors, total };
}
