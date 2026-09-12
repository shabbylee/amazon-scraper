import type { Browser, Page } from 'puppeteer';
import { extractDetailInPage, toDetail } from '../parser/detail-page.js';
import type { Proxy } from './proxy.js';
import { applyProxyAuth } from './proxy-auth.js';
import { applyStealth } from './stealth.js';
import {
  classifyError,
  isCaptchaPage,
  shouldRetry,
  type ScrapePageDeps,
} from './search.js';
import {
  MARKETPLACES,
  type AttemptSummary,
  type DetailJob,
  type DetailResult,
  type FailureClass,
  type Marketplace,
  type ProductDetail,
} from '../types.js';

/**
 * Detail Scraper（ADR-0005）：抓商品详情页（/dp/ASIN）并转成 ProductDetail。
 * 复用 Search 的稳定性设施：失败分类 / stealth / proxy-auth / retry 编排。
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export function buildDetailUrl(asin: string, marketplace: Marketplace): string {
  return `https://${marketplace.host}/dp/${encodeURIComponent(asin)}`;
}

export type DetailPageDeps = ScrapePageDeps;

export interface DetailPageOutcome {
  readonly detail?: ProductDetail;
  readonly failure?: FailureClass;
  readonly message?: string;
}

export async function scrapeDetailPage(
  asin: string,
  deps: DetailPageDeps
): Promise<DetailPageOutcome> {
  const navigateTimeout = deps.navigateTimeoutMs ?? 30_000;
  const selectorTimeout = deps.selectorTimeoutMs ?? 20_000;
  const url = buildDetailUrl(asin, deps.marketplace);

  let page: Page | null = null;
  try {
    page = await deps.browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${deps.marketplace.locale},zh;q=0.9,en;q=0.8`,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
    await applyStealth(page);
    if (deps.proxy) await applyProxyAuth(page, deps.proxy);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: navigateTimeout });

    if (await isCaptchaPage(page)) {
      return { failure: 'captcha', message: 'Amazon 返回验证码页面' };
    }

    await page
      .waitForSelector('#productTitle', { timeout: selectorTimeout })
      .catch(() => undefined);

    const raw = await page.evaluate(extractDetailInPage);
    const detail = toDetail(raw, deps.marketplace.id, asin);
    if (!detail) {
      return { failure: 'parser-miss', message: `未从 ${url} 解析到商品详情` };
    }
    return { detail };
  } catch (err) {
    return {
      failure: classifyError(err),
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }
}

export type DetailPageFn = (asin: string, deps: DetailPageDeps) => Promise<DetailPageOutcome>;

export interface RunDetailJobDeps {
  readonly browser?: Browser;
  readonly browserFactory?: () => Promise<Browser>;
  readonly closeBrowser?: (browser: Browser) => Promise<void>;
  readonly proxy?: Proxy | null;
  readonly retryMaxAttempts: number;
  readonly retryBackoffMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 注入单页抓取函数便于测试；默认走真实 scrapeDetailPage。 */
  readonly scrapeDetailPage?: DetailPageFn;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 单目标重试编排：成功拿到 detail 即返回；network/timeout 退避重试；
 * captcha 立即终止；parser-miss 不重试。返回 attempts 明细。
 */
export async function runDetailJob(
  job: DetailJob,
  deps: RunDetailJobDeps
): Promise<DetailResult> {
  const marketplace = MARKETPLACES[job.marketplace];
  const sleep = deps.sleep ?? defaultSleep;
  const scrapePage = deps.scrapeDetailPage ?? scrapeDetailPage;
  const closeBrowser = deps.closeBrowser ?? ((b: Browser) => b.close());
  const attempts: AttemptSummary[] = [];

  for (let attempt = 1; attempt <= deps.retryMaxAttempts; attempt += 1) {
    const startedAt = Date.now();
    let perAttemptBrowser: Browser;
    if (deps.browserFactory) {
      perAttemptBrowser = await deps.browserFactory();
    } else if (deps.browser) {
      perAttemptBrowser = deps.browser;
    } else {
      throw new Error('runDetailJob requires browser or browserFactory');
    }

    let outcome: DetailPageOutcome;
    try {
      outcome = await scrapePage(job.asin, {
        browser: perAttemptBrowser,
        marketplace,
        proxy: deps.proxy ?? null,
      });
    } finally {
      if (deps.browserFactory) {
        try {
          await closeBrowser(perAttemptBrowser);
        } catch {
          // 关闭是清理动作，失败不影响 Job 结果
        }
      }
    }
    const durationMs = Date.now() - startedAt;

    if (outcome.detail) {
      attempts.push({
        attempt,
        page: 1,
        ok: true,
        durationMs,
        listingCount: 1,
      });
      return { job, detail: outcome.detail, attempts };
    }

    const failure = outcome.failure ?? 'unknown';
    attempts.push({
      attempt,
      page: 1,
      ok: false,
      durationMs,
      listingCount: 0,
      failure,
      message: outcome.message,
    });

    if (failure === 'captcha') return { job, detail: null, attempts };
    if (shouldRetry(failure, attempt, deps.retryMaxAttempts)) {
      await sleep(deps.retryBackoffMs);
      continue;
    }
    break;
  }

  return { job, detail: null, attempts };
}
