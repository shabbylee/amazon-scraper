# Phase 2 抓取稳定性策略：stealth 插件 + Proxy Pool 接口 + 按 FailureClass 分类的 Retry

v1.1.0 的抓取路径是"单次尝试、失败即返回"，Amazon 时不时会 503 或返 CAPTCHA。Phase 2 要提升成功率，但"更努力地重试"和"更聪明地降级"是两个方向，得先定死。我们决定：

- **Stealth**：接入 `puppeteer-extra` + `puppeteer-extra-plugin-stealth`，不再手写反检测脚本
- **Proxy Pool**：只定接口 + 内置一个内存实现（Round-robin + 失败隔离），代理端点由用户通过 `HTTP_PROXY_LIST` 环境变量自备；不集成任何具体商用代理服务
- **Retry**：按 `FailureClass` 分类，只对 `network` / `timeout` 重试，最多 2 次，指数退避 1s → 2s → 4s；`captcha` / `parser-miss` / `unknown` 不重试
- **Marketplace**：Phase 2 保持 `com` 单站，不扩展 `cojp` / `de` / `cn` / `couk`

## 为什么这么选

**Stealth 走 puppeteer-extra 而不是手写**
- 手写要覆盖 `navigator.webdriver` / `chrome.runtime` / `permissions.query` / `plugins` / `languages` / iframe contentWindow / WebGL vendor 等十几个特征，且 Chromium 每次大版本都可能新增检测点，维护成本高
- puppeteer-extra-plugin-stealth 有活跃社区、每次 Chromium 升级都会跟进；代价是 3 个额外依赖 + `launch` 路径从 `puppeteer.launch` 换成 `puppeteer-extra.launch`

**Proxy Pool 只定接口**
- 商用代理服务（Bright Data / Oxylabs / Smartproxy）的 SDK 各自不同，锁死一家会让用户切换成本很高
- 接口只需三个方法：`acquire()` / `release(endpoint, ok)` / `size()`；内存实现从 `HTTP_PROXY_LIST` 环境变量读逗号分隔的代理 URL，Round-robin 分配，连续失败 3 次的端点进入 30 秒冷却
- 用户想接商用服务，写一个 `ProxyPool` 实现类替换即可，不改核心代码

**Retry 按 FailureClass 分类**
- `network` / `timeout` 是瞬时故障，重试有意义
- `captcha` 是 Amazon 主动拦截，重试只会加剧封锁；换代理才有用（但也不该无脑换，见下）
- `parser-miss` 通常是 Amazon 改了 DOM 或搜索无结果，重试不会变出 Listing
- `unknown` 是兜底，重试可能掩盖 bug

**CAPTCHA 命中不换代理、直接终止 Job**
- 换代理绕过 CAPTCHA 属于 AGENTS.md 明确禁止的"绕过反爬"
- 命中 CAPTCHA 说明当前 IP + 当前 UA + 当前访问模式已经被识别，继续换 IP 只是把问题推后
- 正确做法：终止 Job，前端提示用户"命中反爬，请稍后再试或降低频率"

**Marketplace 不扩展**
- 用户明确只关心美国站
- 每个新站点都需要独立的 Parser 验证（选择器、货币符号、CAPTCHA 页面文案都可能不同）；Phase 2 的核心是稳定性，不是覆盖面

## 被拒绝的替代方案

- **手写 stealth**：省 3 个依赖，但每次 Chromium 升级都要跟着改；不划算
- **接具体商用代理**：开箱即用但锁死 vendor；用户可能有自己的代理池
- **无脑重试所有失败**：短期看成功率会涨，长期会让 Amazon 更快封 IP，且掩盖 parser 的 bug
- **CAPTCHA 时换代理再试**：违反 AGENTS.md 的抓取伦理
- **同步扩多站点**：分散 Phase 2 的注意力，且 Phase 3 详情页在多站点上的复杂度是列表页的 3-5 倍

## 后果

- `browser.ts` 的 `launchBrowser` 改用 `puppeteer-extra`；`puppeteer` 变成 peer dep（仍在 dependencies）
- 新增环境变量 `HTTP_PROXY_LIST`（逗号分隔的代理 URL，如 `http://user:pass@host1:port,http://host2:port`）；留空表示不用代理
- 新增 `src/proxy/` 目录：`types.ts`（接口）+ `memory-pool.ts`（内存实现）+ `index.ts`（工厂）
- `runSearchJob` 的每次 Attempt 包一层 `withRetry`；`AttemptSummary` 加 `retryCount` 字段
- `isCaptchaPage` 扩展 DOM 特征（响应体正则、`/errors/validateCaptcha` URL 匹配、`Robot Check` 标题）
- Phase 4 的调度器要复用 `ProxyPool` 接口；如果 Phase 3 详情页发现新的失败模式，可能需要扩 `FailureClass` 枚举（属于 additive change，不算 breaking）
