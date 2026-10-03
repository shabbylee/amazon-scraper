import { describe, expect, it } from 'vitest';
import { parseVariations, toDetail } from './detail-page.js';

const validVariants = [
  {
    name: 'set_name',
    title: '大小: 32GB DDR5 RAM | 1TB PCIe SSD',
    options: [
      { asin: 'B0HFVPJ71V', label: '32GB DDR5 RAM,1TB PCIe SSD 3个选项，起始价：CNY 7,372.27' },
      { asin: 'B0HFVPJ71W', label: '64GB DDR5 RAM,1TB PCIe SSD 3个选项，起始价：CNY 14,738.12' },
      { asin: 'B0HFVPJ71X', label: '64GB DDR5 RAM,2TB PCIe SSD 3个选项，起始价：CNY 16,078.55' },
    ],
  },
];

const validRaw = {
  title: 'HP Pavilion 15.6 inch Laptop',
  image: 'https://m.media-amazon.com/images/I/abc.jpg',
  rating: 4.3,
  reviewCount: 1234,
  priceText: '$599.00',
  hasBuyBox: true,
  sellerName: 'Amazon.com',
  shippingText: 'FREE delivery',
  isPrime: true,
  inStock: true,
  variants: validVariants,
};

describe('toDetail', () => {
  it('builds a ProductDetail with structured twisterPlus variants', () => {
    const d = toDetail(validRaw, 'com', 'B0HFVPJ71V');
    expect(d).toEqual({
      marketplace: 'com',
      asin: 'B0HFVPJ71V',
      href: 'https://www.amazon.com/dp/B0HFVPJ71V',
      title: 'HP Pavilion 15.6 inch Laptop',
      image: 'https://m.media-amazon.com/images/I/abc.jpg',
      rating: 4.3,
      reviewCount: 1234,
      buyBox: {
        hasBuyBox: true,
        priceText: '$599.00',
        priceNum: 599,
        sellerName: 'Amazon.com',
        shippingText: 'FREE delivery',
        isPrime: true,
        inStock: true,
      },
      variants: [
        {
          name: 'set_name',
          title: '大小: 32GB DDR5 RAM | 1TB PCIe SSD',
          options: [
            {
              asin: 'B0HFVPJ71V',
              label: '32GB DDR5 RAM,1TB PCIe SSD',
              priceText: 'CNY 7,372.27',
              priceNum: 7372.27,
              currency: 'CNY',
              unavailable: false,
            },
            {
              asin: 'B0HFVPJ71W',
              label: '64GB DDR5 RAM,1TB PCIe SSD',
              priceText: 'CNY 14,738.12',
              priceNum: 14738.12,
              currency: 'CNY',
              unavailable: false,
            },
            {
              asin: 'B0HFVPJ71X',
              label: '64GB DDR5 RAM,2TB PCIe SSD',
              priceText: 'CNY 16,078.55',
              priceNum: 16078.55,
              currency: 'CNY',
              unavailable: false,
            },
          ],
        },
      ],
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

  it('coerces non-finite numbers and returns empty variants for legacy string arrays', () => {
    const d = toDetail(
      {
        ...validRaw,
        rating: Number.NaN,
        reviewCount: Number.POSITIVE_INFINITY,
        variants: ['A', 'B'],
      },
      'com',
      'B0COERCE001'
    );
    expect(d?.rating).toBeNull();
    expect(d?.reviewCount).toBeNull();
    expect(d?.variants).toEqual([]);
  });
});

describe('parseVariations', () => {
  it('extracts English from-price and marks unavailable', () => {
    const parsed = parseVariations([
      {
        name: 'size_name',
        title: 'Size',
        options: [
          { asin: 'B000000001', label: '16GB 2 options from $739.99' },
          { asin: 'B000000002', label: '32GB 2 options from US$799.99 Currently unavailable' },
        ],
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.options[0]).toMatchObject({
      asin: 'B000000001',
      label: '16GB',
      priceText: '$739.99',
      priceNum: 739.99,
      currency: 'USD',
      unavailable: false,
    });
    expect(parsed[0]!.options[1]).toMatchObject({
      label: '32GB',
      priceNum: 799.99,
      currency: 'USD',
      unavailable: true,
    });
  });

  it('cleans CSS comment garbage and keeps only the config part', () => {
    const parsed = parseVariations([
      {
        name: 'color_name',
        title: 'Color',
        options: [
          {
            asin: 'B000000003',
            label: '/* Temporary CSS overrides for savings. */ Black 4 options，起始价：CNY 1,200.00',
          },
        ],
      },
    ]);
    expect(parsed[0]!.options[0]!.label).toBe('Black');
    expect(parsed[0]!.options[0]!.priceNum).toBe(1200);
  });

  it('strips inlined CSS rules and embedded price text from option labels', () => {
    const parsed = parseVariations([
      {
        name: 'color_name',
        title: 'Color',
        options: [
          {
            asin: 'B000000004',
            label:
              '.centralizedApexPriceSavingsOverrides { color: var(--deal-savings-color, #CC0C39)!important; } ' +
              'CNY 1,742.50 with 41 percent savings In Stock',
          },
        ],
      },
    ]);
    // 纯噪声选项清洗后为空 label；下游配置解析据此跳过它。
    expect(parsed[0]!.options[0]!.label).toBe('');
    expect(parsed[0]!.options[0]!.priceNum).toBeNull();
  });

  it('keeps config text when the li carried a style block and stock status', () => {
    const parsed = parseVariations([
      {
        name: 'set_name',
        title: 'Set name',
        options: [
          {
            asin: 'B000000005',
            label:
              'N4120|64GB eMMC .centralizedApexPriceSavingsOverrides' +
              ' { color: var(--deal-savings-color, #CC0C39)!important; } CNY 1,534.80 In Stock',
          },
        ],
      },
    ]);
    expect(parsed[0]!.options[0]!.label).toBe('N4120|64GB eMMC');
  });

  it('drops availability status text from labels', () => {
    const parsed = parseVariations([
      {
        name: 'set_name',
        title: 'Set name',
        options: [
          { asin: 'B000000006', label: '16 GB See available options' },
          { asin: 'B000000007', label: '32GB Currently unavailable.' },
        ],
      },
    ]);
    expect(parsed[0]!.options[0]!.label).toBe('16 GB');
    expect(parsed[0]!.options[1]!.label).toBe('32GB');
    expect(parsed[0]!.options[1]!.unavailable).toBe(true);
  });

  it('skips malformed entries and legacy string arrays', () => {
    expect(parseVariations(null)).toEqual([]);
    expect(parseVariations(['old', 'shape'])).toEqual([]);
    expect(parseVariations([{ name: 'x', options: 'not-array' }])).toEqual([]);
    expect(parseVariations([{ name: '', options: [] }])).toEqual([]);
  });
});
