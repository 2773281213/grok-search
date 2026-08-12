import type {
  CitationRecord,
  SourceRecord,
  VerificationReport,
} from '@cairn/shared';

/** 从答案中的 [n] 标记建立到已排序来源的稳定映射。 */
export function mapInlineCitations(answer: string, sources: SourceRecord[]): CitationRecord[] {
  const markers = [...answer.matchAll(/\[(\d{1,3})\]/g)]
    .map((match) => Number(match[1]))
    .filter((n) => Number.isInteger(n) && n > 0);
  const unique = [...new Set(markers)];
  return unique
    .filter((marker) => marker <= sources.length)
    .map((marker) => ({ marker, sourceId: sources[marker - 1]!.id }));
}

export function verifyCitations(
  answer: string,
  sources: SourceRecord[],
  citations: CitationRecord[],
  deadSources: string[] = [],
): VerificationReport {
  const allMarkers = [...answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1]));
  const mapped = new Set(citations.map((c) => c.marker));
  const danglingMarkers = [...new Set(allMarkers.filter((marker) => marker > sources.length || !mapped.has(marker)))];
  const factualSentences = answer
    .split(/(?<=[。！？.!?])\s+|(?<=[。！？])/)
    .map((s) => s.trim())
    // 句首引用通常属于前一句，校验当前句时先剥离，避免引用错位被误判为已引用。
    .map((s) => s.replace(/^(?:\[\d{1,3}\]\s*)+/, ''))
    .filter((s) => looksFactual(s));
  const uncitedFacts = factualSentences
    .filter((sentence) => !/\[\d{1,3}\]/.test(sentence))
    .slice(0, 5)
    .map((sentence) => sentence.slice(0, 160));
  const citationCounts = new Map<string, number>();
  for (const citation of citations) citationCounts.set(citation.sourceId, (citationCounts.get(citation.sourceId) ?? 0) + 1);
  const total = [...citationCounts.values()].reduce((sum, value) => sum + value, 0);
  const largest = Math.max(0, ...citationCounts.values());
  const singleSourceRatio = total ? largest / total : 1;
  const notes: string[] = [];
  if (!citations.length) notes.push('答案未包含可映射的内联引用');
  if (singleSourceRatio > 0.7 && citations.length > 1) notes.push('引用过度集中于单一来源');
  if (sources.filter((s) => s.kind === 'official' || s.kind === 'paper' || s.kind === 'gov').length === 0) {
    notes.push('未找到官方、论文或政府类第一手来源');
  }
  return {
    checked: citations.length,
    danglingMarkers,
    uncitedFacts,
    singleSourceRatio,
    deadSources,
    notes,
  };
}

function looksFactual(sentence: string): boolean {
  const hasCjk = /[一-鿿]/.test(sentence);
  if (sentence.length < (hasCjk ? 20 : 35)) return false;
  return /(\d|是|为|发布|支持|包含|导致|需要|可以|requires?|supports?|released?|is |are |has |have )/i.test(sentence);
}
