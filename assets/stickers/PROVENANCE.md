# 表情包来源与授权（Sticker Provenance & Licensing）

> 本文件声明本项目**表情包资产的来源与可分发性**，并说明"锁发布只发原创"的
> 硬闸如何机械保证公开仓永远不夹带来源不明素材。
>
> ✅ **CC0-1.0 落款主体已拍定（2026-07-06 维护者）= 「溪语 AI 团队（xiyuai team）」**。
> xiyu2 原创集若随发布放进公开仓，以 **CC0-1.0** 释出——溪语 AI 团队将其可能存在的一切
> 权利奉献至公共领域，下游无需署名、无授权摩擦（与仓本体 MIT 兼容）。像素级复核与"是否
> 真放图"仍属发布前人工（见文末「发布前 checklist」）。

---

## 现状：公开仓不分发任何表情包图片

`assets/stickers/README.md` 已写明：本开源仓库**只含加载与匹配机制**
（`src/stickers.mjs`），**不分发**任何真实表情包图片。所有图片二进制被
`.gitignore` 挡住，仓库里只跟踪三个机制文件：`.gitkeep` / `README.md` /
`manifest.example.json`（外加本 `PROVENANCE.md`）。

因此**今天公开仓的表情包图片数 = 0**。本文件与配套硬闸是**面向未来的护栏**：
将来若要让 bot 开箱即用地带一套表情，只有**原创 CC0** 那一套可以进公开仓，
来源不明的那一套永远进不去。

## 两套素材（都只在生产/本地，不在公开仓）

生产/本地可把两套表情合并使用；公开仓只随附下表 `opensource:true` 的原创集：

| 集合 | 张数 | 载体 | `opensource` | 来源与可分发性 |
|---|---|---|---|---|
| **xiyu2** | 25 | `xiyu2/*.png` | `true` | **溪语 AI 自制原创**：由生成式图像模型产出、溪语 AI 挑选定稿。无第三方 IP。**拟以 CC0-1.0 公共领域奉献释出**，可进公开仓。 |
| **zh** | 27 | `zh/*.jpg` | `false` | **来源不明**（网络萌兔/涂鸦/真猫等素材，重分发授权状态不清）。**仅生产自用，绝不进公开仓。** |

`opensource` 字段是**纯元数据**：`src/stickers.mjs` 只读 `emotion`，从不读
`opensource`——加这个字段对选图
行为零影响，它只在"发布筛选"这一步被读。

## 为什么原创集用 CC0（而不是 MIT/CC-BY）

xiyu2 是**生成式模型产出的图像**。此类产出的可版权性在部分法域本身存疑
（AI 生成物未必构成受版权保护的作品）。**CC0-1.0 恰好绕开这个问题**：无论其
是否可受版权保护，我们都把可能存在的一切权利**奉献至公共领域**，下游随意使用、
无需署名、无授权摩擦。这与仓库本体的 MIT 协议兼容（MIT 管代码，CC0 管这套图）。

🔴 **诚实边界**：本文件是**声明**，不是像素级鉴权。"这 25 张确为原创、无第三方
IP" 的最终判断属人工（维护者 制作/委托），由发布前 checklist 兜底；机器只保证
"没被标成原创的东西一律进不了公开仓"。

## 锁发布只发原创（硬闸 · 机械保证）

确定性护栏，删/绕即红：

1. **发布前自检 `scripts/opensource_check.sh` 第 7 项**：被 git 跟踪的表情包图片
   若**不在 CC0 原创允许路径**（`assets/stickers/xiyu2/`）即**失败退非零**——
   任何 `zh/*` 或根目录商用图一旦误 commit 进公开仓副本，发布脚本当场拦住。
   本脚本已接入 CI（`ci.yml`），持续跑而非只在发布日跑；本 `PROVENANCE.md` 须在场。

## 发布前 checklist（🔴 维护者 发布前拍）

把 xiyu2 图片真正放进公开仓那一天（若决定放）之前，逐条确认：

- [x] **版权/署名落款**（2026-07-06 维护者 拍定）：**CC0-1.0 落款主体 = 「溪语 AI 团队（xiyuai team）」**
      （LICENSE 本体=MIT·暂定·维护者 发布前可改）。
- [ ] **像素级复核**：抽查 25 张确为生成式产出/自制，无夹带第三方 IP、无水印、
      无可识别真人肖像。
- [ ] 把 xiyu2 图片落到 `assets/stickers/xiyu2/` 并从 `.gitignore` 放行该子目录；
      跑 `bash scripts/opensource_check.sh` 应 7/0 绿（zh 仍被挡）。
- [ ] `manifest.json`（或其生成源）里 xiyu2 条目 `opensource:true`、zh 条目 `false`。

---

*Stickers licensing is separate from the repository's MIT license (which covers
code). The xiyu2 original set is intended for CC0-1.0 release; the zh set is of
unknown provenance and is never redistributed. The CC0-1.0 attribution subject
was set by the maintainer (2026-07-06): **"溪语 AI 团队 (xiyuai team)"**.*
