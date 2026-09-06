# Phase 3 商品详情：按需触发 + 独立间隔 + 全字段 Parser

Phase 1/2 已经把搜索列表页的抓取做稳。Phase 3 要拿到列表页给不出的信息：Buy Box（含卖家 / 运费 / Prime / 库存）、评论统计（总数 + 5→1 星分布）、变体（颜色 / 尺寸 / 对应 ASIN）、描述 / 类别面包屑 / 图片画廊 / 技术参数表。

我们决定：

- **触发时机**：**按需**触发，新增 `POST /api/detail { asin, marketplace? }` 端点；不在 `POST /api/scrape` 里加 `includeDetails:true` 自动批量抓
- **抓取间隔**：详情页独立走 `DETAIL_INTERVAL_MS`（默认 5000ms，硬下限 2000ms），不复用 `REQUEST_INTERVAL_MS`
- **字段范围**：Parser 一次性提取全部字段（Buy Box / 评论 / 变体 / 描述 / 类别 / 图片 / 参数），前端按需渲染
- **模块划分**：新增 `src/parser/detail-page.ts`（纯函数）+ `src/scraper/detail.ts`（IO 编排），复用 Phase 2 的 Retry / ProxyPool / CAPTCHA 探测 / stealth

## 为什么按需触发

- **列表 Job 时长**：一次 3 页搜索返回 ~48 个 Listing。批量抓详情按 5s 间隔算要 4 分钟，用户在前端等不了
- **反爬压力**：连续访问 `/dp/` 比 `/s` 更容易触发 CAPTCHA；批量抓会把整段 IP 拉进黑名单，连累后续搜索
- **前端体验**：用户通常只对少数几个商品感兴趣；按需加载让"点开一个看一个"成为可能
- **Phase 4 定时任务**：Watch 会自己决定哪些 Listing 需要详情、多久刷新一次；不需要 Phase 3 提前批量化

## 为什么详情页独立间隔

- Amazon 对 `/dp/` 的保护强于 `/s`：详情页包含价格 / 库存 / 卖家等敏感数据，反爬触发阈值更低
- 搜索页 2s 间隔是"用户翻页"的自然节奏；详情页 5s 更接近"用户逐个浏览"的节奏
- 独立变量让用户可以按场景调（批量研究调低、生产环境调高），不影响搜索路径

## 为什么 Parser 一次拿全字段

- 详情页 DOM 抓取成本主要在页面加载（3-5s），Parser 提取本身的开销可以忽略
- 分字段多次访问 = 多次触发反爬；一次拿全 = 一次风险
- 前端渲染时可以按需展示，字段全在 JSON 里不会浪费带宽（详情响应通常 <20KB）
- Phase 4 落库时需要一个稳定的 `ProductDetail` schema；一次定好比逐步扩好

## 被拒绝的替代方案

- **`includeDetails:true` 批量抓**：见"为什么按需触发"
- **GraphQL 风格字段选择**（`?fields=buyBox,reviews`）：Parser 复杂度上升，反爬风险不变，收益低
- **前端直接 fetch Amazon 详情页**：CORS 会拦，且失去 stealth / proxy / retry 保护
- **详情页复用 `REQUEST_INTERVAL_MS`**：搜索与详情耦合，无法独立调参

## 后果

- 新增端点 `POST /api/detail`；请求 schema `{ asin: string, marketplace?: MarketplaceId }`，响应 schema 见 `src/types.ts` 的 `ProductDetail`
- `AppConfig` 加 `detailIntervalMs`；`.env.example` 加 `DETAIL_INTERVAL_MS`；`config.ts` 保持 2000ms 硬下限
- 前端 `public/index.html` 每行加"详情"按钮，点击弹出模态框展示 `ProductDetail`；不引入前端框架，继续零依赖
- Detail Scraper 复用 `runSearchJob` 的 Retry / ProxyPool / CAPTCHA 逻辑；`scrapeDetailPage` 与 `scrapeSearchPage` 走同一套 `ScrapePageDeps` 模式
- Parser 层新增 `detail-page.ts`，与 `search-page.ts` 并列；两者都遵守"纯函数 + Node 侧类型守卫"的分层
- Phase 4 会把 `ProductDetail` 落到 SQLite 的 `product_details` 表，与 `listings` / `price_snapshots` 通过 `(marketplace, asin)` 关联
