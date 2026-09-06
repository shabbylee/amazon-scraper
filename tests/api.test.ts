import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

/**
 * /api/health 是不启动浏览器的轻量端点，可安全做集成测试。
 * /api/scrape 会真的 launch puppeteer，不在 CI 里跑，留给 Phase 2 加 mock 后再补。
 */
describe('GET /api/health', () => {
  const config = loadConfig({ env: { HEADLESS: 'true' }, envFilePath: '/nonexistent/.env' });
  const app = createApp(config);

  it('returns ok:true with the resolved runtime info', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      headless: true,
      defaultMarketplace: 'com',
    });
    expect(typeof res.body.chromePath).toBe('string');
    expect(typeof res.body.chromeDetected).toBe('boolean');
    expect(res.body.requestIntervalMs).toBeGreaterThanOrEqual(2000);
    expect(res.body.maxConcurrentAttempts).toBeLessThanOrEqual(2);
  });
});

describe('POST /api/scrape (validation only)', () => {
  const config = loadConfig({ env: {}, envFilePath: '/nonexistent/.env' });
  const app = createApp(config);

  it('rejects a request with no keyword before touching puppeteer', async () => {
    const res = await request(app)
      .post('/api/scrape')
      .send({})
      .set('content-type', 'application/json')
      .expect(400);
    expect(res.body).toEqual({ error: 'keyword required' });
  });

  it('rejects a request with a whitespace-only keyword', async () => {
    await request(app)
      .post('/api/scrape')
      .send({ keyword: '   ' })
      .set('content-type', 'application/json')
      .expect(400);
  });
});
