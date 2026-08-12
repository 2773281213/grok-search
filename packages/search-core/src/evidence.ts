import {
  clampText,
  idOf,
  jaccard,
  tokenize,
  type EvidenceItem,
  type SourceRecord,
} from '@cairn/shared';

/** 从来源摘要/正文中抽取最相关的短证据，保留原文而不让模型自行编造。 */
export function extractEvidence(
  question: string,
  sources: SourceRecord[],
  bodies: Map<string, string> = new Map(),
  maxPerSource = 2,
): EvidenceItem[] {
  const qTokens = tokenize(question);
  const now = new Date().toISOString();
  const results: EvidenceItem[] = [];

  for (const source of sources) {
    const body = bodies.get(source.id) ?? source.snippet ?? '';
    if (!body.trim()) continue;
    const sentences = splitSentences(body)
      .filter((s) => s.length >= 30)
      .map((sentence) => ({ sentence, score: jaccard(qTokens, tokenize(sentence)) }))
      .sort((a, b) => b.score - a.score);
    const chosen = sentences.length
      ? sentences.slice(0, maxPerSource)
      : [{ sentence: body, score: 0 }];
    for (const { sentence } of chosen) {
      results.push({
        id: idOf.evidence(),
        sessionId: source.sessionId,
        sourceId: source.id,
        snippet: clampText(sentence.trim(), 700),
        retrievedAt: now,
      });
    }
  }
  return results;
}

export function formatEvidenceContext(sources: SourceRecord[], evidence: EvidenceItem[]): string {
  const evidenceBySource = new Map<string, EvidenceItem[]>();
  for (const item of evidence) {
    const list = evidenceBySource.get(item.sourceId) ?? [];
    list.push(item);
    evidenceBySource.set(item.sourceId, list);
  }
  return sources.map((source, index) => {
    const snippets = evidenceBySource.get(source.id)?.map((e) => e.snippet) ?? [source.snippet ?? '未提供摘要'];
    return [
      `[${index + 1}] ${source.title}`,
      `URL: ${source.url}`,
      `类型: ${source.kind}${source.publishedAt ? `；时间: ${source.publishedAt}` : ''}；质量分: ${source.score}`,
      ...snippets.map((s) => `证据: ${s}`),
    ].join('\n');
  }).join('\n\n');
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？.!?])\s+|(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500);
}
