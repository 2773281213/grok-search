import { describe, expect, it } from 'vitest';
import { extractAnthropicContent, extractResponsesOutput } from './extract.js';

describe('extractResponsesOutput', () => {
  it('提取文本、annotations 与 web search sources 并去重', () => {
    const result = extractResponsesOutput({
      output: [
        {
          type: 'web_search_call',
          action: { sources: [{ url: 'https://a.dev', title: 'A' }] },
        },
        {
          type: 'message',
          content: [{
            type: 'output_text',
            text: 'answer',
            annotations: [{ type: 'url_citation', url: 'https://a.dev', title: 'A', cited_text: 'proof' }],
          }],
        },
      ],
    });
    expect(result.text).toBe('answer');
    expect(result.sources).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ url: 'https://a.dev', citedText: 'proof' });
  });

  it('兼容 xAI 顶层 citations', () => {
    const result = extractResponsesOutput({ citations: ['https://x.com/post/1'] });
    expect(result.sources[0]?.url).toBe('https://x.com/post/1');
  });
});

describe('extractAnthropicContent', () => {
  it('提取 web_search_tool_result 与 text citation', () => {
    const result = extractAnthropicContent([
      {
        type: 'web_search_tool_result',
        content: [{ type: 'web_search_result', url: 'https://docs.dev', title: 'Docs', page_age: '2026-07-01' }],
      },
      {
        type: 'text',
        text: 'answer',
        citations: [{ type: 'web_search_result_location', url: 'https://docs.dev', title: 'Docs', cited_text: 'proof' }],
      },
    ]);
    expect(result.text).toBe('answer');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]?.publishedAt).toBe('2026-07-01');
    expect(result.citations).toHaveLength(1);
  });
});
