# 四阶段路线图：先重构，再稳定，再深入，再持久化

v1.0 是一个 207 行 `server.js` + 529 行单文件前端的"一次成型"版本。要继续推进"抓取稳定性 / 详情页 / 持久化+定时 / 工程化重构"四个方向，我们决定**按 Phase 1 → 2 → 3 → 4 顺序**推进，而不是并行或从最"有价值"的功能先做。

- **Phase 1 — 工程化重构**：把 `server.js` 拆成 `src/{app,config,browser,scraper,parser,routes}`，明确 Parser/Scraper 分层，加 vitest + supertest、Dockerfile、GitHub Actions。TypeScript 迁移单独走 ADR-0002 决定。
- **Phase 2 — 抓取稳定性**：在 Phase 1 的边界内引入 Retry（按 `Failure Class` 分类）、Proxy Pool 接口、stealth 插件、多 Marketplace 注册表、CAPTCHA 探测。
- **Phase 3 — 商品详情**：新增 Detail Scraper 与 Detail Parser，把 Listing schema 扩展到 Buy Box / 卖家 / 运费 / 变体 / 评论数。
- **Phase 4 — 持久化 + 定时**：SQLite（better-sqlite3）存 Listing / Price Snapshot / Watch，node-cron 调度 Scrape Job，前端加历史曲线与提醒。

## 为什么这个顺序

- **重构前置**：Phase 2/3/4 每个都会往抓取路径里塞新代码。不先拆模块，稳定性/详情页/持久化的逻辑会全部挤进 `server.js`，几次迭代后就无法维护。
- **稳定性先于详情页**：详情页比列表页更容易触发反爬（Amazon 对 `/dp/` 的保护强于 `/s`）。没有 Phase 2 的 Retry/Proxy/CAPTCHA 分类，Phase 3 抓十次能有六次是空的，schema 也验证不了。
- **持久化最后**：Snapshot 的字段取决于 Listing 的最终 schema。Phase 3 之前定 schema，Phase 4 就得改迁移；不如等 Listing 稳定再落库。

## 被拒绝的替代方案

- **先做持久化**：能立刻看到"历史价格"的效果，但 schema 会随 Phase 2/3 反复迁移，早期数据变成负债。
- **先做详情页**：功能上更"值钱"，但没有稳定的抓取管道，详情页失败率会拖垮整个演示。
- **边加功能边重构**：每次功能提交都夹带结构调整，diff 不可读，回滚代价高。

## 后果

- Phase 1 结束前**不引入新的用户可见功能**；README 与前端在 Phase 1 只做同步更新的必要修改。
- 每完成一个 Phase 打一个 tag（`v0.2-phase1` / `v0.3-phase2` / …），保留回退点。
- Phase 之间如果有新的架构级选择（TS 迁移、数据库选型、代理池实现、调度器实现），单独开 ADR，不塞进路线图 ADR 里。
