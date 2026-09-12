import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer';
import {
  MARKETPLACES,
  type FailureClass,
  type Listing,
  type ScrapeJob,
} from '../types.js';
import {
  buildSearchUrl,
  classifyError,
  isRetryable,
  runSearchJob,
  shouldRetry,
  type ScrapePageFn,
  type ScrapePageOutcome,
} from './search.js';

describe('buildSearchUrl', () => {
  it('produces a marketplace-scoped Amazon search URL with encoded keyword', () => {
    const url = buildSearchUrl({
      keyword: 'gaming laptop',
      page: 2,
      marketplace: MARKETPLACES.com,
    });
    expect(url).toBe('https://www.amazon.com/s?k=gaming+laptop&page=2&ref=nb_sb_noss');
  });

  it('escapes special characters in the keyword', () => {
    const url = buildSearchUrl({
      keyword: 'a&b=c',
      page: 1,
      marketplace: MARKETPLACES.com,
    });
    expect(url).toContain('k=a%26b%3Dc');
  });

  it('scopes the URL to the marketplace host', () => {
    const url = buildSearchUrl({
      keyword: 'laptop',
      page: 2,
      marketplace: MARKETPLACES.de,
    });
    expect(url.startsWith('https://www.amazon.de/s?')).toBe(true);
  });
});

describe('classifyError', () => {
  it.each([
    ['Navigation timeout of 30000 ms exceeded', 'timeout'],
    ['net::ERR_NAME_NOT_RESOLVED at https://www.amazon.com', 'network'],
    ['connect ECONNRESET 1.2.3.4:443', 'network'],
    ['getaddrinfo ENOTFOUND www.amazon.com', 'network'],
    ['navigation failed because page was closed', 'network'],
    ['CAPTCHA required to continue', 'captcha'],
    ['Robot Check', 'captcha'],
    ['some brand new weird error', 'unknown'],
  ])('maps %j to %j', (message, expected) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });

  it('returns unknown for non-Error values', () => {
    expect(classifyError('string failure')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
    expect(classifyError({ message: 'not an Error instance' })).toBe('unknown');
  });
});

describe('retry policy', () => {
  it.each<[FailureClass, boolean]>([
    ['network', true],
    ['timeout', true],
    ['captcha', false],
    ['parser-miss', false],
    ['unknown', false],
  ])('isRetryable(%s) = %j', (failure, expected) => {
    expect(isRetryable(failure)).toBe(expected);
  });

  it('shouldRetry only when retryable and attempt budget remains', () => {
    expect(shouldRetry('network', 1, 3)).toBe(true);
    expect(shouldRetry('timeout', 2, 3)).toBe(true);
    expect(shouldRetry('captcha', 1, 3)).toBe(false);
    expect(shouldRetry('parser-miss', 1, 3)).toBe(false);
    expect(shouldRetry('network', 3, 3)).toBe(false); // attempt === maxAttempts
    expect(shouldRetry('network', 4, 3)).toBe(false);
  });
});

describe('runSearchJob (retry orchestration)', () => {
  const fakeBrowser = {} as Browser;
  const job: ScrapeJob = { keyword: 'laptop', marketplace: 'com', pages: 2, trigger: 'manual' };

  const makeOutcome = (partial: Partial<ScrapePageOutcome>): ScrapePageOutcome => ({
    listings: [],
    ...partial,
  });
  const okListing = (asin: string): Listing => ({
    marketplace: 'com',
    asin,
    title: 'x',
    href: `https://www.amazon.com/dp/${asin}`,
    image: null,
    priceText: '$1.00',
    hasPrice: true,
    priceNum: 1,
    rating: null,
  });

  const noop = async () => {};

  it('retries network failures with backoff, then keeps the successful page listings', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const scrapePage: ScrapePageFn = vi
      .fn()
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'network', message: 'down' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'network', message: 'down' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [okListing('B0RETRY01')] }))
      .mockResolvedValueOnce(makeOutcome({ listings: [okListing('B0RETRY02')] }));

    const result = await runSearchJob(job, {
      browser: fakeBrowser,
      requestIntervalMs: 2000,
      retryMaxAttempts: 3,
      retryBackoffMs: 2500,
      sleep,
      scrapePage,
    });

    expect(scrapePage).toHaveBeenCalledTimes(4); // 2 次失败 + 1 次成功（page1），1 次（page2）
    expect(result.attempts.map((a) => [a.page, a.attempt, a.ok, a.failure])).toEqual([
      [1, 1, false, 'network'],
      [1, 2, false, 'network'],
      [1, 3, true, undefined],
      [2, 1, true, undefined],
    ]);
    // 两次重试退避 + 页间间隔
    expect(sleeps).toEqual([2500, 2500, 2000]);
    expect(result.listings.map((l) => l.asin)).toEqual(['B0RETRY01', 'B0RETRY02']);
  });

  it('stops the whole job immediately on captcha without retrying or touching later pages', async () => {
    const scrapePage: ScrapePageFn = vi
      .fn()
      .mockResolvedValue(makeOutcome({ listings: [], failure: 'captcha', message: 'captcha' }));
    const sleep = vi.fn(noop);

    const result = await runSearchJob(job, {
      browser: fakeBrowser,
      requestIntervalMs: 2000,
      retryMaxAttempts: 3,
      retryBackoffMs: 2500,
      sleep,
      scrapePage,
    });

    expect(scrapePage).toHaveBeenCalledTimes(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.failure).toBe('captcha');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry parser-miss and moves on to the next page', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const scrapePage: ScrapePageFn = vi
      .fn()
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'parser-miss', message: 'empty' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [okListing('B0PARSER01')] }));

    const result = await runSearchJob(job, {
      browser: fakeBrowser,
      requestIntervalMs: 2000,
      retryMaxAttempts: 3,
      retryBackoffMs: 2500,
      sleep,
      scrapePage,
    });

    expect(scrapePage).toHaveBeenCalledTimes(2);
    expect(result.attempts.map((a) => [a.page, a.attempt, a.ok])).toEqual([
      [1, 1, false],
      [2, 1, true],
    ]);
    expect(sleeps).toEqual([2000]); // 只有页间间隔，没有退避
    expect(result.listings).toHaveLength(1);
  });

  it('gives up a page after exhausting retry budget, keeps earlier pages, continues later pages', async () => {
    const scrapePage: ScrapePageFn = vi
      .fn()
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'timeout', message: 'slow' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'timeout', message: 'slow' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [], failure: 'timeout', message: 'slow' }))
      .mockResolvedValueOnce(makeOutcome({ listings: [okListing('B0LATER01')] }));

    const result = await runSearchJob(job, {
      browser: fakeBrowser,
      requestIntervalMs: 2000,
      retryMaxAttempts: 3,
      retryBackoffMs: 2000,
      sleep: noop,
      scrapePage,
    });

    expect(scrapePage).toHaveBeenCalledTimes(4);
    expect(result.attempts).toHaveLength(4);
    expect(result.attempts[0]?.page).toBe(1);
    expect(result.attempts[2]?.failure).toBe('timeout');
    expect(result.attempts[3]?.ok).toBe(true);
    expect(result.listings.map((l) => l.asin)).toEqual(['B0LATER01']);
  });
});
