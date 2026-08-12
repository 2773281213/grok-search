import type { ModelInfo, ProviderCapabilities } from '@cairn/shared';
import { BaseProvider } from './base.js';
import { extractAnthropicContent } from './extract.js';
import { fetchJson, fetchSse, joinUrl } from './http.js';
import { numberOf } from './response-utils.js';
import type { ProviderEvent, ProviderSearchRequest } from './types.js';

export class AnthropicProvider extends BaseProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Anthropic / Claude';

  capabilities(): ProviderCapabilities {
    return {
      nativeWebSearch: true,
      socialSearch: false,
      streaming: true,
      citations: true,
      modelDiscovery: true,
      configurableBaseUrl: true,
      plainGeneration: true,
    };
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const result = await fetchJson<{ data?: Array<{ id: string; display_name?: string }> }>({
      providerId: this.id,
      fetchFn: this.fetchFn,
      url: joinUrl(this.config.baseUrl, 'v1/models'),
      headers: this.headers(),
      signal,
    });
    return (result.data ?? []).map((m) => ({ id: m.id, label: m.display_name }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async *search(request: ProviderSearchRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const model = this.model(request.model);
    const tools = buildAnthropicTools(request);
    const body: Record<string, unknown> = {
      model,
      max_tokens: request.maxOutputTokens ?? 4096,
      messages: [{ role: 'user', content: composeInput(request) }],
      stream: true,
    };
    if (request.systemPrompt) body.system = request.systemPrompt;
    if (tools.length) body.tools = tools;

    yield { type: 'status', phase: 'connecting' };
    const emittedSources = new Set<string>();
    const emittedCitations = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let searchCalls = 0;

    for await (const frame of fetchSse({
      providerId: this.id,
      fetchFn: this.fetchFn,
      url: joinUrl(this.config.baseUrl, 'v1/messages'),
      headers: this.headers(),
      body,
      signal,
    })) {
      const event = JSON.parse(frame.data) as any;
      const type = event.type ?? frame.event;
      if (type === 'message_start') {
        inputTokens = numberOf(event.message?.usage?.input_tokens);
      } else if (type === 'content_block_start') {
        const block = event.content_block;
        if (block?.type === 'server_tool_use' && block?.name === 'web_search') {
          searchCalls++;
          yield { type: 'status', phase: 'searching', detail: 'Claude 正在检索网页' };
        } else if (block?.type === 'web_search_tool_result') {
          yield { type: 'status', phase: 'reading', detail: 'Claude 正在阅读搜索结果' };
          const extracted = extractAnthropicContent([block]);
          for (const source of extracted.sources) {
            if (emittedSources.has(source.url)) continue;
            emittedSources.add(source.url);
            yield { type: 'source', source };
          }
        } else if (block?.type === 'text' && block.text) {
          yield { type: 'text.delta', text: block.text };
        }
      } else if (type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'text.delta', text: delta.text };
        } else if (delta?.type === 'citations_delta') {
          const citation = delta.citation;
          if (citation?.url && !emittedCitations.has(citation.url)) {
            emittedCitations.add(citation.url);
            yield {
              type: 'citation',
              url: citation.url,
              title: citation.title,
              citedText: citation.cited_text,
            };
          }
        }
      } else if (type === 'message_delta') {
        outputTokens = numberOf(event.usage?.output_tokens);
      } else if (type === 'message_stop') {
        // 终止事件由统一 done 事件表达。
      }
    }
    yield { type: 'usage', model, inputTokens, outputTokens, searchCalls };
    yield { type: 'done', finishReason: 'end_turn' };
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.key(),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }
}

function composeInput(request: ProviderSearchRequest): string {
  return request.evidenceContext
    ? `${request.query}\n\n请只根据下列已筛选证据回答，并在每个重要事实后保留来源：\n${request.evidenceContext}`
    : request.query;
}

function buildAnthropicTools(request: ProviderSearchRequest): unknown[] {
  if (request.scope === 'none' || request.scope === 'social') return [];
  const tool: Record<string, unknown> = {
    // 基础版本覆盖面最广；可通过环境变量升级，不把“latest”写入代码。
    type: process.env.ANTHROPIC_WEB_SEARCH_TOOL_VERSION ?? 'web_search_20250305',
    name: 'web_search',
    max_uses: request.mode === 'flash' ? 3 : request.mode === 'dive' ? 10 : 5,
  };
  if (request.allowedDomains?.length) tool.allowed_domains = request.allowedDomains.slice(0, 20);
  else if (request.blockedDomains?.length) tool.blocked_domains = request.blockedDomains.slice(0, 20);
  return [tool];
}
