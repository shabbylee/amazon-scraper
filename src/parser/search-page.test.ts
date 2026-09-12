import { describe, expect, it } from 'vitest';
import { MARKETPLACES, type MarketplaceId } from '../types.js';
import { parsePriceNum, toListings } from './search-page.js';

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

  it('coerces non-finite numbers to null for rating, and parses priceNum from text', () => {
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
    expect(listing?.priceNum).toBe(1); // 来自 priceText，忽略 raw priceNum
    expect(listing?.rating).toBeNull();
    expect(listing?.image).toBeNull();
  });
});

describe('parsePriceNum (per-marketplace formats, ADR-0004)', () => {
  it.each<[MarketplaceId, string, number | null]>([
    ['com', '$249.00', 249],
    ['com', '$1,299.00', 1299],
    ['cojp', '￥1,234', 1234],
    ['cn', '¥899.00', 899],
    ['couk', '£1,099.00', 1099],
    ['de', 'EUR 12,99', 12.99],
    ['de', '1.234,56 €', 1234.56],
    ['com', '', null],
    ['de', '没有标记价格或即将推出', null],
    ['com', 'not a price', null],
  ])('%s parses "%s" → %j', (id, text, expected) => {
    expect(parsePriceNum(text, MARKETPLACES[id])).toBe(expected);
  });
});

describe('toListings across marketplaces', () => {
  it('binds listings to the requested marketplace host and parses its price format', () => {
    const raw = [
      {
        asin: 'B0DE0000001',
        title: 'Produkt',
        priceText: 'EUR 12,99',
        hasPrice: true,
        image: null,
        rating: 4.5,
      },
    ];
    const [listing] = toListings(raw, 'de');
    expect(listing).toMatchObject({
      marketplace: 'de',
      href: 'https://www.amazon.de/dp/B0DE0000001',
      priceText: 'EUR 12,99',
      priceNum: 12.99,
      rating: 4.5,
    });
  });
});
