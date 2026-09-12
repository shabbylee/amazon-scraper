# proxy-auth — 代理认证（CDP 注入）

## 目标

解决 ADR-0003 记录的限制：Chrome 不会自动用代理 URL 里的 userinfo 做认证。

## 方法

- `parseProxyCredentials(url)`：从 `http://user:pass@host:port` 解析凭证（percent-decode）。
- `applyProxyAuth(page, proxy)`：页面创建后挂 CDP Fetch 域（`Fetch.enable` + `Fetch.authRequired` → `continueWithAuth` 返回 `ProvideCredentials`）。
- 无凭证 → 直接返回，零开销；凭证不进日志（label 只取 hostname）。
- 挂载点在 `scrapeSearchPage`（goto 前），覆盖共享浏览器与每 Attempt 轮换两种路径。

## 验收

- [x] parseProxyCredentials 单测（普通 / percent-encoded / 无 userinfo）
- [x] API 集成：带凭证代理 → 页面 CDP session 收到 `Fetch.enable`
