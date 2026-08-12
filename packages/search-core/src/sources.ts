import {
  canonicalizeUrl,
  extractDomain,
  idOf,
  jaccard,
  titlesLookAlike,
  tokenize,
  type ProviderId,
  type ScoreBreakdown,
  type SourceKind,
  type SourceRecord,
} from '@cairn/shared';
import type { ProviderSourceCandidate } from '@cairn/providers';

export interface NormalizeSourceContext {
  sessionId: string;
  queryId?: string;
  providerId: ProviderId;
}

export function normalizeSource(candidate: ProviderSourceCandidate, ctx: NormalizeSourceContext): SourceRecord | null {
  const canonicalUrl = canonicalizeUrl(candidate.url);
  if (!canonicalUrl) return null;
  const domain = extractDomain(canonicalUrl);
  if (!domain) return null;
  const social = candidate.social ?? isSocialDomain(domain);
  return {
    id: idOf.source(),
    sessionId: ctx.sessionId,
    queryId: ctx.queryId,
    providerId: ctx.providerId,
    url: candidate.url,
    canonicalUrl,
    domain,
    title: candidate.title?.trim() || domain,
    snippet: candidate.snippet?.trim(),
    publishedAt: normalizeDate(candidate.publishedAt),
    kind: candidate.kind ?? classifySourceKind(domain, candidate.url, social),
    social,
    score: 0,
  };
}

/** URL 去重 + 同新闻转载聚类。每个 cluster 保留全部来源，但标记同一 clusterId。 */
export function dedupeAndCluster(input: SourceRecord[]): SourceRecord[] {
  const byUrl = new Map<string, SourceRecord>();
  for (const source of input) {
    const existing = byUrl.get(source.canonicalUrl);
    if (!existing || sourceInformation(source) > sourceInformation(existing)) byUrl.set(source.canonicalUrl, source);
  }
  const unique = [...byUrl.values()];
  for (let i = 0; i < unique.length; i++) {
    const current = unique[i]!;
    if (current.clusterId) continue;
    current.clusterId = current.id;
    for (let j = i + 1; j < unique.length; j++) {
      const candidate = unique[j]!;
      if (candidate.clusterId) continue;
      if (titlesLookAlike(current.title, candidate.title) && current.domain !== candidate.domain) {
        candidate.clusterId = current.id;
      }
    }
  }
  return unique;
}

/**
 * 来源质量评分(0-100)。域名仅影响“类型/第一手”一维，不作为绝对判决；
 * 相关度、时效、跨域印证、多样性、内容农场惩罚共同决定排序。
 */
export function scoreSources(question: string, sources: SourceRecord[], now = new Date()): SourceRecord[] {
  const questionTokens = tokenize(question);
  const domainCounts = countBy(sources.map((s) => s.domain));
  const clusterCounts = countBy(sources.map((s) => s.clusterId ?? s.id));

  return sources.map((source) => {
    const relevanceRaw = jaccard(questionTokens, tokenize(`${source.title} ${source.snippet ?? ''}`));
    const relevance = Math.min(35, Math.round(relevanceRaw * 100));
    const freshness = freshnessScore(source.publishedAt, now);
    const authority = authorityScore(source);
    const corroboration = Math.min(15, Math.max(0, (clusterCounts.get(source.clusterId ?? source.id) ?? 1) - 1) * 6);
    const diversity = Math.max(2, 10 - Math.max(0, (domainCounts.get(source.domain) ?? 1) - 1) * 3);
    const penalty = qualityPenalty(source);
    const breakdown: ScoreBreakdown = { relevance, freshness, authority, corroboration, diversity, penalty };
    const base = relevance + freshness + authority + corroboration + diversity - penalty;
    // 即使标题与提问词面重合较低，也给第一手来源一个基础可见度。
    const score = Math.max(0, Math.min(100, Math.round(base + (source.kind === 'official' ? 8 : 0))));
    return { ...source, score, scoreBreakdown: breakdown };
  }).sort((a, b) => b.score - a.score);
}

export function classifySourceKind(domain: string, url: string, social = false): SourceKind {
  if (social) return 'social';
  if (/\.gov(\.|$)|\.gov\.[a-z]{2}$|europa\.eu$/.test(domain)) return 'gov';
  if (/github\.com$|gitlab\.com$/.test(domain)) return 'repo';
  if (/arxiv\.org$|doi\.org$|nature\.com$|science\.org$|pubmed\.ncbi\.nlm\.nih\.gov$/.test(domain)) return 'paper';
  if (/(docs\.|developer\.|developers\.|support\.|help\.|standards\.)/.test(domain)
    || /\/docs?\//i.test(url)
    || /^(w3\.org|ietf\.org|sqlite\.org|owasp\.org|nodejs\.org)$/.test(domain)) return 'official';
  if (/(reuters|apnews|bbc|nytimes|wsj|ft\.com|bloomberg|theguardian)/.test(domain)) return 'news';
  if (/(stackoverflow|reddit|news\.ycombinator|discourse)/.test(domain)) return 'community';
  if (/blog\.|medium\.com|substack\.com/.test(domain)) return 'blog';
  return 'other';
}

function authorityScore(source: SourceRecord): number {
  const byKind: Record<SourceKind, number> = {
    official: 24, paper: 25, gov: 25, repo: 21, news: 17,
    community: 10, social: 5, blog: 11, other: 8,
  };
  let score = byKind[source.kind];
  if (source.snippet && source.snippet.length >= 120) score += 2;
  if (source.url.startsWith('https://')) score += 1;
  return Math.min(28, score);
}

function freshnessScore(date: string | undefined, now: Date): number {
  if (!date) return 4;
  const ts = Date.parse(date);
  if (!Number.isFinite(ts)) return 4;
  const days = Math.max(0, (now.getTime() - ts) / 86_400_000);
  if (days <= 7) return 17;
  if (days <= 30) return 14;
  if (days <= 180) return 10;
  if (days <= 730) return 6;
  return 2;
}

function qualityPenalty(source: SourceRecord): number {
  let penalty = 0;
  if (/(best-\d+|top-\d+|click|viral|free-download|coupon)/i.test(`${source.title} ${source.url}`)) penalty += 9;
  if (source.title.length < 8) penalty += 4;
  if (!source.snippet) penalty += 2;
  if (source.social) penalty += 4;
  return penalty;
}

function normalizeDate(input?: string): string | undefined {
  if (!input) return undefined;
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : input.slice(0, 80);
}

function isSocialDomain(domain: string): boolean {
  return /(^|\.)(x|twitter)\.com$/.test(domain);
}

function sourceInformation(source: SourceRecord): number {
  return (source.snippet?.length ?? 0) + (source.publishedAt ? 50 : 0) + (source.title.length > 8 ? 20 : 0);
}

function countBy(items: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}
