import { describe, expect, it } from 'vitest';
import { NoopProxyPool, StaticProxyPool, createProxyPool } from './proxy.js';

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
