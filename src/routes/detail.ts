import type { RequestHandler } from 'express';
import type { Browser } from 'puppeteer';
import type { AppConfig } from '../config.js';
import type { ParsedProxy, ProxyPool } from '../proxy/index.js';
import { launchBrowser } from '../scraper/browser.js';
import { runDetailJob, type DetailJob } from '../scraper/detail.js';
import { isMarketplaceId, isAsin, type MarketplaceId } from '../types.js';

interface DetailRequestBody {
  asin?: unknown;
  marketplace?: unknown;
}

/** 只暴露 host:port，绝不把 credentials 回给前端（与 scrape.ts 的 safeProxyLabel 语义一致）。 */
function safeProxyLabel(proxy: ParsedProxy | null): string | null {
  if (!proxy) return null;
  return proxy.serverFlag.replace(/^[^=]+=/, '');
}

/**
 * 详情 Job 对代理的使用结果判定：与 scrape 一致，
 * network/timeout 才算代理的锅，captcha/parser-miss/unknown 不算。
 */
function judgeProxyOutcome(failure: string | undefined): 'success' | 'failure' {
  return failure === 'network' || failure === 'timeout' ? 'failure' : 'success';
}

export function detailHandler(config: AppConfig, proxyPool: ProxyPool): RequestHandler {
  return async (req, res) => {
    const body = (req.body ?? {}) as DetailRequestBody;
    const rawAsin = typeof body.asin === 'string' ? body.asin.trim().toUpperCase() : '';
    if (!isAsin(rawAsin)) {
      res.status(400).json({ error: 'asin must be a 10-character alphanumeric string' });
      return;
    }

    const marketplace: MarketplaceId = isMarketplaceId(body.marketplace)
      ? body.marketplace
      : config.defaultMarketplace;
    const job: DetailJob = { asin: rawAsin, marketplace, trigger: 'manual' };

    const proxy = await proxyPool.acquire();
    let browser: Browser | null = null;
    try {
      browser = await launchBrowser({
        chromePath: config.chromePath,
        headless: config.headless,
        proxy,
      });
      const result = await runDetailJob(job, { browser, proxy });
      if (proxy) await proxyPool.release(proxy, judgeProxyOutcome(result.attempt.failure));
      res.json({
        asin: job.asin,
        marketplace: job.marketplace,
        proxyUsed: safeProxyLabel(proxy),
        detail: result.detail,
        attempt: result.attempt,
      });
    } catch (err) {
      if (proxy) await proxyPool.release(proxy, 'failure');
      const message = err instanceof Error ? err.message : 'detail scrape failed';
      console.error('[detail error]', message);
      res.status(500).json({ error: message, proxyUsed: safeProxyLabel(proxy) });
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
