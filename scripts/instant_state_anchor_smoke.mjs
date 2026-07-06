/**
 * instant_state_anchor_smoke.mjs — P2→P1 即时状态锚定·红验（停板B·2026-06-24）
 *
 * 锁死（must-pass）：
 *   ① 合理态 anchor：工作日久醒→禁刚醒+禁在家 / 🔴schedule override(在家)→只禁刚醒不禁在家 /
 *      🔴周末→不硬禁刚醒(补觉午睡合理) / 已醒 OR last_proactive 兜底 / presence=null→''
 *   ② 已声明态 anchor：showered 几小时前→禁二次"别说成现在才刚发生" / 🔴recency<1h→不锚
 *   ③ 🔴坏版本验红：关 anchor(presence=null)→工作日"刚醒"无禁锚=飘复现；开→被禁
 *   ④ 🔴 merge 白名单：showered/woke 收·🔴吃饭(ate)不收=让位 food_state / clear 清空（db·/tmp）
 *   ⑤ false-negation（"还没洗澡呢"/比喻不误记）由 LLM extractor 过滤=真LLM 沙箱验，非纯函数（注释说明）
 *
 * 跑：DB_PATH=/tmp/ia_smoke.db node scripts/instant_state_anchor_smoke.mjs
 */
import { buildPresenceAnchor } from '../src/companion.mjs';
import { getDb, getBodyEventsToday, mergeBodyEventsToday, clearBodyEventsTodayAll } from '../src/db.mjs';
import { BODY_HINT_RE } from '../src/memory.mjs';

let p = 0, f = 0;
const ck = (n, c) => c ? p++ : (f++, console.error('  ✗', n));
const A = (presence, sched, now) => buildPresenceAnchor({ age: 24 }, presence, sched, now);
const WED_16 = new Date('2026-06-24T08:00:00Z');   // 周三 16:00 CST
const SAT_16 = new Date('2026-06-27T08:00:00Z');   // 周六 16:00 CST
const WOKE_0730 = new Date('2026-06-23T23:30:00Z').getTime();   // 今天 07:30 CST
const SENT_AM = new Date('2026-06-23T23:00:00Z').getTime();     // 今早 07:00 CST 发过 proactive

// ── ① 合理态 anchor ───────────────────────────────────────────────────────────
console.log('— ① 合理态 anchor —');
{
  // 完整作息系统：② work 锚已从「age 派生 9-18」升级为「expectedBand 驱动」（band 由调用方按身份+dayContext 算好传入）。
  const ACT_BAND = { dayContext: { dayKind: 'active' }, expectedBand: { act: '上班', place: '公司' } };
  const a = A({ wokeAt: WOKE_0730, isSleeping: false, ...ACT_BAND }, { items: [{ time: '09:00', activity: '上班' }] }, WED_16);
  ck('工作日久醒 → 禁刚醒', /不是刚醒|别说"刚醒/.test(a));
  ck('工作日上班 band → 禁"在家躺/午睡/刚起床"（band 驱动）', /别说成"在家躺着/.test(a) && /通常在公司上班/.test(a));
  // 🔴 schedule override：日程明确在家休息 → 不禁在家（只剩禁刚醒）
  const ov = A({ wokeAt: WOKE_0730, isSleeping: false, ...ACT_BAND }, { items: [{ time: '14:00', activity: '在家休息' }] }, WED_16);
  ck('🔴 schedule override(在家休息) → 不禁在家(work 锚撤)', !/通常在/.test(ov));
  ck('schedule override 下仍禁刚醒(已醒久)', /不是刚醒/.test(ov));
  // 🔴 周末 → 不硬禁刚醒（补觉/午睡合理）
  ck('🔴 周末同时间 → 不硬禁刚醒(补觉合理)', !/不是刚醒/.test(A({ wokeAt: WOKE_0730, isSleeping: false }, null, SAT_16)));
  // 已醒 OR last_proactive_sent_at 兜底（wokeAt 缺/不准时靠"今早发过 proactive"判已醒）
  ck('已醒兜底：wokeAt=0 但今早发过 proactive → 仍禁刚醒', /不是刚醒/.test(A({ wokeAt: 0, lastProactiveSentAt: SENT_AM, isSleeping: false }, null, WED_16)));
  // presence=null / 在睡 → 空
  ck('presence=null → 空串(老调用零影响)', A(null, null, WED_16) === '');
  ck('isSleeping 时不禁刚醒(她真在睡窗)', !/不是刚醒/.test(A({ wokeAt: WOKE_0730, isSleeping: true }, null, WED_16)));
}

// ── ② 已声明态 anchor（recency 衰减 + 二次声明禁）─────────────────────────────────
console.log('\n— ② 已声明态 anchor —');
{
  const a = A({ wokeAt: WOKE_0730, isSleeping: false, bodyEventsToday: { showered: { at: WOKE_0730 } } }, null, WED_16);
  ck('今早洗过澡(9h前) → 禁傍晚二次"别说成现在才刚发生"', /就说过洗澡|别把它说成现在才刚发生/.test(a));
  ck('洗澡 ≥3h → 提示头发早干了', /头发早干了/.test(a));
  // 🔴 recency 衰减：<1h 前刚声明 → 不锚（她可能正在说这件事）
  const recent = A({ wokeAt: WOKE_0730, isSleeping: false, bodyEventsToday: { showered: { at: WED_16.getTime() - 20 * 60000 } } }, null, WED_16);
  ck('🔴 recency<1h(20分前刚说洗澡) → 不锚(她可能正在说)', !/就说过洗澡/.test(recent));
}

// ── ③ 🔴 坏版本验红（anchor 是载荷·关→飘 / 开→治）────────────────────────────────
console.log('\n— ③ 🔴 坏版本验红 —');
{
  const off = A(null, null, WED_16);   // 关 anchor（部署前=纯 ad-lib）
  ck('坏版本(关 anchor) 工作日下午无"禁刚醒"锚 = 飘复现', !/不是刚醒/.test(off));
  const on = A({ wokeAt: WOKE_0730, isSleeping: false, bodyEventsToday: { showered: { at: WOKE_0730 } } }, { items: [{ time: '09:00', activity: '上班' }] }, WED_16);
  ck('真版本(开 anchor) 同情形 → 禁刚醒 + 禁二次洗澡 = 治', /不是刚醒/.test(on) && /别把它说成现在才刚发生/.test(on));
}

// ── ④ 🔴 merge 白名单（db·吃饭不收=让位 food_state）──────────────────────────────
console.log('\n— ④ 🔴 merge 白名单（db）—');
{
  const id = 990001;
  try {
    getDb().pragma('foreign_keys = OFF');   // /tmp 抛弃库·只测 merge 白名单逻辑·免建 FK 父行
    getDb().prepare('INSERT OR REPLACE INTO companions (id, user_id, bot_id, name) VALUES (?,1,?,?)').run(id, 'iatest', '阿测');
    mergeBodyEventsToday(id, { showered: { at: 111 }, woke: { at: 222 }, ate: { at: 333 }, dreamed: { at: 444 } });
    const ev = getBodyEventsToday(id);
    ck('showered/woke/dreamed 收', ev.showered && ev.woke && ev.dreamed);
    ck('🔴 吃饭(ate) 不收=让位 food_state 白名单', !ev.ate);
    clearBodyEventsTodayAll();
    ck('clearBodyEventsTodayAll → 清空', !Object.keys(getBodyEventsToday(id)).length);
    getDb().prepare('DELETE FROM companions WHERE id = ?').run(id);
  } catch (e) { ck('db merge 白名单（建测试 companion 跑通）', false); console.error('   db err:', e.message); }
}

// ── ⑤ false-negation 说明（非纯函数·真LLM 沙箱验）─────────────────────────────────
console.log('\n— ⑤ false-negation 由 LLM extractor 过滤（真LLM 沙箱验·此处不断言）—');
console.log('  「还没洗澡呢」「像三天没洗澡」「等下要洗」→ 不记 = BODY_EVENTS_PROMPT/her_body_events 的 LLM 理解过滤·非正则·见沙箱回归');

// ── ⑥ 🔴 proactive 预筛门 BODY_HINT_RE（宁可多抽不可漏抽：四类身体态线索全命中 + 非身体态跳过）────
console.log('\n— ⑥ 🔴 预筛门 BODY_HINT_RE —');
for (const t of ['刚洗完澡 头发还滴着水', '在擦头发呢', '刚醒迷迷糊糊', '做了个梦梦到你', '还没洗澡呢', '刚睡醒', '头发还湿着', '刚起床', '补觉补到现在', '赖床不想起来'])
  ck(`身体态线索命中(不漏抽): "${t}"`, BODY_HINT_RE.test(t));
for (const t of ['今天忙不忙呀', '看了个电影超好看', '突然想找你', '好无聊啊', '新布丁抢到最后一个'])
  ck(`非身体态→跳过(省调用): "${t}"`, !BODY_HINT_RE.test(t));

console.log(`\n${f === 0 ? '✅' : '🔴'} instant_state_anchor_smoke: ${p} pass · ${f} fail`);
process.exit(f === 0 ? 0 : 1);
