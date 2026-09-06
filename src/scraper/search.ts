import type { Browser, Page } from 'puppeteer';
import {
  extractSearchResultsInPage,
  toListings,
} from '../parser/search-page.js';
import type { ParsedProxy } from '../proxy/index.js';
import {
  MARKETPLACES,
  type AttemptSummary,
  type FailureClass,
  type Listing,
  type Marketplace,
  type ScrapeJob,
  type ScrapeResult,
} from '../types.js';
import { withRetry, type RetryPolicy } from './retry.js';

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

/**
 * Amazon CAPTCHA / Robot Check 页面的多维信号。
 * 抽成纯数据结构，方便 detectCaptchaFromSignals 独立单测。
 */
export interface CaptchaSignals {
  readonly url: string;
  readonly title: string;
  readonly hasValidateCaptchaForm: boolean;
  readonly hasCaptchaImage: boolean;
  readonly hasRobotCheckHeading: boolean;
  readonly hasSupportEmailMarker: boolean;
}

/**
 * 纯逻辑：任一信号命中即认为是 CAPTCHA 页。
 * Amazon 的反爬页面在不同 Marketplace / 不同时期会换特征，多维探测比单点稳。
 */
export function detectCaptchaFromSignals(s: CaptchaSignals): boolean {
  if (s.url.includes('/errors/validateCaptcha')) return true;
  const t = s.title.toLowerCase();
  if (t.includes('captcha') || t.includes('robot')) return true;
  // Amazon 实际 CAPTCHA 页的常见标题文案："Enter the characters you see below"
  if (t.includes('characters you see')) return true;
  if (s.hasValidateCaptchaForm) return true;
  if (s.hasCaptchaImage) return true;
  if (s.hasRobotCheckHeading) return true;
  if (s.hasSupportEmailMarker) return true;
  return false;
}

/** 在浏览器上下文里收集 CaptchaSignals；失败（页面还没加载完 / evaluate 抛错）视为非 CAPTCHA。 */
export async function isCaptchaPage(page: Page): Promise<boolean> {
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

/** HTTP 响应状态 → FailureClass 的补充映射（goto 成功但状态码异常时用）。 */
export function classifyHttpStatus(status: number): FailureClass | null {
  if (status === 429 || status === 503) return 'network';
  if (status >= 500) return 'network';
  if (status === 403) return 'unknown';
  if (status >= 400) return 'unknown';
  return null;
}

export interface ScrapePageDeps {
  readonly browser: Browser;
  readonly marketplace: Marketplace;
  readonly navigateTimeoutMs?: number;
  readonly selectorTimeoutMs?: number;
  /** Phase 2：可选代理；credentials 在 newPage 后、goto 前用 page.authenticate 应用。 */
  readonly proxy?: ParsedProxy | null;
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
    if (deps.proxy?.credentials) {
      await page.authenticate({
        username: deps.proxy.credentials.username,
        password: deps.proxy.credentials.password,
      });
    }
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({
      'Accept-Language': `${deps.marketplace.locale},zh;q=0.9,en;q=0.8`,
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
      return {
        listings: [],
        failure: statusFailure,
        message: `HTTP ${status} from ${url}`,
      };
    }

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
  /** Phase 2：可选自定义 Retry 策略；默认走 retry.ts 的 DEFAULT_RETRY_POLICY。 */
  readonly retryPolicy?: RetryPolicy;
  /** Phase 2：可选代理；透传给每页的 scrapeSearchPage。 */
  readonly proxy?: ParsedProxy | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 编排一个 Scrape Job：按页遍历，每页的 scrapeSearchPage 走 withRetry（按 FailureClass 分类），
 * 相邻 Attempt 之间 sleep(requestIntervalMs)。遇到 CAPTCHA 立即停止后续页（AGENTS.md 硬约束）。
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
    const { result: outcome, attempts: tryCount, delaysMs } = await withRetry(
      () =>
        scrapeSearchPage(job.keyword, pageNum, {
          browser: deps.browser,
          marketplace,
          proxy: deps.proxy,
        }),
      { policy: deps.retryPolicy, sleep }
    );
    const durationMs = Date.now() - startedAt;
    const retryCount = tryCount - 1;

    if (outcome.failure) {
      attempts.push({
        page: pageNum,
        ok: false,
        durationMs,
        listingCount: 0,
        failure: outcome.failure,
        message: outcome.message,
        retryCount,
        retryDelaysMs: delaysMs,
      });
      if (outcome.failure === 'captcha') break;
    } else {
      attempts.push({
        page: pageNum,
        ok: true,
        durationMs,
        listingCount: outcome.listings.length,
        retryCount,
        retryDelaysMs: delaysMs,
      });
      allListings.push(...outcome.listings);
    }

    if (pageNum < job.pages) await sleep(deps.requestIntervalMs);
  }

  return { job, listings: allListings, attempts };
}
