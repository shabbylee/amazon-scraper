# AGENTS.md — Amazon Scraper 工作手册

本项目是一个 Amazon 商品抓取器：输入关键字，抓取商品列表与（后续阶段的）详情页，前端表格展示、CSV 导出，最终支持历史价格与定时抓取。

后端 Node.js + Express + Puppeteer，前端零依赖单文件。

## 工作方式

- **术语以 `CONTEXT.md` 为准**。涉及 Marketplace / Listing / Scrape Job / Attempt / Parser / Scraper 等概念时使用其中的规范说法；术语缺失或冲突时通过 `/domain-modeling` 补充，不要自行发明同义词。
- **一件事一个目录**。每个 feature 对应 `.scratch/<feature-slug>/`，规格是 `spec.md`，实现工单是 `issues/NN-<slug>.md`，约定见 `docs/agents/issue-tracker.md`。
- **动手前先分诊**。用 `/triage` 过一遍，标签见 `docs/agents/triage-labels.md`；分诊状态写在条目顶部的 `Status:` 行。
- **决策要落 ADR**。四阶段路线图、TS 迁移、数据库选型、代理池实现、Marketplace 注册表这类"难以回退 + 未来读者会问为什么"的选择写进 `docs/adr/NNNN-<slug>.md`，格式见 `docs/agents/domain.md`。
- **Parser 与 Scraper 严格分层**。Parser 只做 DOM → 领域对象，纯函数、无 IO、可单测；Scraper 才碰浏览器、重试、代理。新加代码前先问自己"这段属于哪层"。

## 抓取伦理与边界

Amazon 是会主动反爬的第三方站点。以下规则是**硬约束**，改动前必须先记录 ADR：

- **匿名访问**：不登录、不持久化 Cookie、不携带用户凭证。
- **限速**：同一 Marketplace 相邻 Attempt 至少间隔 2 秒；并发 Attempt ≤ 2。
- **尊重 CAPTCHA**：识别到验证码页面即归类为 `captcha` 失败态并停止重试该 Job，不打码、不切账号。
- **真实 UA + 合理 Header**：使用主流浏览器 UA，不伪装 Amazon 官方客户端。
- **失败要分类**：`network` / `timeout` / `captcha` / `parser-miss` / `unknown`，只有前两类可以自动重试。

## 命令

| 用途 | 命令 |
|---|---|
| 安装依赖 | `npm install` |
| 启动服务 | `npm start`（默认 `http://localhost:3456`） |
| 健康检查 | `curl http://localhost:3456/api/health` |
| 抓取一次 | `curl -X POST http://localhost:3456/api/scrape -H 'content-type: application/json' -d '{"keyword":"laptop","pages":1}'` |

Phase 1 之后会新增 `npm test` / `npm run lint` / `npm run build`；届时更新此表，不要把测试脚本散落到 README。

## 代码约定

- **CommonJS**（`"type": "commonjs"`），跟首个提交保持一致；如要迁 ESM 或 TS，走 ADR。
- **无框架前端**：`public/index.html` 单文件，保持零依赖；如要引入构建流程，走 ADR。
- **配置从 `.env` 读**，通过 `loadEnv()`（Phase 1 会替换为统一 `config` 模块）；不要把常量硬编码进业务代码。
- **提交信息前缀**：`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:`，跟首个提交 `feat: Amazon scraper v1.0` 一致。
- **不 `push` 到 `main` 除非用户明确要求**；本地 `git commit` 可以随时做。

## 边界

- 本仓库不代替任何生产级监控/告警系统；Watch 阶段的价格提醒只落地为本地通知或简单前端提示。
- 与用户其他仓库（`WechatWork` / `FeishuWork`）互不搬移条目；如果 Amazon 抓取需求来自飞书/微信，在来源仓库登记并在这里留来源指向。

## Agent skills

### Issue tracker

条目以本地 markdown 文件形式存放在 `.scratch/<feature-slug>/` 下（非 GitHub/GitLab）。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的五个分诊角色标签（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录一个 `CONTEXT.md` + `docs/adr/`。详见 `docs/agents/domain.md`。
