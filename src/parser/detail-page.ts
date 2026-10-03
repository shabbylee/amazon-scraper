import {
  MARKETPLACES,
  type BuyBox,
  type MarketplaceId,
  type ProductDetail,
  type VariantDimension,
  type VariantOption,
} from '../types.js';
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

  // 变体：twisterPlus（Value Delta 切片）——提取维度行原始结构，Node 侧 parseVariations 解析。
  // 选项取 li 全文而非按钮窄文本：价格段（起始价/from）只在全文里出现。
  const variantRows: Array<{ name: string; title: string; options: Array<{ asin: string; label: string }> }> = [];
  document.querySelectorAll('[id^="inline-twister-row-"]').forEach((row) => {
    const dimId = (row.id ?? '').replace('inline-twister-row-', '');
    if (!dimId) return;
    const title = text(document.querySelector(`#inline-twister-dim-title-${dimId}`));
    const options: Array<{ asin: string; label: string }> = [];
    row.querySelectorAll('li[data-asin]').forEach((li) => {
      const asin = li.getAttribute('data-asin') ?? '';
      const label = text(li);
      if (asin && label) options.push({ asin, label });
    });
    if (options.length > 0) variantRows.push({ name: dimId, title, options });
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
    variants: variantRows,
  };
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNullableNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const asNullableString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

/** 变体选项里的起始价：中文"起始价：CNY X" / 英文"from $X"；捕获币种+数字串。 */
const VARIANT_PRICE_RE =
  /(?:起始价|from)\s*[：:]?\s*((?:CNY|US\$|\$|€|£|JP¥|¥)\s*[\d,]+(?:\.\d+)?)/i;

const UNAVAILABLE_MARKERS = [
  '目前无货',
  'currently unavailable',
  'temporarily out of stock',
  'out of stock',
  '无法配送',
] as const;

const CURRENCY_CODES = ['CNY', 'JPY', 'EUR', 'GBP', 'USD', 'AUD', 'CAD'] as const;

function extractVariantCurrency(text: string): string | null {
  const t = text.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (t.includes(code)) return code;
  }
  if (t.includes('€')) return 'EUR';
  if (t.includes('£')) return 'GBP';
  if (t.includes('$')) return 'USD';
  if (t.includes('¥')) return 'CNY';
  return null;
}

/** 从选项全文拆出清洗后的配置文本与起始价。 */
function parseVariantText(fullText: string): Pick<VariantOption, 'label' | 'priceText' | 'priceNum'> {
  const normalized = fullText.replace(/\s+/g, ' ').trim();

  let priceText: string | null = null;
  let priceNum: number | null = null;
  const pm = normalized.match(VARIANT_PRICE_RE);
  if (pm?.[1]) {
    priceText = pm[1].trim();
    const digits = pm[1].match(/[\d,]+(?:\.\d+)?/);
    if (digits) {
      const n = Number.parseFloat(digits[0].replace(/,/g, ''));
      if (Number.isFinite(n)) priceNum = n;
    }
  }

  // 配置 = "N个选项/N options" 之前的文本；无该标记则取全文。
  const cut = normalized.match(/^(.*?)\d+\s*(?:个选项|options?)/i)?.[1] ?? normalized;
  const label = cut
    .replace(/\/\*[\s\S]*?\*\//g, '') // CSS 注释垃圾
    .replace(/\s+/g, ' ')
    .trim();

  return { label, priceText, priceNum };
}

function isUnavailable(text: string): boolean {
  const t = text.toLowerCase();
  return UNAVAILABLE_MARKERS.some((m) => t.includes(m.toLowerCase()));
}

/**
 * 把浏览器侧返回的 twisterPlus 原始结构解析成 VariantDimension[]。
 * 历史兼容：读到的旧 string[]（非法结构）会被整体跳过，返回空数组。
 */
export function parseVariations(raw: unknown): readonly VariantDimension[] {
  if (!Array.isArray(raw)) return [];
  const out: VariantDimension[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const name = asString((item as { name?: unknown }).name);
    if (!name) continue;
    const title = asString((item as { title?: unknown }).title);
    const options: VariantOption[] = [];
    const rawOptions = (item as { options?: unknown }).options;
    if (!Array.isArray(rawOptions)) continue;
    for (const opt of rawOptions) {
      if (typeof opt !== 'object' || opt === null) continue;
      const asin = asString((opt as { asin?: unknown }).asin);
      const fullText = asString((opt as { label?: unknown }).label);
      if (!asin || !fullText) continue;
      const parsed = parseVariantText(fullText);
      options.push({
        asin,
        ...parsed,
        currency: parsed.priceText ? extractVariantCurrency(parsed.priceText) : null,
        unavailable: isUnavailable(fullText),
      });
    }
    if (options.length > 0) out.push({ name, title, options });
  }
  return out;
}

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
    variants: parseVariations(r.variants),
  };
}
