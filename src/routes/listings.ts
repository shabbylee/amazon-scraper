import type { RequestHandler } from 'express';
import type { Persistence } from '../db/persistence.js';
import { isMarketplaceId, type MarketplaceId } from '../types.js';

/**
 * GET /api/listings?keyword=&marketplace=&sort=&limit=
 * 从本地库检索已保存的 Listing（ADR-0006），支持模糊搜索 + 价格/评分/更新时间排序。
 */
export function listingsHandler(store: Persistence): RequestHandler {
  return (req, res) => {
    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim() : undefined;
    const marketplace: MarketplaceId | undefined = isMarketplaceId(req.query.marketplace)
      ? req.query.marketplace
      : undefined;
    const sortRaw = String(req.query.sort ?? 'updated');
    const sort =
      sortRaw === 'price-asc' || sortRaw === 'price-desc' || sortRaw === 'rating'
        ? sortRaw
        : 'updated';
    const limitRaw = Number.parseInt(String(req.query.limit ?? 100), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const items = store.searchListings({ keyword, marketplace, sort, limit });
    res.json({ count: items.length, items });
  };
}
