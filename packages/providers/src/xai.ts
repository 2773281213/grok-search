import type { ModelInfo, ProviderCapabilities } from '@cairn/shared';
import { BaseProvider } from './base.js';
import { extractResponsesOutput } from './extract.js';
import { fetchJson, fetchSse, joinUrl } from './http.js';
import { numberOf, sourcesFromResponsesEvent } from './response-utils.js';
import type { ProviderEvent, ProviderSearchRequest } from './types.js';

export class XAIProvider extends BaseProvider {
  readonly id = 'xai' as const;
  readonly label = 'xAI / Grok';

  capabilities(): ProviderCapabilities {
    return {
      nativeWebSearch: true,
      socialSearch: true,
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
    const tools = buildXAITools(request);
    const body: Record<string, unknown> = {
      model,
      input: [{ role: 'user', content: composeInput(request) }],
      stream: true,
      max_output_tokens: request.maxOutputTokens ?? 4096,
    };
    if (request.systemPrompt) body.instructions = request.systemPrompt;
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
      url: joinUrl(this.config.baseUrl, 'responses'),
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json' },
      body,
      signal,
    })) {
      if (frame.data === '[DONE]') continue;
      const event = JSON.parse(frame.data) as any;
      const type = event.type ?? frame.event;
      if (/web_search|x_search/.test(type ?? '') && /(in_progress|searching)/.test(type ?? '')) {
        yield {
          type: 'status',
          phase: 'searching',
          detail: type.includes('x_search') ? 'Grok 正在检索 X' : 'Grok 正在检索网页',
        };
      } else if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
        yield { type: 'text.delta', text: event.delta };
      } else if (type === 'response.output_text.annotation.added') {
        const ann = event.annotation ?? event;
        if (ann?.url && !emittedCitations.has(ann.url)) {
          emittedCitations.add(ann.url);
          yield { type: 'citation', url: ann.url, title: ann.title, citedText: ann.cited_text };
        }
      } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
        for (const source of sourcesFromResponsesEvent(event)) {
          if (emittedSources.has(source.url)) continue;
          emittedSources.add(source.url);
          yield { type: 'source', source: markSocial(source, request) };
        }
      } else if (type === 'response.completed' || type === 'response.done') {
        const response = event.response ?? event;
        const extracted = extractResponsesOutput(response);
        for (const source of extracted.sources) {
          if (emittedSources.has(source.url)) continue;
          emittedSources.add(source.url);
          yield { type: 'source', source: markSocial(source, request) };
        }
        for (const citation of extracted.citations) {
          if (emittedCitations.has(citation.url)) continue;
          emittedCitations.add(citation.url);
          yield { type: 'citation', ...citation };
        }
        inputTokens = numberOf(response?.usage?.input_tokens);
        outputTokens = numberOf(response?.usage?.output_tokens);
        searchCalls = numberOf(response?.server_side_tool_usage?.web_search_requests)
          + numberOf(response?.server_side_tool_usage?.x_search_requests);
      }
    }
    yield { type: 'usage', model, inputTokens, outputTokens, searchCalls };
    yield { type: 'done', finishReason: 'completed' };
  }
}

function composeInput(request: ProviderSearchRequest): string {
  return request.evidenceContext
    ? `${request.query}\n\n仅根据以下证据综合回答：\n${request.evidenceContext}`
    : request.query;
}

function buildXAITools(request: ProviderSearchRequest): unknown[] {
  if (request.scope === 'none') return [];
  const tools: unknown[] = [];
  if (request.scope === 'web' || request.scope === 'both') {
    const filters: Record<string, unknown> = {};
    // xAI 官方限制 5 个域名，且 allow/block 不可同时使用。
    if (request.allowedDomains?.length) filters.allowed_domains = request.allowedDomains.slice(0, 5);
    else if (request.blockedDomains?.length) filters.excluded_domains = request.blockedDomains.slice(0, 5);
    tools.push({ type: 'web_search', ...(Object.keys(filters).length ? { filters } : {}) });
  }
  if (request.scope === 'social' || request.scope === 'both') tools.push({ type: 'x_search' });
  return tools;
}

function markSocial<T extends { url: string; social?: boolean; kind?: any }>(source: T, request: ProviderSearchRequest): T {
  const social = /(^|\.)x\.com$/i.test(safeHost(source.url))
    || /(^|\.)twitter\.com$/i.test(safeHost(source.url))
    || request.scope === 'social';
  return { ...source, social, ...(social ? { kind: 'social' } : {}) };
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}
