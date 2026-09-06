# AGENTS.md — Amazon Scraper 工作手册

本项目是一个 Amazon 商品抓取器：输入关键字，抓取商品列表与（后续阶段的）详情页，前端表格展示、CSV 导出，最终支持历史价格与定时抓取。

后端 Node.js + Express + Puppeteer，前端零依赖单文件。

## 工作方式

- **术语以 `CONTEXT.md` 为准**。涉及 Marketplace / Listing / Scrape Job / Attempt / Parser / Scraper 等概念时使用其中的规范说法；术语缺失或冲突时通过 `/domain-modeling` 补充，不要自行发明同义词。
- **一件事一个目录**。每个 feature 对应 `.scratch/<feature-slug>/`，规格是 `spec.md`，实现工单是 `issues/NN-<slug>.md`，约定见 `docs/agents/issue-tracker.md`。
- **动手前先分诊**。用 `/triage` 过一遍，标签见 `docs/agents/triage-labels.md`；分诊状态写在条目顶部的 `Status:` 行。
- **决策要落 ADR**。四阶段路线图、TS 迁移、数据库选型、代理池实现、Marketplace 注册表这类"难以回退 + 未来读者会问为什么"的选择写进 `docs/adr/NNNN-<slug>.md`，格式见 `docs/agents/domain.md`。
- **Parser / Scraper / Proxy 三层严格分离**：
  - **Parser**（`src/parser/`）只做 DOM → 领域对象，纯函数、无 IO、可单测
  - **Scraper**（`src/scraper/`）编排 Browser + Retry + Parser + Proxy 完成 Attempt，负责失败分类
  - **Proxy**（`src/proxy/`）只做端点管理（分配 / 冷却 / 归还），不碰浏览器、不解析 DOM
  - 新加代码前先问自己"这段属于哪层"；跨层的类型统一放 `src/types.ts`

## 抓取伦理与边界

Amazon 是会主动反爬的第三方站点。以下规则是**硬约束**，改动前必须先记录 ADR：

- **匿名访问**：不登录、不持久化 Cookie、不携带用户凭证。
- **限速**：同一 Marketplace 相邻 Attempt 至少间隔 2 秒；并发 Attempt ≤ 2。
- **尊重 CAPTCHA**：识别到验证码页面即归类为 `captcha` 失败态并停止重试该 Job，**不换代理、不打码、不切账号**。
- **真实 UA + 合理 Header**：使用主流浏览器 UA，不伪装 Amazon 官方客户端。
- **失败要分类**：`network` / `timeout` / `captcha` / `parser-miss` / `unknown`；只有前两类可以自动重试（最多 3 次，指数退避 1s → 2s → 4s）。
- **代理只做端点管理**：Proxy Pool 负责分配 / 冷却 / 归还，不做任何反爬绕过；命中 CAPTCHA 时不把当前代理标记为失败（那不是代理的锅）。

## 命令

| 用途 | 命令 |
|---|---|
| 安装依赖 | `npm install` |
| 开发（热重载） | `npm run dev`（tsx watch，默认 `http://localhost:3456`） |
| 生产构建 | `npm run build`（`tsc -p tsconfig.build.json` → `dist/`） |
| 生产运行 | `npm start`（`node dist/index.js`；必须先 build） |
| 类型检查 | `npm run typecheck` |
| 单元测试 | `npm test`（vitest run）/ `npm run test:watch` |
| 健康检查 | `curl http://localhost:3456/api/health` |
| 抓取一次 | `curl -X POST http://localhost:3456/api/scrape -H 'content-type: application/json' -d '{"keyword":"laptop","pages":1}'` |
| 抓单个详情 | `curl -X POST http://localhost:3456/api/detail -H 'content-type: application/json' -d '{"asin":"B09S3HNMHF"}'` |
| 创建 Watch | `curl -X POST http://localhost:3456/api/watches -H 'content-type: application/json' -d '{"keyword":"laptop","cronExpr":"0 9 * * 1"}'` |
| 查看价格历史 | `curl http://localhost:3456/api/history/B09S3HNMHF` |
| Docker 构建 | `docker build -t amazon-scraper:local .` |
| Docker 运行 | `docker compose up --build`（映射 3456） |

CI 走 `.github/workflows/ci.yml`（Node 20 + 22 矩阵：install → typecheck → build → test → docker build）。

## 代码约定

- **TypeScript strict + ESM**：后端源码在 `src/`，编译到 `dist/`；`"type": "module"`，`NodeNext` 模块解析，所有相对 import 必须带 `.js` 扩展名。决定与迁移代价见 `docs/adr/0002-typescript-migration.md`；再改模块系统或语言需新 ADR。
- **Node ≥ 20**：跟 `package.json#engines` 与 Dockerfile base image 保持一致。
- **无框架前端**：`public/index.html` 单文件，保持零依赖；如要引入构建流程，走 ADR。
- **配置统一从 `src/config.ts` 读**：`loadConfig({ env, envFilePath })` 会把 `process.env` 覆盖到 `.env` 之上，并把 `requestIntervalMs` / `maxConcurrentAttempts` 夹紧到 AGENTS.md 硬约束。**不要**在业务代码里直接读 `process.env` 或硬编码常量。
- **Parser 与 Scraper 严格分层**：Parser 是纯函数（DOM → 领域对象），Scraper 才碰 browser/IO/retry。跨层的类型都在 `src/types.ts`。
- **提交信息前缀**：`feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:`；breaking change 用 `!` 后缀（如 `refactor!:`）并在正文写 `BREAKING CHANGE:`。
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
