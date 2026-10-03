# Price Snapshot 价源（price snapshot source）规格

日期：2026-10-03。上游：Value Delta 多 Listing 聚合收尾时记录的债务——`price_snapshots` 不记录价源，搜索结果价与详情页 Buy Box 价混进同一条只追加序列。决策见 `docs/adr/0010-price-snapshot-source.md`。

## 问题

`price_snapshots` 有两个写入端，语义不同：

- `saveScrapeResult`（`/api/scrape` 与 Watch 调度器）写**搜索结果页的 Listing 价格**
- `saveDetail`（`/api/detail`）写**详情页 Buy Box 价格**

CONTEXT.md 把 Listing 与 Buy Box 定义为两个不同的领域概念，但表里没有任何字段区分它们，查询方也无法得知某条快照属于哪个口径。ADR-0006 的表述「一条 Listing 一次抓取产生一条」进一步掩盖了这一点：同一个 Listing 被搜索抓一次、详情抓一次，就会产生两条不同口径的快照。

## 危害（按严重度）

`buildPriceAlerts` 取「最近两条」快照比较，而 `scheduler.ts` 是先写本次快照、再比较。若两次 Watch 抓取之间发生过一次详情抓取，最近两条便是 `[BuyBox, Listing]`，价差被当成价格波动，**直接生成虚假提醒并经 Webhook 发出去**。

其余两档：`/api/history` 把两种口径画成一条折线（视觉上是价格跳变）；建模层若按时间序列读取，会把口径切换当成价格变化。

## 证据

反向验证（把 `buildPriceAlerts` 的价源过滤临时去掉，其余不动）——新加的回归用例转红：

```
FAIL src/alerts.test.ts > buildPriceAlerts > does not fire an alert when a Buy Box snapshot shifts the price source between scrapes
AssertionError: expected [ { event: 'price_change', …(6) } ] to have a length of +0 but got 1
```

即：搜索价 $100 → 详情 Buy Box 价 $150 → 搜索价仍 $100 的三步序列，在无价源区分时**真的产出了一条虚假告警**。

## 方案

- schema v3：`ALTER TABLE price_snapshots ADD COLUMN source TEXT`；迁移前的历史记录留 `NULL`，含义是「价源未知」，不做猜测性回填（回填等于伪造，会让告警与曲线继续错）。
- `PricePoint` 新增 `source: PriceSource | null`；读取时经 `toPriceSource` 收窄，无法识别的值一律归为「未知」。
- `getRecentSnapshots` 支持按源过滤；`buildPriceAlerts` 固定取 `'listing'`（Watch 触发的是搜索 Job，比的就是搜索价）。
- 快照查询补 `id` 作次级排序键：同一毫秒内写入多条时 `captured_at` 会打平，靠 `id` 才能得到确定的「最近两条」。
- 前端曲线按价源分组绘制、x 轴改为真实时间比例（分组后各组点数不同，索引等距会让跨组点错位），并给出图例。

## 验收

1. 搜索写入 `source='listing'`、详情写入 `source='buybox'`。
2. 跨源序列不再触发告警（反向验证确认该用例可红）。
3. 按源过滤只返回同一口径的快照。
4. 真实库从 v2 迁移到 v3 后历史记录为 `NULL`，新写入带正确价源。
5. `/api/history` 透出 `source`；前端按源分组渲染、不跨源连线。

## 非目标

- 不修正已存在的告警记录（它们反映当时的比较逻辑，回填属于伪造历史）。
- 不改「无价格也写快照」的既有行为。
- 不给 `price_snapshots` 增加币种折算或其他列。
