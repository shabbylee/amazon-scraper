import type { Database } from 'better-sqlite3';
import type { Listing, MarketplaceId, ProductDetail } from '../types.js';

/**
 * Persistence 接口（ADR-0006）：业务层只依赖这个接口，SQLite 是当前实现。
 * 将来换 Postgres 只换实现，不换业务代码。
 */

export interface PricePoint {
  readonly capturedAt: string;
  readonly priceText: string | null;
  readonly priceNum: number | null;
  readonly currency: string | null;
}

export interface WatchRecord {
  readonly id: number;
  readonly keyword: string;
  readonly marketplace: MarketplaceId;
  readonly intervalMinutes: number;
  readonly lastRunAt: string | null;
  readonly createdAt: string;
}

export interface PriceAlertRecord {
  readonly id: number;
  readonly watchId: number;
  readonly keyword: string;
  readonly marketplace: MarketplaceId;
  readonly asin: string;
  readonly fromPrice: number | null;
  readonly toPrice: number | null;
  readonly deltaPct: number;
  readonly createdAt: string;
}

export type ListingSort = 'price-asc' | 'price-desc' | 'rating' | 'updated';

export interface Persistence {
  /** upsert listings + 追加 price_snapshots；返回本次写入的 snapshot 数。 */
  saveScrapeResult(marketplace: MarketplaceId, listings: readonly Listing[]): number;
  saveDetail(detail: ProductDetail): void;
  getHistory(marketplace: MarketplaceId, asin: string, days: number): readonly PricePoint[];
  /** 最近 N 条价格快照（时间升序），用于 Watch 触发后的价格对比（ADR-0007）。 */
  getRecentSnapshots(marketplace: MarketplaceId, asin: string, limit: number): readonly PricePoint[];
  /** 记录一条 Price Alert；返回 id。 */
  insertAlert(alert: Omit<PriceAlertRecord, 'id' | 'createdAt'>): number;
  searchListings(opts: {
    keyword?: string;
    marketplace?: MarketplaceId;
    sort: ListingSort;
    limit: number;
  }): readonly Listing[];
  listWatches(): readonly WatchRecord[];
  createWatch(input: {
    keyword: string;
    marketplace: MarketplaceId;
    intervalMinutes: number;
  }): WatchRecord;
  deleteWatch(id: number): boolean;
  getDueWatches(now: Date): readonly WatchRecord[];
  markWatchRun(id: number, at: Date): void;
  close(): void;
}

/** 从价格文本提取币种；提取不到回退 Marketplace 默认币种。 */
export function extractCurrency(priceText: string, marketplace: MarketplaceId): string {
  const t = priceText.toUpperCase();
  for (const code of ['CNY', 'JPY', 'EUR', 'GBP', 'USD', 'AUD', 'CAD']) {
    if (t.includes(code)) return code;
  }
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('$')) return 'USD';
  if (t.includes('¥')) return marketplace === 'cojp' ? 'JPY' : 'CNY';
  const defaults: Record<MarketplaceId, string> = {
    com: 'USD',
    cojp: 'JPY',
    de: 'EUR',
    cn: 'CNY',
    couk: 'GBP',
  };
  return defaults[marketplace];
}

interface ListingRow {
  marketplace: string;
  asin: string;
  title: string;
  href: string;
  image: string | null;
  rating: number | null;
  price_text: string | null;
  price_num: number | null;
  currency: string | null;
}

const toListing = (r: ListingRow): Listing => ({
  marketplace: r.marketplace as MarketplaceId,
  asin: r.asin,
  title: r.title,
  href: r.href,
  image: r.image,
  rating: r.rating,
  priceText: r.price_text ?? '无价格',
  hasPrice: r.price_num !== null,
  priceNum: r.price_num,
});

export class SqlitePersistence implements Persistence {
  private readonly db: Database;
  private readonly upsertListing;
  private readonly insertSnapshot;
  private readonly insertWatch;

  constructor(db: Database) {
    this.db = db;
    this.upsertListing = this.db.prepare(`
    INSERT INTO listings (marketplace, asin, title, href, image, rating, review_count,
      price_text, price_num, currency, has_buy_box, seller_name, shipping_text,
      is_prime, in_stock, variants, updated_at)
    VALUES (@marketplace, @asin, @title, @href, @image, @rating, @reviewCount,
      @priceText, @priceNum, @currency, @hasBuyBox, @sellerName, @shippingText,
      @isPrime, @inStock, @variants, @updatedAt)
    ON CONFLICT(marketplace, asin) DO UPDATE SET
      title = excluded.title, href = excluded.href, image = excluded.image,
      rating = excluded.rating, review_count = excluded.review_count,
      price_text = excluded.price_text, price_num = excluded.price_num,
      currency = excluded.currency, has_buy_box = excluded.has_buy_box,
      seller_name = excluded.seller_name, shipping_text = excluded.shipping_text,
      is_prime = excluded.is_prime, in_stock = excluded.in_stock,
      variants = excluded.variants, updated_at = excluded.updated_at
  `);
    this.insertSnapshot = this.db.prepare(`
    INSERT INTO price_snapshots (marketplace, asin, price_text, price_num, currency, captured_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
    this.insertWatch = this.db.prepare(`
    INSERT INTO watches (keyword, marketplace, interval_minutes, last_run_at, created_at)
    VALUES (?, ?, ?, NULL, ?)
  `);
  }

  saveScrapeResult(marketplace: MarketplaceId, listings: readonly Listing[]): number {
    if (listings.length === 0) return 0;
    const now = new Date().toISOString();
    const write = this.db.transaction((items: readonly Listing[]) => {
      let saved = 0;
      for (const l of items) {
        const currency = l.priceNum !== null ? extractCurrency(l.priceText, marketplace) : null;
        this.upsertListing.run({
          marketplace,
          asin: l.asin,
          title: l.title,
          href: l.href,
          image: l.image,
          rating: l.rating,
          reviewCount: null,
          priceText: l.hasPrice ? l.priceText : null,
          priceNum: l.priceNum,
          currency,
          hasBuyBox: 0,
          sellerName: null,
          shippingText: null,
          isPrime: 0,
          inStock: 0,
          variants: null,
          updatedAt: now,
        });
        this.insertSnapshot.run(marketplace, l.asin, l.hasPrice ? l.priceText : null, l.priceNum, currency, now);
        saved += 1;
      }
      return saved;
    });
    return write(listings);
  }

  saveDetail(detail: ProductDetail): void {
    const now = new Date().toISOString();
    const b = detail.buyBox;
    this.db.transaction(() => {
      this.upsertListing.run({
        marketplace: detail.marketplace,
        asin: detail.asin,
        title: detail.title,
        href: detail.href,
        image: detail.image,
        rating: detail.rating,
        reviewCount: detail.reviewCount,
        priceText: b.hasBuyBox ? b.priceText : null,
        priceNum: b.priceNum,
        currency: b.priceNum !== null ? extractCurrency(b.priceText, detail.marketplace) : null,
        hasBuyBox: b.hasBuyBox ? 1 : 0,
        sellerName: b.sellerName || null,
        shippingText: b.shippingText || null,
        isPrime: b.isPrime ? 1 : 0,
        inStock: b.inStock ? 1 : 0,
        variants: detail.variants.length > 0 ? JSON.stringify(detail.variants) : null,
        updatedAt: now,
      });
      this.insertSnapshot.run(
        detail.marketplace,
        detail.asin,
        b.hasBuyBox ? b.priceText : null,
        b.priceNum,
        b.priceNum !== null ? extractCurrency(b.priceText, detail.marketplace) : null,
        now
      );
    })();
  }

  getHistory(marketplace: MarketplaceId, asin: string, days: number): readonly PricePoint[] {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare(
        `SELECT captured_at AS capturedAt, price_text AS priceText, price_num AS priceNum, currency
         FROM price_snapshots
         WHERE marketplace = ? AND asin = ? AND captured_at >= ?
         ORDER BY captured_at ASC`
      )
      .all(marketplace, asin, since) as Array<{
      capturedAt: string;
      priceText: string | null;
      priceNum: number | null;
      currency: string | null;
    }>;
    return rows;
  }

  getRecentSnapshots(marketplace: MarketplaceId, asin: string, limit: number): readonly PricePoint[] {
    const rows = this.db
      .prepare(
        `SELECT captured_at AS capturedAt, price_text AS priceText, price_num AS priceNum, currency
         FROM price_snapshots
         WHERE marketplace = ? AND asin = ?
         ORDER BY captured_at DESC
         LIMIT ?`
      )
      .all(marketplace, asin, limit) as Array<{
      capturedAt: string;
      priceText: string | null;
      priceNum: number | null;
      currency: string | null;
    }>;
    return rows.reverse();
  }

  insertAlert(alert: Omit<PriceAlertRecord, 'id' | 'createdAt'>): number {
    const info = this.db
      .prepare(
        `INSERT INTO price_alerts (watch_id, keyword, marketplace, asin, from_price, to_price, delta_pct, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        alert.watchId,
        alert.keyword,
        alert.marketplace,
        alert.asin,
        alert.fromPrice,
        alert.toPrice,
        alert.deltaPct,
        new Date().toISOString()
      );
    return Number(info.lastInsertRowid);
  }

  searchListings(opts: {
    keyword?: string;
    marketplace?: MarketplaceId;
    sort: ListingSort;
    limit: number;
  }): readonly Listing[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.marketplace) {
      where.push('marketplace = ?');
      params.push(opts.marketplace);
    }
    if (opts.keyword) {
      where.push('title LIKE ?');
      params.push(`%${opts.keyword}%`);
    }
    const orderBy =
      opts.sort === 'price-asc' ? 'price_num ASC'
      : opts.sort === 'price-desc' ? 'price_num DESC'
      : opts.sort === 'rating' ? 'rating DESC'
      : 'updated_at DESC';
    const sql = `SELECT marketplace, asin, title, href, image, rating,
        price_text, price_num, currency
      FROM listings
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, opts.limit) as ListingRow[];
    return rows.map(toListing);
  }

  listWatches(): readonly WatchRecord[] {
    const rows = this.db
      .prepare(`SELECT id, keyword, marketplace, interval_minutes AS intervalMinutes,
        last_run_at AS lastRunAt, created_at AS createdAt
        FROM watches ORDER BY created_at DESC`)
      .all() as WatchRecord[];
    return rows;
  }

  createWatch(input: {
    keyword: string;
    marketplace: MarketplaceId;
    intervalMinutes: number;
  }): WatchRecord {
    const createdAt = new Date().toISOString();
    const info = this.insertWatch.run(input.keyword, input.marketplace, input.intervalMinutes, createdAt);
    return {
      id: Number(info.lastInsertRowid),
      keyword: input.keyword,
      marketplace: input.marketplace,
      intervalMinutes: input.intervalMinutes,
      lastRunAt: null,
      createdAt,
    };
  }

  deleteWatch(id: number): boolean {
    return this.db.prepare('DELETE FROM watches WHERE id = ?').run(id).changes > 0;
  }

  getDueWatches(now: Date): readonly WatchRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, keyword, marketplace, interval_minutes AS intervalMinutes,
          last_run_at AS lastRunAt, created_at AS createdAt
         FROM watches ORDER BY id ASC`
      )
      .all() as WatchRecord[];
    return rows.filter((w) => {
      if (!w.lastRunAt) return true;
      const dueAt = new Date(new Date(w.lastRunAt).getTime() + w.intervalMinutes * 60_000);
      return now.getTime() >= dueAt.getTime();
    });
  }

  markWatchRun(id: number, at: Date): void {
    this.db.prepare('UPDATE watches SET last_run_at = ? WHERE id = ?').run(at.toISOString(), id);
  }

  close(): void {
    this.db.close();
  }
}
