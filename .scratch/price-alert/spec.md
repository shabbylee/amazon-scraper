# price-alert — Watch 价格变动提醒（Webhook）

## 目标

补全 Watch 语义（CONTEXT.md："周期性触发 + 在价格变化时提醒"）。决策见 `docs/adr/0007-price-alert.md`。

## 方法

- `WATCH_WEBHOOK_URL`（可选）+ `WATCH_PRICE_CHANGE_PCT`（默认 1%，夹紧 [0.01, 100]）。
- `src/alerts.ts`：`buildPriceAlerts`（对比最近两次快照，纯函数）+ `deliverAlert`（fetch POST，8s 超时）+ `persistAlert`。
- scheduler 重构：`fetchWatchListings` 注入点（抓取）与 落库/提醒/标记 分离，提醒链路可单测。
- schema v2：`price_alerts` 表（watch_id / asin / from / to / delta_pct / created_at）。
- 前端：价格历史图支持 7/30/90/365 天切换。

## 验收

- [x] alerts 单测 6（超阈值涨跌 / 首次无对比 / 无价格+低于阈值 / webhook 发送 / 非 2xx 抛错 / 落库）
- [x] scheduler 集成 4（执行+落库+标记 / 失败不崩 / 价格变动发提醒+落库 / 价格稳定不发）
- [x] 全量 106/106，typecheck + build 通过
- [x] 冒烟：webhook 未配置时调度器正常运行（health.webhookEnabled=false）
