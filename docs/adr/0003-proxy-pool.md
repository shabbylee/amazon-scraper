# Proxy Pool：静态配置池 + 按 Job / 按 Attempt 两种轮换粒度

## 背景

Amazon 对 `/s` 搜索页的 IP 限流是 Phase 2 抓取稳定性的主要威胁之一（README 常见问题第一条）。目标是提供一个"换出口 IP"的通道，同时不引入外部代理服务依赖。

## 决定

- **抽象**：`ProxyPool` 接口只有两个成员：`next(): Promise<Proxy | null>` 与 `size`。`null` 表示"没有可用代理，走直连"。任何实现（静态、收费 API、住宅代理）都满足该契约。
- **Phase 2 实现**：`StaticProxyPool`，从 `PROXIES` 环境变量读取逗号分隔的代理 URL 列表，round-robin 轮换。列表为空时返回 `null`（直连）。
- **轮换粒度**：
  - **单代理 / 直连**：按 Job 轮换，Job 内所有 Attempt 共享一个浏览器（Puppeteer 的 `--proxy-server` 是浏览器级参数）。
  - **多代理（≥ 2）**：自动升级为**每 Attempt 轮换** —— `runSearchJob` 的 `browserFactory` 在每个 Attempt 重启浏览器并取下一个代理，用完即关。响应 `proxy` 字段显示 `rotating:N`。
- **认证代理（收尾）**：Chrome 不会自动用 URL 里的 userinfo 做代理认证。`applyProxyAuth` 通过 CDP Fetch 域（`Fetch.enable` + `Fetch.authRequired` → `continueWithAuth`）把 URL userinfo 转成 Proxy-Authorization，页面创建时挂载；无凭证则零开销跳过。凭证不进日志（label 只取 hostname）。

## 被拒绝的替代方案

- **第三方代理服务（Bright Data / Oxylabs 等）**：需要账号与凭证管理，Phase 2 不引入外部依赖；接口已预留，将来加一个 `ProviderProxyPool` 即可。
- **不做抽象、直接在 config 里放一个代理字符串**：无法表达"多个代理轮换"，也堵死了未来切换提供商的路。
- **CDP 动态切换代理（不重启浏览器）**：Chrome 没有稳定的运行时切代理 API；每 Attempt 重启浏览器的代价（~1-2s/次）可接受，且与限速间隔正交。

## 后果

- `src/scraper/proxy.ts` 是唯一代理出入口；Scraper 不直接读 `process.env`。
- `src/scraper/proxy-auth.ts` 负责认证注入；`runSearchJob` 支持 `browserFactory` 每 Attempt 换浏览器。
- 未来加提供商：新实现 `ProxyPool`，不改 Scraper/Router。
- 每 Attempt 轮换的开销：每次 Attempt 多一次浏览器启动（~1-2s），限速间隔不受影响。
