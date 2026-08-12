interface SafeSchema<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: { flatten(): unknown } };
}

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BODY_BYTES = 16_384;

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  });
}

export async function readJson<T>(request: Request, schema: SafeSchema<T>): Promise<T> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, '请求体过大');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new ApiError(413, '请求体过大');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new ApiError(400, 'JSON 格式无效'); }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new ApiError(400, '请求参数无效', result.error.flatten());
  return result.data;
}

export function enforceRateLimit(request: Request): void {
  const ip = clientIp(request);
  const now = Date.now();
  const rpm = Math.max(1, Math.min(300, Number(process.env.CAIRN_RATE_LIMIT_RPM ?? 30)));
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return;
  }
  bucket.count++;
  if (bucket.count > rpm) throw new ApiError(429, '请求过于频繁，请稍后重试');
  if (buckets.size > 10_000) {
    for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
  }
}

export function handleApiError(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message, details: error.details }, { status: error.status });
  const message = error instanceof Error ? error.message : '服务器内部错误';
  const stack = error instanceof Error ? error.stack : undefined;
  console.error('[cairn:api]', {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: redact(message),
    stack: stack ? redact(stack) : undefined,
  });
  // 仅返回脱敏消息，不暴露堆栈、密钥或上游请求体。
  return json({ error: redact(message) }, { status: 500 });
}

export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'unknown';
}

export function redact(value: string): string {
  return value
    .replace(/(?:sk|xai|ant)-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/(api[_ -]?key["'\s:=]+)[^\s,"']+/gi, '$1[REDACTED]')
    .slice(0, 500);
}

export function parseAfter(request: Request): number {
  const url = new URL(request.url);
  const raw = url.searchParams.get('after') ?? request.headers.get('last-event-id') ?? '0';
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
