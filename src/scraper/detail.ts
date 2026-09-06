import type { Browser, Page } from 'puppeteer';
import {
  extractProductDetailInPage,
  toProductDetail,
} from '../parser/detail-page.js';
import type { ParsedProxy } from '../proxy/index.js';
import {
  MARKETPLACES,
  type DetailAttemptSummary,
  type FailureClass,
  type JobTrigger,
  type MarketplaceId,
  type ProductDetail,
} from '../types.js';
import { withRetry, type RetryPolicy } from './retry.js';
import {
  USER_AGENT,
  classifyError,
  classifyHttpStatus,
  detectCaptchaFromSignals,
} from './search.js';

/**
 * Detail Scraper：抓取单个 ASIN 的商品详情页。
 * 复用 Phase 2 的 Retry / ProxyPool / CAPTCHA 探测 / stealth；
 * 独立走 detailIntervalMs（见 docs/adr/0004-phase3-product-detail.md）。
 */

export interface DetailJob {
  readonly asin: string;
  readonly marketplace: MarketplaceId;
  readonly trigger: JobTrigger;
}

export interface DetailResult {
  readonly job: DetailJob;
  readonly detail: ProductDetail | null;
  readonly attempt: DetailAttemptSummary;
}

export function buildDetailUrl(asin: string, marketplace: MarketplaceId): string {
  const host = MARKETPLACES[marketplace].host;
  return `https://${host}/dp/${encodeURIComponent(asin)}`;
}

export interface ScrapeDetailPageDeps {
  readonly browser: Browser;
  readonly marketplace: MarketplaceId;
  readonly navigateTimeoutMs?: number;
  readonly selectorTimeoutMs?: number;
  readonly proxy?: ParsedProxy | null;
}

export interface ScrapeDetailPageOutcome {
  readonly detail: ProductDetail | null;
  readonly failure?: FailureClass;
  readonly message?: string;
}

/** 收集详情页 CAPTCHA 信号（与搜索页共用 detectCaptchaFromSignals 纯逻辑）。 */
async function collectCaptchaSignals(page: Page): Promise<boolean> {
  try {
    const signals = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      const hasRobotCheckHeading = headings.some((el) =>
        /robot\s*check/i.test(el.textContent ?? '')
      );
      const bodyText = document.body ? document.body.innerText ?? '' : '';
      return {
        url: window.location.href,
        title: document.title,
        hasValidateCaptchaForm: Boolean(
          document.querySelector('form[action*="validateCaptcha"]')
        ),
        hasCaptchaImage: Boolean(document.querySelector('img[src*="captcha"]')),
        hasRobotCheckHeading,
        hasSupportEmailMarker: bodyText.includes('api-services-support@amazon.com'),
      };
    });
    return detectCaptchaFromSignals(signals);
  } catch {
    return false;
  }
}

export async function scrapeDetailPage(
  asin: string,
  deps: ScrapeDetailPageDeps
): Promise<ScrapeDetailPageOutcome> {
  const navigateTimeout = deps.navigateTimeoutMs ?? 30_000;
  const selectorTimeout = deps.selectorTimeoutMs ?? 20_000;
  const url = buildDetailUrl(asin, deps.marketplace);

  let page: Page | null = null;
  try {
    page = await deps.browser.newPage();
    if (deps.proxy?.credentials) {
      await page.authenticate({
        username: deps.proxy.credentials.username,
        password: deps.proxy.credentials.password,
      });
    }
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${MARKETPLACES[deps.marketplace].locale},zh;q=0.9,en;q=0.8`,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: navigateTimeout,
    });
    const status = response?.status() ?? 0;
    const statusFailure = status > 0 ? classifyHttpStatus(status) : null;
    if (statusFailure) {
      return { detail: null, failure: statusFailure, message: `HTTP ${status} from ${url}` };
    }

    if (await collectCaptchaSignals(page)) {
      return { detail: null, failure: 'captcha', message: 'Amazon 返回验证码页面' };
    }

    // 详情页主选择器：#productTitle 或 #dp-container 任一出现即认为页面结构 OK
    await page
      .waitForSelector('#productTitle, #dp-container, #ppd', { timeout: selectorTimeout })
      .catch(() => undefined);

    const raw = await page.evaluate(extractProductDetailInPage);
    const detail = toProductDetail(raw, deps.marketplace);
    if (!detail) {
      return {
        detail: null,
        failure: 'parser-miss',
        message: `未从 ${url} 解析到 ProductDetail`,
      };
    }
    return { detail };
  } catch (err) {
    return {
      detail: null,
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

export interface RunDetailJobDeps {
  readonly browser: Browser;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly retryPolicy?: RetryPolicy;
  readonly proxy?: ParsedProxy | null;
}

/**
 * 单个 ASIN 的详情 Job：走 withRetry 包裹 scrapeDetailPage。
 * 详情页 Job 只有一个 Attempt，因此不做页间 sleep；批量详情由上层编排（Phase 4）。
 */
export async function runDetailJob(
  job: DetailJob,
  deps: RunDetailJobDeps
): Promise<DetailResult> {
  const startedAt = Date.now();
  const { result: outcome, attempts: tryCount, delaysMs } = await withRetry(
    () =>
      scrapeDetailPage(job.asin, {
        browser: deps.browser,
        marketplace: job.marketplace,
        proxy: deps.proxy,
      }),
    { policy: deps.retryPolicy, sleep: deps.sleep }
  );
  const durationMs = Date.now() - startedAt;
  const attempt: DetailAttemptSummary = {
    asin: job.asin,
    ok: !outcome.failure,
    durationMs,
    ...(outcome.failure
      ? { failure: outcome.failure, message: outcome.message }
      : {}),
    retryCount: tryCount - 1,
    retryDelaysMs: delaysMs,
  };
  return { job, detail: outcome.detail, attempt };
}
