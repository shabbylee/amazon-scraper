# 01-retry-policy

Type: task
Status: resolved

按 Failure Class 为页内 Attempt 加自动重试：network/timeout 可重试（退避 `RETRY_BACKOFF_MS`，上限 `RETRY_MAX_ATTEMPTS`），captcha 立即终止 Job，parser-miss/unknown 不重试。`AttemptSummary` 增加 `attempt` 序号。规格见同目录 `spec.md`。

## Answer

- `src/scraper/search.ts`：新增 `isRetryable` / `shouldRetry` 纯函数；`runSearchJob` 改为页内 Attempt 循环，注入 `scrapePage` 依赖便于测试。
- `src/config.ts`：新增 `RETRY_MAX_ATTEMPTS`（夹紧 [1,5]，默认 3）、`RETRY_BACKOFF_MS`（夹紧 ≥2000，默认 3000）。
- `src/types.ts`：`AttemptSummary` 增加 `attempt: number`。
- `src/routes/scrape.ts`：传入重试配置。
- 测试：`search.test.ts` 新增 10 个用例（含一个真实 bug 捕获：页内先失败后成功时成功页数据被丢弃，已修复）；`config.test.ts` 新增 3 个用例。全量 38 测试通过。
