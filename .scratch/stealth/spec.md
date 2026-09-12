# stealth — 轻量反自动化指纹

## 目标

降低 Puppeteer 被 CloudFront 识别的概率。不引入 puppeteer-extra 依赖（保持零额外依赖），只做最小、诚实的指纹清理。

## 边界

- 不做打码、不切账号、不伪装 Amazon 官方客户端（AGENTS.md）。
- 只在页面加载前注入（`evaluateOnNewDocument`），失败只告警不阻断。

## 行为

- `stealthInitScript()`：抹掉 `navigator.webdriver`，补 `window.chrome`，标准化 `languages` / `plugins`。
- `applyStealth(page)`：注入脚本，try/catch 降级。
- `scrapeSearchPage` 在 goto 前调用。

## 验收

- [x] 脚本语法可解析（`new Function` 不抛）
- [x] 含 webdriver / chrome / languages / plugins 指纹处理
- [x] 不含 captcha / password / token / login 逻辑
