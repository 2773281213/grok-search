/** Provider 错误分类 —— 决定是否重试与如何向用户呈现 */
export type ProviderErrorKind =
  | 'auth'          // 401/403,密钥问题,不重试
  | 'rate_limit'    // 429,可退避重试
  | 'timeout'       // 超时,可重试
  | 'network'       // 连接失败,可重试
  | 'bad_request'   // 4xx 参数问题,不重试
  | 'server'        // 5xx 上游故障,可重试
  | 'cancelled'     // 用户取消,不重试
  | 'unsupported'   // 能力不支持(如该 Provider 无 x_search)
  | 'unknown';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly providerId: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(opts: {
    kind: ProviderErrorKind;
    providerId: string;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'ProviderError';
    this.kind = opts.kind;
    this.providerId = opts.providerId;
    this.status = opts.status;
    this.retryable = ['rate_limit', 'timeout', 'network', 'server'].includes(opts.kind);
  }
}

/** 由 HTTP 状态码归类错误 */
export function classifyHttpStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

/** 统一把 unknown 异常转为 ProviderError */
export function toProviderError(providerId: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error && err.name === 'AbortError') {
    return new ProviderError({ kind: 'cancelled', providerId, message: '请求已取消', cause: err });
  }
  if (err instanceof Error && /timeout|timed out/i.test(err.message)) {
    return new ProviderError({ kind: 'timeout', providerId, message: err.message, cause: err });
  }
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
    return new ProviderError({ kind: 'network', providerId, message: '网络请求失败', cause: err });
  }
  return new ProviderError({
    kind: 'unknown',
    providerId,
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}
