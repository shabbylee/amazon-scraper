# scrape-api-mock-tests — /api/scrape 集成测试

## 目标

CI 之前只覆盖 /api/health 和 /api/scrape 的入参校验（tests/api.test.ts 注释明确留到 Phase 2）。现在 mock `launchBrowser`，用假 Page 驱动真实管道（route → runSearchJob → scrapeSearchPage → toListings），把 /api/scrape 的核心行为纳入 CI。

## 方法

- `vi.mock('../src/scraper/browser.js')` 替换 `launchBrowser`，不启动真实 Chrome。
- 假 Page 的 `evaluate` 按函数源码区分调用方：`isCaptchaPage`（含 document.title）返回 captcha 标志；`extractSearchResultsInPage`（含 data-component-type）返回 canned 原始条目。
- `gotoFailTimes` 让前 N 次 goto 抛 network 错误，走真实重试循环（退避 2s，符合限速约束）。

## 验收

- [x] happy path：多页抓取、attempts 明细、proxy=null
- [x] captcha 立即终止，failure 分类正确
- [x] network 失败走真实重试，第二次成功
- [x] PROXIES 配置下按 Job 取代理并回传 label
