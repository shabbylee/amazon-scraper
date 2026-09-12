import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { launchBrowser } from '../src/scraper/browser.js';

/**
 * /api/scrape 集成测试：mock launchBrowser（不启动真实 Chrome），
 * 用假 Page 驱动真实管道 —— route → runSearchJob → scrapeSearchPage → toListings。
 * CI 里之前无法覆盖这条路径（见 tests/api.test.ts 注释），Phase 2 补上。
 */

vi.mock('../src/scraper/browser.js', () => ({
  launchBrowser: vi.fn(),
  detectChromePath: vi.fn(() => null),
}));

const mockLaunchBrowser = vi.mocked(launchBrowser);

/** 根据 evaluate 的函数源码区分调用方，返回对应 canned 结果。 */
function makePage(opts: {
  rawItems?: unknown[];
  captcha?: boolean;
  gotoFailTimes?: number;
} = {}) {
  let gotoCalls = 0;
  return {
    setUserAgent: async () => {},
    setExtraHTTPHeaders: async () => {},
    evaluateOnNewDocument: async () => {},
    goto: async () => {
      gotoCalls += 1;
      if (opts.gotoFailTimes && gotoCalls <= opts.gotoFailTimes) {
        throw new Error('net::ERR_NAME_NOT_RESOLVED at https://www.amazon.com');
      }
    },
    waitForSelector: async () => null,
    evaluate: async (fn: (...args: unknown[]) => unknown) => {
      const src = String(fn);
      if (src.includes('document.title')) return opts.captcha ?? false; // isCaptchaPage
      if (src.includes('data-component-type')) return opts.rawItems ?? []; // extractSearchResultsInPage
      return null;
    },
    close: async () => {},
  };
}

const rawItem = (asin: string, priceText: string): unknown => ({
  asin,
  title: `Item ${asin}`,
  priceText,
  hasPrice: true,
  image: null,
  rating: 4.5,
});

beforeEach(() => {
  mockLaunchBrowser.mockReset();
});

describe('POST /api/scrape (browser mocked, real pipeline)', () => {
  it('scrapes multiple pages and returns listings with per-attempt details', async () => {
    const page = makePage({
      rawItems: [rawItem('B0MOCK0001', '$10.00'), rawItem('B0MOCK0002', '$20.00')],
    });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page } as never);

    const config = loadConfig({
      env: { HEADLESS: 'true' },
      envFilePath: '/nonexistent/.env',
    });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/scrape')
      .send({ keyword: 'laptop', pages: 2, marketplace: 'com' })
      .expect(200);

    expect(res.body.marketplace).toBe('com');
    expect(res.body.total).toBe(4);
    expect(res.body.items).toHaveLength(4);
    expect(res.body.attempts).toHaveLength(2);
    expect(res.body.attempts[0]).toMatchObject({ page: 1, attempt: 1, ok: true });
    expect(res.body.attempts[1]).toMatchObject({ page: 2, attempt: 1, ok: true });
    expect(res.body.proxy).toBeNull();
    expect(mockLaunchBrowser).toHaveBeenCalledTimes(1);
    expect(mockLaunchBrowser.mock.calls[0]?.[0]).toMatchObject({
      headless: true,
      proxy: null,
    });
  });

  it('stops the job immediately on captcha and reports the failure class', async () => {
    const page = makePage({ rawItems: [], captcha: true });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page } as never);

    const config = loadConfig({
      env: { HEADLESS: 'true' },
      envFilePath: '/nonexistent/.env',
    });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/scrape')
      .send({ keyword: 'laptop', pages: 3, marketplace: 'com' })
      .expect(200);

    expect(res.body.total).toBe(0);
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0]).toMatchObject({ page: 1, attempt: 1, ok: false, failure: 'captcha' });
  });

  it('retries network failures through the real job loop', async () => {
    const page = makePage({
      rawItems: [rawItem('B0MOCK0003', '$30.00')],
      gotoFailTimes: 1, // 第一页第一次 goto 抛 network 错误，重试后成功
    });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page } as never);

    const config = loadConfig({
      env: { HEADLESS: 'true', RETRY_BACKOFF_MS: '2000' },
      envFilePath: '/nonexistent/.env',
    });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/scrape')
      .send({ keyword: 'laptop', pages: 1, marketplace: 'com' })
      .expect(200);

    expect(res.body.attempts).toHaveLength(2);
    expect(res.body.attempts[0]).toMatchObject({ attempt: 1, ok: false, failure: 'network' });
    expect(res.body.attempts[1]).toMatchObject({ attempt: 2, ok: true });
    expect(res.body.items).toHaveLength(1);
  });

  it('picks a proxy per job and reports its label', async () => {
    const page = makePage({ rawItems: [rawItem('B0MOCK0004', '$40.00')] });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page } as never);

    const config = loadConfig({
      env: { HEADLESS: 'true', PROXIES: 'http://proxy.example:8080' },
      envFilePath: '/nonexistent/.env',
    });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/scrape')
      .send({ keyword: 'laptop', pages: 1, marketplace: 'com' })
      .expect(200);

    expect(res.body.proxy).toBe('proxy.example');
    expect(mockLaunchBrowser.mock.calls[0]?.[0]).toMatchObject({
      proxy: 'http://proxy.example:8080',
    });
  });
});
