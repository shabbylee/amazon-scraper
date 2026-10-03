# 01-price-snapshot-source

Type: bugfix
Status: resolved

`price_snapshots` 不记录价源，搜索结果价（listing）与详情页 Buy Box 价（buybox）混进同一条只追加序列，导致 Watch 告警跨口径比较而失真、历史曲线混口径。规格见同目录 `spec.md`，决策见 `docs/adr/0010-price-snapshot-source.md`。

## Answer

- `src/db/schema.ts`：新增 v3 迁移 `ALTER TABLE price_snapshots ADD COLUMN source TEXT`（历史记录留 NULL = 价源未知）。
- `src/db/persistence.ts`：新增 `PriceSource` 类型；`PricePoint` 带 `source`；`insertSnapshot` 写入价源，`saveScrapeResult` 写 `'listing'`、`saveDetail` 写 `'buybox'`；`getRecentSnapshots` 支持按源过滤；读取经 `toPriceSource` 收窄；排序补 `id` 次级键。
- `src/alerts.ts`：`buildPriceAlerts` 只在 listing 源内比较。
- `public/index.html`：价格曲线按价源分组、x 轴改为时间比例、加图例。
- `CONTEXT.md`：补 `Price Source` 术语并更新 `Price Snapshot` 定义。
- `docs/adr/0010-price-snapshot-source.md`：记录决定与被拒方案。
- `src/db/persistence.test.ts` / `src/alerts.test.ts`：新增 4 项用例（3 + 1）。
- `.scratch/price-snapshot-source/verify-history-render.mjs`：真实浏览器渲染验证脚本。

## 验证

- 反向验证：临时去掉 `buildPriceAlerts` 的价源过滤后，新增的跨源告警用例转红，实测产出 1 条虚假告警。
- 真实库迁移：`user_version` 2 → 3，`price_snapshots` 出现 `source` 列，97 条历史快照全部为 `NULL`。
- 端到端：真实详情抓取写入 `buybox` 1 条；真实搜索抓取（1 页）写入 `listing` 16 条；`/api/history` 正确透出 `source`。
- 渲染验证脚本：`[verify] PASS`（脚本无错误、两条独立折线、5 个散点、三项图例齐全）。
- `typecheck` + `build` 通过，全量 134/134 通过。

## Comments

本工单由「先清这两条」中的第二条发起。用户报告的是「历史曲线混口径」，实施中发现同一根因还制造**虚假价格告警**（经 Webhook 外发），严重度更高，因此一并修复。价源是领域属性而非实现细节：CONTEXT.md 早已把 Listing 与 Buy Box 分成两个概念，快照表只是没有把这个区分落下来。
