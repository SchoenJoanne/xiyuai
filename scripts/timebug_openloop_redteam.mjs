/**
 * timebug_openloop_redteam.mjs — 时间感知bug C线修法·坏版本验红(must-pass·进 CI)
 *
 * 停板B:buildOpenLoopsHint 注入带确定性时间状态(dueStatus)·过期不再复读死文本"明天"。
 * 锁死:①dueStatus 6 边界(尤其"今天"off-by-one 与"昨天/过去N天"bug核心)②注入端到端过期相对化
 *      ③关掉 dueStatus→复现死文本复读(红)·开→相对化正确(绿)④null/脏 fail-open⑤appointment 叠加精简。
 * 🔴 用独立临时库(DB_PATH=/tmp)·每场景独立 companion·关外键(不影响被测注入格式)·零碰真实数据。
 * 跑:node scripts/timebug_openloop_redteam.mjs
 */
import { getDb, saveOpenLoop, shanghaiDateKey } from '../src/db.mjs';
import { dueStatus, buildOpenLoopsHint } from '../src/open_loops.mjs';
import { existsSync, unlinkSync } from 'node:fs';

if (!process.env.DB_PATH) { console.error('🔴 必须隔离库跑:  DB_PATH=/tmp/timebug_rt_$$.db node scripts/timebug_openloop_redteam.mjs'); process.exit(2); }
getDb().pragma('foreign_keys = OFF');   // 临时库无 companions 行·关外键(只测注入格式逻辑)

let p = 0, f = 0;
const ok = (n, c) => c ? p++ : (f++, console.error('  ✗', n));
const addDays = (n) => shanghaiDateKey(new Date(Date.now() + n * 86400000));   // 相对真实今天·结果确定

// ── A. dueStatus 6 边界(确定性单测) ──────────────────────────────────────
console.log('── A. dueStatus 6 边界 ──');
ok('未来(≥2天)→future〔还有N天〕', (() => { const s = dueStatus('2026-07-10', '2026-07-02'); return s && s.phase === 'future' && s.tag.includes('还有8天'); })());
ok('明天(1)→tomorrow〔就在明天〕', (() => { const s = dueStatus('2026-07-03', '2026-07-02'); return s && s.phase === 'tomorrow' && s.tag.includes('就在明天'); })());
ok('🔴今天(0)→today 不误判过去(off-by-one)', (() => { const s = dueStatus('2026-07-02', '2026-07-02'); return s && s.phase === 'today' && s.tag.includes('就是今天'); })());
ok('🔴昨天(-1)→past〔已过去1天〕(bug核心)', (() => { const s = dueStatus('2026-07-01', '2026-07-02'); return s && s.phase === 'past' && s.tag.includes('已经过去1天'); })());
ok('🔴过去N天(-3)→past〔已过去3天·问后来〕(bug核心)', (() => { const s = dueStatus('2026-06-29', '2026-07-02'); return s && s.phase === 'past' && s.tag.includes('已经过去3天') && s.tag.includes('别当成还没发生'); })());
ok('null due_at→null(无时效·不加标注)', dueStatus(null, '2026-07-02') === null);
ok('脏 due_at"明天"→null(fail-open)', dueStatus('明天', '2026-07-02') === null);
ok('非法日期"2026-13-99"→null(fail-open)', dueStatus('2026-13-99', '2026-07-02') === null);
ok('today 脏→null(fail-open)', dueStatus('2026-07-02', '') === null);

// ── B. buildOpenLoopsHint 端到端(每场景独立 companion·避 slice/置顶干扰) ──
console.log('── B. buildOpenLoopsHint 注入端到端 ──');
const mk = (cid, title, dueAt, kind = 'user_said') => { saveOpenLoop({ companionId: cid, title, dueAt, emotionalWeight: 60, loopKind: kind }); return buildOpenLoopsHint(cid); };

const hPast = mk('rt_past', '他明天去考试', addDays(-3));
ok('过期项:含 title 且带〔已过去…〕(不再裸"明天")', /他明天去考试/.test(hPast) && /已经过去3天/.test(hPast) && /别当成还没发生/.test(hPast));
ok('过期项:注入头改写(以此为准/问问后来)·非旧"别当没发生过·主动提起"', /以此为准/.test(hPast) && /问问后来/.test(hPast) && !/别当没发生过，自然时可主动提起/.test(hPast));

const hTom = mk('rt_tom', '他明天面试', addDays(1));
ok('明天项→〔就在明天〕', /他明天面试/.test(hTom) && /就在明天/.test(hTom));

const hToday = mk('rt_today', '他今天体检', addDays(0));
ok('今天项→〔就是今天·可以关心一下〕', /他今天体检/.test(hToday) && /就是今天/.test(hToday) && /可以关心一下/.test(hToday));

const hFut = mk('rt_fut', '他下周搬家', addDays(8));
ok('未来项→〔还有8天〕', /他下周搬家/.test(hFut) && /还有8天/.test(hFut));

const hNull = mk('rt_null', '他想买手办', null);
ok('null 无时效项→该项行无〔〕标注(不误标过期·注入头提及〔〕不算)', /他想买手办/.test(hNull) && !/他想买手办[^\n]*〔/.test(hNull));

// appointment 叠加协调(确认点③)
const hApptPast = mk('rt_appt_past', '约了一起吃饭', addDays(-2), 'appointment');
ok('过期约定→丢"还没兑现"·只留〔已过去…〕(不冗余)', /约了一起吃饭/.test(hApptPast) && /已经过去2天/.test(hApptPast) && !/还没兑现/.test(hApptPast));
const hApptFut = mk('rt_appt_fut', '约了周末看电影', addDays(3), 'appointment');
ok('未过期约定→保留"还没兑现"+〔还有3天〕', /约了周末看电影/.test(hApptFut) && /你俩的约定，还没兑现/.test(hApptFut) && /还有3天/.test(hApptFut));

// ── C. 坏版本验红(证守卫非 no-op) ────────────────────────────────────────
console.log('── C. 坏版本验红 ──');
// C1 关掉 dueStatus = 旧渲染(死文本复读)。同一断言:过期项必须相对化。
const pastRelativized = (h) => /他明天去考试/.test(h) && /已经过去/.test(h);
const OLD_RENDER = `\n【你还记得这些没了结的事】（别忘了；约定没兑现别当没发生过，自然时可主动提起）\n- 他明天去考试`;
ok('C1 real(dueStatus 开)过期项相对化=绿', pastRelativized(hPast));
ok('C1 坏版本(dueStatus 关=旧渲染)被同一断言判红', !pastRelativized(OLD_RENDER));
// C2 off-by-one:把今天误判过去。real 必须 today、坏版本才 past。
const badDue = (dueAt, todayKey) => { const days = Math.round((Date.parse(dueAt + 'T00:00:00+08:00') - Date.parse(todayKey + 'T00:00:00+08:00')) / 86400000); return days >= 1 ? { phase: 'future' } : { phase: 'past' }; };
ok('C2 real:今天=today(不误判过去)=绿', dueStatus('2026-07-02', '2026-07-02').phase === 'today');
ok('C2 坏版本 off-by-one:今天被误判 past=红(证边界守卫有意义)', badDue('2026-07-02', '2026-07-02').phase === 'past');

// cleanup 临时库
for (const fp of [process.env.DB_PATH, process.env.DB_PATH + '-wal', process.env.DB_PATH + '-shm']) try { if (existsSync(fp)) unlinkSync(fp); } catch {}
console.log(`\ntimebug_openloop_redteam: ${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
