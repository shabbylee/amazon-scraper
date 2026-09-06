import { describe, expect, it } from 'vitest';
import { MARKETPLACES } from '../types.js';
import { buildSearchUrl, classifyError } from './search.js';

describe('buildSearchUrl', () => {
  it('produces a marketplace-scoped Amazon search URL with encoded keyword', () => {
    const url = buildSearchUrl({
      keyword: 'gaming laptop',
      page: 2,
      marketplace: MARKETPLACES.com,
    });
    expect(url).toBe('https://www.amazon.com/s?k=gaming+laptop&page=2&ref=nb_sb_noss');
  });

  it('escapes special characters in the keyword', () => {
    const url = buildSearchUrl({
      keyword: 'a&b=c',
      page: 1,
      marketplace: MARKETPLACES.com,
    });
    expect(url).toContain('k=a%26b%3Dc');
  });
});

describe('classifyError', () => {
  it.each([
    ['Navigation timeout of 30000 ms exceeded', 'timeout'],
    ['net::ERR_NAME_NOT_RESOLVED at https://www.amazon.com', 'network'],
    ['connect ECONNRESET 1.2.3.4:443', 'network'],
    ['getaddrinfo ENOTFOUND www.amazon.com', 'network'],
    ['navigation failed because page was closed', 'network'],
    ['CAPTCHA required to continue', 'captcha'],
    ['Robot Check', 'captcha'],
    ['some brand new weird error', 'unknown'],
  ])('maps %j to %j', (message, expected) => {
    expect(classifyError(new Error(message))).toBe(expected);
  });

  it('returns unknown for non-Error values', () => {
    expect(classifyError('string failure')).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
    expect(classifyError(undefined)).toBe('unknown');
    expect(classifyError({ message: 'not an Error instance' })).toBe('unknown');
  });
});
