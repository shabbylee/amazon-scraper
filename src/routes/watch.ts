import type { RequestHandler } from 'express';
import type { Persistence } from '../db/persistence.js';
import { isMarketplaceId, type MarketplaceId } from '../types.js';

/** Watch 最小间隔：30 分钟（AGENTS.md 抓取伦理：匿名、限速，不做高频轮询）。 */
export const MIN_WATCH_INTERVAL_MINUTES = 30;
/** Watch 最大间隔：7 天。 */
export const MAX_WATCH_INTERVAL_MINUTES = 7 * 24 * 60;

interface WatchRequestBody {
  keyword?: unknown;
  marketplace?: unknown;
  intervalMinutes?: unknown;
}

function clampInterval(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? 60), 10);
  if (!Number.isFinite(n)) return 60;
  return Math.min(Math.max(n, MIN_WATCH_INTERVAL_MINUTES), MAX_WATCH_INTERVAL_MINUTES);
}

/**
 * Watch CRUD（ADR-0006）：
 * - POST /api/watch { keyword, marketplace, intervalMinutes } → 创建
 * - GET  /api/watch → 列表
 * - DELETE /api/watch/:id → 删除
 * 实际调度由进程内 scheduler 负责（src/scheduler.ts）。
 */
export function watchCreateHandler(store: Persistence): RequestHandler {
  return (req, res) => {
    const body = (req.body ?? {}) as WatchRequestBody;
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if (!keyword) {
      res.status(400).json({ error: 'keyword required' });
      return;
    }
    const marketplace: MarketplaceId = isMarketplaceId(body.marketplace)
      ? body.marketplace
      : 'com';
    const watch = store.createWatch({
      keyword,
      marketplace,
      intervalMinutes: clampInterval(body.intervalMinutes),
    });
    res.status(201).json({ watch });
  };
}

export function watchListHandler(store: Persistence): RequestHandler {
  return (_req, res) => {
    res.json({ watches: store.listWatches() });
  };
}

export function watchDeleteHandler(store: Persistence): RequestHandler {
  return (req, res) => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const removed = store.deleteWatch(id);
    if (!removed) {
      res.status(404).json({ error: 'watch not found' });
      return;
    }
    res.json({ ok: true });
  };
}
