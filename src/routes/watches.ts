import { Router, type RequestHandler } from 'express';
import type { AppConfig } from '../config.js';
import {
  createWatch,
  deleteWatch,
  deactivateWatch,
  getRecentPriceChanges,
  getRecentWatchRuns,
  getWatchById,
  listWatches,
} from '../db/store.js';
import type { Scheduler } from '../scheduler/index.js';
import { isMarketplaceId } from '../types.js';

/**
 * /api/watches — Watch CRUD + 价格变化查询。
 */

export function watchesRouter(config: AppConfig, scheduler: Scheduler): Router {
  const router = Router();

  // GET /api/watches — 列出所有 Watch
  router.get('/', (_req, res) => {
    const watches = listWatches();
    res.json({ watches, scheduledCount: scheduler.scheduledCount });
  });

  // POST /api/watches — 创建 Watch
  router.post('/', (req, res) => {
    const body = req.body ?? {};
    const keyword = typeof body.keyword === 'string' ? body.keyword.trim() : '';
    if (!keyword) {
      res.status(400).json({ error: 'keyword required' });
      return;
    }
    const marketplace = isMarketplaceId(body.marketplace) ? body.marketplace : config.defaultMarketplace;
    const pages = Math.min(Math.max(parseInt(String(body.pages ?? 1), 10) || 1, 1), 10);
    const cronExpr = typeof body.cronExpr === 'string' && body.cronExpr.trim() ? body.cronExpr.trim() : '0 9 * * 1';
    const webhookUrl = typeof body.webhookUrl === 'string' && body.webhookUrl.trim() ? body.webhookUrl.trim() : null;
    const notifyLocal = body.notifyLocal !== false;

    const watch = createWatch({ keyword, marketplace, pages, cronExpr, webhookUrl, notifyLocal });
    scheduler.scheduleWatch(watch);
    res.status(201).json({ watch });
  });

  // GET /api/watches/:id — 单个 Watch + 最近执行记录
  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const watch = getWatchById(id);
    if (!watch) { res.status(404).json({ error: 'watch not found' }); return; }
    const runs = getRecentWatchRuns(id, 10);
    res.json({ watch, runs });
  });

  // DELETE /api/watches/:id — 停用并删除
  router.delete('/:id', (req, res) => {
    const id = parseInt(req.params.id ?? '', 10);
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
    const watch = getWatchById(id);
    if (!watch) { res.status(404).json({ error: 'watch not found' }); return; }
    scheduler.unscheduleWatch(id);
    deactivateWatch(id);
    deleteWatch(id);
    res.json({ ok: true, deleted: id });
  });

  // GET /api/watches/changes/recent — 最近价格变化（前端 badge 轮询用）
  router.get('/changes/recent', (_req, res) => {
    const changes = getRecentPriceChanges(50);
    res.json({ changes });
  });

  return router;
}
