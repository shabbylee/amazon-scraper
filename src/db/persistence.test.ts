import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initSchema } from './schema.js';
import { extractCurrency, SqlitePersistence, type Persistence } from './persistence.js';
import type { Listing, ProductDetail } from '../types.js';

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

let db: InstanceType<typeof Database>;
let store: Persistence;

beforeEach(() => {
  db = new Database(':memory:');
  initSchema(db);
  store = new SqlitePersistence(db);
});

afterEach(() => {
  db.close();
});

describe('extractCurrency', () => {
  it('prefers explicit currency codes, then symbols, then marketplace default', () => {
    expect(extractCurrency('CNY1,536.22', 'com')).toBe('CNY');
    expect(extractCurrency('EUR 12,99', 'de')).toBe('EUR');
    expect(extractCurrency('£10.00', 'couk')).toBe('GBP');
    expect(extractCurrency('$10.00', 'com')).toBe('USD');
    expect(extractCurrency('¥1,200', 'cojp')).toBe('JPY');
    expect(extractCurrency('¥99.00', 'com')).toBe('CNY'); // com 站显示 CNY 的实测场景
    expect(extractCurrency('10.00', 'de')).toBe('EUR'); // 无符号 → 站点默认
  });
});

describe('saveScrapeResult', () => {
  it('upserts listings and appends snapshots on repeated scrapes', () => {
    const n1 = store.saveScrapeResult('com', [listing('B0SNAP0001', '$10.00', 10)]);
    expect(n1).toBe(1);
    expect(store.getHistory('com', 'B0SNAP0001', 30)).toHaveLength(1);

    const n2 = store.saveScrapeResult('com', [
      listing('B0SNAP0001', '$12.00', 12),
      listing('B0SNAP0002', '$20.00', 20),
    ]);
    expect(n2).toBe(2);
    // upsert 不重复加行，snapshot 只追加
    const all = store.searchListings({ sort: 'updated', limit: 100 });
    expect(all).toHaveLength(2);
    const history = store.getHistory('com', 'B0SNAP0001', 30);
    expect(history).toHaveLength(2);
    expect(history.map((h) => h.priceNum)).toEqual([10, 12]);
  });

  it('records no snapshot for listings without price', () => {
    store.saveScrapeResult('com', [listing('B0NOPRICE0', '无价格', null)]);
    const history = store.getHistory('com', 'B0NOPRICE0', 30);
    expect(history).toHaveLength(1);
    expect(history[0]?.priceNum).toBeNull();
  });
});

describe('saveDetail', () => {
  const detail: ProductDetail = {
    marketplace: 'com',
    asin: 'B0DETAIL01',
    href: 'https://www.amazon.com/dp/B0DETAIL01',
    title: 'Detail Item',
    image: null,
    rating: 4.2,
    reviewCount: 99,
    buyBox: {
      hasBuyBox: true,
      priceText: '$88.00',
      priceNum: 88,
      sellerName: 'Amazon.com',
      shippingText: 'FREE delivery',
      isPrime: true,
      inStock: true,
    },
    variants: ['Black', 'White'],
  };

  it('persists the detail with Buy Box fields and a snapshot', () => {
    store.saveDetail(detail);
    const rows = db
      .prepare('SELECT seller_name, is_prime, in_stock, variants FROM listings WHERE asin = ?')
      .get('B0DETAIL01') as { seller_name: string; is_prime: number; in_stock: number; variants: string };
    expect(rows.seller_name).toBe('Amazon.com');
    expect(rows.is_prime).toBe(1);
    expect(rows.in_stock).toBe(1);
    expect(rows.variants).toBe('["Black","White"]');
    expect(store.getHistory('com', 'B0DETAIL01', 30)).toHaveLength(1);
  });
});

describe('searchListings', () => {
  beforeEach(() => {
    store.saveScrapeResult('com', [
      listing('B0SORT0001', '$30.00', 30),
      listing('B0SORT0002', '$10.00', 10),
      listing('B0SORT0003', '$20.00', 20),
    ]);
  });

  it('sorts by price asc / desc and filters by keyword', () => {
    const asc = store.searchListings({ sort: 'price-asc', limit: 10 });
    expect(asc.map((l) => l.priceNum)).toEqual([10, 20, 30]);

    const desc = store.searchListings({ sort: 'price-desc', limit: 10 });
    expect(desc.map((l) => l.priceNum)).toEqual([30, 20, 10]);

    const kw = store.searchListings({ keyword: 'B0SORT0002', sort: 'updated', limit: 10 });
    expect(kw).toHaveLength(1);
  });
});

describe('watches', () => {
  it('creates, lists, deletes and computes due watches', () => {
    const w = store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 60 });
    expect(w.id).toBeGreaterThan(0);
    expect(w.lastRunAt).toBeNull();
    expect(store.listWatches()).toHaveLength(1);

    // 从未跑过 → due
    expect(store.getDueWatches(new Date())).toHaveLength(1);

    // 跑完后 60 分钟内不 due，超过才 due
    store.markWatchRun(w.id, new Date('2026-01-01T00:00:00Z'));
    expect(store.getDueWatches(new Date('2026-01-01T00:30:00Z'))).toHaveLength(0);
    expect(store.getDueWatches(new Date('2026-01-01T01:00:01Z'))).toHaveLength(1);

    expect(store.deleteWatch(w.id)).toBe(true);
    expect(store.deleteWatch(w.id)).toBe(false);
    expect(store.listWatches()).toHaveLength(0);
  });
});
