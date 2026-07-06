# 灰度闸·开闸前置债务清单（Gated-feature pre-enable debts）

> 有些功能在灰度闸后（默认关、未上线）。开闸前必须先还清下面对应的债，否则开闸即暴露问题。
> **闸一开、债必还**——这是这些临时豁免/权宜实现的赎回条件。

本清单是 `scripts/user_wording_guard.mjs` 等守卫里「临时豁免」注释的权威落点（原挂在内部交接文档，现迁入仓内）。

---

## SOCIAL_CIRCLE（社交圈·默认关）

**债**：`src/social_circle.mjs` 的注入 prompt 里有一句「用户问起你的生活」直接用了「用户」一词。
她的世界里不该出现「用户」这种系统词（见 `user_wording_guard.mjs` 的称呼泄漏门禁）。当前该句在
`user_wording_guard.mjs` 的行级豁免清单里被**临时**放行，仅因 `SOCIAL_CIRCLE` 默认关、尚未上线。

**开闸前置（必做）**：把 `social_circle.mjs` 里「用户问起你的生活」reword，「用户」→「他」
（语义等价、去掉触发词），然后从 `user_wording_guard.mjs` 的 `SRC_LINE_EXEMPT` 移除该行豁免，
重跑 `user_wording_guard` 应仍绿。

> 原则：guard 豁免只收**死文本**（禁词表/检测 regex/注释/prompt 内负向禁令）；**真 prompt 文本一律不豁免**。
> 这条是真 prompt 文本的临时豁免（挂在此 checklist 上），不是永久豁免。
