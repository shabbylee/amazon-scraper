import { describe, expect, it } from 'vitest';
import {
  MIN_REQUEST_INTERVAL_MS,
  MAX_CONCURRENT_ATTEMPTS,
  MAX_RETRY_ATTEMPTS,
  MIN_RETRY_BACKOFF_MS,
  loadConfig,
  parseEnvFile,
} from './config.js';

describe('parseEnvFile', () => {
  it('parses KEY=VALUE lines, ignores comments and blanks', () => {
    const content = `
# comment line
PORT=4000

HEADLESS=false
CHROME_PATH="/usr/bin/chromium"
EMPTY=
`;
    expect(parseEnvFile(content)).toEqual({
      PORT: '4000',
      HEADLESS: 'false',
      CHROME_PATH: '/usr/bin/chromium',
      EMPTY: '',
    });
  });

  it('strips matching single or double quotes from values', () => {
    const content = `A="hello"\nB='world'\nC="mismatched'\n`;
    expect(parseEnvFile(content)).toEqual({
      A: 'hello',
      B: 'world',
      C: `"mismatched'`,
    });
  });
});

describe('loadConfig', () => {
  const opts = (env: NodeJS.ProcessEnv) => ({ env, envFilePath: '/nonexistent/.env' });

  it('uses defaults when env is empty', () => {
    const c = loadConfig(opts({}));
    expect(c.port).toBe(3456);
    expect(c.headless).toBe(true);
    expect(c.chromePath).toBeNull();
    expect(c.defaultMarketplace).toBe('com');
    expect(c.requestIntervalMs).toBeGreaterThanOrEqual(MIN_REQUEST_INTERVAL_MS);
    expect(c.maxConcurrentAttempts).toBeLessThanOrEqual(MAX_CONCURRENT_ATTEMPTS);
  });

  it('clamps requestIntervalMs to the AGENTS.md hard floor of 2000ms', () => {
    const c = loadConfig(opts({ REQUEST_INTERVAL_MS: '100' }));
    expect(c.requestIntervalMs).toBe(MIN_REQUEST_INTERVAL_MS);
  });

  it('clamps maxConcurrentAttempts to the AGENTS.md hard ceiling of 2', () => {
    const c = loadConfig(opts({ MAX_CONCURRENT_ATTEMPTS: '99' }));
    expect(c.maxConcurrentAttempts).toBe(MAX_CONCURRENT_ATTEMPTS);
  });

  it('defaults retry to 3 attempts and 3000ms backoff, clamped to hard bounds', () => {
    const c = loadConfig(opts({}));
    expect(c.retryMaxAttempts).toBe(3);
    expect(c.retryBackoffMs).toBe(3000);
  });

  it('clamps retryMaxAttempts into [1, 5]', () => {
    expect(loadConfig(opts({ RETRY_MAX_ATTEMPTS: '99' })).retryMaxAttempts).toBe(MAX_RETRY_ATTEMPTS);
    expect(loadConfig(opts({ RETRY_MAX_ATTEMPTS: '0' })).retryMaxAttempts).toBe(1);
    expect(loadConfig(opts({ RETRY_MAX_ATTEMPTS: '2' })).retryMaxAttempts).toBe(2);
  });

  it('clamps retryBackoffMs up to the AGENTS.md hard floor of 2000ms', () => {
    expect(loadConfig(opts({ RETRY_BACKOFF_MS: '100' })).retryBackoffMs).toBe(MIN_RETRY_BACKOFF_MS);
    expect(loadConfig(opts({ RETRY_BACKOFF_MS: '5000' })).retryBackoffMs).toBe(5000);
  });

  it('parses PROXIES as a trimmed, comma-separated list (empty = direct)', () => {
    expect(loadConfig(opts({})).proxies).toEqual([]);
    expect(loadConfig(opts({ PROXIES: 'http://a.example:8080, http://b.example:8080,  ' })).proxies)
      .toEqual(['http://a.example:8080', 'http://b.example:8080']);
  });

  it('rejects an unsupported DEFAULT_MARKETPLACE with a helpful error', () => {
    expect(() => loadConfig(opts({ DEFAULT_MARKETPLACE: 'xx' }))).toThrowError(
      /Unsupported DEFAULT_MARKETPLACE: xx/
    );
  });

  it('accepts the extended Phase 2 marketplaces', () => {
    expect(loadConfig(opts({ DEFAULT_MARKETPLACE: 'de' })).defaultMarketplace).toBe('de');
    expect(loadConfig(opts({ DEFAULT_MARKETPLACE: 'cojp' })).defaultMarketplace).toBe('cojp');
    expect(loadConfig(opts({ DEFAULT_MARKETPLACE: 'couk' })).defaultMarketplace).toBe('couk');
  });

  it('treats HEADLESS=false (any case) as headed mode', () => {
    expect(loadConfig(opts({ HEADLESS: 'false' })).headless).toBe(false);
    expect(loadConfig(opts({ HEADLESS: 'FALSE' })).headless).toBe(false);
    expect(loadConfig(opts({ HEADLESS: 'true' })).headless).toBe(true);
    expect(loadConfig(opts({ HEADLESS: 'anything-else' })).headless).toBe(true);
  });
});
