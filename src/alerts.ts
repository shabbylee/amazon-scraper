import type { Persistence, PriceAlertRecord, PricePoint, WatchRecord } from './db/persistence.js';
import type { Listing, MarketplaceId } from './types.js';

/**
 * Price Alert（ADR-0007）：Watch 触发后对比最近两次价格快照，
 * 变动幅度 ≥ 阈值则生成提醒并通过 Webhook 发送。
 */

export interface PriceAlertPayload {
  readonly event: 'price_change';
  readonly watch: {
    readonly id: number;
    readonly keyword: string;
    readonly marketplace: MarketplaceId;
  };
  readonly listing: {
    readonly asin: string;
    readonly title: string;
    readonly href: string;
  };
  readonly from: { readonly priceText: string; readonly priceNum: number };
  readonly to: { readonly priceText: string; readonly priceNum: number };
  readonly deltaPct: number;
  readonly capturedAt: string;
}

/** 生成提醒：对每个有价格且已有历史快照的 Listing 计算变动幅度。纯函数（store 只读）。 */
export function buildPriceAlerts(
  watch: WatchRecord,
  marketplace: MarketplaceId,
  listings: readonly Listing[],
  store: Pick<Persistence, 'getRecentSnapshots'>,
  thresholdPct: number
): readonly PriceAlertPayload[] {
  const alerts: PriceAlertPayload[] = [];
  for (const l of listings) {
    if (l.priceNum === null || !l.hasPrice) continue;
    const recent = store.getRecentSnapshots(marketplace, l.asin, 2);
    if (recent.length < 2) continue; // 本次是第一条快照，无从对比
    const to = recent[recent.length - 1]!;
    const from = recent[recent.length - 2]!;
    if (to.priceNum === null || from.priceNum === null || from.priceNum === 0) continue;

    const deltaPct = ((to.priceNum - from.priceNum) / from.priceNum) * 100;
    if (Math.abs(deltaPct) < thresholdPct) continue;

    alerts.push({
      event: 'price_change',
      watch: { id: watch.id, keyword: watch.keyword, marketplace },
      listing: { asin: l.asin, title: l.title, href: l.href },
      from: { priceText: from.priceText ?? String(from.priceNum), priceNum: from.priceNum },
      to: { priceText: to.priceText ?? String(to.priceNum), priceNum: to.priceNum },
      deltaPct: Number(deltaPct.toFixed(2)),
      capturedAt: to.capturedAt,
    });
  }
  return alerts;
}

export type DeliverAlert = (payload: PriceAlertPayload) => Promise<void>;

/** Webhook 发送：POST JSON，8 秒超时；失败抛错由调用方记录（不崩调度器）。 */
export function deliverAlert(webhookUrl: string): DeliverAlert {
  return async (payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`webhook responded ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

/** 落库一条 Alert（ADR-0007：可审计；发送失败不影响落库）。 */
export function persistAlert(
  store: Persistence,
  watch: WatchRecord,
  marketplace: MarketplaceId,
  payload: PriceAlertPayload
): number {
  return store.insertAlert({
    watchId: watch.id,
    keyword: watch.keyword,
    marketplace,
    asin: payload.listing.asin,
    fromPrice: payload.from.priceNum,
    toPrice: payload.to.priceNum,
    deltaPct: payload.deltaPct,
  });
}
