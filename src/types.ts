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

/** Phase 3：Buy Box 库存状态。unknown 表示 DOM 里识别不出明确文案。 */
export type Availability =
  | 'in-stock'
  | 'out-of-stock'
  | 'pre-order'
  | 'backorder'
  | 'unavailable'
  | 'unknown';

/** Phase 3：详情页 Buy Box（"加入购物车"归属的卖家 Offer）。见 CONTEXT.md。 */
export interface BuyBox {
  readonly priceText: string | null;
  readonly priceNum: number | null;
  readonly currency: string | null;
  readonly shippingText: string | null;
  readonly sellerName: string | null;
  readonly isPrime: boolean;
  readonly availability: Availability;
}

/** Phase 3：评论统计。breakdown 里每项是 0-100 的百分比，抓不到为 null。 */
export interface ReviewStats {
  readonly totalCount: number | null;
  readonly averageRating: number | null;
  readonly breakdown: {
    readonly star5: number | null;
    readonly star4: number | null;
    readonly star3: number | null;
    readonly star2: number | null;
    readonly star1: number | null;
  };
}

/** Phase 3：商品变体（颜色 / 尺寸 / 容量 …）。dimensions 是维度名到值的映射。 */
export interface Variant {
  readonly asin: string;
  readonly label: string;
  readonly dimensions: Readonly<Record<string, string>>;
  readonly image: string | null;
  readonly isCurrent: boolean;
}

/** Phase 3：技术参数表的一行。 */
export interface ProductSpec {
  readonly key: string;
  readonly value: string;
}

/** Phase 3：详情页的完整领域对象。见 docs/adr/0004-phase3-product-detail.md。 */
export interface ProductDetail {
  readonly marketplace: MarketplaceId;
  readonly asin: string;
  readonly title: string;
  readonly brand: string | null;
  readonly href: string;
  readonly images: readonly string[];
  readonly breadcrumbs: readonly string[];
  readonly description: string | null;
  readonly bullets: readonly string[];
  readonly specs: readonly ProductSpec[];
  readonly buyBox: BuyBox;
  readonly reviews: ReviewStats;
  readonly variants: readonly Variant[];
  /** ISO 8601 抓取时间戳，Phase 4 会与 Price Snapshot 关联。 */
  readonly capturedAt: string;
}

/** ASIN 是 10 位字母数字（大写字母 + 数字），见 CONTEXT.md。 */
export function isAsin(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{10}$/.test(value);
}

/** Phase 3：一次详情页 Attempt 的摘要。没有 page/listingCount，改用 asin。 */
export interface DetailAttemptSummary {
  readonly asin: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly failure?: FailureClass;
  readonly message?: string;
  readonly retryCount?: number;
  readonly retryDelaysMs?: readonly number[];
}
