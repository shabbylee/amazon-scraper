# retry-policy — 按 Failure Class 的页内重试

## 目标

在 Phase 1 的失败分类基础上，为单个页面的 Scrape Attempt 增加自动重试：只有 `network` / `timeout` 允许重试，`captcha` 立即终止整个 Job，`parser-miss` / `unknown` 该页不重试但继续下一页。

## 约束（来自 AGENTS.md 抓取伦理）

- 限速：任何相邻 Attempt（含重试）间隔 ≥ 2000ms —— `RETRY_BACKOFF_MS` 在 config 夹紧到 ≥ 2000。
- 尊重 CAPTCHA：识别到即停止，不打码、不切账号、不重试。
- 重试上限硬夹紧：`RETRY_MAX_ATTEMPTS` ∈ [1, 5]。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `RETRY_MAX_ATTEMPTS` | `3` | 单页最多物理 Attempt 次数（1 = 不重试），夹紧 [1,5] |
| `RETRY_BACKOFF_MS` | `3000` | 可重试失败后的退避毫秒数，夹紧 ≥ 2000 |

## 行为

- `AttemptSummary` 增加 `attempt`（该页第几次物理 Attempt，1 起）。
- 重试退避只发生在 network/timeout 之后；成功后立刻停止该页的重试循环。
- 页间仍 sleep `REQUEST_INTERVAL_MS`（原有行为）。
- 返回结构向后兼容：只是 `attempts[]` 条目数可能变多，并多了 `attempt` 字段。

## 验收

- [x] `isRetryable` / `shouldRetry` 纯函数单测（分类 → 是否重试）
- [x] runSearchJob 注入 fake scrapePage：网络失败两次后成功、captcha 立即终止、parser-miss 跳过重试、耗尽预算后继续下一页
- [x] config 夹紧测试
