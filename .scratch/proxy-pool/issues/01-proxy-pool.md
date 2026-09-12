# 01-proxy-pool

Type: task
Status: resolved

实现 `ProxyPool` 抽象 + 静态配置实现，按 Job 轮换代理。架构决策见 `docs/adr/0003-proxy-pool.md`，规格见同目录 `spec.md`。

## Answer

- `src/scraper/proxy.ts`：`Proxy` / `ProxyPool` / `StaticProxyPool` / `NoopProxyPool` / `createProxyPool`。
- `src/config.ts`：`PROXIES` 逗号分隔解析，`AppConfig.proxies`。
- `src/scraper/browser.ts`：`launchBrowser` 增加 `proxy` 参数 → `--proxy-server`。
- `src/routes/scrape.ts`：每个 Job 从池里取一个代理，响应回传 `proxy` label；`health` 回传 `proxyPoolSize`。
- 测试：`proxy.test.ts` 6 个 + `config.test.ts` 1 个。全量 45 测试通过。
