# 详情字段保留（detail field preservation）规格

日期：2026-10-03。上游：Value Delta 切片（`.scratch/value-delta/`）依赖 `listings.variants` 作为建模输入，本规格修复其数据完整性缺口。

## 问题

`listings` 表同时承载**搜索结果可观测字段**与**详情页专属字段**，但 `saveScrapeResult` 与 `saveDetail` 共用一条 `INSERT ... ON CONFLICT DO UPDATE` 语句，冲突时无条件覆盖**全部**列。

重跑 `collect.sh`（流程为「先搜索、后详情」）时，搜索阶段先把所有详情专属字段写回"未观测"占位值，再靠详情阶段填回。实测在当前库副本上模拟一次搜索重跑：

```
字段             重跑前 -> 重跑后   结论
variants            25 ->    25   KEEP（修复后）
seller_name         12 ->    12   KEEP（修复后）
shipping_text       12 ->    12   KEEP（修复后）
review_count        33 ->    33   KEEP（修复后）
has_buy_box         12 ->    12   KEEP（修复后）
is_prime             5 ->     5   KEEP（修复后）
in_stock            11 ->    11   KEEP（修复后）
```

修复前，除 `variants` 外全部为 `LOST`（`seller_name`/`shipping_text`/`has_buy_box` 各 12 → 0、`review_count` 33 → 0、`is_prime` 5 → 0、`in_stock` 11 → 0）。

危害不是"白跑一次"，而是**详情阶段一旦中断，被清掉的观测值永久丢失**。触发条件与 AGENTS.md 的硬约束直接冲突：识别到 CAPTCHA 即停止该 Job，此时所有尚未轮到的 Listing 详情数据已经被搜索阶段抹平。此外，掉出搜索前若干页但仍在库中的 Listing 不再被抓取详情，其数据同样永久退化为占位值。

## 根因

写入权限没有分层：搜索路径**有权覆盖它根本不携带的字段**。

其中 `variants` / `seller_name` / `shipping_text` / `review_count` 可 NULL，尚可用 `COALESCE` 兜住；但 `has_buy_box` / `is_prime` / `in_stock` 是 `INTEGER NOT NULL DEFAULT 0`，搜索路径写 `0`，与"详情观测到 false"在值域上不可区分，`COALESCE` 无法保护。

## 方案

**把单条 upsert 拆成两条，按写入方划定字段边界。**

- `upsertFromSearch`：只插入/更新搜索结果能观测的字段（`title` / `href` / `image` / `rating` / `price_text` / `price_num` / `currency` / `updated_at`）。详情专属字段完全不出现在语句中，因此冲突时不被触碰。
- `upsertFromDetail`：携带全部列。对详情路径"可能未观测到"的可 NULL 字段（`review_count` / `seller_name` / `shipping_text` / `variants`）用 `COALESCE(excluded, listings)` 保守保留上次观测值；对布尔列直接覆盖——详情路径的 `0/1` 是真实观测（false 也是观测）。

## 设计决策

**D1：不加 `COALESCE` 就完事，而是拆分语句。** 因为 `COALESCE` 对三个 `NOT NULL` 布尔列无效，且拆分后在结构上就不存在"搜索覆盖详情"这条路径，比在冲突子句里逐个字段打补丁更难回退成错误。

**D2：不改 schema。** 布尔列维持 `NOT NULL DEFAULT 0` 语义，即"新行尚未抓详情"。新增行的取值与修复前完全一致，改动只作用于已存在行的冲突更新，因此无需 schema 迁移、无需 ADR（schema 未变，AGENTS.md 的跨语言契约不受影响）。

**D3：详情路径写 NULL 表示"未观测"而非"确认不存在"。** Parser 无法区分"页面确实无该字段"与"选择器未命中"，两者都产出 NULL/空。既然不可区分，保守保留上次观测值优于清空；真实变化会在下一次成功抓取时覆盖。已知代价：商品确实下架某字段时，旧值会留到下次成功抓取为止。

**D4：价格仍由两条路径共同更新。** 价格是搜索与详情都能观测的量，非详情专属；详情值（Buy Box）在时序上晚于搜索值，覆盖方向正确，维持原行为。

## 验收

- [x] 单测 5 项锁住保留语义：搜索重跑不清变体；详情空观测不清变体；详情观测到新变体集则覆盖；搜索重跑保留全部 7 个详情专属字段且仍更新价格；详情缺失可选字段时保留旧观测、布尔列照常覆盖。
- [x] 反向验证：临时回退实现到 HEAD 版本，新测试 4 项转红（第 5 项为防回归用例，旧实现下本就通过）。
- [x] 真实数据验证：在 `data/amazon.db` 副本上模拟搜索重跑，7 个字段全部 `KEEP`（验证脚本：`verify-detail-fields.mjs`，原库只读，写入全发生在 `/tmp` 副本）。
- [x] 全量 120/120，`typecheck` + `build` 通过。

## 后续（不在本规格范围）

- **搜索覆盖了详情字段的价格语义**：两条路径都写 `price_num`，若详情失败则最新价来自列表页，与 Buy Box 价语义不同。当前 `price_snapshots` 不区分来源，历史曲线会混两种口径。这是独立问题，需先定义快照的价源字段。
- **`tsx watch` dev 链路**：详情抓取在 dev 模式下报 `__name is not defined`（生产构建正常），尚未定位。
