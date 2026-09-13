# Price Alert：Watch 价格变动提醒，Webhook 优先

## 背景

Watch 的语义（CONTEXT.md）是"周期性触发 Scrape Job **并在价格变化时提醒**"。Phase 4 只实现了"周期触发 + 落库"，缺提醒出口。历史趋势的"对比维度"API 已支持 `days=1..365`，缺的是前端切换与一次抓取的"变化摘要"。

## 决定

- **提醒 = Price Alert，Webhook 出口**：
  - `WATCH_WEBHOOK_URL` 配置（可选）。配置后，每次 Watch 完成抓取，对本次抓到的**有价格** Listing 对比其最近两次价格快照，价格变动幅度 ≥ `WATCH_PRICE_CHANGE_PCT`（默认 1%，可配 0.01–100）则生成 Alert 并 POST JSON 到 Webhook。
  - 选 Webhook 不选内置邮件：SMTP 需要账号/密钥/额外依赖（nodemailer），本地工具不引入；Webhook 载荷标准，用户可经 Mailgun / Zapier / IFTTT 等转发成邮件（README 说明）。
- **载荷格式**：`{ event: "price_change", watch, listing, from, to, deltaPct, capturedAt }`，`from`/`to` 带 `priceText` 与 `priceNum`，`deltaPct` 为有符号百分比（负 = 降价）。
- **落库 `price_alerts`**：`(watch_id, keyword, marketplace, asin, from_price, to_price, delta_pct, created_at)`，schema 迁移到 v2。可审计、可查。
- **失败不崩调度器**：Webhook 发送失败只记日志（`console.error` + alert 仍落库），不影响 Watch 后续 tick。
- **历史趋势维度**：前端趋势图加 7/30/90/365 天切换（`GET /api/history?days=` 已支持），不新增后端逻辑。

## 被拒绝的替代方案

- **内置 SMTP 邮件**：需要账号与密钥、增加依赖；Webhook 转发覆盖邮件场景。
- **阈值固定为 0（任何变动都提醒）**：同一商品短时间价格抖动会刷屏；默认 1% 且可配。
- **只在"降价"时提醒**：涨跌都要知道（用户可能想追踪涨价原因），阈值已控制噪音。

## 后果

- `src/config.ts` + `WATCH_WEBHOOK_URL` / `WATCH_PRICE_CHANGE_PCT`（`.env.example` 同步）。
- `src/db/schema.ts` 迁移 v2（`price_alerts`）；`Persistence` + `insertAlert` / `getRecentSnapshots`。
- `src/alerts.ts`：`buildPriceAlerts`（纯函数，可单测）+ `deliverAlert`（fetch POST）。
- `src/scheduler.ts`：Watch 完成 → 生成提醒 → 落库 → 发送；`deliverAlert` 可注入测试。
- 前端：趋势图时间段切换。
