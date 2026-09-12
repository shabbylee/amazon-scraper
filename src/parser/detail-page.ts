import {
  MARKETPLACES,
  type Availability,
  type BuyBox,
  type MarketplaceId,
  type ProductDetail,
  type ProductSpec,
  type ReviewStats,
  type Variant,
} from '../types.js';

/**
 * Parser 层：把 Amazon 详情页 DOM 转成 ProductDetail 领域对象。
 * 严格约束（见 AGENTS.md）：Parser 只做纯转换，不启动浏览器、不做 IO、不重试。
 *
 * Amazon 详情页的选择器会变，这里用多重 fallback 提高鲁棒性。
 */

/** 浏览器上下文中提取出的原始 JSON-safe 结构，字段类型未经校验。 */
export interface RawProductDetail {
  readonly asin?: unknown;
  readonly title?: unknown;
  readonly brand?: unknown;
  readonly images?: unknown;
  readonly breadcrumbs?: unknown;
  readonly description?: unknown;
  readonly bullets?: unknown;
  readonly specs?: unknown;
  readonly buyBox?: unknown;
  readonly reviews?: unknown;
  readonly variants?: unknown;
}

/**
 * 在浏览器上下文中执行。不能引用外部作用域（Puppeteer 会序列化函数源码到页面执行）。
 * 返回原始 JSON-safe 数据，类型化在 Node 侧的 toProductDetail 完成。
 */
export function extractProductDetailInPage(): unknown {
  const text = (el: Element | null): string => (el ? (el.textContent ?? '').trim() : '');
  const attr = (el: Element | null, name: string): string | null =>
    el ? el.getAttribute(name) : null;
  const firstText = (selectors: readonly string[]): string | null => {
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const t = text(el);
      if (t) return t;
    }
    return null;
  };

  // ASIN 从 URL /dp/XXXX 或 data-asin body 属性拿
  const urlMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/i);
  const asin =
    urlMatch?.[1]?.toUpperCase() ??
    document.body?.getAttribute('data-asin')?.toUpperCase() ??
    '';

  const title = firstText(['#productTitle', 'h1.product-title-wording', '#title span']);
  const brandRaw = firstText([
    '#bylineInfo',
    'a#bylineInfo',
    '.po-brand .a-span9 .a-size-base',
  ]);
  // bylineInfo 通常是 "Visit the X Store" 或 "Brand: X"，剥掉前缀
  const brand = brandRaw
    ? brandRaw
        .replace(/^Visit the\s+/i, '')
        .replace(/^Brand:\s*/i, '')
        .replace(/\s+Store$/, '')
        .trim() || null
    : null;

  // 图片画廊：landingImage 的 data-a-dynamic-image 是 JSON 映射（url → [w,h]）
  const images: string[] = [];
  const landing = document.querySelector('#landingImage, #imgBlkFront');
  const dyn = attr(landing, 'data-a-dynamic-image');
  if (dyn) {
    try {
      const parsed = JSON.parse(dyn) as Record<string, unknown>;
      for (const url of Object.keys(parsed)) images.push(url);
    } catch {
      // ignore
    }
  }
  if (images.length === 0) {
    const src = attr(landing, 'src');
    if (src) images.push(src);
  }
  document.querySelectorAll('#altImages li img, #altImages .a-button-thumbnail img').forEach((el) => {
    const src = attr(el, 'src');
    if (src && !images.includes(src)) images.push(src);
  });

  // 类别面包屑
  const breadcrumbs: string[] = [];
  document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a, #wayfinding-breadcrumbs li a').forEach((el) => {
    const t = text(el);
    if (t) breadcrumbs.push(t);
  });

  // 描述段落
  const description =
    firstText([
      '#productDescription .a-expander-content',
      '#productDescription',
      '#bookDescription_feature_div .a-expander-content',
    ]) ?? null;

  // 特性 bullets
  const bullets: string[] = [];
  document
    .querySelectorAll('#feature-bullets ul li span.a-list-item, #feature-bullets li span')
    .forEach((el) => {
      const t = text(el);
      if (t && !bullets.includes(t)) bullets.push(t);
    });

  // 技术参数表（多种布局：新版 prodDetTable / a-keyvalue，旧版 techSpec section，detailBullets）
  const specs: { key: string; value: string }[] = [];
  const seenSpecKeys = new Set<string>();
  const pushSpec = (k: string, v: string) => {
    if (!k || !v) return;
    if (seenSpecKeys.has(k)) return;
    seenSpecKeys.add(k);
    specs.push({ key: k, value: v });
  };
  document
    .querySelectorAll(
      '.prodDetTable tr, table.a-keyvalue tr, #productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr'
    )
    .forEach((tr) => {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      pushSpec(text(th), text(td));
    });
  document
    .querySelectorAll('#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li')
    .forEach((li) => {
      const labelEl = li.querySelector('.a-text-bold');
      const raw = text(li);
      const label = text(labelEl).replace(/[:：\s]+$/, '');
      if (label && raw.startsWith(label)) {
        const value = raw.slice(label.length).replace(/^[:：\s]+/, '').trim();
        pushSpec(label, value);
      }
    });

  // Buy Box
  const priceText = firstText([
    '#corePrice_feature_div .a-price .a-offscreen',
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#price_inside_buybox',
    'span.a-price span.a-offscreen',
  ]);
  const shippingText = firstText([
    '#deliveryBlockMessage',
    '#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE',
    '#deliveryBlockMessage .a-color-base',
    '#dateOfDelivery',
  ]);
  const sellerName = firstText([
    '#sellerProfileTriggerId',
    '#merchant-info a',
    '#merchantInfoFeature_feature_div a',
    '#tabular-buybox tr:nth-child(3) td:last-child span',
    '#shipsFromMessage',
  ]);
  const availabilityRaw = firstText(['#availability', '#availability span', '.a-color-success']);
  const isPrime = Boolean(
    document.querySelector('#priceblock_ourprice ~ .a-icon-prime, .a-icon-prime, #primeIcon, i.a-icon-prime')
  );

  const buyBox = {
    priceText,
    shippingText,
    sellerName,
    availabilityRaw,
    isPrime,
  };

  // 评论统计
  const reviewsCountRaw = firstText(['#acrCustomerReviewText', 'span[data-hook="total-review-count"]']);
  const averageRatingRaw = firstText([
    '#acrPopover .a-icon-alt',
    'span[data-hook="rating-out-of-text"]',
    '#averageCustomerReviews .a-icon-alt',
  ]);
  const breakdown: { star: number; pct: number }[] = [];
  // 新布局：<ul id="histogramTable"> → <li> → <a aria-label="70 percent of reviews have 5 stars">
  document
    .querySelectorAll('#histogramTable a[aria-label], #cm_cr_dp_hist a[aria-label]')
    .forEach((a) => {
      const label = attr(a, 'aria-label') ?? '';
      const m = label.match(/(\d+(?:\.\d+)?)\s*percent of reviews have\s*([1-5])\s*star/i);
      if (m?.[1] && m?.[2]) {
        breakdown.push({ star: Number.parseInt(m[2], 10), pct: Number.parseFloat(m[1]) });
      }
    });
  // 旧布局 fallback：<table> 行，th/td 带 aria-label 或百分比文本
  if (breakdown.length === 0) {
    document.querySelectorAll('#histogramTable tr, #cm_cr_dp_hist tr').forEach((tr) => {
      const label =
        attr(tr.querySelector('th, td.aok-nowrap'), 'aria-label') ?? text(tr.querySelector('th, td'));
      const pctText =
        attr(tr.querySelector('td:last-child, .a-text-right'), 'aria-label') ??
        text(tr.querySelector('.a-text-right, td:last-child'));
      const starMatch = label.match(/([1-5])\s*star/i);
      const pctMatch = pctText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (starMatch?.[1] && pctMatch?.[1]) {
        breakdown.push({
          star: Number.parseInt(starMatch[1], 10),
          pct: Number.parseFloat(pctMatch[1]),
        });
      }
    });
  }

  const reviews = {
    reviewsCountRaw,
    averageRatingRaw,
    breakdown,
  };

  // 变体
  const variants: { asin: string; label: string; dimensions: Record<string, string>; image: string | null; isCurrent: boolean }[] = [];
  const variationGroups = document.querySelectorAll(
    '#twister-plus-inline-twister .twisterSwatchWrapper, #twister_feature_div .twisterSwatchWrapper, [id^="variation_"]'
  );
  variationGroups.forEach((group) => {
    const groupName =
      text(group.closest('[id^="variation_"]')?.querySelector('.a-keyword') ?? null) ||
      attr(group.closest('[id^="variation_"]'), 'data-a-name') ||
      '';
    group.querySelectorAll('li[data-defaultasin], li[data-asin], li img').forEach((li) => {
      const el: Element | null = li.tagName === 'IMG' ? li.parentElement : li;
      if (!el) return;
      const vAsin =
        attr(el, 'data-defaultasin')?.toUpperCase() ??
        attr(el, 'data-asin')?.toUpperCase() ??
        '';
      if (!vAsin) return;
      const label =
        attr(el, 'title') ??
        text(el.querySelector('.a-button-text') ?? el) ??
        '';
      const imgEl = el.querySelector('img') ?? (el.tagName === 'IMG' ? el : null);
      const image = attr(imgEl, 'src');
      const isCurrent = el.classList.contains('swatchSelect') || el.getAttribute('aria-current') === 'true';
      const dimensions: Record<string, string> = {};
      if (groupName) dimensions[groupName] = label;
      if (variants.some((v) => v.asin === vAsin)) return;
      variants.push({ asin: vAsin, label, dimensions, image, isCurrent });
    });
  });

  return {
    asin,
    title,
    brand,
    images,
    breadcrumbs,
    description,
    bullets,
    specs,
    buyBox,
    reviews,
    variants,
  };
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNullableString = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const asNullableNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

function parsePriceText(raw: string | null): { priceNum: number | null; currency: string | null } {
  if (!raw) return { priceNum: null, currency: null };
  const numMatch = raw.replace(/[,\s]/g, '').match(/[\d.]+/);
  const priceNum = numMatch ? Number.parseFloat(numMatch[0]) : null;
  const curMatch = raw.match(/^\s*([^\d\s.,]+)\s*|([A-Z]{3})\s/);
  const currency = curMatch?.[1] ?? curMatch?.[2] ?? null;
  return {
    priceNum: priceNum !== null && Number.isFinite(priceNum) ? priceNum : null,
    currency,
  };
}

function parseAvailability(raw: string | null): Availability {
  if (!raw) return 'unknown';
  const s = raw.toLowerCase();
  if (s.includes('in stock') || s.includes('有货') || s.includes('现货')) return 'in-stock';
  if (s.includes('out of stock') || s.includes('无货') || s.includes('缺货')) return 'out-of-stock';
  if (s.includes('pre-order') || s.includes('preorder') || s.includes('即将推出') || s.includes('预售')) return 'pre-order';
  if (s.includes('backorder') || s.includes('back order')) return 'backorder';
  if (s.includes('unavailable') || s.includes('currently unavailable')) return 'unavailable';
  return 'unknown';
}

function parseReviewCount(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,，\s]/g, '');
  const m = cleaned.match(/(\d+)/);
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function parseAverageRating(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!m?.[1]) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function toReviewStats(raw: unknown): ReviewStats {
  if (typeof raw !== 'object' || raw === null) {
    return {
      totalCount: null,
      averageRating: null,
      breakdown: { star5: null, star4: null, star3: null, star2: null, star1: null },
    };
  }
  const r = raw as Record<string, unknown>;
  const breakdownRaw = Array.isArray(r.breakdown) ? (r.breakdown as { star?: unknown; pct?: unknown }[]) : [];
  const get = (star: number): number | null => {
    const found = breakdownRaw.find((b) => b.star === star);
    return found ? asNullableNumber(found.pct) : null;
  };
  return {
    totalCount: parseReviewCount(asNullableString(r.reviewsCountRaw)),
    averageRating: parseAverageRating(asNullableString(r.averageRatingRaw)),
    breakdown: {
      star5: get(5),
      star4: get(4),
      star3: get(3),
      star2: get(2),
      star1: get(1),
    },
  };
}

function toBuyBox(raw: unknown): BuyBox {
  if (typeof raw !== 'object' || raw === null) {
    return {
      priceText: null,
      priceNum: null,
      currency: null,
      shippingText: null,
      sellerName: null,
      isPrime: false,
      availability: 'unknown',
    };
  }
  const r = raw as Record<string, unknown>;
  const priceText = asNullableString(r.priceText);
  const { priceNum, currency } = parsePriceText(priceText);
  return {
    priceText,
    priceNum,
    currency,
    shippingText: asNullableString(r.shippingText),
    sellerName: asNullableString(r.sellerName),
    isPrime: r.isPrime === true,
    availability: parseAvailability(asNullableString(r.availabilityRaw)),
  };
}

function toVariants(raw: unknown): Variant[] {
  if (!Array.isArray(raw)) return [];
  const out: Variant[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const v = entry as Record<string, unknown>;
    const asin = asString(v.asin).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
    const dims: Record<string, string> = {};
    if (typeof v.dimensions === 'object' && v.dimensions !== null) {
      for (const [k, val] of Object.entries(v.dimensions as Record<string, unknown>)) {
        if (typeof val === 'string' && val.length > 0) dims[k] = val;
      }
    }
    if (out.some((x) => x.asin === asin)) continue;
    out.push({
      asin,
      label: asString(v.label),
      dimensions: dims,
      image: asNullableString(v.image),
      isCurrent: v.isCurrent === true,
    });
  }
  return out;
}

function toSpecs(raw: unknown): ProductSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSpec[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const s = entry as Record<string, unknown>;
    const key = asString(s.key);
    const value = asString(s.value);
    if (key && value) out.push({ key, value });
  }
  return out;
}

/** Node 侧：把浏览器返回的 unknown 校验并转成 ProductDetail。 */
export function toProductDetail(raw: unknown, marketplace: MarketplaceId): ProductDetail | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as RawProductDetail;
  const asin = asString(r.asin).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin)) return null;
  const host = MARKETPLACES[marketplace].host;
  return {
    marketplace,
    asin,
    title: asString(r.title),
    brand: asNullableString(r.brand),
    href: `https://${host}/dp/${asin}`,
    images: asStringArray(r.images),
    breadcrumbs: asStringArray(r.breadcrumbs),
    description: asNullableString(r.description),
    bullets: asStringArray(r.bullets),
    specs: toSpecs(r.specs),
    buyBox: toBuyBox(r.buyBox),
    reviews: toReviewStats(r.reviews),
    variants: toVariants(r.variants),
    capturedAt: new Date().toISOString(),
  };
}
