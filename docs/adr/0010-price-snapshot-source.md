# Price Snapshot 记录价源（listing / buybox）

## 背景

`price_snapshots` 是只追加的价格序列（ADR-0006），被三处消费：`GET /api/history` 的价格曲线、Watch 告警的相邻快照对比（ADR-0007）、建模层的历史读取。

但写入端有两个来源，语义不同：

- `saveScrapeResult` 写的是**搜索结果页的 Listing 价格**
- `saveDetail` 写的是**详情页 Buy Box 价格**

CONTEXT.md 把 Listing 与 Buy Box 定义为两个不同概念（Listing 携带搜索结果可见的价格；Buy Box 是详情页「加入购物车」归属的那个 Offer），而快照表把两者混进同一个序列且不加标记。ADR-0006 的表述「一条 Listing 一次抓取产生一条」也掩盖了这个事实：同一个 Listing 被搜索抓取一次、详情抓取一次，会产生两条不同口径的快照。

后果分三档，按严重度排列：

1. **告警失真（最严重）**：`buildPriceAlerts` 取「最近两条」快照比较，而 `scheduler.ts` 是先写本次快照、再比较。若两次 Watch 抓取之间发生过一次详情抓取，最近两条便是 `[BuyBox, Listing]`，价差被当成价格波动，直接生成虚假提醒并经 Webhook 发出去。
2. **曲线失真**：`/api/history` 把两种口径画成一条折线，视觉上是价格跳变。
3. **建模失真**：建模层若按时间序列读取，会把口径切换当成价格变化。

## 决定

- `price_snapshots` 新增 `source TEXT` 列（schema v3），取值 `'listing'` / `'buybox'`；迁移前的历史记录为 `NULL`，含义是**价源未知**，不做猜测性回填。
- `PricePoint` 领域类型新增 `source: PriceSource | null`。
- Watch 告警只在**同价源**内比较：`getRecentSnapshots` 支持按源过滤，`buildPriceAlerts` 固定取 `'listing'`（Watch 触发的是搜索 Job，比的就是搜索价）。
- 前端价格曲线按价源分组绘制、不跨源连线，并给出图例。

## 被拒绝的替代方案

- **不加列，靠调用方记住上下文**：上下文散落在 scheduler / route / 前端三处，无法约束；且历史数据一旦写入就无法追溯口径。
- **拆成两张表**：列结构相同、查询要 UNION，收益不抵迁移成本；`source` 是同一实体的属性，不是不同的实体。
- **给历史记录回填 `'listing'`**：迁移前的数据同样可能来自详情抓取，回填等于伪造，会让告警与曲线继续错。

## 后果

- schema v3 是加列迁移（`ALTER TABLE ... ADD COLUMN`），SQLite 原生支持，无需重建表；旧库升级后该列为 `NULL`。
- 跨语言契约（ADR-0009）变更：`modeling/connect.py` 只登记表名、不含列定义，因此无需同步；但建模层若开始读 `price_snapshots`，**必须**按 `source` 区分口径，不得跨源拼接序列。
- `/api/history` 响应新增 `source` 字段；前端已同步按源分组渲染。
- 已存在的告警记录不做回溯修正——它们反映的是当时的（有缺陷的）比较逻辑，回填属于伪造历史。
