# 01-stealth

Type: task
Status: resolved

轻量 stealth：`navigator.webdriver` / `window.chrome` / `languages` / `plugins` 指纹清理，注入到每个页面的文档加载前。规格见同目录 `spec.md`。

## Answer

- `src/scraper/stealth.ts`：`stealthInitScript()` 返回可注入脚本字符串；`applyStealth(page)` 注入并降级。
- `src/scraper/search.ts`：`scrapeSearchPage` 在 goto 前调用 `applyStealth`。
- 测试：`stealth.test.ts` 3 个（语法 / 指纹项 / 无越界逻辑）。全量 48 测试通过。
