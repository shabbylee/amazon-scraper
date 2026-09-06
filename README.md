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
| `DEFAULT_MARKETPLACE` | `com` | 目前只支持美国站 `com`；多站点扩展未列入近期路线图 |
| `REQUEST_INTERVAL_MS` | `2000` | 相邻 Attempt 最小间隔（毫秒）。**硬下限 2000**，配低了会被夹紧 |
| `MAX_CONCURRENT_ATTEMPTS` | `1` | 并发 Attempt 上限。**硬上限 2**，配高了会被夹紧 |
| `HTTP_PROXY_LIST` | 空 | 逗号分隔的代理 URL 列表（`http://user:pass@host:port`）；留空 = 不用代理；连续失败 3 次的端点进入 30s 冷却 |

前两个数值型硬约束来自 [`AGENTS.md`](AGENTS.md) 的抓取伦理，改约束前请先记录 ADR。代理策略见 [`docs/adr/0003-phase2-scrape-stability.md`](docs/adr/0003-phase2-scrape-stability.md)。

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
│   │   ├── 0002-typescript-migration.md
│   │   └── 0003-phase2-scrape-stability.md
│   └── agents/               # mattpocock skill 约定（domain / issue-tracker / triage-labels）
├── .scratch/                 # 本地 issue tracker（feature-slug/spec.md + issues/NN-*.md）
├── src/
│   ├── index.ts              # 入口：loadConfig → createApp → listen + graceful shutdown
│   ├── app.ts                # createApp 工厂（可脱离 listen 单测，注入 ProxyPool）
│   ├── config.ts             # AppConfig + loadConfig；夹紧 AGENTS.md 硬约束
│   ├── types.ts              # Marketplace / Listing / ScrapeJob / AttemptSummary / FailureClass
│   ├── routes/
│   │   ├── health.ts         # GET /api/health（含 proxyPoolSize）
│   │   └── scrape.ts         # POST /api/scrape（acquire → launch → run → release）
│   ├── scraper/
│   │   ├── browser.ts        # puppeteer-extra + stealth；detectChromePath / launchBrowser（可选 proxy）
│   │   ├── retry.ts          # RetryPolicy / withRetry（按 FailureClass 分类，指数退避）
│   │   └── search.ts         # buildSearchUrl / classifyError / classifyHttpStatus / detectCaptchaFromSignals / scrapeSearchPage / runSearchJob
│   ├── proxy/
│   │   ├── types.ts          # ProxyPool 接口（acquire / release / size）
│   │   ├── parse.ts          # parseProxyUrl / parseProxyList
│   │   ├── memory-pool.ts    # MemoryProxyPool（round-robin + 失败阈值 → 冷却）
│   │   └── index.ts          # createProxyPoolFromEnv 工厂
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
  "maxConcurrentAttempts": 1,
  "proxyPoolSize": 0
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
| `marketplace` | string | 可选，默认走 `DEFAULT_MARKETPLACE`；目前只支持 `com` |

响应：

```json
{
  "keyword": "laptop",
  "marketplace": "com",
  "pagesScraped": 3,
  "proxyUsed": "proxy1.example.com:3128",
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
    { "page": 1, "ok": true, "durationMs": 4123, "listingCount": 16, "retryCount": 0, "retryDelaysMs": [] },
    { "page": 2, "ok": true, "durationMs": 7980, "listingCount": 16, "retryCount": 2, "retryDelaysMs": [1000, 2000] },
    { "page": 3, "ok": false, "durationMs": 210, "listingCount": 0, "failure": "captcha", "message": "Amazon 返回验证码页面", "retryCount": 0, "retryDelaysMs": [] }
  ]
}
```

`attempts` 里每页一条：成败、耗时、失败分类、`retryCount`（本次 Attempt 内部重试了几次）、`retryDelaysMs`（每次重试前的退避毫秒数）。遇到 `captcha` 会立即停止后续页（AGENTS.md 硬约束），已抓到的页仍然返回。

`proxyUsed` 只暴露 `host:port`，绝不回传凭证；未配置代理池时为 `null`。

失败分类枚举（`FailureClass`）与 Phase 2 的重试策略：

- `network` — DNS/连接/导航失败、HTTP 429/5xx。**自动重试**，最多 3 次，指数退避 1s → 2s → 4s
- `timeout` — 页面加载超时。**自动重试**，同上
- `captcha` — 反爬验证页（URL/title/表单/图片/标题/邮件地址 六维探测）。**不重试、不换代理**，直接终止该 Job
- `parser-miss` — 页面拿到了但没解析到 Listing（Amazon 改了 DOM 结构？空搜索结果？）。**不重试**
- `unknown` — 兜底（含 HTTP 403 但非 CAPTCHA 页面）。**不重试**，避免掩盖 bug

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
┌──────────┐    POST /api/scrape     ┌─────────────────────┐
│  浏览器   │ ──────────────────────▶ │ Express (app.ts)     │
│  前端页面 │                         │  → scrapeHandler     │
└──────────┘                         └──────────┬──────────┘
                                                │
                              ┌─────────────────┴────────────────┐
                              ▼                                  ▼
                     proxyPool.acquire()              launchBrowser(proxy?)
                     （HTTP_PROXY_LIST）              puppeteer-extra + stealth
                              │                                  │
                              └──────────────┬───────────────────┘
                                             ▼
                              ┌──────────────────────────────┐
                              │ runSearchJob                 │
                              │  遍历 pages 1..N：            │
                              │    withRetry(               │
                              │      scrapeSearchPage        │
                              │    )                         │
                              │      ├─ goto → 状态码分类     │
                              │      │    429/5xx → network  │
                              │      ├─ detectCaptchaSignals │
                              │      │    6 维探测            │
                              │      ├─ waitForSelector      │
                              │      ├─ evaluate(extract…)   │
                              │      └─ toListings           │
                              │    retryOn=[network,timeout] │
                              │    指数退避 1s → 2s → 4s      │
                              │    captcha → 立即停 Job       │
                              │  页间 sleep(interval ≥ 2s)   │
                              └──────────────┬───────────────┘
                                             ▼
                                proxyPool.release(outcome)
                                network/timeout → failure（累计到阈值 → 冷却 30s）
                                其他 → success
                                             ▼
                                  ScrapeResult JSON
                                  （含 attempts / retryCount / proxyUsed）
```

Parser 与 Scraper 严格分层：Parser 是纯函数（DOM → 领域对象），可单测；Scraper 才碰 browser/IO/失败分类/重试/代理。

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
- [x] **Phase 2** — 抓取稳定性（Retry / Proxy Pool / stealth / CAPTCHA 多维探测与降级；Marketplace 按用户要求保持 `com` 单站）
- [ ] **Phase 3** — 商品详情（Detail Scraper + Parser，扩展 Listing schema 到 Buy Box / 卖家 / 运费 / 变体 / 评论数）
- [ ] **Phase 4** — 持久化 + 定时（SQLite 存 Listing / Price Snapshot / Watch，node-cron 调度 Job，前端历史曲线）

## 常见问题

**Q：抓不到数据 / attempts 里全是 `captcha`？**
Amazon 的 CloudFront 偶尔会升级反爬。Phase 2 已经加了 puppeteer-extra-plugin-stealth 做指纹伪装、Retry 兜住瞬时故障、Proxy Pool 支持出口 IP 轮换。如果仍然命中 CAPTCHA，说明当前 IP + 访问模式已被识别；按 AGENTS.md 抓取伦理，我们**不会**自动换代理再打，Job 会直接终止。稍后再试或降低频率。

**Q：怎么配代理？**
在 `.env` 里设 `HTTP_PROXY_LIST=http://user:pass@host1:port,http://host2:port`（逗号分隔）。留空 = 不用代理。启动后 `/api/health` 的 `proxyPoolSize` 会告诉你加载了几个端点；`/api/scrape` 响应的 `proxyUsed` 会告诉你本次用了哪个（只有 host:port，不含凭证）。连续失败 3 次的端点会自动进入 30 秒冷却。

**Q：stealth 是什么？为什么要用？**
`puppeteer-extra-plugin-stealth` 会自动覆盖 Chromium 里十几个可被反爬脚本识别的特征（`navigator.webdriver` / `chrome.runtime` / `permissions.query` / `plugins` / `languages` / iframe contentWindow / WebGL vendor 等）。比手写反检测脚本更完整、跟随 Chromium 版本升级更及时。见 [`docs/adr/0003-phase2-scrape-stability.md`](docs/adr/0003-phase2-scrape-stability.md)。

**Q：Chrome 路径找不到？**
不填也能用，会自动尝试系统里安装的 Chrome。也可以在 `.env` 里指定 `CHROME_PATH=...`。Docker 镜像已经预装 Debian chromium。

**Q：有价格的商品太少？**
Amazon 的搜索结果里大量"即将推出"或第三方预售商品没有标价。有多少算多少，我们已经按实际情况展示。

**Q：抓取速度慢？**
每页 ~3-5 秒 + 页间 2 秒硬约束间隔，3 页大约 15-20 秒；如果触发 Retry 会更长（最多 3 次指数退避 1s+2s+4s）。可以减少页数。**间隔不能配低于 2 秒**——`config.ts` 会把它夹回 2000。

**Q：`npm install` 时 Puppeteer 没下载 Chromium？**
某些 npm 配置默认阻止 postinstall 脚本。要么手动跑 `npx puppeteer browsers install chrome`，要么依赖系统 Chrome（`CHROME_PATH` 或自动探测）。Docker 镜像走系统 chromium，不需要 Puppeteer 下载。

**Q：TypeScript 报"Cannot find module './xxx'"？**
ESM + `NodeNext` 要求所有相对 import 带 `.js` 扩展名（即使源文件是 `.ts`）。这是 Node 的规则，不是 tsc 的。

## License

MIT
