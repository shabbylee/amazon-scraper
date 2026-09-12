# Persistence：Phase 4 用 SQLite（better-sqlite3），抓取结果自动落库

## 背景

Phase 1-3 的抓取结果是内存态：`POST /api/scrape` / `/api/detail` 把对象直接 JSON 返回，进程退出即消失（用户唯一留存手段是前端手动导出 CSV）。CONTEXT.md 早已定义 `Price Snapshot`（只追加不更新）与 `Watch`（持久化 + 定时阶段的入口概念），Phase 4 把它们落地。

## 决定

- **存储 = SQLite 单文件，驱动 better-sqlite3**：
  - 项目定位是本地工具：单文件、零运维、无需外部服务，进程重启数据仍在。
  - better-sqlite3 同步 API 简单可靠、有主流平台 prebuilt（避免 node-gyp 编译），`:memory:` 便于单测。
  - 不选 Node 内置 `node:sqlite`：Node 20（CI 矩阵之一）没有该模块，且它仍是实验特性。
  - 不选 JSONL：历史趋势需要按 `(marketplace, asin, 时间)` 高效查询，文件扫描太弱；SQLite 与 JSONL 的取舍记录在案，不做混合。
- **Schema（对齐 CONTEXT.md 术语）**：
  - `listings`：最新状态快照，`UNIQUE (marketplace, asin)`，抓取到即 upsert。
  - `price_snapshots`：价格只追加，`(marketplace, asin, captured_at)` 索引；一条 Listing 一次抓取产生一条。
  - `watches`：用户订阅的 `(Keyword, Marketplace, 间隔)`，进程内调度器扫描到期项触发抓取。
- **自动落库**：`/api/scrape` 与 `/api/detail` 成功即写入（listings upsert + snapshots insert），响应带 `saved` 计数，无需显式"保存"按钮。
- **Repository 接口隔离**：业务层只依赖 `Persistence` 接口，SQLite 是当前实现；将来换 Postgres 只换实现不换业务。
- **Watch 调度不引入 node-cron**：进程内 `setInterval`（60s 粒度）扫描到期 Watch，触发复用 `runSearchJob` / `runDetailJob` 管道，`last_run_at` 持久化保证不重跑。

## 被拒绝的替代方案

- **node:sqlite（Node 内置）**：Node 20 无此模块，CI 矩阵含 Node 20；实验 flag 增加部署噪音。
- **JSONL / lowdb**：无索引，历史趋势与按 ASIN 查询要全量扫描；Watch 状态并发更新易损坏。
- **Postgres / MySQL（起步即上）**：本地单用户工具上外部数据库过重；接口已隔离，需要时再换。
- **node-cron**：语法学习成本 + 进程内语义与 setInterval 等价；本项目只需"到期触发"，60s 粒度足够。

## 后果

- 新增依赖 `better-sqlite3`（Phase 1 起第一个运行时原生依赖；有 prebuilt，无 node-gyp）。
- `src/db/` 新层：`schema.ts`（建表/迁移）、`persistence.ts`（Repository 实现）、`store.ts`（App 级单例装配）。
- `/api/scrape`、`/api/detail` 响应新增 `saved`；新增 `GET /api/history`、`GET /api/listings`、`POST/GET/DELETE /api/watch`。
- 前端：抓取后提示"已保存 N 条"，详情卡片加"价格历史"SVG 趋势图，新增 Watch 管理面板。
- 数据库文件默认 `<project>/data/amazon.db`（`DATA_DIR` 可配，加入 .gitignore）；`:memory:` 用于测试。
- Docker：挂载 volume 持久化 data 目录。
