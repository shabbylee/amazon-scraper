# Amazon Scraper

Amazon 商品价格抓取器 — 输入关键字，一键抓取商品、价格、评分，按表格展示并支持 CSV 导出。

后端 TypeScript（strict + ESM）+ Express 5 + Puppeteer 25，前端零依赖单文件（HTML/CSS/JS）。

> 项目当前进度见 [`docs/adr/0001-four-phase-roadmap.md`](docs/adr/0001-four-phase-roadmap.md)。术语见 [`CONTEXT.md`](CONTEXT.md)，工作方式见 [`AGENTS.md`](AGENTS.md)。

## 快速开始

### 开发（热重载）

```bash
npm install
npm run dev
# → http://localhost:3456
```

`npm run dev` 用 [`tsx`](https://tsx.is) 直接跑 TypeScript，改代码即重启，不需要 build。

### 生产

```bash
npm install
npm run build   # tsc → dist/
npm start       # node dist/index.js
```

### Docker

```bash
docker compose up --build
# → http://localhost:3456
```

镜像基于 `node:20-bookworm-slim` + Debian chromium + Noto CJK 字体，multi-stage 构建，产物只带 `dist/` + `public/` + 生产依赖。

## 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | ≥ 20（ESM + 稳定 fetch） |
| 操作系统 | macOS / Linux / Windows |
| Chrome | 已安装（自动探测）或用 Puppeteer 自带的 Chromium |

## 配置

复制 `.env.example` 为 `.env` 后按需修改。所有变量都有默认值，`.env` 可选。

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3456` | 服务端口 |
| `HEADLESS` | `true` | `false` = 弹出可见 Chrome 窗口（排查反爬用） |
| `CHROME_PATH` | 自动探测 | 手动指定 Chrome 可执行文件路径 |
| `DEFAULT_MARKETPLACE` | `com` | 默认 Amazon 站点；Phase 2 会扩展 `cojp` / `de` / `cn` / `couk` |
| `REQUEST_INTERVAL_MS` | `2000` | 相邻 Attempt 最小间隔（毫秒）。**硬下限 2000**，配低了会被夹紧 |
| `MAX_CONCURRENT_ATTEMPTS` | `1` | 并发 Attempt 上限。**硬上限 2**，配高了会被夹紧 |

后两个硬约束来自 [`AGENTS.md`](AGENTS.md) 的抓取伦理，改约束前请先记录 ADR。

## 项目结构

```
amazon-scraper/
├── package.json              # type=module, engines.node>=20
├── tsconfig.json             # 编辑器/typecheck 用（含 tests）
├── tsconfig.build.json       # 构建用（只 src，不含 *.test.ts）
├── vitest.config.ts
├── .prettierrc.json
├── Dockerfile                # multi-stage: builder + runner(node:20 + chromium)
├── docker-compose.yml
├── .dockerignore
├── .github/workflows/ci.yml  # Node 20/22 矩阵 + docker build
├── .env.example
├── AGENTS.md                 # 工作方式与抓取伦理
├── CONTEXT.md                # 领域术语表
├── docs/
│   ├── adr/
│   │   ├── 0001-four-phase-roadmap.md
│   │   └── 0002-typescript-migration.md
│   └── agents/               # mattpocock skill 约定（domain / issue-tracker / triage-labels）
├── .scratch/                 # 本地 issue tracker（feature-slug/spec.md + issues/NN-*.md）
├── src/
│   ├── index.ts              # 入口：loadConfig → createApp → listen + graceful shutdown
│   ├── app.ts                # createApp 工厂（可脱离 listen 单测）
│   ├── config.ts             # AppConfig + loadConfig；夹紧 AGENTS.md 硬约束
│   ├── types.ts              # Marketplace / Listing / ScrapeJob / AttemptSummary / FailureClass
│   ├── routes/
│   │   ├── health.ts         # GET /api/health
│   │   └── scrape.ts         # POST /api/scrape
│   ├── scraper/
│   │   ├── browser.ts        # detectChromePath + launchBrowser
│   │   └── search.ts         # buildSearchUrl / classifyError / isCaptchaPage / scrapeSearchPage / runSearchJob
│   └── parser/
│       └── search-page.ts    # 浏览器侧 extractSearchResultsInPage + Node 侧 toListings（类型守卫）
├── tests/
│   └── api.test.ts           # supertest 集成测试
└── public/
    └── index.html            # 前端（零依赖单文件）
```

## API

### `GET /api/health`

```json
{
  "ok": true,
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "chromeDetected": true,
  "headless": true,
  "defaultMarketplace": "com",
  "requestIntervalMs": 2000,
  "maxConcurrentAttempts": 1
}
```

### `POST /api/scrape`

请求：

```json
{
  "keyword": "laptop",
  "pages": 3,
  "marketplace": "com"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyword` | string | **必填**，搜索关键字 |
| `pages` | number | 抓取页数，夹紧到 `[1, 10]`，默认 3 |
| `marketplace` | string | 可选，默认走 `DEFAULT_MARKETPLACE`；Phase 1 只支持 `com` |

响应：

```json
{
  "keyword": "laptop",
  "marketplace": "com",
  "pagesScraped": 3,
  "total": 48,
  "withPrice": 12,
  "withoutPrice": 36,
  "minPrice": "$899.00",
  "maxPrice": "$2,499.00",
  "avgPrice": "$ 1,462",
  "items": [
    {
      "marketplace": "com",
      "asin": "B09S3HNMHF",
      "title": "Samsung 14\" Galaxy Chromebook Go...",
      "href": "https://www.amazon.com/dp/B09S3HNMHF",
      "priceText": "$249.00",
      "hasPrice": true,
      "priceNum": 249,
      "image": "https://m.media-amazon.com/images/I/...",
      "rating": 4.3
    }
  ],
  "attempts": [
    { "page": 1, "ok": true, "durationMs": 4123, "listingCount": 16 },
    { "page": 2, "ok": true, "durationMs": 3870, "listingCount": 16 },
    { "page": 3, "ok": false, "durationMs": 210, "listingCount": 0, "failure": "captcha", "message": "Amazon 返回验证码页面" }
  ]
}
```

`attempts` 是 Phase 1 新加的：每页一条，含成败、耗时、失败分类。遇到 `captcha` 会立即停止后续页（AGENTS.md 硬约束），已抓到的页仍然返回。

失败分类枚举（`FailureClass`）：

- `network` — DNS/连接/导航失败，可自动重试（Phase 2 会加）
- `timeout` — 页面加载超时，可自动重试
- `captcha` — 反爬验证页，**不重试**，直接终止该 Job
- `parser-miss` — 页面拿到了但没解析到 Listing（Amazon 改了 DOM 结构？空搜索结果？）
- `unknown` — 兜底

## 前端功能

- **关键字输入**：回车或点"立即抓取"
- **页数选择**：1 / 2 / 3 / 5 / 10 页
- **统计卡片**：总数、页数、有/无价格数、最低/最高/平均价格
- **筛选**：全部 / 有价格 / 无价格
- **点击排序**：点击表头按价格或评分排序
- **星级展示**：5 星可视化 + 阿拉伯数字
- **跳转链接**：直接打开 Amazon 商品页
- **CSV 导出**：带 UTF-8 BOM 的 CSV（Excel 友好）

## 工作原理

```
┌──────────┐     POST /api/scrape      ┌─────────────────┐
│  浏览器   │ ────────────────────────▶ │  Express (app.ts)│
│  前端页面 │                           │  → scrapeHandler │
└──────────┘                           └────────┬────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │ runSearchJob          │
                                    │  ├─ launchBrowser     │
                                    │  ├─ 遍历 pages 1..N   │
                                    │  │   ├─ scrapeSearchPage
                                    │  │   │   ├─ goto
                                    │  │   │   ├─ isCaptchaPage
                                    │  │   │   └─ evaluate(extractSearchResultsInPage)
                                    │  │   └─ toListings (类型守卫)
                                    │  └─ sleep(interval)   │
                                    └────────┬──────────────┘
                                             ▼
                                     ScrapeResult JSON
                                     (含 attempts 明细)
```

Parser 与 Scraper 严格分层：Parser 是纯函数（DOM → 领域对象），可单测；Scraper 才碰 browser/IO/失败分类。

## 开发命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | tsx watch，热重载 |
| `npm run build` | tsc → `dist/` |
| `npm start` | 跑 `dist/index.js` |
| `npm run typecheck` | 只跑 tsc --noEmit |
| `npm test` | vitest run（parser / config / route validation / API） |
| `npm run test:watch` | vitest 交互模式 |

CI（`.github/workflows/ci.yml`）在 push / PR 到 `main` 时跑 Node 20 + 22 矩阵的 install → typecheck → build → test，最后 docker build 一次。

## 路线图

见 [`docs/adr/0001-four-phase-roadmap.md`](docs/adr/0001-four-phase-roadmap.md)。当前状态：

- [x] **Phase 1** — 工程化重构（TS + 模块拆分 + 测试 + Docker + CI）
- [ ] **Phase 2** — 抓取稳定性（Retry / Proxy Pool / stealth / 多 Marketplace / CAPTCHA 降级）
- [ ] **Phase 3** — 商品详情（Detail Scraper + Parser，扩展 Listing schema 到 Buy Box / 卖家 / 运费 / 变体 / 评论数）
- [ ] **Phase 4** — 持久化 + 定时（SQLite 存 Listing / Price Snapshot / Watch，node-cron 调度 Job，前端历史曲线）

## 常见问题

**Q：抓不到数据 / 503 / attempts 里全是 `captcha`？**
Amazon 的 CloudFront 偶尔会升级反爬。多试几次；把 `HEADLESS=false` 用可见窗口看看是不是要求人机验证。Phase 2 会加 Proxy Pool 与自动降级。

**Q：Chrome 路径找不到？**
不填也能用，会自动尝试系统里安装的 Chrome。也可以在 `.env` 里指定 `CHROME_PATH=...`。Docker 镜像已经预装 Debian chromium。

**Q：有价格的商品太少？**
Amazon 的搜索结果里大量"即将推出"或第三方预售商品没有标价。有多少算多少，我们已经按实际情况展示。

**Q：抓取速度慢？**
每页 ~3-5 秒 + 页间 2 秒硬约束间隔，3 页大约 15-20 秒。可以减少页数。**间隔不能配低于 2 秒**——`config.ts` 会把它夹回 2000。

**Q：`npm install` 时 Puppeteer 没下载 Chromium？**
某些 npm 配置默认阻止 postinstall 脚本。要么手动跑 `npx puppeteer browsers install chrome`，要么依赖系统 Chrome（`CHROME_PATH` 或自动探测）。Docker 镜像走系统 chromium，不需要 Puppeteer 下载。

**Q：TypeScript 报"Cannot find module './xxx'"？**
ESM + `NodeNext` 要求所有相对 import 带 `.js` 扩展名（即使源文件是 `.ts`）。这是 Node 的规则，不是 tsc 的。

## License

MIT
