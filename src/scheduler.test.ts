import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';
import { initSchema } from './db/schema.js';
import { SqlitePersistence } from './db/persistence.js';
import { startWatchScheduler } from './scheduler.js';

describe('startWatchScheduler', () => {
  const config = loadConfig({ env: {}, envFilePath: '/nonexistent/.env' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs due watches through the injected executor and marks them', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    const w = store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });
    const runWatchOnce = vi.fn(async () => {});

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000, // 长 tick：只有启动补跑那轮
      runWatchOnce,
    });

    // 启动即补跑一轮：due watch 被执行且 last_run_at 被标记
    await vi.waitFor(() => expect(store.listWatches()[0]?.lastRunAt).not.toBeNull());
    expect(runWatchOnce).toHaveBeenCalledWith(w.id);

    // 同 tick 内不重复执行
    expect(runWatchOnce).toHaveBeenCalledTimes(1);
    stop();
    db.close();
  });

  it('catches executor failures without crashing the tick', async () => {
    const db = new Database(':memory:');
    initSchema(db);
    const store = new SqlitePersistence(db);
    store.createWatch({ keyword: 'laptop', marketplace: 'com', intervalMinutes: 30 });
    const runWatchOnce = vi.fn(async () => {
      throw new Error('boom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const stop = startWatchScheduler(config, store, {
      tickMs: 600_000,
      runWatchOnce,
    });

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    stop();
    db.close();
  });
});
