# 01-product-detail

Type: feature
Status: resolved

商品详情抓取（Phase 3）。规格见同目录 `spec.md`，决策见 `docs/adr/0005-product-detail.md`。

## Answer

- `types.ts`：新增 `BuyBox / ProductDetail / DetailJob / DetailResult`。
- `parser/detail-page.ts`：`extractDetailInPage`（浏览器侧，多级选择器 fallback）+ `toDetail`（Node 侧类型守卫）。
- `scraper/detail.ts`：`buildDetailUrl / scrapeDetailPage / runDetailJob`。
- `routes/detail.ts` + `routes/browser-runner.ts`；`scrape.ts` 重构复用 runner。
- 前端：详情按钮 + Buy Box 卡片弹层。
- 测试：parser 5 / scraper 6 / API 3，全量 86/86。
- 版本 1.3.0，tag `v1.3.0-phase3`。
