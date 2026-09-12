import type { Database } from 'better-sqlite3';

/**
 * SQLite Schema（ADR-0006）：listings（最新状态，upsert）+ price_snapshots（只追加）+ watches。
 * 迁移策略：user_version 递增，逐版本执行升级语句（当前只有 v1）。
 */

const MIGRATIONS: readonly string[] = [
  // v1
  `
  CREATE TABLE IF NOT EXISTS listings (
    marketplace  TEXT NOT NULL,
    asin         TEXT NOT NULL,
    title        TEXT NOT NULL,
    href         TEXT NOT NULL,
    image        TEXT,
    rating       REAL,
    review_count INTEGER,
    price_text   TEXT,
    price_num    REAL,
    currency     TEXT,
    has_buy_box  INTEGER NOT NULL DEFAULT 0,
    seller_name  TEXT,
    shipping_text TEXT,
    is_prime     INTEGER NOT NULL DEFAULT 0,
    in_stock     INTEGER NOT NULL DEFAULT 0,
    variants     TEXT,
    updated_at   TEXT NOT NULL,
    PRIMARY KEY (marketplace, asin)
  );

  CREATE TABLE IF NOT EXISTS price_snapshots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    marketplace  TEXT NOT NULL,
    asin         TEXT NOT NULL,
    price_text   TEXT,
    price_num    REAL,
    currency     TEXT,
    captured_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_lookup
    ON price_snapshots(marketplace, asin, captured_at);

  CREATE TABLE IF NOT EXISTS watches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword         TEXT NOT NULL,
    marketplace     TEXT NOT NULL,
    interval_minutes INTEGER NOT NULL,
    last_run_at     TEXT,
    created_at      TEXT NOT NULL
  );
  `,
];

export function initSchema(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
