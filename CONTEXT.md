# CONTEXT.md — Amazon Scraper

一个"输入关键字、抓取 Amazon 商品列表与详情、按表格展示并支持导出/历史对比"的工具。本文件定义项目的**通用语言**：AI 与协作者在讨论、命名条目、撰写文档与代码时都应使用这里的术语，避免同义词漂移。

> 这是一份**活文档**。术语在实际使用中通过 `/domain-modeling` 逐步打磨、增删。遇到没定义的概念，先记下来，别急着发明新词。

## Language

**Marketplace**:
一个 Amazon 站点（`.com` / `.co.jp` / `.de` / `.cn` / `.co.uk` 等），有独立的域名、货币、语言与商品目录。所有抓取都必须绑定一个 Marketplace。
_Avoid_: 站点、site、区域、region、国家

**Keyword**:
用户提交给一次抓取的搜索关键字，最终作为 `?k=` 参数进入 Amazon 搜索 URL。
_Avoid_: 查询、query、搜索词、term

**Listing**:
Amazon 搜索结果里的一行商品，是本项目**运行时的基本数据单位**：绑定一个 Marketplace 与一个 ASIN，携带标题、价格、图片、评分、是否有货等属性。同一个 ASIN 在不同 Marketplace 是不同的 Listing。
_Avoid_: 商品、item、product、result（作为运行时对象时）

**ASIN**:
Amazon Standard Identification Number，10 位字母数字，Marketplace 内 Listing 的稳定标识。跨 Marketplace 可能重合，因此单独一个 ASIN 不足以定位 Listing。
_Avoid_: 商品编号、SKU、ID

**Buy Box**:
Amazon 商品详情页上"加入购物车"归属的那一个卖家 Offer，包含价格、运费、卖家名、Prime 状态、库存。一个 Listing 可能没有 Buy Box（无货 / 未开售）。
_Avoid_: 购物车、默认卖家、主 Offer

**Scrape Job**:
用户或调度器提交的一次抓取任务，含 `(Keyword, Marketplace, Pages, Trigger)`。Job 是**编排单位**，可能包含多次 Attempt。
_Avoid_: 任务、request、抓取（作为可数名词时）

**Scrape Attempt**:
为完成一个 Job 而对某一页发起的一次实际浏览器访问，含重试计数、耗时、失败原因。一个 Job 通常产生 `Pages × (1..N)` 次 Attempt。
_Avoid_: run、fetch、执行、请求

**Failure Class**:
一次 Attempt 失败的分类，用于决定重试策略：`network` / `timeout` / `captcha` / `parser-miss` / `unknown`。不同 Class 走不同的降级路径（`captcha` 不应无脑重试）。
_Avoid_: 错误、error、异常

**Price Snapshot**:
某个 Listing 在某个时刻的价格记录，用于历史对比，包含 `(Listing 键, PriceText, PriceNum, Currency, CapturedAt)`。Snapshot 只追加，不更新。
_Avoid_: 价格记录、历史、price history

**Watch**:
用户订阅的 `(Keyword, Marketplace, Schedule)` 组合，用于周期性触发 Scrape Job 并在价格变化时提醒。Watch 是"持久化 + 定时"阶段的入口概念。
_Avoid_: 订阅、监控、追踪、alert

**Parser**:
纯函数模块，把 Marketplace 页面 DOM 转成 Listing / Snapshot 领域对象。**不做 IO、不启动浏览器、不重试**，只解析已获取的 DOM 快照。每个 Marketplace 一组 Parser。
_Avoid_: extractor、解析器、scraper（scraper 是更上层的编排）

**Scraper**:
编排 Browser + Parser + Retry + Proxy 完成一次 Scrape Attempt 的模块。它负责 IO、失败分类、重试；解析本身委托给 Parser。
_Avoid_: crawler、fetcher

## 边界（本项目不做什么）

- **不登录 Amazon、不保存 Cookie、不代下单**：只做匿名公开搜索页与详情页的读取。
- **不绕过 CAPTCHA**：识别到即标记为 `captcha` 失败态并降级，不做打码或人工介入自动化。
- **不做通用爬虫框架**：Marketplace 与 Parser 都是硬扩展点，新增站点走"注册表 + Parser"两步，不做 DSL、不做插件市场。

## 待明确（Open questions）

- [ ] 多币种下 `PriceNum` 是否需要统一折算到某一记账货币？还是保留原币 + 汇率表？
- [ ] Watch 的最小调度粒度（分钟 / 小时 / 天）与 Amazon 侧的合理抓取频率上限如何匹配？
- [ ] Listing 的"同一性"由 `(Marketplace, ASIN)` 唯一确定，还是需要考虑卖家维度（同一 ASIN 多个卖家 Offer）？
