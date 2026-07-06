# 完整作息 / 日程系统 — 设计稿（停板A）

> 分支 `design/daily-schedule-system` · 仅设计·不施工·不碰生产。
> 定位：P2 主体（即时状态锚定的根本底座）。即时状态锚定（已部署 `2668b9f`）只锚「她记得自己今天干过什么」；本系统补「她今天**本来该**干什么」——按身份的真实作息，喂给日程生成与即时态锚定，让三路径的「合理态推导」从『age 数值 + 工作日/周末』升级到『身份作息 + 学期/假期日历』。
>
> **一句话结论**：这不是从零造，是**三件事**——①把已有的「4 档年龄模板」升级成「5 身份作息档（含子形态 + 个体偏移）」；②补上**整个缺失的日历轴**（学期/寒暑假/法定节假日），同时喂日程生成与 anchor 推导；③**焊死一条现已被违反的红线**——现有 `tryLockSchedule` 正在从用户活跃时间学她的睡觉/起床时间，必须断掉。
>
> 🔴 红线（贯穿全稿）：**她的作息是她自己的真实节奏，绝不围着用户在线时间转。** 纯连贯性/真实性，不碰情绪强度/黏人/占有（那是另两笔 backlog）。

---

## 0. 停板A 边界

- 本稿 = **研究 + 盘点 + 设计**，到此给维护者审。**不写一行实现代码、不碰生产、不并 main。**
- 实现/坏版本验红/审实现 = 停板B（维护者拍板后另起）。
- 第 5 节「待拍板清单」是请维护者在停板A 裁的决策点；第 4 节「验设计自检」对照维护者给的 4 条验收重点逐条交代。

---

## 1. 研究：五身份真实作息档案（web 取证·分身份建模）

> 五身份独立 web 研究（知乎/小红书/教育部/高校教务/考研帮/牛客等，含出处），核心纪律：**时间给区间不给单点**（个体偏移）、**标南北/季节**（尤其洗澡）、**绝不混成统一模板**。下表是建模可直接消费的蒸馏；完整档案与出处见会话研究记录，关键数字已交叉印证。

### 1.1 五身份作息基线（蒸馏·建模输入）

| 维度 | 高中生(16-18) | 大学生(19-22) | 上班族(22-30) | 考研/考公(21-26) | 毕业过渡(21-25) |
|---|---|---|---|---|---|
| **起床** | 5:40–6:40（住校更早） | 课表决定：早八 6:50–7:30 / 无早课睡到 9–11 | a朝九 7:00–7:40 / b996 8:00–9:30 / c轮班全天候 | 自律 6:00–6:30 / 真实多 6:30–7:30 | 论文期 10:30–13:00 / 实习 7–9 / 求职 10–13（最乱） |
| **睡觉** | 22:00–01:00（住校熄灯早/走读熬夜） | 23:00–次日1:00（24:00 峰值） | a 22:30–24:00 / b 0:00–1:30(<6h) / c 随班次 | 23:00–23:30（冲刺期对齐考试钟） | 1:00–4:00 / 赶due通宵（方差最大） |
| **白天主轴** | 上课+晚自习（被铃声/熄灯锁死） | 有课/无课两套，自由度极高 | 通勤+工时锁死，几无自主 | 早中晚三段制、图书馆三点一线 | 论文爆肝/实习打杂/海投焦虑（阶段驱动） |
| **洗澡** | 晚 21:30–23:00，住校抢热水/限时 | 晚 22:00–23:30，宿舍澡堂限时 | 晚 20:30–24:00，累到拖延/不洗 | 晚 22:00–23:30，省时 | 晚为主，压力期省略/紊乱 |
| **三餐** | 早常省、食堂为主 | 早约47%跳过、外卖/食堂 | 早通勤路上/不吃、午工作餐、晚偏晚 | 规律但敷衍、续命式 | 跳早饭、外卖度日、压力期没胃口 |
| **周末** | 单休唯一懒觉窗(睡9–11)/补课作业蚕食 | 宅(≈无课日) vs 出门 两套 | 补觉(睡9–13)+家务+社交补偿 | 放半天(常伴愧疚)、背单词不断 | 工作日/周末界限模糊(实习除外) |
| **长假/假期** | 寒暑假晚睡晚起 vs 高三准上学态 | 寒暑假黑白颠倒/实习/回家 | 法定假位移型(回家/旅游) vs 躺平 | 冲刺期收紧、考完报复性放松 | 阶段切换定义一切(交稿/拿offer后骤松) |
| **🔴 个体偏移轴** | 住校/走读·年级·校强度谱 | 卷王/摆烂·有早课/无·社牛/宅 | 子形态a/b/c·通勤长短·加班频率 | 自律/焦虑·一战在校/二战脱产·倒计时阶段 | 处境a论文/b实习/c求职·是否临近due面试 |
| **最不可混淆特征** | 被学校逐分钟锁死，娱乐碎片化，唯一奢侈是周末懒觉 | 有课/无课两套，可光明正大睡到中午、假期黑白颠倒 | 被通勤+工时绑死，睡眠/社交/洗澡全挤到夜里和周末补偿 | 自律+倒计时+生活极简，生物钟硬对齐考试时段 | 没有自己的锚点，作息是阶段的影子，方差最大 |

### 1.2 三条跨身份铁律（研究共识·建模硬约束）

1. **洗澡晚上为主**（全五身份一致）；频率**南方每天 / 北方隔天~三天**（《中国皮肤清洁指南》2–3 天一次印证北方）。早上洗澡是少数例外，不能当默认。→ 印证即时状态锚定「一天洗两次澡」就是 bug。
2. **周末 ≠ 工作日是两套人格**，长假 ≠ 周末（周末=就地补偿/补觉，长假=位移型/回家旅游或彻底躺平）。
3. **学生身份有「学期 vs 寒暑假」第三态**，作息完全不同；上班族有「法定节假日」位移态。**这两个日历维度现在系统完全没有**（见 2.4）。

---

## 2. 盘点：现状事实底图（核实·别假设·file:line 取证）

### 2.1 日程生成「已存在」——本系统是升级不是新建

- **生成器**：`plan_tasks.mjs:264 generateScheduleFor()`，每天 00:30（上海时区）`runDailySchedules()` 批量，LLM 生成结构化 JSON：`{items:[{time,activity,importance}]×8–12, mood_arc, mood_segments}`，存 `companion_daily_schedule(companion_id,date_key,schedule_json,mood_arc,mood_segments)`（`db.mjs:876-884`）。
- **已有身份分流**：`plan_tasks.mjs:366-377 ageOccupationHint(age,isWeekend,roleTitle)` 已按**年龄 4 档**给作息模板（16-18 高中 / 19-22 大学 / 23-35 上班 / 35+ 社会人）＋已分**工作日/周末**。提示词明确禁「高中生工作日不要出现『在公司』『开会』」。
- **硬约束常数**：日程覆盖 `07:00–23:30`（`plan_tasks.mjs:310,323`）——产品常数，**不来自 sleep_schedule**（解耦，好）。
- **缺口（= 本系统要补的）**：
  - 只有 4 **年龄档**，不是 5 **身份**：考研/考公、毕业过渡、996 vs 朝九晚五 全被压进「19-22 大学」或「23-35 上班」一档；`role_title`（"邻家女孩"）只是软文本提示，不是结构化作息身份。
  - **零日历轴**：1/2/7/8 月按 `isWeekend` 当普通工作日/周末，寒暑假被当上学日；法定节假日不影响 occupationHint。
  - `07:00–23:30` 硬窗装不下真考研党 6:00 起、996 党 1:00 睡。

### 2.2 🔴🔴 红线已被违反：她的睡眠时间正在向用户活跃时间漂移

**这是本次盘点最重要的发现，且是现状 bug，不是设计选项。**

- 链路：每条用户消息 → `sleep.mjs:180 recordUserActivitySample()` 记下用户当天 `first_msg`/`last_msg` 时刻（存 `observed_samples_json`，留 14 天）→ 每天 03:40 `tryLockSchedule()`（`sleep.mjs:219-258`）：
  ```
  bedMin  = median(用户 last_msg)  + 30   // 「她比你晚睡 30min」
  wakeMin = median(用户 first_msg) - 10    // 「她比你早起 10min」
  ```
  观测 7 天后 `learn_state='locked'`，写 `bed_time/wake_time`。
- **后果**：用户熬夜到凌晨 2 点 → 她学成 2:30 睡；用户早 7 点冒泡 → 她学成 6:50 醒。**她的作息被用户的在线时间牵着走 = 正是要焊死的「围着用户转」反模式**（滑向 engagement：留住用户而扭曲她）。
- **泄漏面（学到的 bed/wake 流向何处）**：盘点确认它**不进日程内容生成**（`generateScheduleFor` 不读 bed_time/wake_time，全局 grep 0 命中——这部分干净）。但它流向三处真实行为：
  1. `sleep.mjs:148 maybeSleepBlock` 睡眠拦截（她几点「睡了」不回消息）；
  2. 晚安/早安主动消息时点（`plan_tasks.mjs` tick）；
  3. **即时状态锚定的 `presence.wokeAt`**（`bot.mjs:895 / proactive.mjs:850` 取 `today_wake_at` → `buildPresenceAnchor` 的「已醒时长禁刚醒」锚）。
- → 焊死方案见 3.3。**这是停板A 头号待拍板项。**

### 2.3 三引擎边界：别重复造、别打架

| 引擎 | 实际建模 | 与作息的关系 | 结论 |
|---|---|---|---|
| `life_state.mjs`(207行) | **生理期/小病/外伤状态机**（`LIFE_KIND_CONFIG`=period/minor_illness/injury），经期确定性周期派生 | **零日常作息**，不知道几点起/今天行程 | **不可当作息源**；可作「状态修饰器」（经期重日避体力活，读 `getActivePeriodContext()`） |
| `current_works.mjs`(453行) | 手头项目（在看的书/手帐），生命周期换档 | `buildScheduleWorksHint()`@169 **已是「状态源→日程注入」范式**，且注释**明确预留 life_state/未来状态源的同级注入位** | **复用注入范式**：新身份作息 hint 在同位置注入；works 当活动素材源 |
| `emotion_state.mjs`(919行) | 7 维情绪 | `derivePresenceFromSchedule(dailySchedule,nowMin)`@704 **已把日程→availability/attention**；夜间 energy 衰减等内部时段规则 | **日程是情绪的输入（单向箭头）**；新系统产出更好的 dailySchedule 喂它，**不自己算 availability、不写情绪** |

🔴 **单向箭头铁律**（盘点B 结论）：`身份作息 → dailySchedule → presence/情绪hint`，全程单向，作息系统**永不写 emotion_state、永不读情绪当输入**。这是「不碰情绪」红线的架构落地。

### 2.4 即时状态锚定（已部署）的缺口 = 本系统的接入点

- `companion.mjs:790 buildPresenceAnchor` 现有合理态推导三规则：① 已醒>4h 禁刚醒（周末放宽、OR last_proactive）② **工作日 9-18 锚「上班/上课」**（age≥23 上班 / 否则上课；`schedSaysHome` 正则可被当日日程覆盖）③ body_events 已声明态。
- **唯一日历维度 = 工作日/周末（getDay 派生）**。**完全无学期/寒暑假/节假日，无按身份作息。**
- 具体误锚场景（盘点C 举证）：暑假大学生被当工作日锚「在学校/上班」（`schedSaysHome` 只看当日日程关键词，假期无保护）；考研党工作日该在自习室却被锚「上班」；996 党 9:00 还在通勤却被锚「在公司」。
- presence 扩展面（已识别）：需新增 `dayType`（weekday/weekend/holiday/vacation）、`academicPhase`、`currentExpectedActivity` 等，由调用方算好传入（`companion.mjs` 维持零依赖纯函数契约）。
- 顺手缺口：proactive 路径 `presence.isSleeping` 硬编码 `false`（`proactive.mjs:850`）——独立小 bug，纳入本系统一并修。

---

## 3. 设计

### 3.0 架构总览（一张图）

```
                       ┌─────────────────────────────────────────┐
  companion.life_identity ──┐                                     │
  (新结构化身份字段)         ├─► ROUTINE_PROFILES[identity]        │ 单一事实源
  companion.id ──► 个体偏移 ─┘   (五身份作息基线 + 子形态)          │ (profile + calendar)
                                                                  │
  dateKey ──► getDayContext(identity,date) ──► {dayType,           │
  (新 life_calendar.mjs)        学期/寒暑假/法定节假日/考研倒计时}  │
                       └──────────────┬───────────────────────────┘
                                      │ 喂给两处（共享同一源 → 不打架）
                  ┌───────────────────┴────────────────────┐
                  ▼                                         ▼
   ① 日程生成 generateScheduleFor                ② 即时态 buildPresenceAnchor
      buildRoutineHint() 注入                      dayContext+profile 推「此刻合理态」
      (镜像 buildScheduleWorksHint 范式)           (替代 age 派生的 9-18 work 锚)
                  │                                         │
                  ▼ dailySchedule                          ▼ 否定式硬锚
   ③ emotion derivePresenceFromSchedule(单向消费)   ③ life_state 经期(只读修饰器·可选)
```

### 3.1 身份模型（ROUTINE_PROFILES + 个体偏移）

**决策：引入结构化作息身份轴，与 `role_title`（人设风味）正交。**

- 现状把「作息身份」和「人设风味」混在一起：`role_title`="邻家女孩"（是性格风味）+ `age`（推作息）。新设计把**作息身份**独立成一个轴。
- 新字段（DB 迁移）：`companion.life_identity` ∈ `{highschool, college, worker, exam_prep, fresh_grad}`（5 身份），加可选子形态 `life_subform`（worker: `nine_to_five`/`996`/`shift`；fresh_grad: `thesis`/`intern`/`jobhunt`；exam_prep: `fulltime`/`in_school`）。
- **默认值（向后兼容）**：未设时由 age 推（16-18→highschool，19-22→college，23+→worker），子形态给身份默认（worker→nine_to_five）。存量 companion 零配置即用，行为不劣于现状。
- 🔴 **个体偏移（防「所有大学生一个样」）**：每身份的 `ROUTINE_PROFILES[identity]` 给的是**区间基线**（如大学生起床 6:50–11:00、睡 23:00–次日1:00），具体某 companion 落在区间哪个点由 **`companion.id` 确定性派生**（同 `life_state` 经期 id→seed→相位偏移的成熟做法：早睡党/熬夜党、卷/摆烂是稳定的人格特质，不存随机种子、同 id 永远同偏移、跨 companion 离散）。
- `ROUTINE_PROFILES[identity]` 结构（每身份一份，数据来自第 1 节研究）：
  ```
  {
    wake:  {weekday:[区间], weekend:[区间], break:[区间]},   // 起床
    sleep: {weekday:[区间], weekend:[区间], break:[区间]},   // 睡觉
    bands: [ {start,end, activity, importance} ... ],        // 工作日时段轴(上课/上班/自习/通勤…)
    weekendBands, breakBands,                                // 周末/假期时段轴
    shower:  {pref:'evening', freq:'south_daily|north_alt'}, // 洗澡(晚上+南北)
    meals:   {breakfast:'often_skip', ...},                  // 三餐
    offsetAxes: ['住校/走读', ...],                          // 个体偏移轴(供派生)
    forbid:  ['在公司','开会'],                              // 该身份禁词(高中生不上班)
  }
  ```
- **洗澡晚上 + 南北频率**写进 profile（默认晚上；`shower.freq` 默认随地域，无地域信息时取 `south_daily` 偏保守每天，作可配置参数）——直接修「一天洗两次澡 / 洗澡写早上」根因。
- 与「前端可选项扩展」backlog 的边界：本系统只定**数据模型（`life_identity` 字段 + 默认推导）**；把它**暴露成前端可选项**是那笔独立 P2 backlog（「先只读盘点别假设缺」），本稿不设计前端，仅说明字段就位后前端可接。

### 3.2 日历维度（学期 / 寒暑假 / 法定节假日 / 星期几）—— 整个缺失轴

**新模块 `life_calendar.mjs`，纯函数，提供 `getDayContext(identity, dateKey)`：**
```
→ { dayType: 'schoolday'|'weekday'|'weekend'|'holiday'|'winter_break'|'summer_break'|'makeup_workday',
    holidayName?: '春节'|'国庆'…,
    academicPhase?: 'in_session'|'winter_break'|'summer_break'|'exam_week',   // 学生身份
    examCountdown?: {phase:'steady'|'sprint'|'post_exam', daysLeft} }          // 考研/考公叠加
```
- **法定节假日表**：2026 静态表（元旦 / 春节 2.15–2.23 九天 / 清明 / 劳动 5 天 / 端午 / 中秋 / 国庆 10.1–10.7 七天 + 调休补班日 `makeup_workday`），每年维护一次。研究档案 C 已给全 2026 日期。
- 🔴 **节假日单一事实源**：`companion.mjs:878-884` 已有一份节日列表（只喂时间感知块、不喂日程生成，是孤岛）。本系统**合并为唯一来源**，时间感知块改读 `life_calendar`，杜绝两份日历漂移（呼应会话「单一事实源」纪律）。
- **学期/寒暑假边界**：按全国常态、身份参数化的日期区间（寒假≈1 月中–2 月底春节锚定、暑假≈7–8 月；大学比高中更长），per-companion 可在基线上偏移。这是**近似**（各校不一），取「全国主流」够用——具体精度是待拍板项（5.3）。
- **考研/考公倒计时**：`examCountdown` 叠加在日历上（考研 12 月下旬、考公笔试），冲刺期 `sprint` 收紧作息（对齐考试钟）、考完 `post_exam` 松弛——身份特异，仅 exam_prep 身份激活。
- **getDayContext 同时喂两处**（这是「学期假期维度真接上」的关键——不能只接日程生成漏掉 anchor）：
  - 日程生成：`isWeekend` 升级为完整 `dayContext`，提示词说「今天是**暑假平日**」而非「工作日」，occupationHint 变 identity+dayContext 感知（暑假高中生 ≠ 上学日高中生）。
  - anchor 推导：见 3.4。

### 3.3 🔴 焊死「围着用户在线时间转」（红线落地·头号待拍板）

针对 2.2 的泄漏，**推荐方案 A（断学习）**，列方案 B 作备选，请维护者裁（5.1）：

- **方案 A（推荐·干净·与红线一致）**：**停掉从用户活动学 bed/wake 的自动链路**。她的睡眠窗由 `ROUTINE_PROFILES[identity].sleep` 基线 + 个体偏移确定性派生（独立于用户）。保留 `setUserSchedule`（用户在 dashboard 手动设**她的**作息）作唯一覆盖——那是**用户配置这个角色**，不是**角色追用户**，方向相反、不违红线。具体：`recordUserActivitySample`/`tryLockSchedule` 的 learn→lock 链路停用或退化为 no-op；2.2 三个泄漏点（睡眠拦截/晚安早安/presence.wokeAt）改读身份基线睡眠窗。
  - 取舍：失去「她随用户作息自适应」的感觉——但那个自适应**正是**要焊死的反模式，用户已明令独立。故推荐 A。
- **方案 B（备选·软钳）**：保留学习但**硬钳在身份基线合理窗内**（学习只能在 identity-plausible 区间内 ±30min 微调，绝不让「用户是夜猫子」催生出 996 作息）。仍有残余耦合，仅在维护者想保留一点自适应手感时用。
- 验收点④（作息是否「她自己的」）成立与否，全看这条——3.4 之后所有作息推导都从**身份基线**出发，不再从用户派生。

### 3.4 接线三处（无遗漏·无打架）

**核心防打架原则：`profile + calendar` 是唯一事实源，日程生成与 anchor 推导都从它派生 → 两者天然一致，不会「日程说在家、anchor 说上班」。**

1. **日程生成**（`plan_tasks.mjs generateScheduleFor`）：新增 `buildRoutineHint(profile, dayContext, offset)`，**镜像 `current_works.buildScheduleWorksHint` 注入范式**（盘点B 确认该位置已为状态源预留同级位），注入 LLM 提示词强制约束区。`ageOccupationHint` → `identityRoutineHint(identity, dayContext, offset)`。`07:00–23:30` 硬窗按身份放宽（考研早起/996 晚睡）。
2. **即时态 anchor**（`companion.mjs buildPresenceAnchor`）：扩展 `presence` 传入 `dayContext` + `expectedActivityBand`（调用方 `bot.mjs`/`proactive.mjs` 用 `getDayContext` + profile 算好；`companion.mjs` 维持零依赖纯函数）。把现「工作日 9-18 锚上班/上课」替换为**身份+日历推导的「此刻该在做什么」band**：
   - 暑假/寒假 → 不锚上学；考研党 → 锚「该在自习室」；996 → 9:00 锚「通勤/刚到公司」而非「在公司很久」。
   - `schedSaysHome` 覆盖逻辑保留（请假/在家不误杀）。
   - 顺手修 `proactive.isSleeping` 硬编码 `false`（改读 `isSleepingNow`）。
3. **emotion / life_state 协调**（单向·零打架）：
   - emotion：**不改 `derivePresenceFromSchedule`**，它消费的 dailySchedule 变好即可；作息系统**不碰情绪、不算 availability**。
   - life_state：**可选只读修饰器**——经期重日，日程生成可读 `getActivePeriodContext()` 降体力活推荐。低优先，可放本系统 v2，不阻塞 v1。
   - 拼接顺序遵盘点B：作息 hint 与 worksHint 同级（在 buildSystemPrompt 内 / 紧跟），**不在 emotion/arc 之后注入**（避免被 arc 冷淡语气冲淡）。

### 3.5 长周期叙事态（寒暑假 / 春节回家 / 国庆）

- **v1 核心 = 日历正确的作息**：`dayContext.dayType=winter_break/summer_break/holiday` 已让日程与 anchor 切到对应作息（晚睡晚起/位移态）。这是必须项。
- **叙事态（可选增强·建议 v2）**：长假的「她在哪/在干嘛」粗粒度持久态（回家过年/旅行中/宅家），让她连贯地「这几天在老家」。这是 nice-to-have，**不阻塞 v1**；列为本系统内的 phase 2（待拍板 5.4）。先把「日历对、作息对」做扎实，叙事态后补。

---

## 4. 验设计自检（对照维护者 4 条验收重点）

| # | 验收重点 | 本设计如何满足 | 残余风险/需维护者确认 |
|---|---|---|---|
| ① | 按身份建模真覆盖五种、没混成模板 | 5 `ROUTINE_PROFILES` + 子形态（worker a/b/c、fresh_grad 论文/实习/求职、exam 全职/在校）；研究分身份独立取证；**个体偏移 id 确定性派生**防「一个样」 | 35+「社会人」档现状有、本稿五身份未含（产品主力 16-30，35+ 维持现状 age 档兜底）——确认可接受？(5.5) |
| ② | 接进三处无遗漏无打架 | `profile+calendar` 单一事实源同喂日程生成与 anchor → 天然一致；emotion/life_state 单向消费/只读修饰，零反向依赖；注入位复用 works 范式 | life_state 经期修饰器列为 v2 可选——确认不阻塞 v1？ |
| ③ | 学期/假期维度真接上 | `getDayContext` **同时**喂日程生成 + anchor（不只接一处）；法定节假日**合并 `companion.mjs` 孤岛为单一源**；考研倒计时叠加 | 学期/寒暑假边界用全国常态近似（各校不一）——精度可接受？(5.3) |
| ④ | 作息是「她自己的」而非「配合用户」 | **断掉 `tryLockSchedule` 从用户活跃时间学 bed/wake**（方案 A）；所有作息从身份基线派生；`setUserSchedule` 保留为「用户配置她」（方向相反不违红线） | 方案 A（断学习）vs B（软钳）——头号待拍板(5.1) |

🔴 自检补充：全程**单向箭头**（作息→dailySchedule→presence/情绪hint），作息系统**永不写 emotion、永不因用户沉默升级、永不追用户在线时间**——这条同时守住「不碰情绪」与「不滑 engagement」两红线。

**红队复核（对抗式 verify-design）**：A/B/C/D 全部代码论断逐条证实——§2.2 红线破裂诊断（公式 +30/-10、median、7 天 lock、三泄漏点）准确；三引擎边界（life_state 零作息 / works 预留同级注入位 / emotion 单向消费）准确；anchor 仅工作日/周末 + 节日孤岛准确；耦合点穷尽（`grep first_msg/last_msg/recordUserActivitySample/observed_samples` 仅 sleep.mjs，无漏网）。红队提级两项已并入：① `proactive.mjs:854 isSleeping` 硬编码 = **mustFix**（已在 §3.4/§6 实现范围）；② 存量迁移 = 新增待拍板 1b。红队总评：**核心论断无硬伤，拍完头号/迁移两板即可进停板B**。

---

## 5. 待拍板清单（请维护者在停板A 裁）

> 已读 维护者决议记录，以下均为**新决策点**，非重复登记已决项。即时状态锚定（已部署）/ 两笔 backlog（情绪波动 P1·前端可选项 P2）不在此重提。

1. 🔴🔴 **【头号】焊死用户耦合取 A 还是 B**：A=断掉从用户活跃时间学 bed/wake（推荐，与红线一致，代价是失去自适应手感）；B=保留学习但硬钳在身份基线窗内（残余耦合）。**这条不裁，验收点④ 无法成立。**
   - 1b. **存量迁移（红队 E.1 补）**：现有 companion 已有从用户活跃学出的 `learn_state='locked', bed_time/wake_time'`。取 A 后这些值怎么办？选项：(i) **一次性用身份基线重置**（最干净、彻底守红线，代价=老用户察觉她作息变了）；(ii) **冻结现值转 `user_set=1`**（保连贯不再学习，但把已漂移值当「用户设定」语义不纯）。建议 (i)，请维护者裁。
2. **身份字段落地形态**：新增结构化 `life_identity`(+`life_subform`) 字段、age 默认推导、向后兼容——是否同意这个数据模型方向？（前端暴露归独立 backlog，本系统只落字段+默认）
3. **学期/寒暑假边界精度**：用「全国主流」近似的身份参数化日期区间（per-companion 可偏移）够用，还是需要更精确（如可配置学校日历）？建议先近似。
4. **长假叙事态（回家/旅游）**：v1 只做「日历正确的作息」，叙事态（她这几天在老家/旅行）放 v2——同意分期，还是 v1 就要叙事态？
5. **五身份覆盖范围**：聚焦 16-30 主力五身份，35+「社会人」维持现状 age 档兜底——确认可接受？
6. **实现范围与纪律**：本系统是多文件治本（见第 6 节预估），确认停板B 前 dev worktree、不碰生产、不并 main。

---

## 6. 实现范围预估（停板B 前不施工·仅供拍板判断体量）

| 文件 | 改动性质 | 要点 |
|---|---|---|
| `src/routine_profiles.mjs` (新) | 新建 | 五身份 `ROUTINE_PROFILES` 数据 + 个体偏移确定性派生 |
| `src/life_calendar.mjs` (新) | 新建 | `getDayContext` + 2026 法定节假日表 + 学期/寒暑假区间 + 考研倒计时 |
| `src/db.mjs` | 迁移 | `companion.life_identity` / `life_subform` 列 + 默认推导；停用/退化 `tryLockSchedule` 写入（方案 A） |
| `src/sleep.mjs` | 改 | 方案 A：learn→lock 链路停用，睡眠窗改读身份基线 |
| `src/plan_tasks.mjs` | 改 | `ageOccupationHint`→`identityRoutineHint`，注入 `buildRoutineHint`，`isWeekend`→`dayContext` |
| `src/companion.mjs` | 改 | `buildPresenceAnchor` 用 dayContext+band 替代 age 派生 work 锚；时间感知块改读 `life_calendar` 单一源 |
| `src/bot.mjs` / `src/proactive.mjs` | 改 | presence 扩展（dayContext/band）；proactive `isSleeping` 修真值 |
| `scripts/*_smoke.mjs` + `ci.yml` | 新/改 | 身份覆盖五种 / 学期假期切换 / 🔴坏版本验红（断耦合关→飘回用户作息 / 开→独立）/ 洗澡晚上南北 / anchor 暑假不误锚 |

体量：约 2 新建 + 6 改 + smoke，与「即时状态锚定」同量级或略大的治本。**纯连贯性/真实性，零情绪/黏人/占有改动。**

---

*停板A 稿完 · 等维护者审 · 不施工。*
