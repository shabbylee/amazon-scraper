# proxy-pool — 静态配置代理池（ADR-0003）

## 目标

给抓取管道一个换出口 IP 的通道，缓解 Amazon 对 `/s` 的 IP 限流。Phase 2 只做静态配置池：`PROXIES` 逗号分隔代理 URL，round-robin 轮换，轮换粒度 = Scrape Job。

## 决策要点

- `ProxyPool` 接口：`next(): Promise<Proxy | null>` + `size`；`null` = 直连。
- `StaticProxyPool` / `NoopProxyPool`；`createProxyPool` 工厂按列表空否选择。
- 浏览器级 `--proxy-server`，每个 Job 取一个代理，Job 内共享。
- 带认证代理：Phase 2 记录为限制（Chrome 不自动用 URL 凭证做代理认证），见 ADR-0003。

## 验收

- [x] 轮换 / 空池 / 去空白 / label 不含凭证 单测
- [x] config 解析 `PROXIES`（逗号分隔、trim、空=直连）
- [x] launchBrowser 支持 `proxy` 参数；路由按 Job 轮换并回传 `proxy` label
