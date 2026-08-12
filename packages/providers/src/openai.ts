import type { ModelInfo, ProviderCapabilities } from '@cairn/shared';
import { BaseProvider } from './base.js';
import { extractResponsesOutput, uniqueSources } from './extract.js';
import { fetchJson, fetchSse, joinUrl } from './http.js';
import { numberOf, sourcesFromResponsesEvent } from './response-utils.js';
import type { ProviderEvent, ProviderSearchRequest } from './types.js';

export class OpenAIProvider extends BaseProvider {
  readonly id = 'openai' as const;
  readonly label = 'OpenAI';

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
    const result = await fetchJson<{ data?: Array<{ id: string }> }>({
      providerId: this.id,
      fetchFn: this.fetchFn,
      url: joinUrl(this.config.baseUrl, 'models'),
      headers: { Authorization: `Bearer ${this.key()}` },
      signal,
    });
    return (result.data ?? []).map((m) => ({ id: m.id })).sort((a, b) => a.id.localeCompare(b.id));
  }

  async *search(request: ProviderSearchRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const model = this.model(request.model);
    const tools = buildOpenAITools(request);
    const body: Record<string, unknown> = {
      model,
      input: composeInput(request),
      stream: true,
      max_output_tokens: request.maxOutputTokens ?? 4096,
    };
    if (request.systemPrompt) body.instructions = request.systemPrompt;
    if (tools.length) {
      body.tools = tools;
      body.include = ['web_search_call.action.sources'];
    }

    yield { type: 'status', phase: 'connecting' };
    const emittedSources = new Set<string>();
    const emittedCitations = new Set<string>();
    let inputTokens = 0;
    let outputTokens = 0;
    let searchCalls = 0;

    for await (const frame of fetchSse({
      providerId: this.id,
      fetchFn: this.fetchFn,
      url: joinUrl(this.config.baseUrl, 'responses'),
      headers: {
        Authorization: `Bearer ${this.key()}`,
        'Content-Type': 'application/json',
      },
      body,
      signal,
    })) {
      if (frame.data === '[DONE]') continue;
      const event = JSON.parse(frame.data) as any;
      const type = event.type ?? frame.event;
      if (type === 'response.web_search_call.in_progress' || type === 'response.web_search_call.searching') {
        yield { type: 'status', phase: 'searching', detail: 'OpenAI 正在检索网页' };
      } else if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        yield { type: 'text.delta', text: event.delta };
      } else if (type === 'response.output_text.annotation.added') {
        const ann = event.annotation ?? event;
        if (ann?.url && !emittedCitations.has(ann.url)) {
          emittedCitations.add(ann.url);
          yield { type: 'citation', url: ann.url, title: ann.title, citedText: ann.cited_text };
        }
      } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        for (const source of uniqueSources(sourcesFromResponsesEvent(event))) {
          if (emittedSources.has(source.url)) continue;
          emittedSources.add(source.url);
          yield { type: 'source', source };
        }
      } else if (type === 'response.completed') {
        const response = event.response ?? event;
        const extracted = extractResponsesOutput(response);
        for (const source of extracted.sources) {
          if (emittedSources.has(source.url)) continue;
          emittedSources.add(source.url);
          yield { type: 'source', source };
        }
        for (const citation of extracted.citations) {
          if (emittedCitations.has(citation.url)) continue;
          emittedCitations.add(citation.url);
          yield { type: 'citation', ...citation };
        }
        inputTokens = numberOf(response?.usage?.input_tokens);
        outputTokens = numberOf(response?.usage?.output_tokens);
        searchCalls = countSearchCalls(response);
      }
    }
    yield { type: 'usage', model, inputTokens, outputTokens, searchCalls };
    yield { type: 'done', finishReason: 'completed' };
  }
}

function composeInput(request: ProviderSearchRequest): string {
  if (!request.evidenceContext) return request.query;
  return `${request.query}\n\n以下是经过筛选的证据语料，只能根据这些材料作答并保留引用：\n${request.evidenceContext}`;
}

function buildOpenAITools(request: ProviderSearchRequest): unknown[] {
  if (request.scope === 'none' || request.scope === 'social') return [];
  const searchContextSize = request.mode === 'flash' ? 'low' : request.mode === 'dive' ? 'high' : 'medium';
  const filters: Record<string, unknown> = {};
  if (request.allowedDomains?.length) filters.allowed_domains = request.allowedDomains.slice(0, 20);
  else if (request.blockedDomains?.length) filters.blocked_domains = request.blockedDomains.slice(0, 20);
  return [{
    type: 'web_search',
    search_context_size: searchContextSize,
    ...(Object.keys(filters).length ? { filters } : {}),
  }];
}

function countSearchCalls(response: any): number {
  return Array.isArray(response?.output)
    ? response.output.filter((item: any) => item?.type === 'web_search_call').length
    : 0;
}
