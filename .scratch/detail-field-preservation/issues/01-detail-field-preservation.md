# 01-detail-field-preservation

Type: bugfix
Status: resolved

搜索阶段的 upsert 会覆盖详情专属字段，重跑采集时把整套详情数据清零。规格见同目录 `spec.md`。

根因：`saveScrapeResult` 与 `saveDetail` 共用一条冲突子句覆盖全列的 upsert 语句，导致搜索路径有权覆盖它根本不携带的字段。`variants` 是其中一列，同一缺陷还波及 `seller_name` / `shipping_text` / `review_count` / `has_buy_box` / `is_prime` / `in_stock`。

## Answer

- `src/db/persistence.ts`：`upsertListing` 拆为 `upsertFromSearch`（只写搜索结果可观测字段）与 `upsertFromDetail`（全列，可 NULL 类字段用 `COALESCE` 保留）；`saveScrapeResult` / `saveDetail` 分别改用对应语句，搜索路径不再传详情字段占位值。
- `src/db/persistence.test.ts`：新增 `detail field preservation` 用例组 5 项。
- `.scratch/detail-field-preservation/verify-detail-fields.mjs`：真实库副本验证脚本（原库只读）。

## 验证

- 修复前在 `data/amazon.db` 副本上模拟搜索重跑：除 `variants` 外 6 个字段全部归零（`seller_name` 12→0、`shipping_text` 12→0、`review_count` 33→0、`has_buy_box` 12→0、`is_prime` 5→0、`in_stock` 11→0）。
- 修复后同一脚本：7 个字段全部 `KEEP`。
- 反向验证：`git stash` 回退实现后，新增 4 项测试转红，确认测试确实锁住旧行为而非空跑。
- 全量 120/120 通过，`typecheck` + `build` 通过。

## Comments

本工单由「先把 variants 那个洞堵上」发起，实施中发现缺陷范围大于 `variants` 单列（同一根因、同一语句），故一并修复。`COALESCE` 无法保护三个 `NOT NULL` 布尔列，因此采用语句拆分而非逐列打补丁，避免留下"部分字段已保护"的中间态。
