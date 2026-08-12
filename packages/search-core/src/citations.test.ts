import { describe, expect, it } from 'vitest';
import type { SourceRecord } from '@cairn/shared';
import { mapInlineCitations, verifyCitations } from './citations.js';

const sources = [1, 2, 3].map((n): SourceRecord => ({
  id: `src_${n}`,
  sessionId: 'ses',
  providerId: 'mock',
  url: `https://example${n}.com`,
  canonicalUrl: `https://example${n}.com/`,
  domain: `example${n}.com`,
  title: `Source ${n}`,
  kind: n === 1 ? 'official' : 'news',
  social: false,
  score: 80 - n,
}));

describe('citation mapping and verification', () => {
  it('去重映射合法标记并忽略越界标记', () => {
    expect(mapInlineCitations('事实 [1]，另一事实 [2][1]，坏标记 [9]。', sources)).toEqual([
      { marker: 1, sourceId: 'src_1' },
      { marker: 2, sourceId: 'src_2' },
    ]);
  });

  it('报告悬空引用和疑似无引用事实', () => {
    const answer = 'API 在 2026 年发布。[1] 这个实现支持流式输出并保存事件日志，但这里没有引用。坏标记 [8]。';
    const citations = mapInlineCitations(answer, sources);
    const report = verifyCitations(answer, sources, citations, ['src_3']);
    expect(report.danglingMarkers).toEqual([8]);
    expect(report.deadSources).toEqual(['src_3']);
    expect(report.uncitedFacts.length).toBeGreaterThan(0);
  });
});
