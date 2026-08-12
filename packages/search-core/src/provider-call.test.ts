import { describe, expect, it } from 'vitest';
import type { ModelInfo, ProviderCapabilities } from '@cairn/shared';
import { ProviderError } from '@cairn/shared';
import type { ProviderEvent, ProviderSearchRequest, SearchProvider } from '@cairn/providers';
import { executeProviderCall } from './provider-call.js';

const request: ProviderSearchRequest = {
  sessionId: 's', queryId: 'q', query: 'test', mode: 'flash', scope: 'web', maxSources: 5,
};

class FlakyProvider implements SearchProvider {
  readonly id = 'mock' as const;
  readonly label = 'flaky';
  attempts = 0;
  capabilities(): ProviderCapabilities {
    return { nativeWebSearch: true, socialSearch: false, streaming: true, citations: true, modelDiscovery: false, configurableBaseUrl: false, plainGeneration: true };
  }
  configured() { return true; }
  configStatus() { return { hasKey: false, baseUrl: 'mock://flaky', defaultModel: 'm' }; }
  async listModels(): Promise<ModelInfo[]> { return [{ id: 'm' }]; }
  async *search(): AsyncIterable<ProviderEvent> {
    this.attempts++;
    if (this.attempts === 1) throw new ProviderError({ kind: 'network', providerId: 'mock', message: 'temporary' });
    yield { type: 'text.delta', text: 'ok' };
    yield { type: 'usage', model: 'm', inputTokens: 1, outputTokens: 1 };
    yield { type: 'done' };
  }
}

class PartialProvider extends FlakyProvider {
  override async *search(): AsyncIterable<ProviderEvent> {
    yield { type: 'text.delta', text: 'partial' };
    throw new ProviderError({ kind: 'network', providerId: 'mock', message: 'cut off' });
  }
}

describe('executeProviderCall', () => {
  it('对可重试错误指数退避后成功', async () => {
    const provider = new FlakyProvider();
    const seen: ProviderEvent[] = [];
    const result = await executeProviderCall(provider, request, new AbortController().signal, {
      timeoutMs: 5000,
      retries: 2,
      onEvent: (event) => { seen.push(event); },
    });
    expect(provider.attempts).toBe(2);
    expect(result.text).toBe('ok');
    expect(result.usage).toMatchObject({ model: 'm', calls: 1 });
  });

  it('流已有部分文本时不重放，保留部分结果', async () => {
    const provider = new PartialProvider();
    const result = await executeProviderCall(provider, request, new AbortController().signal, {
      timeoutMs: 5000,
      retries: 3,
      onEvent: () => undefined,
    });
    expect(result.text).toBe('partial');
    expect(result.error).toBe('cut off');
  });

  it('超时会中断 Provider', async () => {
    const provider: SearchProvider = {
      id: 'mock', label: 'slow', configured: () => true,
      configStatus: () => ({ hasKey: false, baseUrl: 'mock://slow', defaultModel: 'm' }),
      capabilities: () => ({ nativeWebSearch: true, socialSearch: false, streaming: true, citations: false, modelDiscovery: false, configurableBaseUrl: false, plainGeneration: true }),
      listModels: async () => [{ id: 'm' }],
      async *search(_request, signal) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
        });
        yield { type: 'done' };
      },
    };
    await expect(executeProviderCall(provider, request, new AbortController().signal, {
      timeoutMs: 20, retries: 0, onEvent: () => undefined,
    })).rejects.toMatchObject({ kind: 'timeout' });
  });
});
