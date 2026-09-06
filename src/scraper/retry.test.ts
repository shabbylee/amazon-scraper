import { describe, expect, it, vi } from 'vitest';
import type { FailureClass } from '../types.js';
import {
  DEFAULT_RETRY_POLICY,
  computeBackoffDelay,
  withRetry,
  type RetryPolicy,
} from './retry.js';

const noopSleep = async () => undefined;

interface FakeOutcome {
  readonly value: string;
  readonly failure?: FailureClass;
}

describe('computeBackoffDelay', () => {
  it('grows exponentially from baseDelayMs', () => {
    expect(computeBackoffDelay(0, DEFAULT_RETRY_POLICY)).toBe(1000);
    expect(computeBackoffDelay(1, DEFAULT_RETRY_POLICY)).toBe(2000);
    expect(computeBackoffDelay(2, DEFAULT_RETRY_POLICY)).toBe(4000);
  });

  it('is clamped by maxDelayMs', () => {
    expect(computeBackoffDelay(3, DEFAULT_RETRY_POLICY)).toBe(4000);
    expect(computeBackoffDelay(10, DEFAULT_RETRY_POLICY)).toBe(4000);
  });

  it('respects a custom policy', () => {
    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, baseDelayMs: 100, maxDelayMs: 500 };
    expect(computeBackoffDelay(0, policy)).toBe(100);
    expect(computeBackoffDelay(3, policy)).toBe(500);
  });
});

describe('withRetry', () => {
  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn(async () => ({ value: 'ok' }) as FakeOutcome);
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.result.value).toBe('ok');
    expect(res.attempts).toBe(1);
    expect(res.delaysMs).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries network failures up to maxRetries with exponential backoff', async () => {
    const fn = vi.fn(async () => ({ value: 'fail', failure: 'network' }) as FakeOutcome);
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(4); // 初次 + 3 次重试
    expect(res.delaysMs).toEqual([1000, 2000, 4000]);
    expect(res.result.failure).toBe('network');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('retries timeout failures', async () => {
    const fn = vi
      .fn<[number], Promise<FakeOutcome>>()
      .mockResolvedValueOnce({ value: 'x', failure: 'timeout' })
      .mockResolvedValueOnce({ value: 'ok' });
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(2);
    expect(res.delaysMs).toEqual([1000]);
    expect(res.result.value).toBe('ok');
  });

  it('does NOT retry captcha — it violates AGENTS.md hard rule', async () => {
    const fn = vi.fn(async () => ({ value: 'blocked', failure: 'captcha' }) as FakeOutcome);
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(1);
    expect(res.delaysMs).toEqual([]);
    expect(res.result.failure).toBe('captcha');
  });

  it('does NOT retry parser-miss — retrying cannot make DOM appear', async () => {
    const fn = vi.fn(async () => ({ value: 'empty', failure: 'parser-miss' }) as FakeOutcome);
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(1);
    expect(res.result.failure).toBe('parser-miss');
  });

  it('does NOT retry unknown — protects against masking bugs', async () => {
    const fn = vi.fn(async () => ({ value: 'weird', failure: 'unknown' }) as FakeOutcome);
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(1);
  });

  it('passes 1-based attempt number to fn', async () => {
    const seen: number[] = [];
    const fn = vi.fn(async (attempt: number) => {
      seen.push(attempt);
      return { value: 'x', failure: 'network' } as FakeOutcome;
    });
    await withRetry(fn, { sleep: noopSleep });
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('honors a custom policy', async () => {
    const policy: RetryPolicy = {
      maxRetries: 1,
      baseDelayMs: 50,
      maxDelayMs: 100,
      retryOn: ['network'],
    };
    const fn = vi.fn(async () => ({ value: 'x', failure: 'network' }) as FakeOutcome);
    const res = await withRetry(fn, { policy, sleep: noopSleep });
    expect(res.attempts).toBe(2);
    expect(res.delaysMs).toEqual([50]);
  });

  it('actually sleeps between retries (verifiable with a fake sleep)', async () => {
    const slept: number[] = [];
    const fakeSleep = async (ms: number) => {
      slept.push(ms);
    };
    const fn = vi.fn(async () => ({ value: 'x', failure: 'network' }) as FakeOutcome);
    await withRetry(fn, { sleep: fakeSleep });
    expect(slept).toEqual([1000, 2000, 4000]);
  });

  it('stops retrying once fn succeeds on a middle attempt', async () => {
    const fn = vi
      .fn<[number], Promise<FakeOutcome>>()
      .mockResolvedValueOnce({ value: 'x', failure: 'timeout' })
      .mockResolvedValueOnce({ value: 'x', failure: 'timeout' })
      .mockResolvedValueOnce({ value: 'recovered' });
    const res = await withRetry(fn, { sleep: noopSleep });
    expect(res.attempts).toBe(3);
    expect(res.result.value).toBe('recovered');
    expect(res.delaysMs).toEqual([1000, 2000]);
  });
});
