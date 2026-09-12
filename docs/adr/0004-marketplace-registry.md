# Marketplace 注册表：从 com 扩展到 cojp / de / cn / couk

## 背景

Phase 1 只有 `com` 一个站点，`MarketplaceId` 是字面量类型 `'com'`。路线图要求 Phase 2 扩展多站点。难点不在 URL（注册表加 host 即可），而在**价格格式**：德语站点用逗号做小数分隔（`EUR 12,99`），其他站点用点（`$1,299.00` / `￥1,234`）。数字解析必须在 Node 侧按 Marketplace 的格式规则做，不能在浏览器里写死。

## 决定

- **注册表结构**：`Marketplace` 增加 `priceDecimalSeparator`（`.` / `,`）与 `priceGroupSeparator`（`,` / `.`）两个字段；`MARKETPLACES` 一次登记五个站点：

  | id | host | currency | locale | 小数分隔 |
  |---|---|---|---|---|
  | com | www.amazon.com | USD | en-US | `.` |
  | cojp | www.amazon.co.jp | JPY | ja-JP | `.` |
  | de | www.amazon.de | EUR | de-DE | `,` |
  | cn | www.amazon.cn | CNY | zh-CN | `.` |
  | couk | www.amazon.co.uk | GBP | en-GB | `.` |

- **数字解析收口 Node 侧**：浏览器侧 `extractSearchResultsInPage` 只提取原始价格文本（不再 parse 数字）；Node 侧新增纯函数 `parsePriceNum(text, marketplace)` 按站点格式解析。Parser 保持"纯函数、可单测"。
- **新增站点两步走**（CONTEXT.md 已约定）：① 注册表加一条记录；② 若该站点 DOM 结构与现有一致则复用 Parser，否则加一组该站点专属的 DOM 提取分支。不改核心 Scraper。

## 被拒绝的替代方案

- **浏览器里写死点分隔**：`12,99` 会被拆成 1299，德国站价格全错。
- **引入 `Intl.NumberFormat` 解析**：它管格式化，不管解析；对乱序输入不如正则可靠。
- **为每个站点复制整个 Parser**：重复率高，等真的出现 DOM 分叉再拆，现在用注册表字段解决格式差异。

## 后果

- `Listing.priceNum` 语义不变：站点本地货币的数值，不做汇率折算（CONTEXT.md 开放问题保留）。
- 前端需要暴露站点选择器；`POST /api/scrape` 的 `marketplace` 字段现在支持 5 个值。
- 新站点仍受 AGENTS.md 限速/CAPTCHA 约束（同一 Marketplace 维度）。
