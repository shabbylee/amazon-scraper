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
| `DEFAULT_MARKETPLACE` | `com` | 默认 Amazon 站点，支持 `com` / `cojp` / `de` / `cn` / `couk` |
| `REQUEST_INTERVAL_MS` | `2000` | 相邻 Attempt 最小间隔（毫秒）。**硬下限 2000**，配低了会被夹紧 |
| `MAX_CONCURRENT_ATTEMPTS` | `1` | 并发 Attempt 上限。**硬上限 2**，配高了会被夹紧 |
| `RETRY_MAX_ATTEMPTS` | `3` | 单页最多物理 Attempt 次数（1 = 不重试）。夹紧 [1,5]；只有 network/timeout 会重试 |
| `RETRY_BACKOFF_MS` | `3000` | 可重试失败后的退避（毫秒）。**硬下限 2000**，配低了会被夹紧 |
| `PROXIES` | 空 | 逗号分隔的代理 URL，支持 `http://user:pass@host:port` 认证。1 个 = 按 Job 轮换；≥2 个自动升级为每 Attempt 轮换（ADR-0003）。留空 = 直连 |
| `DB_PATH` | `data/amazon.db` | SQLite 数据库路径（ADR-0006）；`:memory:` = 进程内临时库（测试用） |
| `WATCH_WEBHOOK_URL` | 空 | Watch 价格变动提醒 Webhook URL（ADR-0007）；留空 = 不发送提醒 |
| `WATCH_PRICE_CHANGE_PCT` | `1` | 提醒阈值（百分比，夹紧 [0.01, 100]）：涨跌超过该值才触发 Webhook |

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
│   │   ├── 0002-typescript-migration.md
│   │   ├── 0003-proxy-pool.md
│   │   ├── 0004-marketplace-registry.md
│   │   ├── 0005-product-detail.md
│   │   └── 0006-persistence.md
│   └── agents/               # mattpocock skill 约定（domain / issue-tracker / triage-labels）
├── .scratch/                 # 本地 issue tracker（retry-policy / proxy-pool / stealth / multi-marketplace / scrape-api-mock-tests / proxy-auth / proxy-rotation / product-detail / persistence / price-alert）
├── src/
│   ├── index.ts              # 入口：loadConfig → createStore → createApp → listen + scheduler + graceful shutdown
│   ├── app.ts                # createApp 工厂（可脱离 listen 单测）
│   ├── config.ts             # AppConfig + loadConfig；夹紧 AGENTS.md 硬约束
│   ├── scheduler.ts          # Watch 调度器（60s tick：抓取 → 落库 → 价格提醒 → 标记 last_run_at）
│   ├── alerts.ts             # Price Alert：buildPriceAlerts + deliverAlert + persistAlert（ADR-0007）
│   ├── types.ts              # Marketplace / Listing / ProductDetail / ScrapeJob / AttemptSummary / FailureClass
│   ├── db/
│   │   ├── schema.ts         # SQLite 建表/迁移（user_version）
│   │   ├── persistence.ts    # Persistence 接口 + SqlitePersistence（listings/snapshots/watches）
│   │   └── store.ts          # createStore 装配（文件或 :memory:）
│   ├── routes/
│   │   ├── health.ts         # GET /api/health
│   │   ├── scrape.ts         # POST /api/scrape（成功即落库，saved 字段）
│   │   ├── detail.ts         # POST /api/detail（ADR-0005，成功即落库）
│   │   ├── history.ts        # GET /api/history（价格历史）
│   │   ├── listings.ts       # GET /api/listings（库内检索）
│   │   ├── watch.ts          # POST/GET /api/watch + DELETE /api/watch/:id
│   │   └── browser-runner.ts # 按代理配置解析 Job 浏览器（共享 vs 每 Attempt 轮换）
│   ├── scraper/
│   │   ├── browser.ts        # detectChromePath + launchBrowser（支持 --proxy-server）
│   │   ├── proxy.ts          # ProxyPool 接口 + Static/Noop + createProxyPool（ADR-0003）
│   │   ├── proxy-auth.ts     # CDP Fetch 域注入 Proxy-Authorization（ADR-0003）
│   │   ├── stealth.ts        # 轻量反自动化指纹（零依赖）
│   │   ├── search.ts         # buildSearchUrl / classifyError / isCaptchaPage / scrapeSearchPage / runSearchJob（含重试）
│   │   └── detail.ts         # buildDetailUrl / scrapeDetailPage / runDetailJob（单目标重试编排）
│   └── parser/
│       ├── search-page.ts    # 浏览器侧 extractSearchResultsInPage + Node 侧 parsePriceNum / toListings
│       └── detail-page.ts    # 浏览器侧 extractDetailInPage + Node 侧 toDetail
├── tests/
│   ├── api.test.ts           # supertest 集成测试（health / 入参校验）
│   ├── scrape-api.test.ts    # /api/scrape mock 集成测试（不启动真实 Chrome）
│   ├── detail-api.test.ts    # /api/detail mock 集成测试（不启动真实 Chrome）
│   └── persistence-api.test.ts # /api/history、/api/listings、/api/watch 集成测试（纯 DB）
└── public/
    └── index.html            # 前端（零依赖单文件：搜索 + 详情 + Watch + 价格历史 SVG）
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
  "retryMaxAttempts": 3,
  "retryBackoffMs": 3000,
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
| `marketplace` | string | 可选，默认走 `DEFAULT_MARKETPLACE`；支持 `com` / `cojp` / `de` / `cn` / `couk` |

响应：

```json
{
  "keyword": "laptop",
  "marketplace": "com",
  "pagesScraped": 3,
  "proxy": null,
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
    { "attempt": 1, "page": 1, "ok": true, "durationMs": 4123, "listingCount": 16 },
    { "attempt": 1, "page": 2, "ok": true, "durationMs": 3870, "listingCount": 16 },
    { "attempt": 1, "page": 3, "ok": false, "durationMs": 210, "listingCount": 0, "failure": "captcha", "message": "Amazon 返回验证码页面" }
  ]
}
```

`attempts` 记录每次物理 Attempt：同一 `page` 可能因重试出现多条，`attempt` 是页内序号（1 起）。遇到 `captcha` 会立即停止后续页（AGENTS.md 硬约束），已抓到的页仍然返回。`proxy` 是本次 Job 使用的代理 label（未配置为 `null`）。

### `POST /api/detail`

按 ASIN 抓取商品详情页（ADR-0005），返回 `ProductDetail`：Buy Box（价格/卖家/运费/Prime/库存）、评分、评论数、变体。复用全部稳定性设施（重试 / stealth / 代理认证 / 代理轮换）。

请求：

```json
{
  "asin": "B09S3HNMHF",
  "marketplace": "com"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `asin` | string | **必填**，10 位字母数字（自动归一化为大写） |
| `marketplace` | string | 可选，默认走 `DEFAULT_MARKETPLACE` |

响应：

```json
{
  "asin": "B09S3HNMHF",
  "marketplace": "com",
  "proxy": null,
  "detail": {
    "marketplace": "com",
    "asin": "B09S3HNMHF",
    "href": "https://www.amazon.com/dp/B09S3HNMHF",
    "title": "Samsung Galaxy Chromebook Go",
    "image": "https://m.media-amazon.com/images/I/...",
    "rating": 4.3,
    "reviewCount": 1234,
    "buyBox": {
      "hasBuyBox": true,
      "priceText": "$249.00",
      "priceNum": 249,
      "sellerName": "Amazon.com",
      "shippingText": "FREE delivery",
      "isPrime": true,
      "inStock": true
    },
    "variants": ["Mineral Silver", "Ash Gray"]
  },
  "attempts": [{ "attempt": 1, "page": 1, "ok": true, "durationMs": 4110, "listingCount": 1 }]
}
```

`detail` 为 `null` 表示未抓到（`attempts` 里有失败分类）。ASIN 格式非法返回 `400`。抓到详情会自动落库（ADR-0006），响应带 `saved: 1`。

失败分类枚举（`FailureClass`）：

- `network` — DNS/连接/导航失败，**自动重试**（退避 `RETRY_BACKOFF_MS`，上限 `RETRY_MAX_ATTEMPTS`）
- `timeout` — 页面加载超时，自动重试
- `captcha` — 反爬验证页，**不重试**，直接终止该 Job
- `parser-miss` — 页面拿到了但没解析到 Listing（Amazon 改了 DOM 结构？空搜索结果？），该页不重试、继续下一页
- `unknown` — 兜底

### `GET /api/history`

查询某 ASIN 的价格历史点（只追加的 `price_snapshots`）：

```text
GET /api/history?asin=B09S3HNMHF&marketplace=com&days=30
→ { asin, marketplace, days, points: [{ capturedAt, priceText, priceNum, currency }] }
```

### `GET /api/listings`

从本地库检索已保存的 Listing（模糊匹配标题 + 排序）：

```text
GET /api/listings?keyword=laptop&marketplace=com&sort=price-asc&limit=100
→ { count, items: [Listing...] }   # sort: price-asc | price-desc | rating | updated
```

### `/api/watch`

创建 / 列出 / 删除定时监控（进程内调度器 60s 扫描到期项，触发抓取并落库）：

```text
POST   /api/watch { keyword, marketplace, intervalMinutes }   # intervalMinutes 夹紧 [30, 10080]
GET    /api/watch
DELETE /api/watch/:id
```

### 价格变动提醒 Webhook（ADR-0007）

配置 `WATCH_WEBHOOK_URL` 后，每次 Watch 完成抓取，对**有价格**且已有历史快照的商品对比最近两次价格：变动幅度 ≥ `WATCH_PRICE_CHANGE_PCT`（默认 1%）即 POST 一个 JSON 载荷到该 URL，同时落库 `price_alerts` 表：

```json
{
  "event": "price_change",
  "watch": { "id": 1, "keyword": "laptop", "marketplace": "com" },
  "listing": { "asin": "B09S3HNMHF", "title": "…", "href": "https://www.amazon.com/dp/B09S3HNMHF" },
  "from": { "priceText": "CNY 1,536.22", "priceNum": 1536.22 },
  "to": { "priceText": "CNY 1,490.00", "priceNum": 1490 },
  "deltaPct": -3.01,
  "capturedAt": "2026-09-13T00:00:00.000Z"
}
```

`deltaPct` 为有符号百分比（负 = 降价）。Webhook 可接 Mailgun / Zapier / 企业微信机器人 / Slack 等把 JSON 转发成邮件或通知；发送失败只记日志，不影响后续调度（提醒已落库可审计）。

## 持久化（ADR-0006）

SQLite 单文件（默认 `data/amazon.db`），三张表：

- `listings` — 每个 `(marketplace, asin)` 的最新状态（upsert）
- `price_snapshots` — 价格快照，只追加不更新（历史趋势的数据源）
- `watches` — 定时监控任务（keyword / marketplace / interval / last_run_at）

`POST /api/scrape` 与 `POST /api/detail` 成功即自动写入，无需手动保存；进程重启数据仍在。测试用 `DB_PATH=:memory:`。

## 前端功能

- **关键字输入**：回车或点"立即抓取"
- **站点选择**：com / cojp / de / cn / couk
- **页数选择**：1 / 2 / 3 / 5 / 10 页
- **统计卡片**：总数、站点、页数、有/无价格数、最低/最高/平均价格、已保存条数
- **筛选**：全部 / 有价格 / 无价格
- **点击排序**：点击表头按价格或评分排序
- **星级展示**：5 星可视化 + 阿拉伯数字
- **商品详情**：行内"详情"按钮 → Buy Box 卡片（价格/卖家/运费/Prime/库存/变体/评论数）
- **价格历史**：详情卡片的"价格历史"按钮 → SVG 趋势图（零依赖手绘），支持 7/30/90/365 天切换
- **Watch 面板**：添加/删除定时监控，展示上次运行时间；价格变动超阈值自动发 Webhook
- **跳转链接**：直接打开对应站点的 Amazon 商品页
- **CSV 导出**：带 UTF-8 BOM 的 CSV（Excel 友好）

## 工作原理

```
┌──────────┐     POST /api/scrape      ┌─────────────────┐
│  浏览器   │ ────────────────────────▶ │  Express (app.ts)│
│  前端页面 │                           │  → scrapeHandler │
└──────────┘                           └────────┬────────┘
                                                │  (取一个代理，ADR-0003)
                                                ▼
                                    ┌───────────────────────┐
                                    │ runSearchJob          │
                                    │  ├─ launchBrowser     │
                                    │  ├─ 遍历 pages 1..N   │
                                    │  │   └─ 页内 Attempt 循环（≤RETRY_MAX_ATTEMPTS）
                                    │  │       ├─ scrapeSearchPage
                                    │  │       │   ├─ applyStealth
                                    │  │       │   ├─ applyProxyAuth（代理带凭证时）
                                    │  │       │   ├─ goto
                                    │  │       │   ├─ isCaptchaPage
                                    │  │       │   └─ evaluate(extractSearchResultsInPage)
                                    │  │       ├─ toListings (类型守卫)
                                    │  │       └─ network/timeout → 退避重试；captcha → 终止 Job
                                    │  └─ sleep(interval)   │
                                    └────────┬──────────────┘
                                             ▼
                                     ScrapeResult JSON
                                     (含 attempts 明细)
```

Parser 与 Scraper 严格分层：Parser 是纯函数（DOM → 领域对象，价格解析按站点本地化），可单测；Scraper 才碰 browser/IO/失败分类/重试/代理/stealth。

## 开发命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | tsx watch，热重载 |
| `npm run build` | tsc → `dist/` |
| `npm start` | 跑 `dist/index.js` |
| `npm run typecheck` | 只跑 tsc --noEmit |
| `npm test` | vitest run（parser / config / proxy / stealth / search / detail / db / scheduler / API，含 mock 集成） |
| `npm run test:watch` | vitest 交互模式 |

CI（`.github/workflows/ci.yml`）在 push / PR 到 `main` 时跑 Node 20 + 22 矩阵的 install → typecheck → build → test，最后 docker build 一次。

## 路线图

见 [`docs/adr/0001-four-phase-roadmap.md`](docs/adr/0001-four-phase-roadmap.md)。当前状态：

- [x] **Phase 1** — 工程化重构（TS + 模块拆分 + 测试 + Docker + CI）
- [x] **Phase 2** — 抓取稳定性（Retry / Proxy Pool / stealth / 多 Marketplace / /api/scrape 集成测试）
- [x] **Phase 3** — 商品详情（Detail Scraper + Parser，ProductDetail + Buy Box / 卖家 / 运费 / 变体 / 评论数）
- [x] **Phase 4** — 持久化 + 定时（SQLite 存 Listing / Price Snapshot / Watch，进程内调度器，前端历史曲线）

## 常见问题

**Q：抓不到数据 / 503 / attempts 里全是 `captcha`？**
Amazon 的 CloudFront 偶尔会升级反爬。`network` / `timeout` 现在会自动重试（最多 `RETRY_MAX_ATTEMPTS` 次）；`captcha` 仍按硬约束立即终止，多试几次或把 `HEADLESS=false` 用可见窗口看看是不是要求人机验证。可配置 `PROXIES` 换出口 IP（ADR-0003）。

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
