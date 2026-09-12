# 01-proxy-rotation

Type: task
Status: resolved

每 Attempt 轮换代理。规格见同目录 `spec.md`。

## Answer

- `src/scraper/search.ts`：`RunSearchJobDeps.browserFactory` / `closeBrowser` / `proxy`（browser 改为可选并校验）。
- `src/routes/scrape.ts`：`PROXIES` ≥2 时走 browserFactory 路径，响应 `proxy=rotating:N`；否则共享路径。
- 测试：search.test.ts +2（browserFactory 轮换、proxy 透传）、scrape-api.test.ts +1（多代理轮换）。
