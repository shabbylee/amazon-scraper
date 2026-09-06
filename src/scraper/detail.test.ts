import { describe, expect, it } from 'vitest';
import { buildDetailUrl } from './detail.js';

describe('buildDetailUrl', () => {
  it('builds a marketplace-scoped /dp/ URL for an ASIN', () => {
    expect(buildDetailUrl('B09S3HNMHF', 'com')).toBe(
      'https://www.amazon.com/dp/B09S3HNMHF'
    );
  });

  it('URL-encodes the ASIN (defensive against malformed input)', () => {
    expect(buildDetailUrl('B0 ABC/XYZ', 'com')).toBe(
      'https://www.amazon.com/dp/B0%20ABC%2FXYZ'
    );
  });
});
