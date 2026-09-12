# Proxy Pool：Phase 2 用静态配置池，轮换粒度 = Job

## 背景

Amazon 对 `/s` 搜索页的 IP 限流是 Phase 2 抓取稳定性的主要威胁之一（README 常见问题第一条）。目标是提供一个"换出口 IP"的通道，同时不引入外部代理服务依赖。

## 决定

- **抽象**：`ProxyPool` 接口只有两个成员：`next(): Promise<Proxy | null>` 与 `size`。`null` 表示"没有可用代理，走直连"。任何实现（静态、收费 API、住宅代理）都满足该契约。
- **Phase 2 实现**：`StaticProxyPool`，从 `PROXIES` 环境变量读取逗号分隔的代理 URL 列表，round-robin 轮换。列表为空时返回 `null`（直连）。
- **轮换粒度 = Scrape Job**：Puppeteer 的 `--proxy-server` 是浏览器级参数，代理切换需要重新 launch Browser。每个 Job 启动时取一个代理，Job 内所有 Attempt 共享；不做每 Attempt 轮换（代价是每 Attempt 重启浏览器，Phase 2 不做）。
- **认证代理**：`--proxy-server` 支持 URL 形式，但 Chrome 不会自动使用 URL 里的账号密码做代理认证。带认证的代理在 Phase 2 记录为限制（见下），不伪装、不硬编码凭证到仓库。

## 被拒绝的替代方案

- **每 Attempt 换代理**：需要每 Attempt launch 或 CDP 动态切换代理（`Fetch.enable` + 认证拦截），复杂度高、浏览器重启开销大。留作 Phase 2 后续或 Phase 3 再评估。
- **集成第三方代理服务（Bright Data / Oxylabs 等）**：需要账号与凭证管理，Phase 2 不引入外部依赖；接口已预留，将来加一个 `ProviderProxyPool` 即可。
- **不做抽象、直接在 config 里放一个代理字符串**：无法表达"多个代理轮换"，也堵死了未来切换提供商的路。

## 后果

- `src/scraper/proxy.ts` 成为唯一代理出入口；Scraper 不直接读 `process.env`。
- 未来加提供商：新实现 `ProxyPool`，不改 Scraper/Router。
- 限制记录：带认证代理需要后续通过 CDP `Fetch` 域注入 Proxy-Authorization，或使用支持 URL 凭证直通的代理服务。
