# multi-marketplace — 注册表扩展到 5 站点（ADR-0004）

## 目标

把 `MarketplaceId` 从 `com` 扩展到 `com / cojp / de / cn / couk`，并解决各站点价格格式差异。

## 决策要点

- 注册表加 `priceDecimalSeparator` / `priceGroupSeparator` 字段；de 用逗号小数分隔。
- 价格数字解析从浏览器侧移到 Node 侧纯函数 `parsePriceNum(text, marketplace)`。
- 前端加站点选择器；`POST /api/scrape` 的 `marketplace` 支持 5 个值。
- 汇率折算不做（CONTEXT.md 开放问题保留）。

## 验收

- [x] `parsePriceNum` 覆盖 5 站点格式（含 `EUR 12,99`、`1.234,56 €`）
- [x] `toListings` 绑定到对应 host 并解析本地价格
- [x] `buildSearchUrl` 按 host 生成；config 接受扩展站点
- [x] 前端站点选择器 + 请求体传 `marketplace` + 来源卡片显示站点
