import type { AppConfig } from './config.js';
import type { Persistence, WatchRecord } from './db/persistence.js';
import { buildPriceAlerts, deliverAlert, persistAlert, type DeliverAlert } from './alerts.js';
import { createProxyPool } from './scraper/proxy.js';
import { runSearchJob } from './scraper/search.js';
import { createJobBrowser } from './routes/browser-runner.js';
import type { Listing, ScrapeJob } from './types.js';

/**
 * Watch 调度器（ADR-0006）：进程内 setInterval 扫描到期 Watch，
 * 抓取 → 落库 → 价格变动提醒（ADR-0007）→ 更新 last_run_at。
 * 不引入 node-cron：60s 粒度对本项目足够，且语义可测。
 */

export type FetchWatchListings = (watch: WatchRecord) => Promise<readonly Listing[]>;

export interface SchedulerDeps {
  readonly tickMs?: number;
  /** 注入"按 Watch 抓取一页"的执行器便于测试；默认走真实管道。 */
  readonly fetchWatchListings?: FetchWatchListings;
  /** 注入 Webhook 发送器便于测试；默认用真实 fetch。 */
  readonly deliverAlert?: DeliverAlert;
}

export function startWatchScheduler(
  config: AppConfig,
  store: Persistence,
  deps: SchedulerDeps = {}
): () => void {
  const proxyPool = createProxyPool(config.proxies);
  const tickMs = deps.tickMs ?? 60_000;
  const deliver =
    deps.deliverAlert ?? (config.watchWebhookUrl ? deliverAlert(config.watchWebhookUrl) : null);
  let running = false;

  const fetchWatchListings: FetchWatchListings =
    deps.fetchWatchListings ??
    (async (watch) => {
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
      return result.listings;
    });

  const runWatchOnce = async (watch: WatchRecord): Promise<void> => {
    const listings = await fetchWatchListings(watch);
    store.saveScrapeResult(watch.marketplace, listings);

    // ADR-0007：价格变动提醒 —— 对比最近两次快照，超阈值则落库 + Webhook
    const alerts = buildPriceAlerts(watch, watch.marketplace, listings, store, config.watchPriceChangePct);
    for (const alert of alerts) {
      persistAlert(store, watch, watch.marketplace, alert);
      if (deliver) {
        try {
          await deliver(alert);
        } catch (err) {
          console.error(
            `[alert ${watch.id}] ${alert.listing.asin} webhook failed:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  };

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const due = store.getDueWatches(new Date());
      for (const w of due) {
        try {
          await runWatchOnce(w);
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
