import type { AppConfig } from '../config.js';
import { dispatchAlert } from '../alert/index.js';
import type { WebhookPayload } from '../alert/webhook.js';
import {
  finishWatchRun,
  generateJobId,
  getPriceHistory,
  insertListings,
  insertPriceChanges,
  insertPriceSnapshots,
  startWatchRun,
  updateWatchLastRun,
  type PriceChangeInput,
  type WatchRow,
} from '../db/store.js';
import { createProxyPoolFromEnv } from '../proxy/index.js';
import { launchBrowser } from '../scraper/browser.js';
import { runSearchJob } from '../scraper/search.js';
import { isMarketplaceId, type Listing, type MarketplaceId, type ScrapeJob } from '../types.js';

/**
 * Watch Runner：执行一个 Watch 的完整流程。
 * scrape → 存 Listing + Snapshot → 对比上次价格 → 检测变化 → alert → 记录 run。
 */

export interface WatchRunnerDeps {
  readonly config: AppConfig;
}

export async function executeWatch(watch: WatchRow, deps: WatchRunnerDeps): Promise<void> {
  const { config } = deps;
  const jobId = generateJobId();
  const runId = startWatchRun(watch.id, jobId);
  const marketplace: MarketplaceId = isMarketplaceId(watch.marketplace)
    ? watch.marketplace
    : config.defaultMarketplace;

  const proxyPool = createProxyPoolFromEnv();
  let browser = null;

  try {
    const proxy = await proxyPool.acquire();
    browser = await launchBrowser({
      chromePath: config.chromePath,
      headless: config.headless,
      proxy,
    });

    const job: ScrapeJob = {
      keyword: watch.keyword,
      marketplace,
      pages: watch.pages,
      trigger: 'watch',
    };

    const result = await runSearchJob(job, {
      browser,
      requestIntervalMs: config.requestIntervalMs,
      proxy,
    });

    if (proxy) {
      const proxyFailed = result.attempts.some(
        (a) => a.failure === 'network' || a.failure === 'timeout'
      );
      await proxyPool.release(proxy, proxyFailed ? 'failure' : 'success');
    }

    // 持久化
    insertListings(result.listings, watch.keyword, jobId);
    insertPriceSnapshots(result.listings);

    // 对比价格变化
    const changes = detectPriceChanges(result.listings, marketplace, runId);
    if (changes.length > 0) {
      insertPriceChanges(changes);

      // Alert
      const payload: WebhookPayload = {
        event: 'price_change',
        watchKeyword: watch.keyword,
        marketplace,
        changes: changes.map((c) => ({
          asin: c.asin,
          title: c.title,
          oldPrice: c.oldPriceNum,
          newPrice: c.newPriceNum,
          oldPriceText: c.oldPriceText,
          newPriceText: c.newText,
          changePct:
            c.oldPriceNum && c.oldPriceNum > 0 && c.newPriceNum !== null
              ? Math.round(((c.newPriceNum - c.oldPriceNum) / c.oldPriceNum) * 10000) / 100
              : null,
        })),
        detectedAt: new Date().toISOString(),
      };

      await dispatchAlert({
        watchKeyword: watch.keyword,
        marketplace,
        webhookUrl: watch.webhook_url,
        notifyLocal: watch.notify_local === 1,
        payload,
      });
    }

    finishWatchRun(runId, 'ok', result.listings.length, changes.length);
    updateWatchLastRun(watch.id, new Date().toISOString(), null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[watch-runner] watch ${watch.id} failed:`, message);
    finishWatchRun(runId, 'failed', 0, 0, message);
    updateWatchLastRun(watch.id, new Date().toISOString(), null);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

/**
 * 对比当前 Listing 与最近一次 Snapshot，检测价格变化。
 * 只关心有价格的 Listing；新出现的 ASIN（无历史）不算"变化"。
 */
function detectPriceChanges(
  listings: readonly Listing[],
  marketplace: MarketplaceId,
  runId: number
): PriceChangeInput[] {
  const changes: PriceChangeInput[] = [];
  for (const listing of listings) {
    if (!listing.hasPrice || listing.priceNum === null) continue;
    const history = getPriceHistory(marketplace, listing.asin, 2);
    // history 按时间 ASC，最后一条是"上一次"（本次 snapshot 还没插入时）
    // 但 insertPriceSnapshots 已经在 detectPriceChanges 之前调用了，
    // 所以 history 的最后一条是本次，倒数第二条是上次
    if (history.length < 2) continue; // 首次出现，无历史可比
    const prev = history[history.length - 2]!;
    if (prev.price_num === null) continue;
    if (Math.abs(prev.price_num - listing.priceNum) < 0.01) continue; // 价格未变
    changes.push({
      watchRunId: runId,
      marketplace,
      asin: listing.asin,
      title: listing.title,
      oldPriceNum: prev.price_num,
      newPriceNum: listing.priceNum,
      oldPriceText: prev.price_text,
      newText: listing.priceText,
    });
  }
  return changes;
}
