import { MemoryProxyPool, type MemoryProxyPoolOptions } from './memory-pool.js';
import { parseProxyList } from './parse.js';
import type { ProxyPool } from './types.js';

export interface CreateProxyPoolOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => number;
  readonly failureThreshold?: number;
  readonly cooldownMs?: number;
}

/**
 * 从 HTTP_PROXY_LIST 环境变量创建 ProxyPool。
 * 未设置或全为无效 URL → 返回 size=0 的空池，acquire() 恒为 null，Scraper 走无代理路径。
 */
export function createProxyPoolFromEnv(opts: CreateProxyPoolOptions = {}): ProxyPool {
  const env = opts.env ?? process.env;
  const urls = parseProxyList(env.HTTP_PROXY_LIST);
  const poolOpts: MemoryProxyPoolOptions = { urls };
  if (opts.now) (poolOpts as { now?: () => number }).now = opts.now;
  if (opts.failureThreshold !== undefined) {
    (poolOpts as { failureThreshold?: number }).failureThreshold = opts.failureThreshold;
  }
  if (opts.cooldownMs !== undefined) {
    (poolOpts as { cooldownMs?: number }).cooldownMs = opts.cooldownMs;
  }
  return new MemoryProxyPool(poolOpts);
}

export type { ProxyPool, ProxyOutcome } from './types.js';
export type { ParsedProxy, ProxyCredentials } from './parse.js';
export { parseProxyUrl, parseProxyList } from './parse.js';
export { MemoryProxyPool } from './memory-pool.js';
