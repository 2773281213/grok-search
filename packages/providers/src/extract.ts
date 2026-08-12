import type { ProviderSourceCandidate } from './types.js';

/** 宽松解析 Responses API 输出中的文本、URL annotations、web search sources。 */
export function extractResponsesOutput(response: any): {
  text: string;
  sources: ProviderSourceCandidate[];
  citations: Array<{ url: string; title?: string; citedText?: string }>;
} {
  const textParts: string[] = [];
  const sources: ProviderSourceCandidate[] = [];
  const citations: Array<{ url: string; title?: string; citedText?: string }> = [];
  const output = Array.isArray(response?.output) ? response.output : [];

  for (const item of output) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content?.text === 'string') textParts.push(content.text);
        for (const ann of content?.annotations ?? []) {
          const citation = ann?.type === 'url_citation' ? ann : ann?.url_citation;
          if (!citation?.url) continue;
          citations.push({ url: citation.url, title: citation.title, citedText: citation.cited_text });
          sources.push({ url: citation.url, title: citation.title ?? citation.url, snippet: citation.cited_text });
        }
      }
    }
    if (item?.type === 'web_search_call') {
      for (const source of item?.action?.sources ?? item?.sources ?? []) {
        if (!source?.url) continue;
        sources.push({
          url: source.url,
          title: source.title ?? source.url,
          snippet: source.snippet,
          publishedAt: source.published_at,
        });
      }
    }
  }
  for (const raw of response?.citations ?? []) {
    const url = typeof raw === 'string' ? raw : raw?.url;
    if (!url) continue;
    const title = typeof raw === 'string' ? raw : raw?.title;
    citations.push({ url, title });
    sources.push({ url, title: title ?? url });
  }
  return { text: textParts.join(''), sources: uniqueSources(sources), citations: uniqueCitations(citations) };
}

/** 从 Anthropic content blocks 提取搜索结果、文本与 citations。 */
export function extractAnthropicContent(content: any[]): {
  text: string;
  sources: ProviderSourceCandidate[];
  citations: Array<{ url: string; title?: string; citedText?: string }>;
} {
  const text: string[] = [];
  const sources: ProviderSourceCandidate[] = [];
  const citations: Array<{ url: string; title?: string; citedText?: string }> = [];
  for (const block of content ?? []) {
    if (block?.type === 'text') {
      if (typeof block.text === 'string') text.push(block.text);
      for (const c of block.citations ?? []) {
        if (!c?.url) continue;
        citations.push({ url: c.url, title: c.title, citedText: c.cited_text });
        sources.push({ url: c.url, title: c.title ?? c.url, snippet: c.cited_text });
      }
    }
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result?.type !== 'web_search_result' || !result.url) continue;
        sources.push({
          url: result.url,
          title: result.title ?? result.url,
          publishedAt: result.page_age,
        });
      }
    }
  }
  return { text: text.join(''), sources: uniqueSources(sources), citations: uniqueCitations(citations) };
}

export function uniqueSources(sources: ProviderSourceCandidate[]): ProviderSourceCandidate[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function uniqueCitations<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
