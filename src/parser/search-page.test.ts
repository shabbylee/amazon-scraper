import { describe, expect, it } from 'vitest';
import { toListings } from './search-page.js';

describe('toListings', () => {
  it('converts raw browser items into typed Listings bound to a marketplace', () => {
    const raw = [
      {
        asin: 'B09S3HNMHF',
        title: 'Samsung Galaxy Chromebook Go',
        priceText: '$249.00',
        hasPrice: true,
        priceNum: 249,
        image: 'https://m.media-amazon.com/images/I/abc.jpg',
        rating: 4.3,
      },
    ];

    const [listing] = toListings(raw, 'com');
    expect(listing).toBeDefined();
    expect(listing).toEqual({
      marketplace: 'com',
      asin: 'B09S3HNMHF',
      title: 'Samsung Galaxy Chromebook Go',
      href: 'https://www.amazon.com/dp/B09S3HNMHF',
      image: 'https://m.media-amazon.com/images/I/abc.jpg',
      priceText: '$249.00',
      hasPrice: true,
      priceNum: 249,
      rating: 4.3,
    });
  });

  it('drops entries with missing or non-string asin', () => {
    const raw = [
      { asin: '', title: 'no asin' },
      { asin: 12345, title: 'wrong type' },
      { title: 'missing asin field entirely' },
      null,
      'not an object',
      { asin: 'B0VALIDASIN', title: 'ok' },
    ];
    const listings = toListings(raw as unknown[], 'com');
    expect(listings).toHaveLength(1);
    expect(listings[0]?.asin).toBe('B0VALIDASIN');
  });

  it('forces priceNum to null when hasPrice is false, even if raw contains a number', () => {
    const raw = [
      {
        asin: 'B0NOPRICE01',
        title: '即将推出',
        priceText: '没有标记价格或即将推出',
        hasPrice: false,
        priceNum: 999,
        image: null,
        rating: null,
      },
    ];
    const [listing] = toListings(raw, 'com');
    expect(listing?.hasPrice).toBe(false);
    expect(listing?.priceNum).toBeNull();
  });

  it('coerces non-finite numbers to null for rating and priceNum', () => {
    const raw = [
      {
        asin: 'B0WEIRD0001',
        title: 'x',
        priceText: '$1.00',
        hasPrice: true,
        priceNum: Number.NaN,
        image: '',
        rating: Number.POSITIVE_INFINITY,
      },
    ];
    const [listing] = toListings(raw, 'com');
    expect(listing?.priceNum).toBeNull();
    expect(listing?.rating).toBeNull();
    expect(listing?.image).toBeNull();
  });
});
