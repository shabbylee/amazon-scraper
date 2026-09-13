import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSchema } from './db/schema.js';
import { SqlitePersistence } from './db/persistence.js';
import { buildPriceAlerts, deliverAlert, persistAlert, type PriceAlertPayload } from './alerts.js';
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

const watch = {
  id: 7,
  keyword: 'laptop',
  marketplace: 'com' as const,
  intervalMinutes: 60,
  lastRunAt: null,
  createdAt: '',
};

describe('buildPriceAlerts', () => {
  it('emits an alert when the price crosses the threshold', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    // 第一次抓取：$100；第二次：$95（-5% > 1% 阈值）
    store.saveScrapeResult('com', [listing('B0ALERT001', '$100.00', 100)]);
    store.saveScrapeResult('com', [listing('B0ALERT001', '$95.00', 95)]);

    const alerts = buildPriceAlerts(watch, 'com', [listing('B0ALERT001', '$95.00', 95)], store, 1);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      event: 'price_change',
      watch: { id: 7, keyword: 'laptop', marketplace: 'com' },
      listing: { asin: 'B0ALERT001' },
      from: { priceNum: 100 },
      to: { priceNum: 95 },
      deltaPct: -5,
    });
    db.close();
  });

  it('skips listings without prior history (first scrape)', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    const alerts = buildPriceAlerts(watch, 'com', [listing('B0FIRST001', '$50.00', 50)], store, 1);
    expect(alerts).toHaveLength(0);
    db.close();
  });

  it('skips price-less listings and changes below the threshold', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    store.saveScrapeResult('com', [
      listing('B0NOPRICE0', '无价格', null),
      listing('B0SMALL001', '$10.00', 10),
    ]);
    store.saveScrapeResult('com', [
      listing('B0NOPRICE0', '无价格', null),
      listing('B0SMALL001', '$10.05', 10.05), // +0.5% < 1% 阈值
    ]);

    const alerts = buildPriceAlerts(
      watch,
      'com',
      [listing('B0NOPRICE0', '无价格', null), listing('B0SMALL001', '$10.05', 10.05)],
      store,
      1
    );
    expect(alerts).toHaveLength(0);
    db.close();
  });
});

describe('deliverAlert', () => {
  it('POSTs the payload as JSON to the webhook URL', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true } as Response));
    vi.stubGlobal('fetch', fetchMock);

    const deliver = deliverAlert('https://hooks.example.com/price');
    const payload: PriceAlertPayload = {
      event: 'price_change',
      watch: { id: 7, keyword: 'laptop', marketplace: 'com' },
      listing: { asin: 'B0X', title: 'T', href: 'https://www.amazon.com/dp/B0X' },
      from: { priceText: '$100.00', priceNum: 100 },
      to: { priceText: '$95.00', priceNum: 95 },
      deltaPct: -5,
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    await deliver(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.example.com/price',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ deltaPct: -5 });
    vi.unstubAllGlobals();
  });

  it('throws on a non-2xx response so the caller can log it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 } as Response)));
    const deliver = deliverAlert('https://hooks.example.com/price');
    const payload: PriceAlertPayload = {
      event: 'price_change',
      watch: { id: 7, keyword: 'laptop', marketplace: 'com' },
      listing: { asin: 'B0X', title: 'T', href: 'h' },
      from: { priceText: '$100.00', priceNum: 100 },
      to: { priceText: '$95.00', priceNum: 95 },
      deltaPct: -5,
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    await expect(deliver(payload)).rejects.toThrow('webhook responded 500');
    vi.unstubAllGlobals();
  });
});

describe('persistAlert', () => {
  it('stores the alert row with the computed delta', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    const id = persistAlert(store, watch, 'com', {
      event: 'price_change',
      watch: { id: 7, keyword: 'laptop', marketplace: 'com' },
      listing: { asin: 'B0PERSIST1', title: 'T', href: 'h' },
      from: { priceText: '$100.00', priceNum: 100 },
      to: { priceText: '$95.00', priceNum: 95 },
      deltaPct: -5,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(id).toBeGreaterThan(0);
    const row = db
      .prepare('SELECT watch_id AS watchId, delta_pct AS deltaPct FROM price_alerts WHERE id = ?')
      .get(id) as { watchId: number; deltaPct: number };
    expect(row).toEqual({ watchId: 7, deltaPct: -5 });
    db.close();
  });
});
