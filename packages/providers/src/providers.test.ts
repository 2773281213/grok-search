import { describe, expect, it } from 'vitest';
import type { ProviderError } from '@cairn/shared';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import { sseStreamOf } from './sse.js';
import type { ProviderEvent, ProviderSearchRequest, SearchProvider } from './types.js';
import { XAIProvider } from './xai.js';

const request: ProviderSearchRequest = {
  sessionId: 'ses_test',
  queryId: 'qry_test',
  query: 'latest API changes',
  mode: 'dive',
  model: 'test-model',
  scope: 'both',
  maxSources: 8,
  blockedDomains: ['spam.example'],
};

async function eventsOf(provider: SearchProvider): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.search(request, new AbortController().signal)) events.push(event);
  return events;
}

function sseResponse(frames: Array<{ event?: string; data: unknown }>): Response {
  return new Response(sseStreamOf(frames), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('OpenAIProvider contract', () => {
  it('使用 Responses web_search 并归一化流式文本、来源、引用和用量', async () => {
    let sent: any;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return sseResponse([
        { data: { type: 'response.web_search_call.searching' } },
        { data: { type: 'response.output_text.delta', delta: 'hello ' } },
        { data: { type: 'response.output_text.annotation.added', annotation: { url: 'https://a.dev', title: 'A' } } },
        { data: { type: 'response.output_item.done', item: { type: 'web_search_call', action: { sources: [{ url: 'https://a.dev', title: 'A' }] } } } },
        { data: { type: 'response.completed', response: { model: 'test-model', usage: { input_tokens: 10, output_tokens: 4 }, output: [] } } },
      ]);
    };
    const provider = new OpenAIProvider({ apiKey: 'secret', baseUrl: 'https://openai.test/v1', defaultModel: 'fallback', fetch: fetchFn as typeof fetch });
    const events = await eventsOf(provider);
    expect(sent.model).toBe('test-model');
    expect(sent.tools[0].type).toBe('web_search');
    expect(sent.tools[0].filters.blocked_domains).toEqual(['spam.example']);
    expect(sent.include).toEqual(['web_search_call.action.sources']);
    expect(events).toContainEqual({ type: 'text.delta', text: 'hello ' });
    expect(events.filter((e) => e.type === 'source')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'usage', inputTokens: 10, outputTokens: 4 }));
    expect(events.at(-1)?.type).toBe('done');
  });

  it('listModels 只返回模型元数据', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }] }), { status: 200 });
    const provider = new OpenAIProvider({ apiKey: 'secret', baseUrl: 'https://openai.test/v1', defaultModel: 'm', fetch: fetchFn as typeof fetch });
    await expect(provider.listModels()).resolves.toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

describe('XAIProvider contract', () => {
  it('按 scope 声明独立 web_search 与 x_search 能力', async () => {
    let sent: any;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return sseResponse([
        { data: { type: 'response.output_text.delta', delta: 'grok' } },
        { data: { type: 'response.completed', response: { model: 'test-model', citations: [{ url: 'https://x.com/user/status/1', title: 'Post' }], usage: { input_tokens: 3, output_tokens: 2 } } } },
      ]);
    };
    const provider = new XAIProvider({ apiKey: 'secret', baseUrl: 'https://xai.test/v1', defaultModel: 'm', fetch: fetchFn as typeof fetch });
    const events = await eventsOf(provider);
    expect(sent.tools.map((x: any) => x.type)).toEqual(['web_search', 'x_search']);
    expect(sent.tools[0].filters.excluded_domains).toEqual(['spam.example']);
    expect(events).toContainEqual(expect.objectContaining({ type: 'source', source: expect.objectContaining({ social: true }) }));
  });
});

describe('AnthropicProvider contract', () => {
  it('使用 Messages server web search 并解析结果块与 citation delta', async () => {
    let sent: any;
    let headers: any;
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      headers = init?.headers;
      return sseResponse([
        { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 11 } } } },
        { event: 'content_block_start', data: { type: 'content_block_start', content_block: { type: 'server_tool_use', name: 'web_search' } } },
        { event: 'content_block_start', data: { type: 'content_block_start', content_block: { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://docs.dev', title: 'Docs' }] } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'claude' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'citations_delta', citation: { url: 'https://docs.dev', title: 'Docs', cited_text: 'proof' } } } },
        { event: 'message_delta', data: { type: 'message_delta', usage: { output_tokens: 7 } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]);
    };
    const provider = new AnthropicProvider({ apiKey: 'secret', baseUrl: 'https://anthropic.test', defaultModel: 'm', fetch: fetchFn as typeof fetch });
    const events = await eventsOf(provider);
    expect(sent.tools[0].type).toMatch(/^web_search_/);
    expect(sent.tools[0].blocked_domains).toEqual(['spam.example']);
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(events).toContainEqual({ type: 'text.delta', text: 'claude' });
    expect(events.filter((e) => e.type === 'source')).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'usage', inputTokens: 11, outputTokens: 7, searchCalls: 1 }));
  });
});

describe('MockProvider contract', () => {
  it('无密钥完整流式返回来源、文本、引用和用量', async () => {
    const provider = new MockProvider({ delayMs: 0 });
    const events = await eventsOf(provider);
    expect(provider.configured()).toBe(true);
    expect(events.some((e) => e.type === 'source')).toBe(true);
    expect(events.some((e) => e.type === 'text.delta')).toBe(true);
    expect(events.some((e) => e.type === 'citation')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('响应 AbortController 取消', async () => {
    const provider = new MockProvider({ delayMs: 20 });
    const controller = new AbortController();
    const run = (async () => {
      for await (const _event of provider.search(request, controller.signal)) {
        controller.abort(new Error('cancel test'));
      }
    })();
    await expect(run).rejects.toThrow('cancel test');
  });
});

describe('HTTP errors', () => {
  it('401 被分类为 auth 且不可重试', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    const provider = new OpenAIProvider({ apiKey: 'bad', baseUrl: 'https://openai.test/v1', defaultModel: 'm', fetch: fetchFn as typeof fetch });
    const run = eventsOf(provider);
    await expect(run).rejects.toMatchObject({ kind: 'auth', retryable: false, message: 'bad key' } satisfies Partial<ProviderError>);
  });
});
