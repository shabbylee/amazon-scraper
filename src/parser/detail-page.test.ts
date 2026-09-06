import { describe, expect, it } from 'vitest';
import { toProductDetail } from './detail-page.js';

const minimalRaw = {
  asin: 'B09S3HNMHF',
  title: 'Samsung Galaxy Chromebook Go',
};

describe('toProductDetail', () => {
  it('returns null for non-object input', () => {
    expect(toProductDetail(null, 'com')).toBeNull();
    expect(toProductDetail('string', 'com')).toBeNull();
    expect(toProductDetail(42, 'com')).toBeNull();
    expect(toProductDetail(undefined, 'com')).toBeNull();
  });

  it('returns null when asin is missing or malformed', () => {
    expect(toProductDetail({ ...minimalRaw, asin: '' }, 'com')).toBeNull();
    expect(toProductDetail({ ...minimalRaw, asin: 'short' }, 'com')).toBeNull();
    expect(toProductDetail({ ...minimalRaw, asin: 12345 }, 'com')).toBeNull();
    expect(toProductDetail({ ...minimalRaw, asin: 'B09S3HNMHA!' }, 'com')).toBeNull();
    expect(toProductDetail({ title: 'no asin' }, 'com')).toBeNull();
  });

  it('uppercases a lowercase asin', () => {
    const detail = toProductDetail({ ...minimalRaw, asin: 'b09s3hnmhf' }, 'com');
    expect(detail?.asin).toBe('B09S3HNMHF');
    expect(detail?.href).toBe('https://www.amazon.com/dp/B09S3HNMHF');
  });

  it('builds an href scoped to the marketplace', () => {
    const detail = toProductDetail(minimalRaw, 'com');
    expect(detail?.marketplace).toBe('com');
    expect(detail?.href).toContain('www.amazon.com');
  });

  it('captures an ISO timestamp', () => {
    const before = new Date().toISOString();
    const detail = toProductDetail(minimalRaw, 'com');
    const after = new Date().toISOString();
    expect(detail?.capturedAt).toBeDefined();
    expect(detail!.capturedAt >= before).toBe(true);
    expect(detail!.capturedAt <= after).toBe(true);
  });

  it('fills nulls / empty arrays for all missing optional fields', () => {
    const detail = toProductDetail(minimalRaw, 'com');
    expect(detail).toMatchObject({
      brand: null,
      images: [],
      breadcrumbs: [],
      description: null,
      bullets: [],
      specs: [],
      variants: [],
    });
    expect(detail?.buyBox).toEqual({
      priceText: null,
      priceNum: null,
      currency: null,
      shippingText: null,
      sellerName: null,
      isPrime: false,
      availability: 'unknown',
    });
    expect(detail?.reviews).toEqual({
      totalCount: null,
      averageRating: null,
      breakdown: { star5: null, star4: null, star3: null, star2: null, star1: null },
    });
  });

  it('parses buy box price text into priceNum and currency', () => {
    const detail = toProductDetail(
      {
        ...minimalRaw,
        buyBox: { priceText: '$249.00', isPrime: true, availabilityRaw: 'In Stock' },
      },
      'com'
    );
    expect(detail?.buyBox.priceText).toBe('$249.00');
    expect(detail?.buyBox.priceNum).toBe(249);
    expect(detail?.buyBox.currency).toBe('$');
    expect(detail?.buyBox.isPrime).toBe(true);
    expect(detail?.buyBox.availability).toBe('in-stock');
  });

  it.each([
    ['In Stock', 'in-stock'],
    ['Only 2 left in stock', 'in-stock'],
    ['Currently unavailable', 'unavailable'],
    ['Out of Stock', 'out-of-stock'],
    ['Pre-order now', 'pre-order'],
    ['即将推出', 'pre-order'],
    ['Backorder', 'backorder'],
    ['Something weird', 'unknown'],
    ['', 'unknown'],
  ])('maps availability text %j to %j', (raw, expected) => {
    const detail = toProductDetail(
      { ...minimalRaw, buyBox: { availabilityRaw: raw } },
      'com'
    );
    expect(detail?.buyBox.availability).toBe(expected);
  });

  it('parses review count and average rating from raw text', () => {
    const detail = toProductDetail(
      {
        ...minimalRaw,
        reviews: {
          reviewsCountRaw: '1,234 ratings',
          averageRatingRaw: '4.3 out of 5 stars',
          breakdown: [
            { star: 5, pct: 60 },
            { star: 4, pct: 25 },
            { star: 3, pct: 10 },
            { star: 2, pct: 3 },
            { star: 1, pct: 2 },
          ],
        },
      },
      'com'
    );
    expect(detail?.reviews.totalCount).toBe(1234);
    expect(detail?.reviews.averageRating).toBe(4.3);
    expect(detail?.reviews.breakdown).toEqual({
      star5: 60,
      star4: 25,
      star3: 10,
      star2: 3,
      star1: 2,
    });
  });

  it('filters out malformed variants (bad asin / non-string label)', () => {
    const detail = toProductDetail(
      {
        ...minimalRaw,
        variants: [
          { asin: 'B0VAR1ANT0', label: '蓝色', dimensions: { 颜色: '蓝色' }, image: 'x.jpg', isCurrent: true },
          { asin: 'short', label: 'bad' },
          { asin: 'B0VAR1ANTX', label: '黑色' },
          { asin: 'B0VAR1ANT0', label: 'dupe should be dropped' },
          null,
          'not-an-object',
        ],
      },
      'com'
    );
    expect(detail?.variants).toHaveLength(2);
    expect(detail?.variants[0]?.asin).toBe('B0VAR1ANT0');
    expect(detail?.variants[0]?.isCurrent).toBe(true);
    expect(detail?.variants[1]?.asin).toBe('B0VAR1ANTX');
  });

  it('keeps only key/value string pairs in specs', () => {
    const detail = toProductDetail(
      {
        ...minimalRaw,
        specs: [
          { key: '品牌', value: 'Samsung' },
          { key: '', value: 'no key' },
          { key: 'no value', value: '' },
          { key: 123, value: 'wrong type' },
          null,
        ],
      },
      'com'
    );
    expect(detail?.specs).toEqual([{ key: '品牌', value: 'Samsung' }]);
  });

  it('filters non-string entries from images / bullets / breadcrumbs', () => {
    const detail = toProductDetail(
      {
        ...minimalRaw,
        images: ['a.jpg', '', null, 42, 'b.jpg'],
        bullets: ['bullet one', '', 'bullet two'],
        breadcrumbs: ['Electronics', 'Computers', ''],
      },
      'com'
    );
    expect(detail?.images).toEqual(['a.jpg', 'b.jpg']);
    expect(detail?.bullets).toEqual(['bullet one', 'bullet two']);
    expect(detail?.breadcrumbs).toEqual(['Electronics', 'Computers']);
  });
});
