import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from './schema.js';

export type DB = Database.Database;

let db: DB | null = null;

/**
 * 打开（或创建）SQLite 数据库并执行 schema migration。
 * 幂等：多次调用只打开一次。
 */
export function openDatabase(dbPath: string): DB {
  if (db) return db;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/** 获取当前数据库实例；未打开时抛错。 */
export function getDb(): DB {
  if (!db) throw new Error('Database not opened. Call openDatabase() first.');
  return db;
}

/** 关闭数据库连接（graceful shutdown 时调用）。 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
