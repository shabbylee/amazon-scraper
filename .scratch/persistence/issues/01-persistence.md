# 01-persistence

Type: feature
Status: resolved

Phase 4 持久化 + 定时。规格见同目录 `spec.md`，决策见 `docs/adr/0006-persistence.md`。

## Answer

- `src/db/schema.ts`：建表/迁移（listings / price_snapshots / watches）。
- `src/db/persistence.ts`：`Persistence` 接口 + `SqlitePersistence`（含 `extractCurrency`）。
- `src/db/store.ts`：`createStore` 装配（文件 / :memory:）。
- `src/routes/history.ts` / `listings.ts` / `watch.ts`；`scrape.ts` / `detail.ts` 成功即落库。
- `src/scheduler.ts`：Watch 调度器（60s tick + 启动补跑）。
- 前端：保存提示 / 价格历史 SVG / Watch 面板。
- 测试：db 6 / API 3 / scheduler 2，全量 98/98。
- 版本 1.4.0，tag `v1.4.0-phase4`。
