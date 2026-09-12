import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { launchBrowser } from '../src/scraper/browser.js';

/**
 * /api/detail 集成测试：mock launchBrowser，假 Page 驱动真实管道
 * route → runDetailJob → scrapeDetailPage → toDetail。
 */

vi.mock('../src/scraper/browser.js', () => ({
  launchBrowser: vi.fn(),
  detectChromePath: vi.fn(() => null),
}));

const mockLaunchBrowser = vi.mocked(launchBrowser);

const detailRaw = {
  title: 'Samsung Galaxy Chromebook Go',
  image: 'https://m.media-amazon.com/images/I/abc.jpg',
  rating: 4.3,
  reviewCount: 1234,
  priceText: '$249.00',
  hasBuyBox: true,
  sellerName: 'Amazon.com',
  shippingText: 'FREE delivery',
  isPrime: true,
  inStock: true,
  variants: ['Mineral Silver'],
};

function makePage(opts: { raw?: unknown; captcha?: boolean } = {}) {
  return {
    setUserAgent: async () => {},
    setExtraHTTPHeaders: async () => {},
    evaluateOnNewDocument: async () => {},
    goto: async () => {},
    waitForSelector: async () => null,
    evaluate: async (fn: (...args: unknown[]) => unknown) => {
      const src = String(fn);
      if (src.includes('document.title')) return opts.captcha ?? false; // isCaptchaPage
      if (src.includes('productTitle')) return opts.raw ?? detailRaw; // extractDetailInPage
      return null;
    },
    close: async () => {},
  };
}

beforeEach(() => {
  mockLaunchBrowser.mockReset();
});

describe('POST /api/detail', () => {
  it('rejects a missing or malformed asin before touching puppeteer', async () => {
    const config = loadConfig({ env: {}, envFilePath: '/nonexistent/.env' });
    const app = createApp(config);

    await request(app).post('/api/detail').send({}).expect(400);
    await request(app).post('/api/detail').send({ asin: 'tooshort' }).expect(400);
    await request(app).post('/api/detail').send({ asin: '!!!not-asin!!!' }).expect(400);
    expect(mockLaunchBrowser).not.toHaveBeenCalled();
  });

  it('returns the ProductDetail with Buy Box for a valid asin', async () => {
    const page = makePage({ raw: detailRaw });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page, close: async () => {} } as never);

    const config = loadConfig({ env: { HEADLESS: 'true' }, envFilePath: '/nonexistent/.env' });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/detail')
      .send({ asin: 'b09s3hnmhf', marketplace: 'com' })
      .expect(200);

    expect(res.body.asin).toBe('B09S3HNMHF'); // asin 被规范化
    expect(res.body.detail).toMatchObject({
      asin: 'B09S3HNMHF',
      href: 'https://www.amazon.com/dp/B09S3HNMHF',
      title: 'Samsung Galaxy Chromebook Go',
      reviewCount: 1234,
      buyBox: { hasBuyBox: true, priceNum: 249, isPrime: true, inStock: true },
    });
    expect(res.body.attempts).toHaveLength(1);
    expect(res.body.attempts[0]).toMatchObject({ attempt: 1, ok: true });
  });

  it('reports captcha failures without a detail', async () => {
    const page = makePage({ raw: detailRaw, captcha: true });
    mockLaunchBrowser.mockResolvedValue({ newPage: async () => page, close: async () => {} } as never);

    const config = loadConfig({ env: { HEADLESS: 'true' }, envFilePath: '/nonexistent/.env' });
    const app = createApp(config);

    const res = await request(app)
      .post('/api/detail')
      .send({ asin: 'B09S3HNMHF', marketplace: 'com' })
      .expect(200);

    expect(res.body.detail).toBeNull();
    expect(res.body.attempts[0]).toMatchObject({ ok: false, failure: 'captcha' });
  });
});
