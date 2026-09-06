import { describe, expect, it } from 'vitest';
import { MemoryProxyPool } from './memory-pool.js';

const URLS = ['http://a:1000', 'http://b:1000', 'http://c:1000'];

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('MemoryProxyPool construction', () => {
  it('drops malformed URLs at construction', () => {
    const pool = new MemoryProxyPool({
      urls: ['http://a:1', 'not-a-url', 'http://b:2', 'ftp://c:3'],
    });
    expect(pool.size()).toBe(2);
  });

  it('de-duplicates the same URL', () => {
    const pool = new MemoryProxyPool({
      urls: ['http://a:1', 'http://a:1', 'http://b:2'],
    });
    expect(pool.size()).toBe(2);
  });

  it('empty urls → size 0 and acquire returns null', async () => {
    const pool = new MemoryProxyPool({ urls: [] });
    expect(pool.size()).toBe(0);
    expect(await pool.acquire()).toBeNull();
  });
});

describe('MemoryProxyPool round-robin', () => {
  it('rotates through endpoints on successive acquires', async () => {
    const pool = new MemoryProxyPool({ urls: URLS });
    const first = await pool.acquire();
    const second = await pool.acquire();
    const third = await pool.acquire();
    const fourth = await pool.acquire();
    expect(first?.url).toBe('http://a:1000');
    expect(second?.url).toBe('http://b:1000');
    expect(third?.url).toBe('http://c:1000');
    expect(fourth?.url).toBe('http://a:1000'); // wraps
  });
});

describe('MemoryProxyPool failure isolation', () => {
  it('enters cooldown after failureThreshold consecutive failures', async () => {
    const clock = fakeClock(0);
    const pool = new MemoryProxyPool({
      urls: URLS,
      failureThreshold: 2,
      cooldownMs: 5000,
      now: clock.now,
    });
    const a = await pool.acquire();
    expect(a?.url).toBe('http://a:1000');

    await pool.release(a!, 'failure');
    await pool.release(a!, 'failure'); // 达到阈值

    // a 现在应该在冷却中，acquire 跳过它
    const next = await pool.acquire();
    expect(next?.url).toBe('http://b:1000');
  });

  it('returns null when every endpoint is in cooldown', async () => {
    const clock = fakeClock(0);
    const pool = new MemoryProxyPool({
      urls: URLS,
      failureThreshold: 1,
      cooldownMs: 5000,
      now: clock.now,
    });
    for (const url of URLS) {
      const p = await pool.acquire();
      expect(p?.url).toBe(url);
      await pool.release(p!, 'failure');
    }
    expect(await pool.acquire()).toBeNull();
  });

  it('exits cooldown after cooldownMs elapses', async () => {
    const clock = fakeClock(0);
    const pool = new MemoryProxyPool({
      urls: ['http://a:1000'],
      failureThreshold: 1,
      cooldownMs: 5000,
      now: clock.now,
    });
    const p = await pool.acquire();
    await pool.release(p!, 'failure');
    expect(await pool.acquire()).toBeNull();

    clock.advance(4999);
    expect(await pool.acquire()).toBeNull();

    clock.advance(1);
    const recovered = await pool.acquire();
    expect(recovered?.url).toBe('http://a:1000');
  });

  it('success resets failure count and cooldown', async () => {
    const clock = fakeClock(0);
    const pool = new MemoryProxyPool({
      urls: ['http://a:1000'],
      failureThreshold: 2,
      cooldownMs: 5000,
      now: clock.now,
    });
    const p1 = await pool.acquire();
    await pool.release(p1!, 'failure');

    const p2 = await pool.acquire();
    await pool.release(p2!, 'success'); // 重置

    // 再失败一次不应触发冷却（计数从 0 开始）
    const p3 = await pool.acquire();
    await pool.release(p3!, 'failure');
    expect(await pool.acquire()).not.toBeNull();
  });

  it('failure count does not accumulate across successes', async () => {
    const pool = new MemoryProxyPool({
      urls: ['http://a:1000'],
      failureThreshold: 3,
      cooldownMs: 5000,
    });
    const p = await pool.acquire();
    await pool.release(p!, 'failure');
    await pool.release(p!, 'failure');
    await pool.release(p!, 'success'); // reset
    await pool.release(p!, 'failure');
    await pool.release(p!, 'failure');
    // 只有 2 次连续失败，未到阈值 3
    expect(await pool.acquire()).not.toBeNull();
  });

  it('release with an unknown URL is a no-op', async () => {
    const pool = new MemoryProxyPool({ urls: URLS });
    await expect(
      pool.release({ url: 'http://unknown:9999', serverFlag: 'http=unknown:9999', credentials: null }, 'failure')
    ).resolves.toBeUndefined();
    expect(pool.size()).toBe(3);
  });
});
