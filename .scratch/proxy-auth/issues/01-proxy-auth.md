# 01-proxy-auth

Type: task
Status: resolved

代理认证注入。规格见同目录 `spec.md`。

## Answer

- `src/scraper/proxy.ts`：新增 `ProxyCredentials` + `parseProxyCredentials`。
- `src/scraper/proxy-auth.ts`：`applyProxyAuth(page, proxy)` 经 CDP Fetch 域响应 407 challenge。
- `src/scraper/search.ts`：`ScrapePageDeps.proxy`，`scrapeSearchPage` 在 goto 前挂载。
- 测试：proxy.test.ts +3、scrape-api.test.ts +1。
