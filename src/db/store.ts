import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';
import { initSchema } from './schema.js';
import { SqlitePersistence, type Persistence } from './persistence.js';

/**
 * App 级装配：打开 SQLite 文件（或 :memory:）+ 建表 + 返回 Persistence。
 * 文件模式确保 data 目录存在；失败时抛错（配置问题，不静默降级）。
 */
export function createStore(config: AppConfig): Persistence {
  const file = config.dbPath;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return new SqlitePersistence(db);
}
