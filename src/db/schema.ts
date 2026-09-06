/**
 * Phase 4 数据库 schema。
 * 所有表用 CREATE TABLE IF NOT EXISTS，启动时幂等执行。
 * 见 docs/adr/0005-phase4-persistence-scheduler.md。
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 每次搜索 Job 的每个 Listing 快照
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL DEFAULT 'com',
  asin TEXT NOT NULL,
  keyword TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  href TEXT NOT NULL DEFAULT '',
  image TEXT,
  price_text TEXT,
  has_price INTEGER NOT NULL DEFAULT 0,
  price_num REAL,
  rating REAL,
  job_id TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_asin ON listings(marketplace, asin);
CREATE INDEX IF NOT EXISTS idx_listings_job ON listings(job_id);
CREATE INDEX IF NOT EXISTS idx_listings_keyword ON listings(keyword, captured_at);

-- 价格时间序列（只追加，不更新）
CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketplace TEXT NOT NULL DEFAULT 'com',
  asin TEXT NOT NULL,
  price_text TEXT,
  price_num REAL,
  currency TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_asin_time ON price_snapshots(marketplace, asin, captured_at);

-- Phase 3 详情 JSON 缓存（upsert by marketplace+asin）
CREATE TABLE IF NOT EXISTS product_details (
  marketplace TEXT NOT NULL DEFAULT 'com',
  asin TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (marketplace, asin)
);

-- 用户订阅
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'com',
  pages INTEGER NOT NULL DEFAULT 1,
  cron_expr TEXT NOT NULL DEFAULT '0 9 * * 1',
  webhook_url TEXT,
  notify_local INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_run_at TEXT,
  next_run_at TEXT
);

-- 每次 Watch 执行的记录
CREATE TABLE IF NOT EXISTS watch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  listings_found INTEGER NOT NULL DEFAULT 0,
  price_changes INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_watch_runs_watch ON watch_runs(watch_id, started_at);

-- 价格变化事件
CREATE TABLE IF NOT EXISTS price_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_run_id INTEGER NOT NULL REFERENCES watch_runs(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL DEFAULT 'com',
  asin TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  old_price_num REAL,
  new_price_num REAL,
  old_price_text TEXT,
  new_price_text TEXT,
  change_pct REAL,
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_changes_run ON price_changes(watch_run_id);
CREATE INDEX IF NOT EXISTS idx_price_changes_asin ON price_changes(marketplace, asin, detected_at);
`;
