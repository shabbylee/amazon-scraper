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

describe('price snapshot source', () => {
  /** 可控价格的详情 fixture：Buy Box 价必须可配，才能验证价源与跨源隔离。 */
  const detailPriced = (
    asin: string,
    priceText: string,
    priceNum: number | null
  ): ProductDetail => ({
    marketplace: 'com',
    asin,
    href: `https://www.amazon.com/dp/${asin}`,
    title: 'Priced Item',
    image: null,
    rating: 4.2,
    reviewCount: 99,
    buyBox: {
      hasBuyBox: priceNum !== null,
      priceText,
      priceNum,
      sellerName: 'Amazon.com',
      shippingText: 'FREE delivery',
      isPrime: true,
      inStock: true,
    },
    variants: [],
  });

  it('tags search scrapes as listing and detail scrapes as buybox', () => {
    store.saveScrapeResult('com', [listing('B0SRC00001', '$100.00', 100)]);
    store.saveDetail(detailPriced('B0SRC00001', '$150.00', 150));

    expect(store.getHistory('com', 'B0SRC00001', 30).map((p) => p.source)).toEqual([
      'listing',
      'buybox',
    ]);
  });

  it('filters recent snapshots by source so a cross-source pair cannot be compared', () => {
    store.saveScrapeResult('com', [listing('B0SRC00002', '$100.00', 100)]);
    store.saveDetail(detailPriced('B0SRC00002', '$150.00', 150));
    store.saveScrapeResult('com', [listing('B0SRC00002', '$100.00', 100)]);

    // 不过滤时最近两条跨了两个口径 —— 这正是告警失真的来源
    expect(store.getRecentSnapshots('com', 'B0SRC00002', 2).map((p) => p.source)).toEqual([
      'buybox',
      'listing',
    ]);

    // 按源过滤后只剩同一口径的两条搜索价，价差为 0
    const listingOnly = store.getRecentSnapshots('com', 'B0SRC00002', 2, 'listing');
    expect(listingOnly.map((p) => p.source)).toEqual(['listing', 'listing']);
    expect(listingOnly.map((p) => p.priceNum)).toEqual([100, 100]);
  });

  it('reports the buybox source for detail-only history', () => {
    store.saveDetail(detailPriced('B0SRC00003', '$42.00', 42));
    const history = store.getHistory('com', 'B0SRC00003', 30);
    expect(history).toHaveLength(1);
    expect(history[0]?.source).toBe('buybox');
  });
});

describe('saveDetail', () => {
  const detailVariants = [
    {
      name: 'color_name',
      title: 'Color',
      options: [
        { asin: 'B0DETAIL01', label: 'Black', priceText: null, priceNum: null, currency: null, unavailable: false },
        { asin: 'B0DETAIL02', label: 'White', priceText: null, priceNum: null, currency: null, unavailable: false },
      ],
    },
  ];

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
    variants: detailVariants,
  };

  it('persists the detail with Buy Box fields and a snapshot', () => {
    store.saveDetail(detail);
    const rows = db
      .prepare('SELECT seller_name, is_prime, in_stock, variants FROM listings WHERE asin = ?')
      .get('B0DETAIL01') as { seller_name: string; is_prime: number; in_stock: number; variants: string };
    expect(rows.seller_name).toBe('Amazon.com');
    expect(rows.is_prime).toBe(1);
    expect(rows.in_stock).toBe(1);
    expect(rows.variants).toBe(JSON.stringify(detailVariants));
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

describe('detail field preservation', () => {
  const colorVariants: ProductDetail['variants'] = [
    {
      name: 'color_name',
      title: 'Color',
      options: [
        { asin: 'B0VAR00001', label: 'Black', priceText: null, priceNum: null, currency: null, unavailable: false },
        { asin: 'B0VAR00002', label: 'White', priceText: null, priceNum: null, currency: null, unavailable: false },
      ],
    },
  ];

  interface DetailRow {
    variants: string | null;
    seller_name: string | null;
    shipping_text: string | null;
    review_count: number | null;
    has_buy_box: number;
    is_prime: number;
    in_stock: number;
    price_num: number | null;
  }

  const readRow = (asin: string): DetailRow => {
    const row = db
      .prepare(
        `SELECT variants, seller_name, shipping_text, review_count,
                has_buy_box, is_prime, in_stock, price_num
         FROM listings WHERE asin = ?`
      )
      .get(asin) as DetailRow | undefined;
    if (!row) throw new Error(`listing ${asin} not found`);
    return row;
  };

  const detailWith = (asin: string, variants: ProductDetail['variants']): ProductDetail => ({
    marketplace: 'com',
    asin,
    href: `https://www.amazon.com/dp/${asin}`,
    title: 'Variant Item',
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
    variants,
  });

  it('keeps variants when a later search scrape carries none', () => {
    store.saveDetail(detailWith('B0VAR00001', colorVariants));
    expect(readRow('B0VAR00001').variants).toBe(JSON.stringify(colorVariants));

    // 搜索路径不携带变体；重跑 collect 时不能抹掉已观测到的变体结构
    store.saveScrapeResult('com', [listing('B0VAR00001', '$88.00', 88)]);
    expect(readRow('B0VAR00001').variants).toBe(JSON.stringify(colorVariants));
  });

  it('keeps variants when a later detail scrape observes none', () => {
    store.saveDetail(detailWith('B0VAR00002', colorVariants));
    // 详情返回空数组表示"本次未观测到变体"，不是"确认无变体"：parser 无法区分空页面与选择器未命中
    store.saveDetail(detailWith('B0VAR00002', []));
    expect(readRow('B0VAR00002').variants).toBe(JSON.stringify(colorVariants));
  });

  it('overwrites variants when a later detail scrape observes a new set', () => {
    store.saveDetail(detailWith('B0VAR00003', colorVariants));
    const sizeVariants: ProductDetail['variants'] = [
      {
        name: 'size_name',
        title: 'Size',
        options: [
          { asin: 'B0VAR00003', label: '13-inch', priceText: null, priceNum: null, currency: null, unavailable: false },
        ],
      },
    ];
    store.saveDetail(detailWith('B0VAR00003', sizeVariants));
    expect(readRow('B0VAR00003').variants).toBe(JSON.stringify(sizeVariants));
  });

  it('search re-scrape preserves every detail-only field', () => {
    store.saveDetail(detailWith('B0VAR00004', colorVariants));

    // 重跑 collect 的搜索阶段：只带搜索结果字段
    store.saveScrapeResult('com', [listing('B0VAR00004', '$99.00', 99)]);

    const row = readRow('B0VAR00004');
    // 详情专属字段全部保留（含 NOT NULL 的布尔列，它们写 0 与"观测到 false"不可区分）
    expect(row.variants).toBe(JSON.stringify(colorVariants));
    expect(row.seller_name).toBe('Amazon.com');
    expect(row.shipping_text).toBe('FREE delivery');
    expect(row.review_count).toBe(99);
    expect(row.has_buy_box).toBe(1);
    expect(row.is_prime).toBe(1);
    expect(row.in_stock).toBe(1);
    // 但搜索能观测到的字段仍须更新
    expect(row.price_num).toBe(99);
  });

  it('detail re-scrape keeps previously observed optional fields when absent', () => {
    store.saveDetail(detailWith('B0VAR00005', colorVariants));

    // 详情页未展示卖家/配送/评论数（parser 写 null），不应清掉上一次的观测值
    store.saveDetail({
      ...detailWith('B0VAR00005', colorVariants),
      reviewCount: null,
      buyBox: {
        hasBuyBox: false,
        priceText: '无价格',
        priceNum: null,
        sellerName: '',
        shippingText: '',
        isPrime: false,
        inStock: false,
      },
    });

    const row = readRow('B0VAR00005');
    expect(row.seller_name).toBe('Amazon.com');
    expect(row.shipping_text).toBe('FREE delivery');
    expect(row.review_count).toBe(99);
    // 这三个是详情路径的真实观测（false 也是观测），照常覆盖
    expect(row.has_buy_box).toBe(0);
    expect(row.is_prime).toBe(0);
    expect(row.in_stock).toBe(0);
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
