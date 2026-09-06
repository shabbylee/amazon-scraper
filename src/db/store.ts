import { randomUUID } from 'node:crypto';
import type { Listing, MarketplaceId, ProductDetail } from '../types.js';
import { getDb } from './index.js';

/**
 * Phase 4 数据访问层。
 * 所有函数都是同步的（better-sqlite3 是同步 API）。
 */

// ─── Listings ────────────────────────────────────────────────────────────────

export function generateJobId(): string {
  return randomUUID();
}

export function insertListings(listings: readonly Listing[], keyword: string, jobId: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO listings (marketplace, asin, keyword, title, href, image, price_text, has_price, price_num, rating, job_id, captured_at)
    VALUES (@marketplace, @asin, @keyword, @title, @href, @image, @priceText, @hasPrice, @priceNum, @rating, @jobId, @capturedAt)
  `);
  const now = new Date().toISOString();
  const insertMany = db.transaction((items: readonly Listing[]) => {
    for (const item of items) {
      stmt.run({
        marketplace: item.marketplace,
        asin: item.asin,
        keyword,
        title: item.title,
        href: item.href,
        image: item.image,
        priceText: item.priceText,
        hasPrice: item.hasPrice ? 1 : 0,
        priceNum: item.priceNum,
        rating: item.rating,
        jobId,
        capturedAt: now,
      });
    }
  });
  insertMany(listings);
}

// ─── Price Snapshots ─────────────────────────────────────────────────────────

export function insertPriceSnapshots(listings: readonly Listing[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO price_snapshots (marketplace, asin, price_text, price_num, currency, captured_at)
    VALUES (@marketplace, @asin, @priceText, @priceNum, @currency, @capturedAt)
  `);
  const now = new Date().toISOString();
  const insertMany = db.transaction((items: readonly Listing[]) => {
    for (const item of items) {
      if (!item.hasPrice || item.priceNum === null) continue;
      const currencyMatch = item.priceText.match(/^[^\d]+/);
      stmt.run({
        marketplace: item.marketplace,
        asin: item.asin,
        priceText: item.priceText,
        priceNum: item.priceNum,
        currency: currencyMatch?.[0]?.trim() ?? null,
        capturedAt: now,
      });
    }
  });
  insertMany(listings);
}

export interface PriceSnapshotRow {
  readonly price_text: string | null;
  readonly price_num: number | null;
  readonly currency: string | null;
  readonly captured_at: string;
}

export function getPriceHistory(
  marketplace: MarketplaceId,
  asin: string,
  limit = 200
): PriceSnapshotRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT price_text, price_num, currency, captured_at
       FROM price_snapshots
       WHERE marketplace = ? AND asin = ?
       ORDER BY captured_at ASC
       LIMIT ?`
    )
    .all(marketplace, asin, limit) as PriceSnapshotRow[];
}

// ─── Product Details ─────────────────────────────────────────────────────────

export function upsertProductDetail(detail: ProductDetail): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO product_details (marketplace, asin, detail_json, captured_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(marketplace, asin) DO UPDATE SET detail_json = excluded.detail_json, captured_at = excluded.captured_at`
  ).run(detail.marketplace, detail.asin, JSON.stringify(detail), detail.capturedAt);
}

export function getProductDetail(
  marketplace: MarketplaceId,
  asin: string
): ProductDetail | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT detail_json FROM product_details WHERE marketplace = ? AND asin = ?`)
    .get(marketplace, asin) as { detail_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.detail_json) as ProductDetail;
  } catch {
    return null;
  }
}

// ─── Watches ─────────────────────────────────────────────────────────────────

export interface WatchRow {
  readonly id: number;
  readonly keyword: string;
  readonly marketplace: string;
  readonly pages: number;
  readonly cron_expr: string;
  readonly webhook_url: string | null;
  readonly notify_local: number;
  readonly active: number;
  readonly created_at: string;
  readonly last_run_at: string | null;
  readonly next_run_at: string | null;
}

export interface CreateWatchInput {
  readonly keyword: string;
  readonly marketplace?: MarketplaceId;
  readonly pages?: number;
  readonly cronExpr?: string;
  readonly webhookUrl?: string | null;
  readonly notifyLocal?: boolean;
}

export function createWatch(input: CreateWatchInput): WatchRow {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO watches (keyword, marketplace, pages, cron_expr, webhook_url, notify_local, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      input.keyword,
      input.marketplace ?? 'com',
      input.pages ?? 1,
      input.cronExpr ?? '0 9 * * 1',
      input.webhookUrl ?? null,
      input.notifyLocal !== false ? 1 : 0,
      now
    );
  return getWatchById(Number(result.lastInsertRowid))!;
}

export function getWatchById(id: number): WatchRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM watches WHERE id = ?`).get(id) as WatchRow) ?? null;
}

export function listWatches(activeOnly = false): WatchRow[] {
  const db = getDb();
  if (activeOnly) {
    return db.prepare(`SELECT * FROM watches WHERE active = 1 ORDER BY id DESC`).all() as WatchRow[];
  }
  return db.prepare(`SELECT * FROM watches ORDER BY id DESC`).all() as WatchRow[];
}

export function updateWatchLastRun(id: number, lastRunAt: string, nextRunAt: string | null): void {
  const db = getDb();
  db.prepare(`UPDATE watches SET last_run_at = ?, next_run_at = ? WHERE id = ?`).run(
    lastRunAt,
    nextRunAt,
    id
  );
}

export function deactivateWatch(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE watches SET active = 0 WHERE id = ?`).run(id);
}

export function deleteWatch(id: number): void {
  const db = getDb();
  db.prepare(`DELETE FROM watches WHERE id = ?`).run(id);
}

// ─── Watch Runs ──────────────────────────────────────────────────────────────

export interface WatchRunRow {
  readonly id: number;
  readonly watch_id: number;
  readonly job_id: string;
  readonly started_at: string;
  readonly finished_at: string | null;
  readonly status: string;
  readonly listings_found: number;
  readonly price_changes: number;
  readonly error_message: string | null;
}

export function startWatchRun(watchId: number, jobId: string): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO watch_runs (watch_id, job_id, started_at, status) VALUES (?, ?, ?, 'running')`
    )
    .run(watchId, jobId, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function finishWatchRun(
  runId: number,
  status: 'ok' | 'failed',
  listingsFound: number,
  priceChanges: number,
  errorMessage?: string
): void {
  const db = getDb();
  db.prepare(
    `UPDATE watch_runs SET finished_at = ?, status = ?, listings_found = ?, price_changes = ?, error_message = ? WHERE id = ?`
  ).run(new Date().toISOString(), status, listingsFound, priceChanges, errorMessage ?? null, runId);
}

export function getRecentWatchRuns(watchId: number, limit = 20): WatchRunRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM watch_runs WHERE watch_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(watchId, limit) as WatchRunRow[];
}

// ─── Price Changes ───────────────────────────────────────────────────────────

export interface PriceChangeRow {
  readonly id: number;
  readonly watch_run_id: number;
  readonly marketplace: string;
  readonly asin: string;
  readonly title: string;
  readonly old_price_num: number | null;
  readonly new_price_num: number | null;
  readonly old_price_text: string | null;
  readonly new_price_text: string | null;
  readonly change_pct: number | null;
  readonly detected_at: string;
}

export interface PriceChangeInput {
  readonly watchRunId: number;
  readonly marketplace: MarketplaceId;
  readonly asin: string;
  readonly title: string;
  readonly oldPriceNum: number | null;
  readonly newPriceNum: number | null;
  readonly oldPriceText: string | null;
  readonly newText: string | null;
}

export function insertPriceChanges(changes: readonly PriceChangeInput[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO price_changes (watch_run_id, marketplace, asin, title, old_price_num, new_price_num, old_price_text, new_price_text, change_pct, detected_at)
    VALUES (@watchRunId, @marketplace, @asin, @title, @oldPriceNum, @newPriceNum, @oldPriceText, @newPriceText, @changePct, @detectedAt)
  `);
  const now = new Date().toISOString();
  const insertMany = db.transaction((items: readonly PriceChangeInput[]) => {
    for (const c of items) {
      const changePct =
        c.oldPriceNum && c.oldPriceNum > 0 && c.newPriceNum !== null
          ? Math.round(((c.newPriceNum - c.oldPriceNum) / c.oldPriceNum) * 10000) / 100
          : null;
      stmt.run({
        watchRunId: c.watchRunId,
        marketplace: c.marketplace,
        asin: c.asin,
        title: c.title,
        oldPriceNum: c.oldPriceNum,
        newPriceNum: c.newPriceNum,
        oldPriceText: c.oldPriceText,
        newPriceText: c.newText,
        changePct,
        detectedAt: now,
      });
    }
  });
  insertMany(changes);
}

/** 获取最近 N 条未读价格变化（前端 badge 用）。 */
export function getRecentPriceChanges(limit = 50): PriceChangeRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT pc.* FROM price_changes pc
       JOIN watch_runs wr ON wr.id = pc.watch_run_id
       ORDER BY pc.detected_at DESC
       LIMIT ?`
    )
    .all(limit) as PriceChangeRow[];
}

/** 获取某个 ASIN 的价格变化历史。 */
export function getPriceChangesForAsin(
  marketplace: MarketplaceId,
  asin: string,
  limit = 50
): PriceChangeRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM price_changes WHERE marketplace = ? AND asin = ? ORDER BY detected_at DESC LIMIT ?`
    )
    .all(marketplace, asin, limit) as PriceChangeRow[];
}
