import type { Browser } from 'puppeteer';
import type { AppConfig } from '../config.js';
import { launchBrowser } from '../scraper/browser.js';
import type { Proxy, ProxyPool } from '../scraper/proxy.js';

/**
 * 按代理配置解析"本次 Job 用什么浏览器"（ADR-0003）：
 * - 单代理/直连 → 共享浏览器（Job 内所有 Attempt 复用，一个代理）
 * - 多代理（≥2）→ 每 Attempt 轮换（browserFactory 每次取下一个代理并重启浏览器）
 */
export type JobBrowser =
  | { readonly mode: 'shared'; readonly browser: Browser; readonly proxy: Proxy | null }
  | { readonly mode: 'rotating'; readonly browserFactory: () => Promise<Browser> };

export async function createJobBrowser(
  config: AppConfig,
  pool: ProxyPool
): Promise<JobBrowser> {
  if (config.proxies.length > 1) {
    return {
      mode: 'rotating',
      browserFactory: async () => {
        const p = await pool.next();
        return launchBrowser({
          chromePath: config.chromePath,
          headless: config.headless,
          proxy: p?.url ?? null,
        });
      },
    };
  }
  const proxy = await pool.next();
  const browser = await launchBrowser({
    chromePath: config.chromePath,
    headless: config.headless,
    proxy: proxy?.url ?? null,
  });
  return { mode: 'shared', browser, proxy };
}

/** 响应里的 proxy 字段：轮换时显示 rotating:N，否则显示代理 label（无代理为 null）。 */
export function proxyLabel(jobBrowser: JobBrowser, poolSize: number): string | null {
  if (jobBrowser.mode === 'rotating') return `rotating:${poolSize}`;
  return jobBrowser.proxy?.label ?? null;
}
