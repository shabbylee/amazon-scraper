import { describe, expect, it } from 'vitest';
import {
  NoopProxyPool,
  StaticProxyPool,
  createProxyPool,
  parseProxyCredentials,
} from './proxy.js';

describe('StaticProxyPool', () => {
  it('round-robins through the configured proxies', async () => {
    const pool = new StaticProxyPool(['http://a.example:8080', 'http://b.example:8080']);
    expect(pool.size).toBe(2);
    expect((await pool.next())?.url).toBe('http://a.example:8080');
    expect((await pool.next())?.url).toBe('http://b.example:8080');
    expect((await pool.next())?.url).toBe('http://a.example:8080');
  });

  it('trims whitespace and drops empty entries', async () => {
    const pool = new StaticProxyPool([' http://a.example:8080 ', '  ', 'http://b.example:8080']);
    expect(pool.size).toBe(2);
    expect((await pool.next())?.url).toBe('http://a.example:8080');
  });

  it('labels without leaking credentials', async () => {
    const pool = new StaticProxyPool(['http://user:secret@proxy.example:3128']);
    const proxy = await pool.next();
    expect(proxy?.label).toBe('proxy.example');
    expect(proxy?.url).toBe('http://user:secret@proxy.example:3128');
  });

  it('returns null when the list is empty', async () => {
    const pool = new StaticProxyPool([]);
    expect(pool.size).toBe(0);
    expect(await pool.next()).toBeNull();
  });
});

describe('createProxyPool', () => {
  it('returns NoopProxyPool for an empty list', async () => {
    const pool = createProxyPool([]);
    expect(pool).toBeInstanceOf(NoopProxyPool);
    expect(await pool.next()).toBeNull();
  });

  it('returns a StaticProxyPool when proxies exist', async () => {
    const pool = createProxyPool(['http://a.example:8080']);
    expect(pool).toBeInstanceOf(StaticProxyPool);
    expect((await pool.next())?.url).toBe('http://a.example:8080');
  });
});

describe('parseProxyCredentials', () => {
  it('extracts username and password from a proxy URL', () => {
    expect(parseProxyCredentials('http://user:secret@proxy.example:3128')).toEqual({
      username: 'user',
      password: 'secret',
    });
  });

  it('decodes percent-encoded credentials', () => {
    expect(parseProxyCredentials('http://user%40corp:p%40ss@proxy.example:3128')).toEqual({
      username: 'user@corp',
      password: 'p@ss',
    });
  });

  it('returns null when there is no userinfo', () => {
    expect(parseProxyCredentials('http://proxy.example:3128')).toBeNull();
    expect(parseProxyCredentials('not a url')).toBeNull();
  });
});
