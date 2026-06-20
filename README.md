# Amazon Scraper

Amazon 商品价格抓取器 — 输入关键字，一键抓取商品、价格、评分，按表格展示并支持 CSV 导出。

前端零依赖（纯 HTML / CSS / JS），后端基于 Node.js + Express + Puppeteer。

## 快速开始

```bash
cd amazon-scraper
npm install
npm start

# 打开浏览器访问
http://localhost:3456
```

### 环境要求

| 依赖 | 版本 |
|---|---|
| Node.js | >= 18.0 |
| 操作系统 | macOS / Linux / Windows |
| Chrome | 已安装（自动检测）或用 Puppeteer 自带的 Chromium |

### 可选：通过 `.env` 自定义

复制 `.env.example` 为 `.env` 后修改：

```env
PORT=3456
CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
HEADLESS=true
```

## 项目结构

```
amazon-scraper/
├── package.json
├── .env.example
├── .gitignore
├── server.js               # Express + Puppeteer 后端
├── public/
│   └── index.html          # 前端（零依赖）
└── node_modules/
```

## API 接口

### POST /api/scrape

```json
{
  "keyword": "laptop",
  "pages": 3
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyword` | string | 搜索关键字 |
| `pages` | number | 抓取页数（1-10，默认 3） |

返回：

```json
{
  "keyword": "laptop",
  "pagesScraped": 3,
  "total": 48,
  "withPrice": 12,
  "withoutPrice": 36,
  "minPrice": "CNY 1,221.34",
  "maxPrice": "CNY 10,517.63",
  "avgPrice": "CNY 3,053",
  "items": [
    {
      "asin": "B09S3HNMHF",
      "title": "三星 14 英寸 Galaxy Chromebook Go ...",
      "href": "https://www.amazon.com/dp/B09S3HNMHF",
      "priceText": "CNY 1,221.34",
      "hasPrice": true,
      "priceNum": 1221.34,
      "image": "https://m.media-amazon.com/images/I/...",
      "rating": 4.3
    }
  ]
}
```

### GET /api/health

健康检查，返回运行环境信息（Chrome 路径、headless 模式等）。

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
┌──────────┐     POST /api/scrape      ┌────────────┐
│  浏览器   │ ───────────────────────▶ │   Express    │
│  前端页面 │                           │   服务器     │
└──────────┘                           └──────┬─────┘
                                              │ 启动 Puppeteer
                                              │ 访问 Amazon 搜索页
                                              │ 抓 1..N 页
                                              │ 返回 JSON
                                     ◀──────────┘
                                     前端渲染表格 / 图表
```

Puppeteer 使用真实浏览器（已安装的 Google Chrome 或自带的 Chromium），以真实 User-Agent + zh-CN Accept-Language 访问 Amazon，可绕过简单的 CloudFront 反爬。抓取过程中不登录、不保存 Cookie。

## 常见问题

**Q：抓不到数据 / 503？**
Amazon 的 CloudFront 偶尔会升级反爬。多试几次；如果持续失败，可以把 `HEADLESS` 改成 `false` 用可见窗口看看是不是要求人机验证。

**Q：Chrome 路径找不到？**
不填也能用，会自动尝试系统里安装的 Chrome。也可以在 `.env` 里指定 `CHROME_PATH=...`。

**Q：有价格的商品太少？**
Amazon 的搜索结果里大量"即将推出"或第三方预售商品没有标价。有多少算多少，我们已经按实际情况展示。

**Q：抓取速度慢？**
每页 ~3-5 秒（取决于网络和 Amazon），3 页大约 10-15 秒。可以减少页数。

## License

MIT
