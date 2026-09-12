# 01-multi-marketplace

Type: task
Status: resolved

扩展 Marketplace 注册表到 5 站点并把价格解析收口 Node 侧。架构决策见 `docs/adr/0004-marketplace-registry.md`，规格见同目录 `spec.md`。

## Answer

- `src/types.ts`：`MarketplaceId` 扩为 5 值；`Marketplace` 增加 `priceDecimalSeparator` / `priceGroupSeparator`；登记 com/cojp/de/cn/couk。
- `src/parser/search-page.ts`：浏览器侧只取原始价格文本；新增 `parsePriceNum(text, marketplace)`；`toListings` 用其计算 `priceNum`。
- `public/index.html`：站点选择器 + 请求体传 `marketplace` + 来源卡片显示 `amazon.${marketplace}`。
- 测试：`parsePriceNum` 10 个用例 + 跨站点 `toListings` 1 个 + config/URL 各 1 个。全量 61 测试通过。
