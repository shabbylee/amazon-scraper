# 01-price-alert

Type: feature
Status: resolved

Watch 价格变动提醒（Webhook）。规格见同目录 `spec.md`，决策见 `docs/adr/0007-price-alert.md`。

## Answer

- `config.ts`：`WATCH_WEBHOOK_URL` / `WATCH_PRICE_CHANGE_PCT`（夹紧 [0.01, 100] 默认 1）。
- `src/alerts.ts`：`buildPriceAlerts` / `deliverAlert` / `persistAlert`。
- `src/scheduler.ts`：重构为 `fetchWatchListings` 注入点，落库/提醒/标记分离。
- `src/db/schema.ts`：迁移 v2（`price_alerts`）；`Persistence.insertAlert` / `getRecentSnapshots`。
- `src/routes/health.ts`：+`webhookEnabled`。
- 前端：历史图 7/30/90/365 天切换。
- 测试：alerts 6 / scheduler 4（提醒链路），全量 106/106。
- 版本 1.5.0，tag `v1.5.0-phase4`。
