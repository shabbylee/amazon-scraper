import { Router } from 'express';
import { getPriceChangesForAsin, getPriceHistory } from '../db/store.js';
import { isMarketplaceId, type MarketplaceId } from '../types.js';

/**
 * /api/history — 价格历史查询（前端 Chart.js 折线图数据源）。
 */

export function historyRouter(defaultMarketplace: MarketplaceId): Router {
  const router = Router();

  // GET /api/history/:asin?marketplace=com&limit=200
  router.get('/:asin', (req, res) => {
    const asin = (req.params.asin ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      res.status(400).json({ error: 'asin must be 10 alphanumeric characters' });
      return;
    }
    const marketplace: MarketplaceId = isMarketplaceId(req.query.marketplace)
      ? req.query.marketplace
      : defaultMarketplace;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? 200), 10) || 200, 1), 1000);

    const snapshots = getPriceHistory(marketplace, asin, limit);
    const changes = getPriceChangesForAsin(marketplace, asin, 50);
    res.json({ asin, marketplace, snapshots, changes });
  });

  return router;
}
