import { MARKETPLACES, type Listing, type MarketplaceId } from '../types.js';

/**
 * Parser 层：把 Marketplace 页面 DOM 转成 Listing 领域对象。
 * 严格约束（见 AGENTS.md）：Parser 只做纯转换，不启动浏览器、不做 IO、不重试。
 */

/** 浏览器上下文中提取出的原始 JSON-safe 结构，字段类型未经校验。 */
export interface RawSearchItem {
  readonly asin?: unknown;
  readonly title?: unknown;
  readonly priceText?: unknown;
  readonly hasPrice?: unknown;
  readonly priceNum?: unknown;
  readonly image?: unknown;
  readonly rating?: unknown;
}

/**
 * 在浏览器上下文中执行。不能引用外部作用域（Puppeteer 会序列化函数源码到页面执行）。
 * 返回原始 JSON-safe 数据，类型化在 Node 侧的 toListings 完成。
 */
export function extractSearchResultsInPage(): unknown[] {
  interface BrowserItem {
    asin: string;
    title: string;
    priceText: string;
    hasPrice: boolean;
    priceNum: number | null;
    image: string | null;
    rating: number | null;
  }
  const items: BrowserItem[] = [];

  const parsePrice = (text: string): number | null => {
    if (!text) return null;
    const s = text.replace(/[,\s]/g, '');
    const m = s.match(/[\d.]+/);
    if (!m) return null;
    const n = Number.parseFloat(m[0]);
    return Number.isNaN(n) ? null : n;
  };

  const cards = document.querySelectorAll('[data-component-type="s-search-result"]');
  cards.forEach((card) => {
    const asin = card.getAttribute('data-asin');
    if (!asin) return;

    const titleEl = card.querySelector('h2 a span, h2 span');
    const title = titleEl ? (titleEl.textContent ?? '').trim() : '';

    let priceRaw = '';
    const offscreen = card.querySelector('.a-price .a-offscreen');
    if (offscreen) {
      priceRaw = (offscreen.textContent ?? '').trim();
    } else {
      const whole = card.querySelector('.a-price-whole');
      const frac = card.querySelector('.a-price-fraction');
      if (whole) {
        priceRaw = (whole.textContent ?? '').trim();
        if (frac) priceRaw += (frac.textContent ?? '').trim();
      }
    }

    const hasPrice = Boolean(priceRaw) && !priceRaw.includes('—');
    const imgEl = card.querySelector('.s-image');
    const image = imgEl ? imgEl.getAttribute('src') : null;

    const ratingEl = card.querySelector('.a-icon-alt');
    let rating: number | null = null;
    if (ratingEl) {
      const m = (ratingEl.textContent ?? '').match(/([0-9.]+)/);
      if (m && m[1]) rating = Number.parseFloat(m[1]);
    }

    items.push({
      asin,
      title,
      priceText: hasPrice ? priceRaw.replace(/\s+/g, ' ') : '没有标记价格或即将推出',
      hasPrice,
      priceNum: hasPrice ? parsePrice(priceRaw) : null,
      image,
      rating,
    });
  });
  return items;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNullableNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const asNullableString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** Node 侧：把浏览器返回的 unknown[] 校验并转成 Listing[]。 */
export function toListings(
  raw: readonly unknown[],
  marketplace: MarketplaceId
): Listing[] {
  const host = MARKETPLACES[marketplace].host;
  const out: Listing[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as RawSearchItem;
    const asin = asString(r.asin);
    if (!asin) continue;
    const hasPrice = r.hasPrice === true;
    out.push({
      marketplace,
      asin,
      title: asString(r.title),
      href: `https://${host}/dp/${asin}`,
      image: asNullableString(r.image),
      priceText: asString(r.priceText),
      hasPrice,
      priceNum: hasPrice ? asNullableNumber(r.priceNum) : null,
      rating: asNullableNumber(r.rating),
    });
  }
  return out;
}
