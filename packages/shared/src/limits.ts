/** 并发、超时、重试、信号级联 —— 可靠性原语 */

/** p-limit 式并发闸门 */
export function createLimiter(concurrency: number) {
  if (concurrency < 1) throw new Error('concurrency 必须 >= 1');
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    active--;
    queue.shift()?.();
  };

  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`操作超时(${ms}ms)`);
    this.name = 'TimeoutError';
  }
}

/** 带超时与外部信号的包装;超时或取消时通过 controller 通知底层中断 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) controller.abort(parent.reason);
    else parent.addEventListener('abort', onParentAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new TimeoutError(ms)), ms);
  try {
    return await fn(controller.signal);
  } catch (err) {
    // 把 abort 原因还原为真实错误(TimeoutError / 用户取消)
    if (controller.signal.aborted && controller.signal.reason instanceof Error && err instanceof Error && err.name === 'AbortError') {
      throw controller.signal.reason;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** 返回 false 时立即放弃 */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/** 指数退避 + 抖动重试 */
export async function backoffRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const base = opts.baseDelayMs ?? 500;
  const cap = opts.maxDelayMs ?? 8000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('已取消');
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const more = attempt < opts.retries && (opts.shouldRetry?.(err, attempt) ?? true);
      if (!more) throw err;
      const delay = Math.min(cap, base * 2 ** attempt) * (0.5 + Math.random() * 0.5);
      opts.onRetry?.(err, attempt + 1, Math.round(delay));
      await sleep(delay, opts.signal);
    }
  }
  throw lastErr;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('已取消'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
