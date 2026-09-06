import type { Browser, Page } from 'puppeteer';
import {
  extractSearchResultsInPage,
  toListings,
} from '../parser/search-page.js';
import {
  MARKETPLACES,
  type AttemptSummary,
  type FailureClass,
  type Listing,
  type Marketplace,
  type ScrapeJob,
  type ScrapeResult,
} from '../types.js';

/**
 * Scraper 层：编排 Browser + Parser + Retry + Proxy 完成一次 Scrape Attempt。
 * 严格约束（见 AGENTS.md）：
 * - 匿名访问：不登录、不持久化 Cookie
 * - 限速：相邻 Attempt ≥ requestIntervalMs（config 保证 ≥ 2000）
 * - 尊重 CAPTCHA：识别到即停止该 Job 的后续 Attempt
 * - 失败分类：network / timeout / captcha / parser-miss / unknown
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export interface SearchUrlOptions {
  readonly keyword: string;
  readonly page: number;
  readonly marketplace: Marketplace;
}

export function buildSearchUrl({ keyword, page, marketplace }: SearchUrlOptions): string {
  const params = new URLSearchParams({
    k: keyword,
    page: String(page),
    ref: 'nb_sb_noss',
  });
  return `https://${marketplace.host}/s?${params.toString()}`;
}

export function classifyError(err: unknown): FailureClass {
  if (!(err instanceof Error)) return 'unknown';
  const msg = err.message.toLowerCase();
  if (msg.includes('captcha') || msg.includes('robot')) return 'captcha';
  if (msg.includes('timeout')) return 'timeout';
  if (
    msg.includes('net::') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('navigation failed')
  ) {
    return 'network';
  }
  return 'unknown';
}

/** 通过 DOM 特征判断是否为 Amazon 反爬 CAPTCHA 页面。 */
export async function isCaptchaPage(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = document.title.toLowerCase();
      if (title.includes('captcha') || title.includes('robot')) return true;
      const form = document.querySelector('form[action*="validateCaptcha"]');
      if (form) return true;
      const img = document.querySelector('img[src*="captcha"]');
      return Boolean(img);
    });
  } catch {
    return false;
  }
}

export interface ScrapePageDeps {
  readonly browser: Browser;
  readonly marketplace: Marketplace;
  readonly navigateTimeoutMs?: number;
  readonly selectorTimeoutMs?: number;
}

export interface ScrapePageOutcome {
  readonly listings: readonly Listing[];
  readonly failure?: FailureClass;
  readonly message?: string;
}

export async function scrapeSearchPage(
  keyword: string,
  pageNum: number,
  deps: ScrapePageDeps
): Promise<ScrapePageOutcome> {
  const navigateTimeout = deps.navigateTimeoutMs ?? 30_000;
  const selectorTimeout = deps.selectorTimeoutMs ?? 20_000;
  const url = buildSearchUrl({ keyword, page: pageNum, marketplace: deps.marketplace });

  let page: Page | null = null;
  try {
    page = await deps.browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${deps.marketplace.locale},zh;q=0.9,en;q=0.8`,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: navigateTimeout });

    if (await isCaptchaPage(page)) {
      return { listings: [], failure: 'captcha', message: 'Amazon 返回验证码页面' };
    }

    await page
      .waitForSelector('[data-component-type="s-search-result"]', { timeout: selectorTimeout })
      .catch(() => undefined);

    const raw = (await page.evaluate(extractSearchResultsInPage)) as readonly unknown[];
    const listings = toListings(raw, deps.marketplace.id);
    if (listings.length === 0) {
      return {
        listings: [],
        failure: 'parser-miss',
        message: `未从 ${url} 解析到任何 Listing`,
      };
    }
    return { listings };
  } catch (err) {
    return {
      listings: [],
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

export interface RunSearchJobDeps {
  readonly browser: Browser;
  readonly requestIntervalMs: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 编排一个 Scrape Job：按页遍历，每次 Attempt 之间 sleep(requestIntervalMs)。
 * 遇到 CAPTCHA 立即停止后续页（AGENTS.md 硬约束）。
 */
export async function runSearchJob(
  job: ScrapeJob,
  deps: RunSearchJobDeps
): Promise<ScrapeResult> {
  const marketplace = MARKETPLACES[job.marketplace];
  const sleep = deps.sleep ?? defaultSleep;
  const allListings: Listing[] = [];
  const attempts: AttemptSummary[] = [];

  for (let pageNum = 1; pageNum <= job.pages; pageNum += 1) {
    const startedAt = Date.now();
    const outcome = await scrapeSearchPage(job.keyword, pageNum, {
      browser: deps.browser,
      marketplace,
    });
    const durationMs = Date.now() - startedAt;

    if (outcome.failure) {
      attempts.push({
        page: pageNum,
        ok: false,
        durationMs,
        listingCount: 0,
        failure: outcome.failure,
        message: outcome.message,
      });
      if (outcome.failure === 'captcha') break;
    } else {
      attempts.push({
        page: pageNum,
        ok: true,
        durationMs,
        listingCount: outcome.listings.length,
      });
      allListings.push(...outcome.listings);
    }

    if (pageNum < job.pages) await sleep(deps.requestIntervalMs);
  }

  return { job, listings: allListings, attempts };
}
