import { TERMINAL_STATUSES, type SessionSnapshot } from '@cairn/shared';

/** MCP/CLI 共用的结构化输出；不包含密钥、日志或隐藏推理。 */
export function serializeSession(session: SessionSnapshot): Record<string, unknown> {
  const sourceById = new Map(session.sources.map((source) => [source.id, source]));
  return {
    sessionId: session.id,
    parentId: session.parentId,
    question: session.question,
    mode: session.mode,
    status: session.status,
    terminal: TERMINAL_STATUSES.includes(session.status),
    answer: session.answer,
    citations: session.citations.map((citation) => {
      const source = sourceById.get(citation.sourceId);
      return { marker: citation.marker, sourceId: citation.sourceId, title: source?.title, url: source?.url };
    }),
    sources: session.sources.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      domain: source.domain,
      kind: source.kind,
      social: source.social,
      score: source.score,
      publishedAt: source.publishedAt,
      snippet: source.snippet,
    })),
    evidence: session.evidence,
    plan: session.plan?.map((query) => ({ role: query.role, query: query.text, provider: query.providerId })),
    panelAnswers: session.panelAnswers,
    consensus: session.consensus,
    verification: session.verification,
    usage: session.usage,
    relatedQuestions: session.relatedQuestions,
    error: session.error,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt,
  };
}
