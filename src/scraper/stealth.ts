import type { Page } from 'puppeteer';

/**
 * 轻量 stealth：不引入 puppeteer-extra 依赖（保持零额外依赖），
 * 只在页面加载前抹掉最明显的自动化指纹。
 * 边界（AGENTS.md）：不做打码、不切账号、不伪装 Amazon 官方客户端。
 */

/** 返回一个可注入的初始化脚本字符串（evaluateOnNewDocument 接受字符串）。 */
export function stealthInitScript(): string {
  return `
  (() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch (_) {}
    try {
      window.chrome = window.chrome || { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    } catch (_) {}
    try {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    } catch (_) {}
    try {
      if (!navigator.plugins || navigator.plugins.length === 0) {
        Object.defineProperty(navigator, 'plugins', {
          get: () => ({ length: 0, item: () => null, namedItem: () => null, refresh: () => {} }),
        });
      }
    } catch (_) {}
  })();
  `;
}

/** 在页面上下文注入 stealth 脚本；失败只告警，不阻断抓取。 */
export async function applyStealth(page: Page): Promise<void> {
  try {
    await page.evaluateOnNewDocument(stealthInitScript());
  } catch (err) {
    console.warn('[stealth] inject failed:', err instanceof Error ? err.message : String(err));
  }
}
