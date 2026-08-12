import type { ProviderEvent, ProviderSearchRequest, SearchProvider } from '@cairn/providers';
import { ProviderError, TimeoutError, sleep, toProviderError, type UsageRecord } from '@cairn/shared';

export interface ProviderCallResult {
  text: string;
  citationUrls: string[];
  usage?: UsageRecord;
  sourceEvents: number;
  error?: string;
}

export interface ProviderCallOptions {
  timeoutMs: number;
  retries?: number;
  onEvent: (event: ProviderEvent) => void | Promise<void>;
  onRetry?: (attempt: number, message: string) => void;
}

/**
 * 消费 Provider AsyncIterable，统一处理超时、取消和有限重试。
 * 一旦已有文本/来源，失败时保留部分结果而不从头重放，避免重复流式内容。
 */
export async function executeProviderCall(
  provider: SearchProvider,
  request: ProviderSearchRequest,
  parentSignal: AbortSignal,
  options: ProviderCallOptions,
): Promise<ProviderCallResult> {
  const retries = options.retries ?? 2;
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new TimeoutError(options.timeoutMs)), options.timeoutMs);

    let text = '';
    const citationUrls: string[] = [];
    let usage: UsageRecord | undefined;
    let sourceEvents = 0;
    try {
      for await (const event of provider.search(request, controller.signal)) {
        await options.onEvent(event);
        if (event.type === 'text.delta') text += event.text;
        else if (event.type === 'citation') citationUrls.push(event.url);
        else if (event.type === 'source') sourceEvents++;
        else if (event.type === 'usage') {
          usage = {
            providerId: provider.id,
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            calls: 1,
          };
        }
      }
      return { text, citationUrls: [...new Set(citationUrls)], usage, sourceEvents };
    } catch (err) {
      if (parentSignal.aborted) throw parentSignal.reason ?? err;
      const reason = controller.signal.aborted && controller.signal.reason instanceof Error
        ? controller.signal.reason
        : err;
      lastError = reason instanceof TimeoutError
        ? new ProviderError({ kind: 'timeout', providerId: provider.id, message: reason.message, cause: reason })
        : toProviderError(provider.id, reason);
      if (text || sourceEvents) {
        return { text, citationUrls: [...new Set(citationUrls)], usage, sourceEvents, error: lastError.message };
      }
      if (!lastError.retryable || attempt >= retries) throw lastError;
      const delay = Math.min(4_000, 400 * 2 ** attempt);
      options.onRetry?.(attempt + 1, lastError.message);
      await sleep(delay, parentSignal);
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onAbort);
    }
  }
  throw lastError ?? new Error('Provider 调用失败');
}
