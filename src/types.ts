/**
 * 领域类型：定义见 CONTEXT.md。
 * 修改此文件前先读 CONTEXT.md，术语不要漂移。
 */

export type MarketplaceId = 'com' | 'cojp' | 'de' | 'cn' | 'couk';

export interface Marketplace {
  readonly id: MarketplaceId;
  readonly host: string;
  readonly currency: string;
  readonly locale: string;
  /** 价格文本里的小数分隔符（de 用逗号，其余用点）。见 ADR-0004。 */
  readonly priceDecimalSeparator: '.' | ',';
  readonly priceGroupSeparator: ',' | '.';
}

/**
 * Marketplace 注册表（ADR-0004）：新增站点 = 注册表加一条记录 + 必要时加一组 Parser 分支。
 * 数字解析收口在 Node 侧 parsePriceNum（parser/search-page.ts），浏览器侧只取原始文本。
 */
export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  com: {
    id: 'com',
    host: 'www.amazon.com',
    currency: 'USD',
    locale: 'en-US',
    priceDecimalSeparator: '.',
    priceGroupSeparator: ',',
  },
  cojp: {
    id: 'cojp',
    host: 'www.amazon.co.jp',
    currency: 'JPY',
    locale: 'ja-JP',
    priceDecimalSeparator: '.',
    priceGroupSeparator: ',',
  },
  de: {
    id: 'de',
    host: 'www.amazon.de',
    currency: 'EUR',
    locale: 'de-DE',
    priceDecimalSeparator: ',',
    priceGroupSeparator: '.',
  },
  cn: {
    id: 'cn',
    host: 'www.amazon.cn',
    currency: 'CNY',
    locale: 'zh-CN',
    priceDecimalSeparator: '.',
    priceGroupSeparator: ',',
  },
  couk: {
    id: 'couk',
    host: 'www.amazon.co.uk',
    currency: 'GBP',
    locale: 'en-GB',
    priceDecimalSeparator: '.',
    priceGroupSeparator: ',',
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
  /** 第几次物理 Attempt（1 起）。同一 page 可能因重试出现多条。 */
  readonly attempt: number;
  readonly page: number;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly listingCount: number;
  readonly failure?: FailureClass;
  readonly message?: string;
}

export interface ScrapeResult {
  readonly job: ScrapeJob;
  readonly listings: readonly Listing[];
  readonly attempts: readonly AttemptSummary[];
}
