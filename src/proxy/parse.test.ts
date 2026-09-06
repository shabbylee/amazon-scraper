import { describe, expect, it } from 'vitest';
import { parseProxyList, parseProxyUrl } from './parse.js';

describe('parseProxyUrl', () => {
  it('parses an http proxy without credentials', () => {
    const p = parseProxyUrl('http://127.0.0.1:8080');
    expect(p).toEqual({
      url: 'http://127.0.0.1:8080',
      serverFlag: 'http=127.0.0.1:8080',
      credentials: null,
    });
  });

  it('parses an http proxy with basic auth credentials', () => {
    const p = parseProxyUrl('http://alice:s3cret@proxy.example.com:3128');
    expect(p).toEqual({
      url: 'http://alice:s3cret@proxy.example.com:3128',
      serverFlag: 'http=proxy.example.com:3128',
      credentials: { username: 'alice', password: 's3cret' },
    });
  });

  it('URL-decodes credentials', () => {
    const p = parseProxyUrl('http://user%40domain:p%40ss@host:1080');
    expect(p?.credentials).toEqual({ username: 'user@domain', password: 'p@ss' });
  });

  it('supports socks5 scheme', () => {
    const p = parseProxyUrl('socks5://host:1080');
    expect(p?.serverFlag).toBe('socks5=host:1080');
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['malformed URL', 'not a url'],
    ['missing port', 'http://host'],
    ['missing host', 'http://:8080'],
    ['unsupported scheme', 'ftp://host:21'],
    ['file scheme', 'file:///etc/passwd'],
  ])('returns null for %s', (_label, input) => {
    expect(parseProxyUrl(input)).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseProxyUrl('  http://host:8080  ')?.url).toBe('http://host:8080');
  });
});

describe('parseProxyList', () => {
  it('returns [] for undefined / null / empty string', () => {
    expect(parseProxyList(undefined)).toEqual([]);
    expect(parseProxyList(null)).toEqual([]);
    expect(parseProxyList('')).toEqual([]);
  });

  it('splits by comma and trims whitespace', () => {
    expect(parseProxyList('http://a:1, http://b:2 ,http://c:3')).toEqual([
      'http://a:1',
      'http://b:2',
      'http://c:3',
    ]);
  });

  it('drops empty entries produced by trailing or duplicate commas', () => {
    expect(parseProxyList('http://a:1,,,http://b:2,')).toEqual(['http://a:1', 'http://b:2']);
  });
});
