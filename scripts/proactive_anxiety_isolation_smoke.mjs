/**
 * proactive_anxiety_isolation_smoke —— P1-① 焦虑/脆弱隔离 + 灰度闸 两路红验（2026-06-25）。
 *
 * 灰度闸 PROACTIVE_ANXIETY_ISOLATION：关(默认)=旧 REAL_LIFE_RE 行为(脆弱也升格)；开=新否决(NEUTRAL ∧ !DISTRESS)。
 * 两路验红：
 *   🔴 闸关 → 旧行为(脆弱仍升格·证关掉=回旧行为·原操纵面在)；
 *   🔴 闸开 → 新否决(5 场景全过 + 词表覆盖 + 切分原则)。
 *   revert 任一即红。被动路径 / crisis 边界 静态钉死。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasRealContext, missYouVerdict } from '../src/proactive_policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; } else { fail++; console.log('  ✗', n); } };
const hrc = (t) => hasRealContext({ recentUserText: t });
const verdict = (t) => missYouVerdict({ content: '突然好想你', realContext: hrc(t) });

// ═════ 闸关（默认）→ 旧 REAL_LIFE_RE 行为（脆弱也升格·=上线前·灰度先关）═════
delete process.env.PROACTIVE_ANXIETY_ISOLATION;
ok(hrc('我好累压力大') === true, '闸关：焦虑"我好累压力大"仍升格(旧REAL_LIFE_RE·原操纵面·证关掉=回旧行为)');
ok(verdict('我好累压力大') === 'rewrite', '闸关：焦虑上下文→想你判 rewrite(旧版主动发)');
ok(hrc('我发烧了') === true, '闸关：脆弱"我发烧了"旧版仍升格');
ok(hrc('明天面试') === true, '闸关：中性升格');
ok(hrc('哈哈嗯嗯') === false, '闸关：纯闲聊不升格');
process.env.PROACTIVE_ANXIETY_ISOLATION = '0';
ok(hrc('我好累压力大') === true, '闸值"0"=关：仍旧行为(脆弱升格)');
process.env.PROACTIVE_ANXIETY_ISOLATION = 'false';
ok(hrc('我好累压力大') === true, '闸值"false"=关：仍旧行为');

// ═════ 闸开 → 新否决行为（5 场景 + 词表 + 切分原则）═════
process.env.PROACTIVE_ANXIETY_ISOLATION = '1';
ok(hrc('我好累压力大') === false, '闸开·场景2：焦虑"我好累压力大"→否决');
ok(verdict('我好累压力大') === 'drop', '闸开·场景2：焦虑上下文→想你判 drop(不主动发)');
ok(hrc('面试完被裁了') === false, '闸开·场景3：混合"面试完被裁了"→「被裁」veto(不漏)');
ok(hrc('明天面试') === true, '闸开·场景4：纯中性"明天面试"→升格(不误杀)');
ok(verdict('明天面试') === 'rewrite', '闸开·场景4：中性→想你判 rewrite');
ok(hrc('我发烧了') === false, '闸开·场景5：脆弱"我发烧了"→主动否决(drop)');
const botSrc = readFileSync(path.join(ROOT, 'src/bot.mjs'), 'utf-8');
ok(!/hasRealContext|REAL_LIFE_RE|DISTRESS_RE|NEUTRAL_RE/.test(botSrc), '场景5·被动钉死：bot.mjs 回复路径零引升格判定');

const distress = [
  ['身体', '我感冒发烧了'], ['睡眠', '昨晚失眠没睡'], ['疲惫', '今天好累好困'], ['心理', '我有点崩溃想哭'],
  ['感情', '我跟对象分手了'], ['工作', '我被裁了失业'], ['学业', '这次考砸了挂科'], ['家庭', '亲人病了住院'],
  ['霸凌', '被同事排挤打压PUA'], ['经济', '最近破产欠债还不起'], ['谐音', '最近好蕉绿'], ['绝望', '感觉活不下去了'],
];
for (const [c, t] of distress) ok(hrc(t) === false, `闸开·脆弱[${c}]"${t}"→否决`);
const neutral = ['我明天要考试', '周末去旅行', '在准备考研', '下午要答辩', '马上要交稿截止了', '这周搬家', '约了体检', '出差开会'];
for (const t of neutral) ok(hrc(t) === true, `闸开·中性"${t}"→升格`);
ok(hrc('在准备考研期末') === true, '闸开·切分：考研/期末=努力→升格');
ok(hrc('考研压力好大') === false, '闸开·切分：考研但"压力大"→veto');
ok(hrc('加班好累') === false, '闸开·切分：加班(已移入脆弱)→否决');

// ═════ 静态钉死 ═════
const src = readFileSync(path.join(ROOT, 'src/proactive_policy.mjs'), 'utf-8');
ok(/const REAL_LIFE_RE =/.test(src), '旧 REAL_LIFE_RE 保留(灰度闸关默认路径·与上线前一致)');
ok(/const NEUTRAL_RE =/.test(src) && /const DISTRESS_RE =/.test(src), '新双常量 NEUTRAL_RE/DISTRESS_RE 在');
ok(/PROACTIVE_ANXIETY_ISOLATION/.test(src), '灰度闸 PROACTIVE_ANXIETY_ISOLATION 已接');
ok(/crisis|detectCrisisLevel|硬接管/.test(src), 'crisis 边界注释在(DISTRESS≠crisis 分类器)');

delete process.env.PROACTIVE_ANXIETY_ISOLATION;
console.log(`\nproactive_anxiety_isolation_smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
