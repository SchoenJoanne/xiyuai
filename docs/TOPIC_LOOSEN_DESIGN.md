# 停板A 二轮设计稿：topic 松绑（回库对齐作息 + 放宽·红队改正版）

> 分支 `design/topic-followup` · 仅设计·不施工·不碰生产。
> 关联拍板（2026-06-25「topic 松绑」决议）：阻塞项取 **(a) 先回库 topic_opener 对齐作息 → 再按"更宽松"改**。
> 流程：盘点 4 路（回库策略 / 放宽点查码 / 取料扩面 / 不读沉默红线）→ 设计 → **对抗式红队**。
> 🔴🔴 铁律：触发源只挂**同步 reply 路径**（用户刚发消息才评估开话头）；沉默/走了绝不冒泡、绝不读沉默。放宽的是"**正聊着时多容易/多频繁起新话头**"，不是"她什么时候能主动"。

---

## 0. 🔴 红队改正先行：「太苛刻」的真根因不是门槛

红队实读代码（落行号），把设计的核心前提推翻又救回——**这才是停板A 二轮的真信息**：

> **`_topicOpenerOpenedBySession`（`bot.mjs:429`）是进程生命周期级计数器·永不重置**（全代码无 `.delete`/`.clear`/会话边界；`recentTurns` 是定长 16 轮滑窗、根本没有"会话"概念）。

- **现状 M=1 真实语义 = 「每 companion·每进程生命期·最多开 1 次新话头」**（直到服务重启），**不是**设计稿原以为的"每会话 1 次"。
- → **「topic 太苛刻/开话头太少」的真凶极可能是这个永不重置的计数器，不是 N=3 门槛**。只降 N 3→2 / M 1→2 收益甚微——M=2 在"进程级永不重置"下还是"整个进程生命期开 2 次"≈没放宽。
- **所以放宽的主刀必须落在计数器的重置语义上**，门槛降只是辅助。

红队另两条：
- 🔴 **gate④（话题告段落+回复变短）本轮撤下**：与 gate①（ack-streak≥2 已要求尾部连续短回）高度重叠；它能额外触发的唯一窗口是"短的实义短语"=**更可能是用户敷衍想走→开新话头=贴脸打断**（虽不读沉默，但"用内容信号误判想走"是同害旁路）；且其 turn-index 冷却建在 16 轮滑窗上**无可靠基准**。
- **S2**：`bot.mjs:962` 日志分母硬编码 `/1` 不是 `/${TOPIC_OPEN_MAX}`，M↑后读数误导，顺手改。

红队**证伪失败（=设计扎实）的部分**：回库炸作息风险（手工 port、proactive=0 改动硬门、只新增不删全为真）；fail-silent（取料空则不开不编实测在位）；不读沉默字面红线（放宽点确实零接触 `last_user_reply_at`/missing/tick·焊死行 `:86` 在位）。

---

## 1. 回库 plan（停板B 执行）— 红队核验全为真

**背景（盘点①+红队实证）**：main@`983dda9` 有作息无 topic；分支 `fix/proactive-topic`@`e70883d` 基点早于作息 6+ 提交、有 topic 无作息；生产 = 分支 **byte-for-byte 相同**。直接 merge 分支 → git 判"分支删除了 life_calendar/routine_profiles/proactive 作息接线" → **必炸作息**。

🔴 **会话间 PR 边界**：`fix/proactive-topic` 是别会话 OPEN 产出——**只读取其产出、手工 port 到当前 main，绝不 merge/改那个分支**。源取生产部署（=分支且已稳定跑）。

**Step 1 新增文件（零冲突）**：`cp` 生产的 `src/topic_opener.mjs` + `scripts/topic_opener_smoke.mjs` 进 main。
**Step 2 `bot.mjs` 接线**（手工·按盘点①）：import 三函数 / 计数器（见 §2.1 改成 per-day）/ 同步注入点（topicClosureSignal 三重闸 + buildTopicOpenerHint）/ 出站 `scrubTopicOpenerRedline`。四个 getter（getActiveLifeStates/listOpenLoops/getActiveCurrentWorks/getDailySchedule）**main 已全在**（db.mjs:402/3523/315/2349）。
**Step 3 `moderation.mjs`**：搬 `scrubTopicOpenerRedline` + 续话词正则（复用 `hitsConflictRedline`）。
**Step 4 `ci.yml`**：加 `topic_opener_smoke.mjs`（37/0）。
**Step 5 🔴 作息全保留·只新增不删**：`derivePersonaToneFlags`/`buildPersonaToneGuard`/`getDayContext`/`expectedActivityBand`/`life_calendar`/`routine_profiles` **一行不动**。
- 🔴 **硬验收门**：port 完成 `git diff --stat` 必须显示 **`proactive.mjs` 改动 = 0 行**（topic 只接 bot.mjs 同步路径，不接 proactive）。出现任何删行=误带旧分支语义→立即 abort。红队已证分支 proactive.mjs 不引用 topic 特性，此门成立。

---

## 2. 放宽设计（红队改正版）— 主刀=重置语义·辅刀=门槛

### 2.1 🔴 主刀：计数器从「进程级永不重置」改「每日预算」（治真根因）
- **现状**：`_topicOpenerOpenedBySession`（进程内存·永不重置）→ 每进程生命期每 companion 1 次。
- **改为**：**每日预算**——`{date, count}`，`date != 今日` 即重置 count=0（落库小字段 `topic_opens_today` 或进程内存带日期键；复用作息 `body_events_today` 同款"日界重置"范式，00:30 cron / 日期变更清零）。
- 🔴 **为什么是"每日"而非"每会话"**：定长 16 轮滑窗没有"会话"边界；用"时间间隔/沉默时长"定会话**会逼近读沉默红线**。**日界是日历事实、不是沉默信号**——既给了真实的重置语义，又零接触沉默。
- **预算默认 2–3/日**（env `PROACTIVE_TOPIC_OPEN_DAILY`）：从"整个进程开 1 次"→"每天 2–3 次"是数量级的松绑，且天然有上限不话痨。
- **仍只读用户刚发消息**：触发判定不变（同步路径），只是"还有没有额度"从进程级换成日级。✅ 零沉默接触。

### 2.2 辅刀：门槛 ack-streak ≥3 → ≥2（维护者①）
`topic_opener.mjs:31` 默认 3→2（注释同改）。**env 可调灰度不改码**。这是辅助——主刀（§2.1）解了"额度永不回"，门槛降才有意义（更易在每天的额度内触发）。仍在焊死行 `:86` 之后，只读已落来回。✅

### 2.3 🔴 gate④（话题告段落+回复变短）— 本轮撤下（红队 M2）
与 gate① 高度重叠；额外窗口=短实义短语=易打断想走的人；turn-index 冷却在滑窗上无基准。**不上**。维护者要的"更易开"由 §2.1（真根因）+ §2.2（门槛）兑现，足够且更安全。若日后仍嫌少，gate④ 二期单独设计（需先解决跨窗单调计数）。

### 2.4 S2 顺手修
`bot.mjs:962` 日志分母 `/1` → `/${每日预算}`，dogfood 读数才准。

---

## 3. 取料扩面（红队核验：保守版安全）
**硬约束不动**：`:130` 额度闸 + `:134` `if(!sources.length) return ''`——**档案池全空=零 hint=不开**。扩面只增"有结构化档案、空则天然 skip、不靠 LLM 编"的源。
- **本轮纳入**：works 的 craft/series 进度字段用满（"半成品织到哪/番追到第几集"）——**仍是 works 档案字段·零新数据源·空则 skip**。低风险，红队背书。
- 🔴 **维持不纳入**（会编/读沉默/泄隐私）：emotion_state（无事件锚→编虚构场景）、scene_state（活动无档案化→编承诺/物理违反）、memory_v2 抽象 preferences（recall 补全→编虚构书名）。
- **待拍板**：`companion_preferences` 的"事件型偏好"（"上次说想去看的展"）中风险——建议二期、仅当能映射到 open_loop 才用。
- **多样性来自**"让已有档案更易凑够 sources.length>0 + 每日有额度去开"，**不是**放松 fail-silent。

---

## 4. 质量/频率护栏
| 目标 | 机制 | 放宽后仍生效 |
|---|---|---|
| 从刚聊长出来（不突兀） | gate③ assistant 已收束（无钩子）+ gate① 用户已 ack | ✅ 不动 |
| 不挽留（反愧疚） | `scrubTopicOpenerRedline` 出站无条件扫愧疚/续话词 | ✅ 与门槛独立·总在岗 |
| 不话痨 | **每日预算 2–3**（天然上限）+ gate① ack-streak | ✅ 日预算即频率闸·无需 time 冷却 |
| 红线 0 | `hitsConflictRedline` 出站 drop | ✅ 独立兜底 |

**频率会不会太密**：每日预算是硬上限(2–3)，一天就算每次都满足 gate 也最多开 2–3 次——**不会话痨**。dogfood 量化闸：开话头/日均次、**打断率**、反愧疚 scrub 命中率、红线穿透=**必须 0**。越阈 → env 回调预算/门槛，不发版。

---

## 5. 🔴 验设计自检（逐条自攻）
| 自攻 | 结论 | 焊死它的 |
|---|---|---|
| 碰"读沉默"？ | **否** | 放宽全在 `:86` 焊死行后；每日预算用**日界**重置非时间间隔；零 `last_user_reply_at`/missing/tick；触发仍只挂 bot.mjs 同步 `processUserTurn` |
| 破坏 fail-silent？ | **否** | `:134` 空源不开不动；扩面只用 works 已有字段；emotion/scene/memory 不纳入 |
| 变话痨？ | **否** | 每日预算 2–3 硬上限 = 频率闸；无需 time 冷却 |
| 回库炸作息？ | **否** | 只新增不删 + `proactive.mjs=0改动` 硬门 + 绝不 merge 旧分支（红队实证地基为真） |
| gate④ 误判想走打断？ | **本轮规避** | gate④ 撤下（红队 M2） |
| "每日"会不会还是太死？ | 可调 | env `PROACTIVE_TOPIC_OPEN_DAILY` 灰度调；先 2 观测 |

---

## 6. 待维护者拍板清单 + 灰度
**待拍板**
1. 🔴 **主刀认不认**：把"开话头额度"从进程级永不重置改成**每日预算**（治真根因）——同意？默认 **2 还是 3/日**？
2. 门槛 `ACK_STREAK` 3→2：直接改码 还是 env 灰度先保 3？
3. gate④ 本轮撤下（建议）——确认二期再说？
4. 取料扩面：works craft/series 纳入（建议同意）；`companion_preferences` 暂缓二期；emotion/scene/memory 维持不纳入——确认？
5. S2 日志分母修——顺手带上？

**灰度（dogfood 白名单先跑·一次一个变量·06-12 归因纪律）**
- 阶梯：① 回库 + 行为维持现状（先验回库不炸作息·`proactive.mjs=0改动` 亲眼）→ ② 开每日预算=2 仅白名单 → ③ 观测一周达标再评门槛降2 / 预算升3。
- 🔴 收口证据亲眼：红线穿透/作息删除等"零"一律实跑看空输出，不靠解释退出码。

---

## 7. 停板B 怎么走（拍板后）
回库代码走功能 PR（topic_opener 新增 + bot/moderation/ci 接线 + 每日预算改造 + 门槛/S2）；🔴 记账走**独立小提交直入 main**不搭 PR 车。验收：`topic_opener_smoke` 实跑绿 + 坏版本验红 + `proactive.mjs=0改动` 亲眼 + 每日预算重置 smoke + dogfood 灰度量化闸。

---

*停板A 二轮稿完 · 红队改正（真根因=永不重置计数器·gate④ 撤下）· 等维护者审 · 不施工。*
