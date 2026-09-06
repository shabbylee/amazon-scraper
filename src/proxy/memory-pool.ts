import { parseProxyUrl, type ParsedProxy } from './parse.js';
import type { ProxyOutcome, ProxyPool } from './types.js';

export interface MemoryProxyPoolOptions {
  /** 代理 URL 列表；无效 URL 会在构造时被丢弃。 */
  readonly urls: readonly string[];
  /** 连续失败多少次进入冷却。默认 3。 */
  readonly failureThreshold?: number;
  /** 冷却时长（毫秒）。默认 30_000。 */
  readonly cooldownMs?: number;
  /** 时钟注入，方便测试。默认 Date.now。 */
  readonly now?: () => number;
}

interface EndpointState {
  readonly proxy: ParsedProxy;
  failureCount: number;
  /** 0 表示未冷却；否则是解除冷却的时间戳（毫秒）。 */
  cooldownUntil: number;
}

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

/**
 * 内存 ProxyPool：Round-robin 分配 + 连续失败阈值触发冷却。
 * - 冷却中的端点会被 acquire 跳过
 * - 成功归还会重置该端点的失败计数与冷却
 * - 所有端点都在冷却中时，acquire 返回 null（调用方降级到无代理）
 */
export class MemoryProxyPool implements ProxyPool {
  private readonly endpoints: EndpointState[];
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private cursor = 0;

  constructor(opts: MemoryProxyPoolOptions) {
    this.failureThreshold = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = opts.now ?? Date.now;
    this.endpoints = [];
    for (const url of opts.urls) {
      const proxy = parseProxyUrl(url);
      if (!proxy) continue;
      // 去重：同一 URL 只登记一次
      if (this.endpoints.some((e) => e.proxy.url === proxy.url)) continue;
      this.endpoints.push({ proxy, failureCount: 0, cooldownUntil: 0 });
    }
  }

  async acquire(): Promise<ParsedProxy | null> {
    if (this.endpoints.length === 0) return null;
    const now = this.now();
    for (let i = 0; i < this.endpoints.length; i += 1) {
      const idx = (this.cursor + i) % this.endpoints.length;
      const ep = this.endpoints[idx]!;
      if (ep.cooldownUntil > now) continue;
      this.cursor = (idx + 1) % this.endpoints.length;
      return ep.proxy;
    }
    return null;
  }

  async release(proxy: ParsedProxy, outcome: ProxyOutcome): Promise<void> {
    const ep = this.endpoints.find((e) => e.proxy.url === proxy.url);
    if (!ep) return;
    if (outcome === 'success') {
      ep.failureCount = 0;
      ep.cooldownUntil = 0;
      return;
    }
    ep.failureCount += 1;
    if (ep.failureCount >= this.failureThreshold) {
      ep.cooldownUntil = this.now() + this.cooldownMs;
      ep.failureCount = 0;
    }
  }

  size(): number {
    return this.endpoints.length;
  }
}
