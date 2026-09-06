import type { FailureClass } from '../types.js';

/**
 * 按 FailureClass 分类的重试策略。见 docs/adr/0003-phase2-scrape-stability.md。
 *
 * 只对瞬时故障（network / timeout）重试；captcha / parser-miss / unknown 不重试：
 * - captcha：Amazon 主动拦截，重试加剧封锁，且违反 AGENTS.md 抓取伦理
 * - parser-miss：DOM 结构变了或搜索无结果，重试不会变出 Listing
 * - unknown：兜底，重试可能掩盖 bug
 */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryOn: readonly FailureClass[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 4000,
  retryOn: ['network', 'timeout'],
};

/** 任何带可选 failure 字段的返回值都可以被 withRetry 分类。 */
export interface RetryableOutcome {
  readonly failure?: FailureClass;
}

export interface RetryResult<T> {
  readonly result: T;
  readonly attempts: number;
  readonly delaysMs: readonly number[];
}

export interface WithRetryOptions {
  readonly policy?: RetryPolicy;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 计算第 n 次重试前的等待时间（0-based）。指数退避，被 maxDelayMs 夹紧。 */
export function computeBackoffDelay(retryIndex: number, policy: RetryPolicy): number {
  const raw = policy.baseDelayMs * Math.pow(2, retryIndex);
  return Math.min(raw, policy.maxDelayMs);
}

/**
 * 用 Retry 包裹一个返回 RetryableOutcome 的异步函数。
 * - fn 收到 1-based attempt 序号（1 = 初次尝试，2 = 第一次重试…）
 * - 成功（无 failure）或失败但不在 retryOn 中，立即返回
 * - 达到 maxRetries 后即使失败也返回最后一次结果
 */
export async function withRetry<T extends RetryableOutcome>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOptions = {}
): Promise<RetryResult<T>> {
  const policy = opts.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = opts.sleep ?? defaultSleep;
  const delays: number[] = [];

  let attempt = 0;
  let lastResult: T | null = null;

  while (attempt <= policy.maxRetries) {
    attempt += 1;
    const result = await fn(attempt);
    lastResult = result;

    if (!result.failure) break;
    if (!policy.retryOn.includes(result.failure)) break;
    if (attempt > policy.maxRetries) break;

    const delay = computeBackoffDelay(attempt - 1, policy);
    delays.push(delay);
    await sleep(delay);
  }

  // 循环至少执行一次，lastResult 必然非空
  return { result: lastResult as T, attempts: attempt, delaysMs: delays };
}
