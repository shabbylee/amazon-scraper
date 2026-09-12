# proxy-rotation — 每 Attempt 轮换代理

## 目标

多代理（≥2）时把轮换粒度从 Job 提升到 Attempt：每次物理 Attempt 换一个代理。

## 方法

- `RunSearchJobDeps` 增加 `browserFactory` / `closeBrowser`（可选）：提供后每个 Attempt 用它获取新浏览器并关闭；否则沿用共享 `browser`（向后兼容）。
- route：`PROXIES` ≥2 时走 `browserFactory` 路径（每次取下一个代理 + launch），响应 `proxy` 显示 `rotating:N`；否则共享路径不变。
- 关闭失败不影响 Job 结果（try/catch）。

## 验收

- [x] runSearchJob 单测：browserFactory 每 Attempt 调用并关闭全部新浏览器
- [x] API 集成：2 代理 2 页 → 2 次 launch、代理 a→b 轮换、`rotating:2`
- [x] 代理经 runSearchJob 透传给 scrapePage（共享路径）
