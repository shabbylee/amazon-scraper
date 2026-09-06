import type { RequestHandler } from 'express';
import type { Browser } from 'puppeteer';
import type { AppConfig } from '../config.js';
import { launchBrowser } from '../scraper/browser.js';
import { runSearchJob } from '../scraper/search.js';
import { isMarketplaceId, type Listing, type MarketplaceId, type ScrapeJob } from '../types.js';

interface ScrapeRequestBody {
  keyword?: unknown;
  pages?: unknown;
  marketplace?: unknown;
}

export const MAX_PAGES = 10;

function normalizePages(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? 3), 10);
  if (!Number.isFinite(n)) return 3;
  return Math.min(Math.max(n, 1), MAX_PAGES);
}

function summarize(listings: readonly Listing[]) {
  const withPrice = listings
    .filter((x) => x.hasPrice)
    .slice()
    .sort((a, b) => (a.priceNum ?? 0) - (b.priceNum ?? 0));
  const withoutPrice = listings.filter((x) => !x.hasPrice);

  const min = withPrice.at(0)?.priceText ?? null;
  const max = withPrice.at(-1)?.priceText ?? null;
  const avgNum = withPrice.length
    ? Math.round(withPrice.reduce((s, x) => s + (x.priceNum ?? 0), 0) / withPrice.length)
    : null;
  // 用第一个有价格 Listing 的货币前缀作为均价前缀（Amazon 页面实际返回的货币）
  const currencyPrefix = withPrice[0]?.priceText.match(/^[^\d]+/)?.[0]?.trim() ?? '';
  const avg = avgNum !== null ? `${currencyPrefix} ${avgNum.toLocaleString()}`.trim() : null;

  return {
    total: listings.length,
    withPrice: withPrice.length,
    withoutPrice: withoutPrice.length,
    minPrice: min,
    maxPrice: max,
    avgPrice: avg,
    items: [...withPrice, ...withoutPrice],
  };
}

export function scrapeHandler(config: AppConfig): RequestHandler {
  return async (req, res) => {
    const body = (req.body ?? {}) as ScrapeRequestBody;
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if (!keyword) {
      res.status(400).json({ error: 'keyword required' });
      return;
    }

    const marketplace: MarketplaceId = isMarketplaceId(body.marketplace)
      ? body.marketplace
      : config.defaultMarketplace;
    const job: ScrapeJob = {
      keyword,
      marketplace,
      pages: normalizePages(body.pages),
      trigger: 'manual',
    };

    let browser: Browser | null = null;
    try {
      browser = await launchBrowser({
        chromePath: config.chromePath,
        headless: config.headless,
      });
      const result = await runSearchJob(job, {
        browser,
        requestIntervalMs: config.requestIntervalMs,
      });
      res.json({
        keyword: job.keyword,
        marketplace: job.marketplace,
        pagesScraped: job.pages,
        ...summarize(result.listings),
        attempts: result.attempts,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'scrape failed';
      console.error('[scrape error]', message);
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
