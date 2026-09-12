import { MARKETPLACES, type BuyBox, type MarketplaceId, type ProductDetail } from '../types.js';
import { parsePriceNum } from './search-page.js';

/**
 * Detail Parser（ADR-0005）：把商品详情页 DOM 转成 ProductDetail。
 * 约束与 Search Parser 一致：纯函数、无 IO；浏览器侧只提取原始字段，Node 侧做类型守卫。
 */

export interface RawDetail {
  readonly title?: unknown;
  readonly image?: unknown;
  readonly rating?: unknown;
  readonly reviewCount?: unknown;
  readonly priceText?: unknown;
  readonly hasBuyBox?: unknown;
  readonly sellerName?: unknown;
  readonly shippingText?: unknown;
  readonly isPrime?: unknown;
  readonly inStock?: unknown;
  readonly variants?: unknown;
}

/**
 * 在浏览器上下文中执行。不能引用外部作用域。
 * 选择器多级 fallback：Amazon 详情页改版时尽量兜住，提取失败留空而不是抛错。
 */
export function extractDetailInPage(): unknown {
  const text = (el: Element | null): string => (el?.textContent ?? '').trim();
  const src = (el: Element | null): string | null => {
    const v = el?.getAttribute('src');
    return v && v.length > 0 ? v : null;
  };

  const title = text(document.querySelector('#productTitle'));

  const image = src(document.querySelector('#landingImage')) ??
    src(document.querySelector('#imgTagWrapperId img'));

  const ratingEl = document.querySelector('#acrPopover .a-icon-alt') ??
    document.querySelector('[data-hook="rating-out-of-text"]');
  let rating: number | null = null;
  const ratingText = text(ratingEl);
  const rm = ratingText.match(/([0-9.]+)/);
  if (rm && rm[1]) rating = Number.parseFloat(rm[1]);

  const reviewText = text(document.querySelector('#acrCustomerReviewText'));
  let reviewCount: number | null = null;
  const cm = reviewText.match(/([\d,]+)/);
  if (cm && cm[1]) {
    const n = Number.parseInt(cm[1].replace(/,/g, ''), 10);
    if (Number.isFinite(n)) reviewCount = n;
  }

  // Buy Box 价格：多个已知选择器 fallback
  const priceEl =
    document.querySelector('#corePrice_feature_div .a-offscreen') ??
    document.querySelector('#corePriceDisplay_desktop_feature_div .a-offscreen') ??
    document.querySelector('#priceblock_ourprice') ??
    document.querySelector('#price_inside_buybox');
  const priceText = text(priceEl);

  const sellerName = text(
    document.querySelector('#sellerProfileTriggerId') ??
      document.querySelector('#merchantInfoFeature_feature_div .offer-display-feature-text')
  );

  const shippingText = text(
    document.querySelector('#deliveryBlockMessage') ??
      document.querySelector('#price-shipping-message')
  );

  const isPrime = Boolean(document.querySelector('.a-icon-prime'));

  const availabilityEl = document.querySelector('#availability .a-color-state') ??
    document.querySelector('#availability span');
  const availabilityText = text(availabilityEl).toLowerCase();
  const inStock =
    availabilityText.includes('in stock') ||
    availabilityText.includes('有货') ||
    availabilityText.includes('auf lager') ||
    availabilityText.includes('在庫あり') ||
    availabilityText.includes('在库');

  const hasBuyBox = Boolean(priceText);

  // 变体：当前选中项 + 可选值文本，去重去空（文本级，不做结构化）
  const variants: string[] = [];
  document.querySelectorAll('#variation .selection, #variation .twisterTextDiv').forEach((el) => {
    const t = text(el);
    if (t && !variants.includes(t)) variants.push(t);
  });

  return {
    title,
    image,
    rating,
    reviewCount,
    priceText,
    hasBuyBox,
    sellerName,
    shippingText,
    isPrime,
    inStock,
    variants,
  };
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNullableNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const asNullableString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** Node 侧：校验并把浏览器返回的 unknown 转成 ProductDetail；title 缺失视为未抓到详情页。 */
export function toDetail(raw: unknown, marketplace: MarketplaceId, asin: string): ProductDetail | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as RawDetail;
  const title = asString(r.title);
  if (!title) return null;

  const market = MARKETPLACES[marketplace];
  const hasBuyBox = r.hasBuyBox === true;
  const priceText = asString(r.priceText);
  const buyBox: BuyBox = {
    hasBuyBox,
    priceText: hasBuyBox ? priceText : '无 Buy Box（未开售或无货）',
    priceNum: hasBuyBox ? parsePriceNum(priceText, market) : null,
    sellerName: asString(r.sellerName),
    shippingText: asString(r.shippingText),
    isPrime: r.isPrime === true,
    inStock: r.inStock === true,
  };

  return {
    marketplace,
    asin,
    href: `https://${market.host}/dp/${asin}`,
    title,
    image: asNullableString(r.image),
    rating: asNullableNumber(r.rating),
    reviewCount: asNullableNumber(r.reviewCount),
    buyBox,
    variants: Array.isArray(r.variants) ? r.variants.filter((v) => typeof v === 'string') : [],
  };
}
