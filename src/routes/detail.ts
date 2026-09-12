import type { RequestHandler } from 'express';
import type { Browser } from 'puppeteer';
import type { AppConfig } from '../config.js';
import type { Persistence } from '../db/persistence.js';
import { createProxyPool } from '../scraper/proxy.js';
import { runDetailJob } from '../scraper/detail.js';
import { isMarketplaceId, type DetailJob, type MarketplaceId } from '../types.js';
import { createJobBrowser, proxyLabel } from './browser-runner.js';

interface DetailRequestBody {
  asin?: unknown;
  marketplace?: unknown;
}

/** ASIN 是 10 位字母数字（Amazon Standard Identification Number）。 */
const ASIN_RE = /^[A-Z0-9]{10}$/i;

export function detailHandler(config: AppConfig, store: Persistence): RequestHandler {
  const proxyPool = createProxyPool(config.proxies);
  return async (req, res) => {
    const body = (req.body ?? {}) as DetailRequestBody;
    const asin = typeof body.asin === 'string' ? body.asin.trim() : '';
    if (!asin || !ASIN_RE.test(asin)) {
      res.status(400).json({ error: 'asin required (10-char alphanumeric)' });
      return;
    }

    const marketplace: MarketplaceId = isMarketplaceId(body.marketplace)
      ? body.marketplace
      : config.defaultMarketplace;
    const job: DetailJob = { asin: asin.toUpperCase(), marketplace, trigger: 'manual' };

    let browser: Browser | null = null;
    try {
      const jobBrowser = await createJobBrowser(config, proxyPool);
      const shared = jobBrowser.mode === 'shared';
      if (shared) browser = jobBrowser.browser;

      const result = await runDetailJob(job, {
        ...(shared
          ? { browser: jobBrowser.browser, proxy: jobBrowser.proxy }
          : { browserFactory: jobBrowser.browserFactory }),
        retryMaxAttempts: config.retryMaxAttempts,
        retryBackoffMs: config.retryBackoffMs,
      });

      // ADR-0006：抓到详情即落库（Buy Box 快照）
      if (result.detail) store.saveDetail(result.detail);

      res.json({
        asin: job.asin,
        marketplace: job.marketplace,
        proxy: proxyLabel(jobBrowser, config.proxies.length),
        saved: result.detail ? 1 : 0,
        detail: result.detail,
        attempts: result.attempts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'detail scrape failed';
      console.error('[detail error]', message);
      res.status(500).json({ error: message });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
      }
    }
  };
}
