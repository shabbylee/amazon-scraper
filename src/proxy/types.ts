import type { ParsedProxy } from './parse.js';

/** 一次代理使用后的结果，决定池是否要冷却该端点。 */
export type ProxyOutcome = 'success' | 'failure';

/**
 * 代理池接口。见 docs/adr/0003-phase2-scrape-stability.md。
 * Phase 2 只提供内存实现；用户想接商用服务，实现此接口替换即可。
 */
export interface ProxyPool {
  /** 取一个可用代理；null 表示池空或全部端点在冷却中（调用方走无代理路径）。 */
  acquire(): Promise<ParsedProxy | null>;
  /** 归还代理并报告本次使用结果；连续失败到达阈值会进入冷却。 */
  release(proxy: ParsedProxy, outcome: ProxyOutcome): Promise<void>;
  /** 池里配置的有效端点总数（不看冷却状态）。 */
  size(): number;
}
