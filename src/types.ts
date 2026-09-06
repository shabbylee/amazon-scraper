/**
 * 领域类型：定义见 CONTEXT.md。
 * 修改此文件前先读 CONTEXT.md，术语不要漂移。
 */

export type MarketplaceId = 'com';

export interface Marketplace {
  readonly id: MarketplaceId;
  readonly host: string;
  readonly currency: string;
  readonly locale: string;
}

/**
 * Marketplace 注册表：Phase 2 会扩展 .co.jp / .de / .cn / .co.uk 等。
 * 新增站点走"加一条记录 + 加一组 Parser"两步，不改核心。
 */
export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  com: {
    id: 'com',
    host: 'www.amazon.com',
    currency: 'USD',
    locale: 'en-US',
  },
};

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return typeof value === 'string' && value in MARKETPLACES;
}

/** Listing = 搜索结果里的一行商品，绑定 Marketplace + ASIN。 */
export interface Listing {
  readonly marketplace: MarketplaceId;
  readonly asin: string;
  readonly title: string;
  readonly href: string;
  readonly image: string | null;
  readonly priceText: string;
  readonly hasPrice: boolean;
  readonly priceNum: number | null;
  readonly rating: number | null;
}

/** 失败分类：决定重试策略。见 AGENTS.md 抓取伦理。 */
export type FailureClass = 'network' | 'timeout' | 'captcha' | 'parser-miss' | 'unknown';

export type JobTrigger = 'manual' | 'watch';

export interface ScrapeJob {
  readonly keyword: string;
  readonly marketplace: MarketplaceId;
  readonly pages: number;
  readonly trigger: JobTrigger;
}

export interface AttemptSummary {
  readonly page: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly listingCount: number;
  readonly failure?: FailureClass;
  readonly message?: string;
  /** Phase 2：这次 Attempt 内部重试了几次（0 = 一次就成功或一次就不可重试）。 */
  readonly retryCount?: number;
  /** Phase 2：每次重试前的退避毫秒数，长度 = retryCount。 */
  readonly retryDelaysMs?: readonly number[];
}

export interface ScrapeResult {
  readonly job: ScrapeJob;
  readonly listings: readonly Listing[];
  readonly attempts: readonly AttemptSummary[];
}
