import { ProviderError, classifyHttpStatus, toProviderError } from '@cairn/shared';
import type { ProviderId } from '@cairn/shared';
import { parseSseStream, type SseMessage } from './sse.js';

export interface JsonRequestOptions {
  providerId: ProviderId;
  fetchFn: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  method?: 'GET' | 'POST';
  signal?: AbortSignal;
}

export async function fetchJson<T>(opts: JsonRequestOptions): Promise<T> {
  let response: Response;
  try {
    response = await opts.fetchFn(opts.url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: opts.headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    throw toProviderError(opts.providerId, err);
  }
  if (!response.ok) throw await responseError(opts.providerId, response);
  return response.json() as Promise<T>;
}

export async function* fetchSse(opts: JsonRequestOptions): AsyncGenerator<SseMessage> {
  let response: Response;
  try {
    response = await opts.fetchFn(opts.url, {
      method: opts.method ?? 'POST',
      headers: { ...opts.headers, Accept: 'text/event-stream' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    throw toProviderError(opts.providerId, err);
  }
  if (!response.ok) throw await responseError(opts.providerId, response);
  if (!response.body) {
    throw new ProviderError({ kind: 'server', providerId: opts.providerId, message: '上游未返回响应流' });
  }
  yield* parseSseStream(response.body, opts.signal);
}

async function responseError(providerId: ProviderId, response: Response): Promise<ProviderError> {
  const raw = await response.text().catch(() => '');
  let message = raw.slice(0, 500) || `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') message = parsed.error;
    else message = parsed.error?.message ?? parsed.message ?? message;
  } catch {
    // 非 JSON 错误体保留截断后的文本
  }
  return new ProviderError({
    kind: classifyHttpStatus(response.status),
    providerId,
    status: response.status,
    message,
  });
}

export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
