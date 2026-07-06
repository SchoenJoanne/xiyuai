# Morning 防穿帮闸盲区补丁 — 设计稿（停板 A）

> 🔴 **停板 A · 零实现 · 不碰生产 · dev 仓只读。**
> 本文件只描述补丁设计与验红计划，不含任何代码改动，不触碰生产，dev 仓全程只读。
> 交维护者审；维护者拍板前不得进入实现。
>
> 🔴 **verify 收口结论（已第三方实查代码）**：`misfire_safe=true`、`both_direction_covered=true`、`missedhint_safe=true`。
> 三项安全闸全绿，无需红色闭合块。但 verify 给出 **3 条 must_fix**（见 §4、§7），实现时缺一即漏穿帮，已逐条吸收进设计正文并在 §4 标注。

---

## 1. 问题与根因（简）

dogfood（companion=3，第三方审实查）抓到 proactive 即时状态自相矛盾：

- **07:30** `away_probe`「刚洗完澡」（她已醒、已洗，`today_wake_at≈07:30`）
- **09:10** `morning`「刚醒…今天会洗头」 ← 与 07:30 自相矛盾

09:10 那条经 `getConversationContext(10)` **实际看到了** 07:30 那条，并非瞎编——是 prompt 框架强行装"刚醒"。

三层根因：

| # | 根因 | 位置 | 本窄修是否处理 |
|---|------|------|----------------|
| ① | `morning` prompt 硬编码"带刚醒的迷糊感" | `proactive.mjs:888` | ✅（去框架，见 §2/§4） |
| ② | 防穿帮闸 `shouldDemoteMorning` 盲区 | `proactive.mjs:330` | ✅（**本补丁主体**） |
| ③ | 即时状态不落库（结构性） | — | ❌ 归 P2，明确**不在**本窄修范围 |

**②的盲区**：`shouldDemoteMorning` 现只看两类硬信号——
- `alreadySent`（今天早安已发过）
- `talkedThisMorning`（用户 `lastUserReplyAt` 今早 ≥05:00 动过）

→ **不看"她自己今早已发过任何 proactive"**。away_probe 已证明她醒着，但既没刷新早安已发标记、也不是用户回复，于是 morning 照常装刚醒 = 穿帮。

---

## 2. 补丁设计（精确条件 + 信号源 + demote 语义）

### 2.1 思路

给 `shouldDemoteMorning` 加**第三类盲区** `proactiveSentThisMorning`，并把 demote 拆成两档：

- **hardDemote**（原两类：`alreadySent || talkedThisMorning`）→ 降级为 normal 且**清空** missedHint（保持现行为）
- **softDemote**（新增：仅 `proactiveSentThisMorning` 命中、非 hard）→ 去掉"刚醒"框架，但**保留** missedHint 承接（中性文案）

**确定性兜底优先于 prompt 自觉**：不依赖 LLM 自己从上下文推断"我今早发过"，用单槽时间戳硬判。

### 2.2 信号源（确定性）

| 信号 | 来源 | 验证 |
|------|------|------|
| `proactiveSentThisMorningAt` | `getProactiveLastSent(companion.id).lastAt` | `db.mjs:4280`，读 `companions.last_proactive_sent_at`，**epoch 秒**；缺失/null 返回 `0`（`db.mjs:4284`） |

**为何这个信号最强**：
1. `recordProactiveSentTimestamp`（`db.mjs:4255`）对**所有 kind 统一记账**（away_probe / normal / lastcall / goodnight 全覆盖，写 `Math.floor(Date.now()/1000)`）。故 07:30 away_probe **必把 lastAt 刷成 07:30**。
2. 读点在**发送前**：`shouldDemoteMorning` 在 `proactive.mjs:365` 读 lastAt（morning guard 内、send 前），而 morning 自己记账在 `proactive.mjs:426`（send 后）。**读先于写 → morning 绝不自计数**（verify "Self-counting" 攻击确认）。
3. 单槽时间戳即"最近一次任意 proactive"——是"今早是否已证明醒着"的最强代理。

**为何不取 `getConversationContext(10)` 扫 assistant 时间**：那是 LLM 素材层，含被动回复噪声，不如单槽时间戳确定。

### 2.3 精确条件（伪码）

```
shouldDemoteMorning({ goodmorningSentForDate, todayKey, lastUserReplyAt, proactiveSentThisMorningAt }):

  alreadySent       = !!todayKey && goodmorningSentForDate === todayKey
  talkedThisMorning = <原逻辑不变，proactive.mjs:333-340>

  proactiveSentThisMorning = false
  if (Number.isFinite(proactiveSentThisMorningAt) && proactiveSentThisMorningAt > 0):
      d      = new Date(proactiveSentThisMorningAt * 1000)        // 秒→ms
      shHour = (d.getUTCHours() + 8) % 24                          // 与 line337 逐字一致
      proactiveSentThisMorning = (shanghaiDateKey(d) === todayKey) && (shHour >= 5)

  hard = alreadySent || talkedThisMorning                         // 原两类硬降级
  soft = proactiveSentThisMorning && !hard                        // 新增软降级（hard 吃 soft）

  return {
    demote:                   hard || proactiveSentThisMorning,
    alreadySent,
    talkedThisMorning,
    proactiveSentThisMorning,
    hardDemote:               hard,
    softDemote:               soft,
  }
```

> **单位/时区已核**：`lastAt` 是秒（`db.mjs:4256` 写 `Math.floor(Date.now()/1000)`）→ `*1000` 还原 ms 正确。`shanghaiDateKey(date)` 接收 Date、内部用 `Intl` 按 `Asia/Shanghai` 折算（`db.mjs:4629`），传 Date 正确。`shHour=(getUTCHours()+8)%24` 与 `proactive.mjs:337` 逐字相同。

### 2.4 caller 改动（`proactive.mjs:365-373`）

- line365 传入 `proactiveSentThisMorningAt = getProactiveLastSent(companion.id).lastAt`
- **把 verdict 捕获进一个外层变量**（区分 hard/soft），两档都 `kind='normal'`
- line371 日志补 `proactiveSentThisMorning` 与 `softDemote`
- 🔴 **must_fix #2**：`softDemote` 必须经 **opts 透传**进 `sendProactiveMessage`。注意 `proactive.mjs:412` 有 `opts = {...opts, arcOlive}` 会重建 opts——softDemote 必须 merge 进**最终传入 `sendProactiveMessage` 的那个 opts**（在 412 处一并 spread），不能在 412 被冲掉。与 `arcOlive` 同款先例（`opts` spread 已有；`sendProactiveMessage` line705 已接 opts）。

### 2.5 demote 语义（选**方案 B**：去刚醒框架但保 missedHint 承接，**不选全降级**）

| 档 | 触发 | kind | 刚醒框架 | missedHint |
|----|------|------|----------|------------|
| **hardDemote** | `alreadySent` 或 `talkedThisMorning` | normal | 去 | **清空** |
| **softDemote** | 仅 `proactiveSentThisMorning`、非 hard | normal | 去 | **保留（中性文案）** |
| 三类全 false | — | morning | **带刚醒** | **带（现状刚醒迷糊文案）** |

- **hardDemote 清 missedHint 的理由**：早安已发 / 用户今早已主动聊过 → 承接昨晚的窗口已被真实互动接管，再塞 missedHint 会重复 / 穿帮。
- **softDemote 保 missedHint 的理由**：她 07:30 只是 proactive 发过、用户没必然回、昨晚 missed 还没人承接——丢了 = 昨晚消息再不被接 = 引入新不连贯（正是 §4 要防的回归）。

---

## 3. 🔴 两方向正确性（确定性时间戳兜底）

### 方向 A — 真没发过任何 proactive 今早 → **照常刚醒**（零误伤正常首条早安）

- `lastAt` 为 `0` / `undefined` / `NaN`：`Number.isFinite && >0` 全挡 → `proactiveSentThisMorning=false`
- `lastAt` 是昨晚 / 上个周期：折上海时区后 `shanghaiDateKey ≠ todayKey` 或 `shHour < 5` → false
- 叠加 `alreadySent=false`、`talkedThisMorning=false` → `demote=false` → `effectiveKind` 保持 `morning` → `proactive.mjs:858` 触发**带刚醒迷糊文案 + missedHint**

✅ 正常首条早安零误伤。（verify "Normal user, zero proactive" 攻击确认）

### 方向 B — 今早发过任何 proactive → **不装刚醒**

- 07:30 away_probe 经 `proactive.mjs:426` 把 `lastAt` 刷成 07:30（`shHour=7≥5`、`shanghaiDateKey=todayKey`）→ `proactiveSentThisMorning=true`
- → `demote=true`、`softDemote=true` → `kind=normal` → `858` 走 normal 文案（**无刚醒**），但因 `softDemote` 仍构造 missedHint（中性）

✅ 09:10 的"刚醒"穿帮被止住，昨晚承接不丢。（verify "away_probe stamps lastAt" 攻击确认）

> **05:00 分界既是 `talkedThisMorning` 的界、也复用为 `proactiveSentThisMorning` 的界**——半夜 <05:00 发的不算"今早已醒"，与"凌晨聊过不算穿帮"同源（`talkedThisMorning` line338、`goodnightBelongDateKey` line317 三方对称）。

---

## 4. missedHint 不丢的处理（🔴 must_fix #1 + #3）

**现状**：missedHint 仅在 `proactive.mjs:858 if(effectiveKind==='morning')` 内构造，且仅在 `887-888` morning 分支的 `userMessage` 里被 `${missedHint}` 插值。一旦 demote 成 normal，**整段丢失** = 昨晚消息再不被承接。

**补丁**：

1. **条件放宽**（line858）：`if (effectiveKind === 'morning' || opts.softDemote)` 才构造 missedHint。
   - hardDemote 分支：`softDemote=false` 且 `effectiveKind≠morning` → 条件不命中 → 不构造（清空，符合 §2.5）。
2. 🔴 **must_fix #1 — softDemote 文案必须改写**：删 `proactive.mjs:868` 那句"表达刚醒的迷糊"，改**中性承接**（如：「你之前看到他昨晚发了好多 → 自然提一句'我看到你昨晚发了好多'，不逐条回，挑一条接」）。
   - **morning 与 softDemote 必须是两条独立文案分支，不能共用含'刚醒'措辞的同一串**——否则 07:30 away_probe（已醒）后仍说"刚醒"照样泄露，本任务白修。
3. 🔴 **must_fix #3 — splice 点**：demote 后 `effectiveKind=normal`，不再走 `887-888` 的 morning `userMessage`。softDemote 的 missedHint **必须 append 进 normal 分支的 `userMessage`**，否则 missedHint 算出来了却没人用（computed but never used）。

**drainMissed 注记（有意为之，留作 §7 决策点）**：
- `getUnconsumedMissed`（`db.mjs:5216`）是纯 peek（SELECT，不 UPDATE）；消费者是 `markMissedConsumed`（`db.mjs:5222`）。
- `drainMissed`（`proactive.mjs:443`）只在 `kind==='morning'` 触发。softDemote 后 `kind=normal` → **不触发 drainMissed** → missed 队列不被消费，仍留队列由后续真 morning 或显式 drain 清。
- **设计明确标注**：softDemote 发完不 drain 是**有意为之**——宁可重复承接也不丢。是否要补 drain 见 §7。

---

## 5. 坏版本验红计划（两方向 + 关/开补丁）

### 5.1 纯函数级（`shouldDemoteMorning`）

| # | 场景 | 输入 | 断言（开补丁、好版本绿） | 坏版本如何红 |
|---|------|------|--------------------------|--------------|
| A | **方向 A · 开补丁 · 已发** | `proactiveSentThisMorningAt=今早07:30`，`alreadySent=false`，`talkedThisMorning=false` | `demote && softDemote && proactiveSentThisMorning && !hardDemote` | 坏版本漏判第三类 → `demote=false`，红 |
| B | **方向 B · 开补丁 · 没发** | 三类全 false（`lastAt=0` 或 `=昨晚秒`） | `!demote` | 坏版本误把昨晚/0 当今早 → `demote=true`，红（防误伤正常首条早安） |
| C | **关补丁对照** | 不传 `proactiveSentThisMorningAt`（undefined）→ `proactiveSentThisMorning=false`，仅原两类生效 | 只 away_probe 发过时 `demote=false` → **矛盾复现** | 证明关补丁矛盾仍在，红得对 |
| D | **边界 05:00** | `lastAt=今早04:59` / `lastAt=今早05:00` | 04:59→`!proactiveSentThisMorning`；05:00→`true` | 界错或时区错 → 红 |
| E | **hard 优先** | `alreadySent=true` 且 `proactiveSentThisMorningAt=今早` | `hardDemote=true && softDemote=false`（hard 吃 soft，missedHint 须被清） | 坏版本 soft 误置 true 致 hardDemote 时还保 missedHint → 红 |

### 5.2 端到端级（`sendProactiveMessage` 文案/插值）

| # | 场景 | 断言 | 坏版本如何红 |
|---|------|------|--------------|
| F | **missedHint 不丢** | `softDemote=true` 且 `getUnconsumedMissed` 返非空 → 最终 missedHint **非空且不含"刚醒"字样**；`hardDemote=true` → missedHint **为空** | soft 丢 missedHint / hard 残留 / soft 文案仍含刚醒 → 红 |
| G | **effectiveKind 文案** | away_probe 已发场景 → 走 **normal 文案不走 morning 刚醒文案** | 坏版本仍走 morning 刚醒 → 红 |

> 🔴 **关补丁（矛盾复现）与开补丁（止住）两方向都要红得对**：case C 是关补丁矛盾仍在，case A/B/F/G 是开补丁后好版本绿、坏版本红。

---

## 6. 边界（05:00 / 重启 / kind）

- **05:00 分界**：`shHour>=5`。04:59→4→false；05:00→5→true。与 `talkedThisMorning`（line338）、`goodnightBelongDateKey`（line317）三方对称。半夜 23 点多 goodnight 把 lastAt 设成昨晚 → 折时区后 `shanghaiDateKey≠todayKey` **或** `shHour<5` → 自动**不**触发软降级（豁免正确）。
- **重启**：丢内存排程后重算把 morning 又排上，由 `alreadySent`（hardDemote）兜底——与 `proactiveSentThisMorning` 正交，不冲突。
- **kind 不分**：单槽 `lastAt` 不看 `last_proactive_kind`。**这是有意的**——`recordProactiveSentTimestamp` 只在真实成功 send 后记账（line426），今天 ≥05:00 任何 kind 发出去都已证明她醒着且在主动够人，再装刚醒就是 tell。verify "Single-slot ignores kind" 攻击确认：无"应计但误降"的反例。
- **自计数防护**：读（line365，send 前）先于写（line426，send 后）→ morning 永不把自己算成"已发"。

---

## 7. 🔴 留给维护者拍的决策点

1. **softDemote 后是否要 `drainMissed`？**
   - 设计**倾向不 drain**（peek 不 consume，宁重复承接不丢）。
   - 但这破了"现行 morning 成功必 drain"的对称性：softDemote 承接后**不标记消费** → 后续每条 softDemote 会**重复承接同一批 missed**。
   - 需拍板：softDemote 承接后是否标记消费？若标记，需把 `markMissedConsumed` 提到 softDemote 成功路径；若不标记，接受"同批 missed 可能被多条 softDemote 重复提及"。

2. **softDemote 中性 missedHint 文案定稿**：删"刚醒迷糊"后的具体措辞需维护者敲定（草案见 §4，方向：中性承接、不逐条回、挑一条接、绝不含"刚醒/睡着了对不起"等暗示刚醒的措辞）。

3. **方案 B vs 全降级的最终确认**：本设计已选方案 B（去刚醒框架但保 missedHint）。若维护者认为 softDemote 也该像 hardDemote 一样彻底清 missedHint，需改 §2.5/§4——但那会丢昨晚承接，不推荐。

---

## 附：改动面（三处，供审）

| 处 | 文件:行 | 改动 |
|----|---------|------|
| 1 | `proactive.mjs:330` `shouldDemoteMorning` | 加入参 `proactiveSentThisMorningAt`，扩展返回 `proactiveSentThisMorning/hardDemote/softDemote` |
| 2 | `proactive.mjs:365-373` caller | 传 `getProactiveLastSent().lastAt`、捕获 verdict、两档 `kind=normal`、softDemote 经 opts（line412 一并 spread）透传、日志补字段 |
| 3 | `proactive.mjs:858` + normal 分支 `userMessage` | 条件放宽 `morning || opts.softDemote`；softDemote 走**独立中性文案**（删 line868 刚醒措辞）；missedHint append 进 normal 分支 userMessage |

确定性兜底优先于 prompt 自觉，**不碰 P2 即时状态落库**。
```

---

相关文件（绝对路径）：
- 设计稿落盘文件名（待维护者审，本停板 A 未写盘）：`docs/MORNING_DEMOTE_BLINDSPOT_DESIGN.md`
- 改动面三处所在源文件：`src/proactive.mjs`（行 330 / 365-373 / 858 / 868 / 887-888）
- 信号源：`src/db.mjs`（`getProactiveLastSent` 4280、`recordProactiveSentTimestamp` 4255、`shanghaiDateKey` 4629、`getUnconsumedMissed` 5216、`markMissedConsumed` 5222）

核验结论：设计稿全部行号与信号源已亲眼实查代码无误；verify 三项安全闸（misfire/missedhint/both_direction）全绿，无需红色闭合块；3 条 must_fix 已逐条吸收进 §4 与附表。停板 A，零实现，未碰生产，dev 仓只读。

---

## 🔴 停板A 审阅补充（GPT 第三方审 · 2026-06-24）

**裁决：核心补丁 ✅ 成立，但 missedHint 回归未闭合（`missedhint_safe=False`·2/3 镜头）。**

- ✅ **盲区检测 + 两方向成立**（`misfire_safe`/`both_dir` 全 True）：真没发过任何 proactive 今早 → morning 照常「刚醒」（不误伤）；发过 → 不装「刚醒」。纯函数层咬死。
- 🔴 **missedHint 回归没真闭合**：方案 B（demote→normal 但保 missedHint）只改了 `line858` 的**构造条件**，但 `missedHint` 只在 `line888` 的 morning 分支被**插值进 prompt**——demote 成 normal 后走 normal 分支（`line940`），**missedHint 构造了却没注入**，昨晚承接仍然丢。且 `line836` 的 recall / `line822` confession 二次升级会把 softDemote 的 normal 再抢成 recall，吞掉承接。`red_version_tests` 全是纯函数布尔断言，**没有一条断言 softDemote 路径的真实 `userMessage` 含中性承接、不含刚醒** = prompt 层零覆盖。

**💡 更干净的替代方向（建议停板A 一并拍）**：与其 demote→normal（丢 morning 分支的 missedHint + 撞 recall/confession 升级 + 不 mark goodmorning_sent 可能再排一条 morning），不如**留在 morning 分支、只条件性删掉 prompt 里「带刚醒的迷糊感」那句**（`line888`）：proactiveSentThisMorning 时，morning prompt 改为「你今早已经起来一会儿了（早上发过消息），自然给他个早安/问候，别装刚醒」+ missedHint **天然保留、天然注入**。这更贴你说的「**不装刚醒**」（而非「降级」），回归面最小：不碰 normal 分支注入、不撞 recall 升级、missedHint 不丢、morning 空兜底与 goodmorning_sent 标记都保留。代价：morning 分支多一条件文案。两方向同样成立（没发过→原刚醒文案；发过→去刚醒文案）。

**→ 停板A 决策点**：方案 B（补全注入点+recall 优先级+prompt 级红测）vs 替代方向（留 morning 只改文案）。倾向替代——更小、回归面更窄、与「不装刚醒」语义最贴。
