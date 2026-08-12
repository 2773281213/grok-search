import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '@cairn/shared';
import { dedupeAndCluster, normalizeSource, scoreSources } from './sources.js';

function source(overrides: Partial<SourceRecord>): SourceRecord {
  return {
    id: overrides.id ?? `src_${Math.random()}`,
    sessionId: 'ses_1',
    providerId: 'mock',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    domain: 'example.com',
    title: 'Example source title',
    snippet: 'A detailed source about streaming API reliability and evidence verification.',
    kind: 'other',
    social: false,
    score: 0,
    ...overrides,
  };
}

describe('normalizeSource', () => {
  it('规范 URL 并识别 GitHub repo', () => {
    const result = normalizeSource(
      { url: 'http://www.github.com/org/repo/?utm_source=x', title: 'Repo' },
      { sessionId: 's', providerId: 'mock' },
    );
    expect(result).toMatchObject({
      canonicalUrl: 'https://github.com/org/repo',
      domain: 'github.com',
      kind: 'repo',
    });
  });

  it('拒绝危险协议', () => {
    expect(normalizeSource(
      { url: 'file:///etc/passwd', title: 'bad' },
      { sessionId: 's', providerId: 'mock' },
    )).toBeNull();
  });
});

describe('dedupeAndCluster', () => {
  it('按 canonical URL 去重且保留信息更完整项', () => {
    const a = source({ id: 'a', snippet: undefined });
    const b = source({ id: 'b', snippet: 'more complete text' });
    const result = dedupeAndCluster([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('b');
  });

  it('跨域相似新闻进入同一转载聚类', () => {
    const a = source({ id: 'a', domain: 'one.com', canonicalUrl: 'https://one.com/x', title: 'OpenAI releases new Responses API for developers' });
    const b = source({ id: 'b', domain: 'two.com', canonicalUrl: 'https://two.com/y', title: 'OpenAI releases new Responses API for developers' });
    const result = dedupeAndCluster([a, b]);
    expect(result[0]?.clusterId).toBe(result[1]?.clusterId);
  });
});

describe('scoreSources', () => {
  it('综合相关度、第一手属性、时效和低质惩罚', () => {
    const official = source({
      id: 'official', domain: 'docs.vendor.com', kind: 'official',
      title: 'Streaming API reliability official documentation',
      publishedAt: '2026-07-20',
    });
    const farm = source({
      id: 'farm', domain: 'content-farm.example', kind: 'other',
      title: 'Top-10 free-download click tricks', snippet: undefined,
      canonicalUrl: 'https://content-farm.example/x',
    });
    const ranked = scoreSources('streaming API reliability', [farm, official], new Date('2026-07-27'));
    expect(ranked[0]?.id).toBe('official');
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
    expect(ranked[1]!.scoreBreakdown!.penalty).toBeGreaterThan(0);
  });

  it('独立域名转载提高交叉印证分', () => {
    const clustered = dedupeAndCluster([
      source({ id: 'a', domain: 'a.news', canonicalUrl: 'https://a.news/x', title: 'Vendor launches the new search API today' }),
      source({ id: 'b', domain: 'b.news', canonicalUrl: 'https://b.news/y', title: 'Vendor launches the new search API today' }),
    ]);
    const scored = scoreSources('new search API', clustered);
    expect(scored.every((s) => (s.scoreBreakdown?.corroboration ?? 0) > 0)).toBe(true);
  });
});
