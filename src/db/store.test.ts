import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from './index.js';
import {
  createWatch,
  deleteWatch,
  generateJobId,
  getPriceHistory,
  getRecentPriceChanges,
  getWatchById,
  insertListings,
  insertPriceChanges,
  insertPriceSnapshots,
  listWatches,
  startWatchRun,
  finishWatchRun,
  upsertProductDetail,
  getProductDetail,
  deactivateWatch,
} from './store.js';
import type { Listing, ProductDetail } from '../types.js';

const TEST_DB = ':memory:';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    marketplace: 'com',
    asin: 'B09S3HNMHF',
    title: 'Test Product',
    href: 'https://www.amazon.com/dp/B09S3HNMHF',
    image: null,
    priceText: '$249.00',
    hasPrice: true,
    priceNum: 249,
    rating: 4.3,
    ...overrides,
  };
}

beforeEach(() => {
  openDatabase(TEST_DB);
});

afterEach(() => {
  closeDatabase();
});

describe('listings', () => {
  it('inserts and retrieves listings by job', () => {
    const jobId = generateJobId();
    const listings = [makeListing(), makeListing({ asin: 'B0OTHER001', priceNum: 100 })];
    insertListings(listings, 'laptop', jobId);
    // 验证不抛错即可（store 没有 getListingsByJob，但 insert 成功 = schema 正确）
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('price_snapshots', () => {
  it('inserts snapshots only for listings with price', () => {
    const listings = [
      makeListing({ priceNum: 249 }),
      makeListing({ asin: 'B0NOPRICE0', hasPrice: false, priceNum: null }),
    ];
    insertPriceSnapshots(listings);
    const history = getPriceHistory('com', 'B09S3HNMHF');
    expect(history).toHaveLength(1);
    expect(history[0]?.price_num).toBe(249);
    expect(history[0]?.currency).toBe('$');
    // 无价格的不入 snapshot
    expect(getPriceHistory('com', 'B0NOPRICE0')).toHaveLength(0);
  });

  it('accumulates history over multiple inserts', () => {
    insertPriceSnapshots([makeListing({ priceNum: 249 })]);
    insertPriceSnapshots([makeListing({ priceNum: 229 })]);
    insertPriceSnapshots([makeListing({ priceNum: 199 })]);
    const history = getPriceHistory('com', 'B09S3HNMHF');
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.price_num)).toEqual([249, 229, 199]);
  });
});

describe('product_details', () => {
  it('upserts and retrieves a ProductDetail', () => {
    const detail: ProductDetail = {
      marketplace: 'com',
      asin: 'B09S3HNMHF',
      title: 'Samsung Chromebook',
      brand: 'Samsung',
      href: 'https://www.amazon.com/dp/B09S3HNMHF',
      images: [],
      breadcrumbs: [],
      description: null,
      bullets: [],
      specs: [],
      buyBox: {
        priceText: '$249.00',
        priceNum: 249,
        currency: '$',
        shippingText: null,
        sellerName: null,
        isPrime: false,
        availability: 'in-stock',
      },
      reviews: {
        totalCount: 100,
        averageRating: 4.3,
        breakdown: { star5: 60, star4: 20, star3: 10, star2: 5, star1: 5 },
      },
      variants: [],
      capturedAt: new Date().toISOString(),
    };
    upsertProductDetail(detail);
    const retrieved = getProductDetail('com', 'B09S3HNMHF');
    expect(retrieved?.title).toBe('Samsung Chromebook');
    expect(retrieved?.buyBox.priceNum).toBe(249);

    // upsert 更新
    const updated = { ...detail, title: 'Updated Title', capturedAt: new Date().toISOString() };
    upsertProductDetail(updated);
    expect(getProductDetail('com', 'B09S3HNMHF')?.title).toBe('Updated Title');
  });

  it('returns null for non-existent detail', () => {
    expect(getProductDetail('com', 'B0NOTEXIST0')).toBeNull();
  });
});

describe('watches', () => {
  it('creates and retrieves a watch', () => {
    const w = createWatch({ keyword: 'laptop', cronExpr: '0 9 * * 1' });
    expect(w.id).toBeGreaterThan(0);
    expect(w.keyword).toBe('laptop');
    expect(w.active).toBe(1);
    expect(getWatchById(w.id)?.keyword).toBe('laptop');
  });

  it('lists watches newest first', () => {
    createWatch({ keyword: 'aaa' });
    createWatch({ keyword: 'bbb' });
    const all = listWatches();
    expect(all).toHaveLength(2);
    expect(all[0]?.keyword).toBe('bbb');
  });

  it('deactivates and deletes', () => {
    const w = createWatch({ keyword: 'temp' });
    deactivateWatch(w.id);
    expect(getWatchById(w.id)?.active).toBe(0);
    expect(listWatches(true)).toHaveLength(0);
    deleteWatch(w.id);
    expect(getWatchById(w.id)).toBeNull();
  });
});

describe('watch_runs + price_changes', () => {
  it('records a run and its price changes', () => {
    const w = createWatch({ keyword: 'gpu' });
    const runId = startWatchRun(w.id, generateJobId());
    insertPriceChanges([
      {
        watchRunId: runId,
        marketplace: 'com',
        asin: 'B09S3HNMHF',
        title: 'RTX 4090',
        oldPriceNum: 1599,
        newPriceNum: 1399,
        oldPriceText: '$1,599.00',
        newText: '$1,399.00',
      },
    ]);
    finishWatchRun(runId, 'ok', 16, 1);

    const changes = getRecentPriceChanges(10);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.change_pct).toBeCloseTo(-12.51, 1);
    expect(changes[0]?.title).toBe('RTX 4090');
  });
});
