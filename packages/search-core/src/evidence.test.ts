import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '@cairn/shared';
import { extractEvidence, formatEvidenceContext } from './evidence.js';

const source: SourceRecord = {
  id: 'src_1', sessionId: 'ses_1', providerId: 'mock',
  url: 'https://docs.example.com', canonicalUrl: 'https://docs.example.com/',
  domain: 'docs.example.com', title: 'Streaming docs', kind: 'official', social: false, score: 90,
  snippet: 'Server-sent events support one-way streaming from a server to a browser. Unrelated sentence about colors.',
};

describe('evidence extraction', () => {
  it('优先抽取与问题相关句子并保留来源关系', () => {
    const result = extractEvidence('How does server streaming work?', [source]);
    expect(result[0]).toMatchObject({ sessionId: 'ses_1', sourceId: 'src_1' });
    expect(result[0]?.snippet).toContain('streaming');
  });

  it('格式化为稳定 [n] 证据上下文', () => {
    const evidence = extractEvidence('streaming', [source]);
    const formatted = formatEvidenceContext([source], evidence);
    expect(formatted).toContain('[1] Streaming docs');
    expect(formatted).toContain('URL: https://docs.example.com');
    expect(formatted).toContain('质量分: 90');
  });
});
