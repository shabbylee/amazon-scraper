# product-detail — Phase 3 商品详情

## 目标

新增 Detail Scraper 与 Detail Parser，抓取商品详情页（`/dp/ASIN`）的 Buy Box / 卖家 / 运费 / 变体 / 评论数。决策见 `docs/adr/0005-product-detail.md`。

## 方法

- 新建 `ProductDetail` 领域类型（Buy Box 为子对象），与 Listing 并列；新端点 `POST /api/detail`。
- `parser/detail-page.ts`：浏览器侧 `extractDetailInPage`（多级选择器 fallback）+ Node 侧 `toDetail`（title 缺失 → null）。
- `scraper/detail.ts`：`scrapeDetailPage`（复用 stealth / proxy-auth / 失败分类）+ `runDetailJob`（单目标重试编排，支持 browserFactory）。
- `routes/browser-runner.ts`：从 scrape.ts 抽出的共享浏览器决策，detail route 复用。
- 前端：搜索结果行加"详情"按钮 → 弹层展示 Buy Box 卡片。

## 验收

- [x] parser 单测 5（Buy Box / de 价格 / 无 Buy Box / title 缺失 / 类型强制）
- [x] scraper 单测 6（URL / 一次成功 / network 重试 / captcha 终止 / parser-miss 不重试 / browserFactory）
- [x] API 集成 3（入参校验 / happy path / captcha）
- [x] 全量 86/86，typecheck + build 通过
- [x] 真实冒烟：`POST /api/detail` 抓真实 ASIN 返回 Buy Box
