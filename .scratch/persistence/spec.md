# persistence — Phase 4 持久化 + 定时

## 目标

把抓取结果从"内存即抛"变成"落库可查"，并支持定时监控。决策见 `docs/adr/0006-persistence.md`。

## 方法

- SQLite（better-sqlite3），`data/amazon.db`（`DB_PATH` 可配，`:memory:` 供测试）。
- 表：`listings`（最新状态，upsert）/ `price_snapshots`（只追加）/ `watches`。
- `Persistence` 接口隔离（`src/db/persistence.ts`），业务层不碰 SQL。
- `/api/scrape`、`/api/detail` 成功即自动落库，响应带 `saved`。
- 新 API：`GET /api/history`、`GET /api/listings`、`POST/GET /api/watch`、`DELETE /api/watch/:id`。
- Watch 调度器：进程内 60s tick，扫描到期 Watch → `runSearchJob` → 落库 → 更新 last_run_at。
- 前端：统计卡加"已保存"、详情卡片加"价格历史"SVG 趋势图、Watch 管理面板。

## 验收

- [x] 存储层单测 6（币种推断 / upsert+snapshot / 无价格 / saveDetail / 排序检索 / watch CRUD+due）
- [x] 持久化 API 集成 3（history / listings / watch 夹紧+CRUD）
- [x] 调度器测试 2（到期执行+标记 / 失败不崩 tick）
- [x] 全量 98/98，typecheck + build 通过
- [x] 真实冒烟：scrape 落库 → history 有快照 → watch 创建
