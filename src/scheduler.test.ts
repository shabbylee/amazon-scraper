import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { initSchema } from './db/schema.js';
import { SqlitePersistence } from './db/persistence.js';
import { startWatchScheduler } from './scheduler.js';
import type { Listing } from './types.js';

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

describe('startWatchScheduler', () => {
  const config = loadConfig({ env: {}, envFilePath: '/nonexistent/.env' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs due watches through the injected executor and marks them', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    const w = store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });
    const fetchWatchListings = vi.fn(async () => [listing('B0SCHED001', '$10.00', 10)]);

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000, // 长 tick：只有启动补跑那轮
      fetchWatchListings,
    });

    // 启动即补跑一轮：due watch 被执行、落库且 last_run_at 被标记
    await vi.waitFor(() => expect(store.listWatches()[0]?.lastRunAt).not.toBeNull());
    expect(fetchWatchListings).toHaveBeenCalledTimes(1);
    expect(store.getHistory('com', 'B0SCHED001', 30)).toHaveLength(1);
    stop();
    db.close();
  });

  it('catches executor failures without crashing the tick', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });
    const fetchWatchListings = vi.fn(async () => {
      throw new Error('boom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000,
      fetchWatchListings,
    });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    stop();
    db.close();
  });

  it('persists and delivers a price-change alert when the price moved', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    const w = store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });

    // 上一次 Watch 运行：$100；本次：$95（-5% > 1% 阈值）
    store.saveScrapeResult('com', [listing('B0ALERT001', '$100.00', 100)]);
    const fetchWatchListings = vi.fn(async () => [listing('B0ALERT001', '$95.00', 95)]);
    const deliver = vi.fn(async (_payload: unknown) => {});

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000,
      fetchWatchListings,
      deliverAlert: deliver,
    });

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    const payload = deliver.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      event: 'price_change',
      watch: { id: w.id, keyword: 'laptop' },
      listing: { asin: 'B0ALERT001' },
      from: { priceNum: 100 },
      to: { priceNum: 95 },
      deltaPct: -5,
    });
    // Alert 已落库
    const rows = db.prepare('SELECT count(*) AS c FROM price_alerts').get() as { c: number };
    expect(rows.c).toBe(1);
    stop();
    db.close();
  });

  it('does not deliver alerts for stable prices', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });
    store.saveScrapeResult('com', [listing('B0STABLE01', '$100.00', 100)]);
    const fetchWatchListings = vi.fn(async () => [listing('B0STABLE01', '$100.00', 100)]);
    const deliver = vi.fn(async () => {});

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000,
      fetchWatchListings,
      deliverAlert: deliver,
    });

    // 等调度器完成一轮（last_run_at 被标记）后断言没有提醒
    await vi.waitFor(() => expect(store.listWatches()[0]?.lastRunAt).not.toBeNull());
    expect(deliver).not.toHaveBeenCalled();
    stop();
    db.close();
  });
});
