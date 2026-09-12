import { describe, expect, it } from 'vitest';
import { toDetail } from './detail-page.js';

const validRaw = {
  title: 'Samsung Galaxy Chromebook Go',
  image: 'https://m.media-amazon.com/images/I/abc.jpg',
  rating: 4.3,
  reviewCount: 1234,
  priceText: '$249.00',
  hasBuyBox: true,
  sellerName: 'Amazon.com',
  shippingText: 'FREE delivery',
  isPrime: true,
  inStock: true,
  variants: ['Mineral Silver', 'Ash Gray', 42],
};

describe('toDetail', () => {
  it('builds a ProductDetail with the Buy Box object', () => {
    const d = toDetail(validRaw, 'com', 'B09S3HNMHF');
    expect(d).toEqual({
      marketplace: 'com',
      asin: 'B09S3HNMHF',
      href: 'https://www.amazon.com/dp/B09S3HNMHF',
      title: 'Samsung Galaxy Chromebook Go',
      image: 'https://m.media-amazon.com/images/I/abc.jpg',
      rating: 4.3,
      reviewCount: 1234,
      buyBox: {
        hasBuyBox: true,
        priceText: '$249.00',
        priceNum: 249,
        sellerName: 'Amazon.com',
        shippingText: 'FREE delivery',
        isPrime: true,
        inStock: true,
      },
      variants: ['Mineral Silver', 'Ash Gray'],
    });
  });

  it('parses Buy Box price per marketplace format (de)', () => {
    const d = toDetail(
      { ...validRaw, priceText: 'EUR 12,99', hasBuyBox: true },
      'de',
      'B0DE0000001'
    );
    expect(d?.buyBox.priceNum).toBe(12.99);
    expect(d?.href).toBe('https://www.amazon.de/dp/B0DE0000001');
  });

  it('marks a missing Buy Box with placeholder text and null price', () => {
    const d = toDetail(
      { ...validRaw, priceText: '', hasBuyBox: false },
      'com',
      'B0NOBUYBOX0'
    );
    expect(d?.buyBox.hasBuyBox).toBe(false);
    expect(d?.buyBox.priceNum).toBeNull();
    expect(d?.buyBox.priceText).toBe('无 Buy Box（未开售或无货）');
  });

  it('returns null when the title is missing (page not captured)', () => {
    expect(toDetail({ ...validRaw, title: '' }, 'com', 'B0EMPTYT000')).toBeNull();
    expect(toDetail(null, 'com', 'B0NULL00000')).toBeNull();
    expect(toDetail('not an object', 'com', 'B0STRING000')).toBeNull();
  });

  it('coerces non-finite numbers and keeps only string variants', () => {
    const d = toDetail(
      { ...validRaw, rating: Number.NaN, reviewCount: Number.POSITIVE_INFINITY, variants: ['A', 1, null] },
      'com',
      'B0COERCE001'
    );
    expect(d?.rating).toBeNull();
    expect(d?.reviewCount).toBeNull();
    expect(d?.variants).toEqual(['A']);
  });
});
