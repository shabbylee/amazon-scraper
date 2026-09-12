import type { RequestHandler } from 'express';
import type { Persistence } from '../db/persistence.js';
import { isMarketplaceId, type MarketplaceId } from '../types.js';

/**
 * GET /api/history?asin=&marketplace=&days=
 * 返回某 ASIN 的价格历史点（price_snapshots 只追加，ADR-0006）。
 */
export function historyHandler(store: Persistence): RequestHandler {
  return (req, res) => {
    const asin = typeof req.query.asin === 'string' ? req.query.asin.trim().toUpperCase() : '';
    if (!asin) {
      res.status(400).json({ error: 'asin required' });
      return;
    }
    const marketplace: MarketplaceId = isMarketplaceId(req.query.marketplace)
      ? req.query.marketplace
      : 'com';
    const daysRaw = Number.parseInt(String(req.query.days ?? 30), 10);
    const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 365) : 30;

    const points = store.getHistory(marketplace, asin, days);
    res.json({ asin, marketplace, days, points });
  };
}
