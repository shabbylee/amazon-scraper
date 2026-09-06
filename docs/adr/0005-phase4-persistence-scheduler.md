# Phase 4 持久化 + 定时：SQLite / node-cron / 三路 Alert / Chart.js

Phase 1-3 把抓取管道做稳了，但数据是"用完即丢"的：每次 Job 结束，Listing 只活在一个 JSON 响应里。Phase 4 要让用户能**订阅关键字、周期性抓取、积累价格历史、在价格变化时收到提醒**。

## 决定

- **数据库**：SQLite（`better-sqlite3`），单文件 `data/scraper.sqlite`，WAL 模式，无 ORM
- **调度器**：`node-cron`，最小粒度**每周一次**（用户不需要小时级）；Watch 创建时选预设（每周一 / 每天 / 每周 / 每月）或自定义 cron 表达式
- **数据保留**：**全部保留**，不自动清理；用户可手动删 Watch 时级联清理关联 Snapshot
- **Alert 三路**：
  1. **前端展示**：Watch 列表里标红 badge + 价格变化幅度；轮询 `/api/watches/changes`
  2. **本地系统通知**：macOS 走 `osascript -e 'display notification ...'`；Linux 走 `notify-send`；Windows 走 PowerShell toast。失败静默忽略
  3. **Webhook 回调**：POST JSON 到用户配置的 URL（飞书机器人 / 钉钉 / Slack / 自定义）；超时 10s；失败记录但不重试
- **前端图表**：Chart.js via CDN（`<script src="https://cdn.jsdelivr.net/npm/chart.js">`），在详情模态框里加"价格历史"折线图 tab
- **不引入 ORM**：`better-sqlite3` 的同步 API + 手写 SQL 足够；schema 用 `db/migrations/` 目录下的 `.sql` 文件管理，启动时自动跑未执行的 migration

## 为什么这么选

**SQLite 而不是 Postgres**
- 单用户本地工具，不需要网络数据库
- 零配置、零运维、单文件备份
- `better-sqlite3` 是同步 API，代码简单、无连接池管理
- Phase 4 的数据量（每周一次 × 几十个关键字 × 几年）远不到 SQLite 的瓶颈

**node-cron 而不是 BullMQ / Agenda**
- 不需要任务队列（单进程、单用户、无并发竞争）
- node-cron 是纯 JS、零依赖、API 简单
- Watch 的 cron 表达式直接存 DB，进程启动时从 DB 恢复所有 active Watch 的调度

**三路 Alert 而不是只做一个**
- 前端展示是"打开页面才看到"，不够及时
- 本地通知是"在电脑前才看到"，但零成本
- Webhook 是"推到手机/群聊"，最及时但需要用户配置
- 三路互补，用户按需开启

**Chart.js CDN 而不是手写 SVG**
- 折线图 + tooltip + 时间轴 + 响应式，手写成本太高
- CDN 引入不破坏"前端零构建"原则（不需要 bundler）
- Chart.js 是最轻量的主流图表库（~60KB gzipped）

## Schema 概要

```
listings          每次搜索 Job 的每个 Listing 快照
price_snapshots   价格时间序列（只追加）
product_details   Phase 3 详情 JSON 缓存（upsert by marketplace+asin）
watches           用户订阅（keyword + marketplace + cron + webhook + notify_local）
watch_runs        每次 Watch 执行的记录（status / listings_found / price_changes / error）
price_changes     价格变化事件（watch_run_id + asin + old_price + new_price + change_pct）
```

## 后果

- 新增 `data/` 目录（.gitignore 已覆盖 `*.sqlite*`）
- 新增依赖：`better-sqlite3`（native addon）+ `node-cron`（纯 JS）
- Docker 镜像需要加 `python3` + `build-essential` 来编译 better-sqlite3 的 native addon（或用 prebuild）
- `src/index.ts` 启动时多两步：open DB + start scheduler；shutdown 时多两步：stop scheduler + close DB
- 前端引入 Chart.js CDN（唯一的外部前端依赖）；离线环境下图表不可用，降级为表格
- Alert 的 webhook 失败不重试（避免放大故障）；本地通知失败静默忽略（跨平台兼容性）
