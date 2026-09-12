import type { AppConfig } from './config.js';
import type { Persistence } from './db/persistence.js';
import { createProxyPool } from './scraper/proxy.js';
import { runSearchJob } from './scraper/search.js';
import { createJobBrowser } from './routes/browser-runner.js';
import type { ScrapeJob } from './types.js';

/**
 * Watch 调度器（ADR-0006）：进程内 setInterval 扫描到期 Watch，
 * 触发 runSearchJob 并落库，然后更新 last_run_at。
 * 不引入 node-cron：60s 粒度对本项目足够，且语义可测。
 */

export interface SchedulerDeps {
  readonly tickMs?: number;
  /** 注入单次抓取执行器便于测试；默认走真实管道。 */
  readonly runWatchOnce?: (watchId: number) => Promise<void>;
}

export function startWatchScheduler(
  config: AppConfig,
  store: Persistence,
  deps: SchedulerDeps = {}
): () => void {
  const proxyPool = createProxyPool(config.proxies);
  const tickMs = deps.tickMs ?? 60_000;
  let running = false;

  const runWatchOnce: (watchId: number) => Promise<void> =
    deps.runWatchOnce ??
    (async (watchId) => {
      const watch = store.listWatches().find((w) => w.id === watchId);
      if (!watch) return;
      const job: ScrapeJob = {
        keyword: watch.keyword,
        marketplace: watch.marketplace,
        pages: 1,
        trigger: 'watch',
      };
      const jobBrowser = await createJobBrowser(config, proxyPool);
      const shared = jobBrowser.mode === 'shared';
      const result = await runSearchJob(job, {
        ...(shared
          ? { browser: jobBrowser.browser, proxy: jobBrowser.proxy }
          : { browserFactory: jobBrowser.browserFactory }),
        requestIntervalMs: config.requestIntervalMs,
        retryMaxAttempts: config.retryMaxAttempts,
        retryBackoffMs: config.retryBackoffMs,
      });
      if (shared) {
        try {
          await jobBrowser.browser.close();
        } catch {
          // ignore
        }
      }
      store.saveScrapeResult(job.marketplace, result.listings);
    });

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const due = store.getDueWatches(new Date());
      for (const w of due) {
        try {
          await runWatchOnce(w.id);
          store.markWatchRun(w.id, new Date());
        } catch (err) {
          console.error(`[watch ${w.id}] ${w.keyword} failed:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, tickMs);
  void tick(); // 启动即补跑一轮

  return () => clearInterval(interval);
}
