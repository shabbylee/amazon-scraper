# 01-scrape-api-mock-tests

Type: task
Status: resolved

给 /api/scrape 补 mock 集成测试。规格见同目录 `spec.md`。

## Answer

- `tests/scrape-api.test.ts`：mock `launchBrowser` + 假 Page（按 evaluate 源码区分调用方）。
- 4 个用例：happy path / captcha 终止 / network 重试 / 代理接线。
- 全量 65 测试通过；CI 的 `npm test` 现在覆盖 /api/scrape 全链路（除真实 Chrome 行为）。
