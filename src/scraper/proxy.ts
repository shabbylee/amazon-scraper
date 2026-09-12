/**
 * Proxy Pool：Phase 2 只做静态配置池（ADR-0003）。
 * Scraper 不直接读 process.env，代理统一从这里取。
 */

export interface Proxy {
  readonly url: string;
  readonly label: string;
}

export interface ProxyPool {
  readonly size: number;
  /** 取下一个代理；返回 null = 直连（没有可用代理）。 */
  next(): Promise<Proxy | null>;
}

/** 空池：永远返回 null（直连），避免上层判空逻辑。 */
export class NoopProxyPool implements ProxyPool {
  readonly size = 0;
  async next(): Promise<null> {
    return null;
  }
}

/**
 * 静态配置池：从逗号分隔的代理 URL 列表 round-robin 轮换。
 * 列表为空时退化为 NoopProxyPool 语义。
 */
export class StaticProxyPool implements ProxyPool {
  readonly size: number;
  private readonly items: readonly Proxy[];
  private cursor = 0;

  constructor(urls: readonly string[]) {
    this.items = urls
      .map((raw) => raw.trim())
      .filter((u) => u.length > 0)
      .map((url) => ({ url, label: labelOf(url) }));
    this.size = this.items.length;
  }

  async next(): Promise<Proxy | null> {
    if (this.items.length === 0) return null;
    const proxy = this.items[this.cursor % this.items.length]!;
    this.cursor += 1;
    return proxy;
  }
}

function labelOf(url: string): string {
  try {
    const u = new URL(url);
    // 凭证不打进 label / 日志
    return u.hostname || url;
  } catch {
    return url;
  }
}

/** 工厂：按列表是否为空选择实现。 */
export function createProxyPool(proxies: readonly string[]): ProxyPool {
  if (!proxies || proxies.length === 0) return new NoopProxyPool();
  return new StaticProxyPool(proxies);
}
