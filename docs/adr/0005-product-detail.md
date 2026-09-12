# Product Detail：与 Listing 并列的新领域类型，/api/detail 端点

## 背景

Phase 3 要抓商品详情页（`/dp/ASIN`）。路线图原文说"把 Listing schema 扩展到 Buy Box / 卖家 / 运费 / 变体 / 评论数"，但 CONTEXT.md 里 **Listing = 搜索结果里的一行商品**，而 **Buy Box = 详情页上"加入购物车"归属的那一个 Offer**。这两组数据来自不同页面、生命周期也不同（搜索结果 vs 商品详情）。直接往 Listing 上堆字段会把"搜索结果行"语义撑爆。

## 决定

- **新建 `ProductDetail` 领域类型**，与 `Listing` 并列：包含 Listing 的核心字段（marketplace / asin / title / image / rating）+ 详情页专属字段（reviewCount / buyBox / variants）。Buy Box 是子对象 `BuyBox`：`priceText / priceNum / hasBuyBox / sellerName / shippingText / isPrime / inStock`。
- **新端点 `POST /api/detail`**：`{ asin, marketplace }` → `{ detail, attempts }`。不扩展 `/api/scrape` 的响应（保持搜索结果响应稳定）。
- **变体不做结构化**：详情页变体（颜色/尺寸）提取为 `variants: string[]`（可见变体行文本列表），不建变体商品映射——那是 Phase 4 落库后再考虑的问题。
- **Detail Scraper 复用全部稳定性设施**：失败分类 / retry / stealth / proxy-auth 与 Search 同一套；`runDetailJob` 单目标重试编排（captcha 终止、network/timeout 退避重试）。
- **解析收口 Parser 层**：`parser/detail-page.ts`，浏览器侧提取原始字段 + Node 侧 `toDetail` 类型守卫，保持"Parser 纯函数、Scraper 管 IO"。

## 被拒绝的替代方案

- **扩展现有 Listing schema**：语义错位（见背景），且搜索结果页根本采不到 Buy Box 字段，字段永远是 null，落库时（Phase 4）还要再做一次迁移。
- **复用 /api/scrape**：`pages` 语义不存在于详情场景；强行塞 `asin` 会让响应 shape 变成 if-else 大杂烩。
- **变体结构化**：Amazon 变体 DOM 复杂且各站点差异大，Phase 3 先做文本级提取，验证抓取稳定性后再决定是否结构化。

## 后果

- `types.ts` 新增 `DetailJob / BuyBox / ProductDetail / DetailResult`；`CONTEXT.md` 补充 `ProductDetail` 术语（`_Avoid_: 商品页、product page、item detail_`）。
- 前端搜索结果行加"详情"入口，点击后拉取并展示 Buy Box 卡片；`/api/scrape` 响应不变。
- Phase 4 落库时：Listing 与 ProductDetail 各存各的表，Buy Box 快照可挂到 Listing 上。
