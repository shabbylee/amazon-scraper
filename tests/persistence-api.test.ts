import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createStore } from '../src/db/store.js';
import type { Listing } from '../src/types.js';

/** 持久化 API 集成测试：/api/history、/api/listings、/api/watch（纯 DB，不启动浏览器）。 */

const config = loadConfig({ env: {}, envFilePath: '/nonexistent/.env' });
const store = createStore({ ...config, dbPath: ':memory:' });
const app = createApp(config, store);

afterAll(() => store.close());

const listing = (asin: string, priceText: string, priceNum: number | null): Listing => ({
  marketplace: 'com',
  asin,
  title: `Item ${asin}`,
  href: `https://www.amazon.com/dp/${asin}`,
  image: null,
  rating: 4.5,
  priceText,
  hasPrice: priceNum !== null,
  priceNum,
});

describe('GET /api/history', () => {
  it('requires asin', async () => {
    await request(app).get('/api/history').expect(400);
  });

  it('returns price points in ascending order', async () => {
    store.saveScrapeResult('com', [listing('B0HIST0001', '$10.00', 10)]);
    store.saveScrapeResult('com', [listing('B0HIST0001', '$11.00', 11)]);

    const res = await request(app)
      .get('/api/history?asin=B0hist0001&marketplace=com&days=30')
      .expect(200);

    expect(res.body.asin).toBe('B0HIST0001'); // 归一化大写
    expect(res.body.points.map((p: { priceNum: number }) => p.priceNum)).toEqual([10, 11]);
  });
});

describe('GET /api/listings', () => {
  it('searches and sorts the saved listings', async () => {
    store.saveScrapeResult('com', [
      listing('B0LST00001', '$30.00', 30),
      listing('B0LST00002', '$10.00', 10),
    ]);
    const res = await request(app)
      .get('/api/listings?keyword=B0LST&sort=price-asc&limit=10')
      .expect(200);
    expect(res.body.items.map((l: { asin: string }) => l.asin)).toEqual(['B0LST00002', 'B0LST00001']);
  });
});

describe('/api/watch', () => {
  it('validates and clamps the interval', async () => {
    await request(app).post('/api/watch').send({}).expect(400);
    await request(app).post('/api/watch').send({ keyword: '  ' }).expect(400);

    const res = await request(app)
      .post('/api/watch')
      .send({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 5 }) // 低于下限
      .expect(201);
    expect(res.body.watch.intervalMinutes).toBe(30); // 夹紧到最小
    const id = res.body.watch.id as number;

    const list = await request(app).get('/api/watch').expect(200);
    expect(list.body.watches).toHaveLength(1);

    await request(app).delete(`/api/watch/${id}`).expect(200);
    await request(app).delete(`/api/watch/${id}`).expect(404);
  });
});
