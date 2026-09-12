import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer';
import { MARKETPLACES, type DetailJob, type ProductDetail } from '../types.js';
import {
  buildDetailUrl,
  runDetailJob,
  type DetailPageDeps,
  type DetailPageFn,
  type DetailPageOutcome,
} from './detail.js';

const fakeBrowser = {} as Browser;
const job: DetailJob = { asin: 'B09S3HNMHF', marketplace: 'com', trigger: 'manual' };

const makeOutcome = (partial: Partial<DetailPageOutcome>): DetailPageOutcome => ({ ...partial });
const detail = (asin: string): ProductDetail => ({
  marketplace: 'com',
  asin,
  href: `https://www.amazon.com/dp/${asin}`,
  title: 'Product',
  image: null,
  rating: 4.5,
  reviewCount: 100,
  buyBox: {
    hasBuyBox: true,
    priceText: '$10.00',
    priceNum: 10,
    sellerName: 'Amazon.com',
    shippingText: 'FREE delivery',
    isPrime: true,
    inStock: true,
  },
  variants: [],
});

const noop = async () => {};

describe('buildDetailUrl', () => {
  it('builds a marketplace-scoped /dp URL', () => {
    expect(buildDetailUrl('B09S3HNMHF', MARKETPLACES.com)).toBe(
      'https://www.amazon.com/dp/B09S3HNMHF'
    );
    expect(buildDetailUrl('B0DE0000001', MARKETPLACES.de)).toBe(
      'https://www.amazon.de/dp/B0DE0000001'
    );
  });
});

describe('runDetailJob', () => {
  it('returns the detail on the first successful attempt', async () => {
    const scrapePage = vi.fn(async () => makeOutcome({ detail: detail('B09S3HNMHF') }));
    const result = await runDetailJob(job, {
      browser: fakeBrowser,
      retryMaxAttempts: 3,
      retryBackoffMs: 2000,
      sleep: noop,
      scrapeDetailPage: scrapePage,
    });
    expect(scrapePage).toHaveBeenCalledTimes(1);
    expect(result.detail?.asin).toBe('B09S3HNMHF');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ attempt: 1, ok: true });
  });

  it('retries network failures with backoff until success', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const scrapePage = vi.fn(
      async (_asin: string, _deps: DetailPageDeps) => makeOutcome({ detail: detail('B09S3HNMHF') })
    );
    scrapePage
      .mockResolvedValueOnce(makeOutcome({ failure: 'network', message: 'down' }))
      .mockResolvedValueOnce(makeOutcome({ failure: 'network', message: 'down' }))
      .mockResolvedValueOnce(makeOutcome({ detail: detail('B09S3HNMHF') }));

    const result = await runDetailJob(job, {
      browser: fakeBrowser,
      retryMaxAttempts: 3,
      retryBackoffMs: 2500,
      sleep,
      scrapeDetailPage: scrapePage,
    });

    expect(scrapePage).toHaveBeenCalledTimes(3);
    expect(result.attempts.map((a) => [a.attempt, a.ok])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(sleeps).toEqual([2500, 2500]);
    expect(result.detail).not.toBeNull();
  });

  it('stops immediately on captcha without retrying', async () => {
    const scrapePage = vi.fn(async () => makeOutcome({ failure: 'captcha', message: 'captcha' }));
    const sleep = vi.fn(noop);
    const result = await runDetailJob(job, {
      browser: fakeBrowser,
      retryMaxAttempts: 3,
      retryBackoffMs: 2000,
      sleep,
      scrapeDetailPage: scrapePage,
    });
    expect(scrapePage).toHaveBeenCalledTimes(1);
    expect(result.detail).toBeNull();
    expect(result.attempts[0]?.failure).toBe('captcha');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry parser-miss', async () => {
    const scrapePage = vi.fn(async () => makeOutcome({ failure: 'parser-miss', message: 'no title' }));
    const result = await runDetailJob(job, {
      browser: fakeBrowser,
      retryMaxAttempts: 3,
      retryBackoffMs: 2000,
      sleep: noop,
      scrapeDetailPage: scrapePage,
    });
    expect(scrapePage).toHaveBeenCalledTimes(1);
    expect(result.detail).toBeNull();
    expect(result.attempts[0]?.failure).toBe('parser-miss');
  });

  it('uses a fresh browser per attempt when browserFactory is provided', async () => {
    const scrapePage = vi.fn(async () => makeOutcome({ detail: detail('B09S3HNMHF') }));
    const browserFactory = vi.fn(async (): Promise<Browser> => fakeBrowser);
    const closeBrowser = vi.fn(async () => {});

    await runDetailJob(job, {
      browserFactory,
      closeBrowser,
      retryMaxAttempts: 3,
      retryBackoffMs: 2000,
      sleep: noop,
      scrapeDetailPage: scrapePage,
    });

    expect(browserFactory).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});
