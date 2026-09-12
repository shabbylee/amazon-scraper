import { MARKETPLACES, type Listing, type Marketplace, type MarketplaceId } from '../types.js';

/**
 * Parser 层：把 Marketplace 页面 DOM 转成 Listing 领域对象。
 * 严格约束（见 AGENTS.md）：Parser 只做纯转换，不启动浏览器、不做 IO、不重试。
 * 价格数字解析（parsePriceNum）按 Marketplace 的格式规则在 Node 侧完成（ADR-0004）。
 */

/** 浏览器上下文中提取出的原始 JSON-safe 结构，字段类型未经校验。 */
export interface RawSearchItem {
  readonly asin?: unknown;
  readonly title?: unknown;
  readonly priceText?: unknown;
  readonly hasPrice?: unknown;
  readonly image?: unknown;
  readonly rating?: unknown;
}

/**
 * 在浏览器上下文中执行。不能引用外部作用域（Puppeteer 会序列化函数源码到页面执行）。
 * 只提取原始价格文本与展示字段；数字解析交给 Node 侧 parsePriceNum。
 */
export function extractSearchResultsInPage(): unknown[] {
  interface BrowserItem {
    asin: string;
    title: string;
    priceText: string;
    hasPrice: boolean;
    image: string | null;
    rating: number | null;
  }
  const items: BrowserItem[] = [];

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

/**
 * 按 Marketplace 的格式规则把价格文本解析成数值（ADR-0004）。
 * - 点分隔（com/cojp/cn/couk）：去掉千分位逗号后取首个数值
 * - 逗号分隔（de）：去掉千分位点、把逗号当小数分隔符
 * 取文本中第一个完整数值；无法解析返回 null。
 */
export function parsePriceNum(text: string, marketplace: Marketplace): number | null {
  const t = text.trim();
  if (!t) return null;
  let s = t;
  if (marketplace.priceDecimalSeparator === ',') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const m = s.match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number.parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Node 侧：把浏览器返回的 unknown[] 校验并转成 Listing[]。 */
export function toListings(
  raw: readonly unknown[],
  marketplace: MarketplaceId
): Listing[] {
  const market = MARKETPLACES[marketplace];
  const out: Listing[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const r = entry as RawSearchItem;
    const asin = asString(r.asin);
    if (!asin) continue;
    const hasPrice = r.hasPrice === true;
    const priceText = asString(r.priceText);
    out.push({
      marketplace,
      asin,
      title: asString(r.title),
      href: `https://${market.host}/dp/${asin}`,
      image: asNullableString(r.image),
      priceText,
      hasPrice,
      priceNum: hasPrice ? parsePriceNum(priceText, market) : null,
      rating: asNullableNumber(r.rating),
    });
  }
  return out;
}
