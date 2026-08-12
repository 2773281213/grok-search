import { extractResponsesOutput } from './extract.js';
import type { ProviderEvent, ProviderSourceCandidate } from './types.js';

/** 把 Responses API 完整响应转为统一事件；OpenAI/xAI 共用宽松结构。 */
export function* finalResponseEvents(response: any, model: string): Generator<ProviderEvent> {
  const extracted = extractResponsesOutput(response);
  if (extracted.text) yield { type: 'text.delta', text: extracted.text };
  for (const source of extracted.sources) yield { type: 'source', source };
  for (const citation of extracted.citations) yield { type: 'citation', ...citation };
  const usage = response?.usage;
  if (usage) {
    yield {
      type: 'usage',
      model: response?.model ?? model,
      inputTokens: numberOf(usage.input_tokens ?? usage.input_tokens_details?.cached_tokens),
      outputTokens: numberOf(usage.output_tokens),
      searchCalls: numberOf(response?.server_side_tool_usage?.web_search_calls),
    };
  }
}

export function numberOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** 从 Responses 流事件中提取 source 候选。 */
export function sourcesFromResponsesEvent(event: any): ProviderSourceCandidate[] {
  const item = event?.item ?? event?.output_item;
  if (item?.type !== 'web_search_call') return [];
  const raw = item?.action?.sources ?? item?.sources ?? [];
  return raw.filter((s: any) => s?.url).map((s: any) => ({
    url: s.url,
    title: s.title ?? s.url,
    snippet: s.snippet,
    publishedAt: s.published_at,
  }));
}
