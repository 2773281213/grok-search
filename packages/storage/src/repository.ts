import { and, desc, eq, like } from 'drizzle-orm';
import {
  TERMINAL_STATUSES,
  idOf,
  newId,
  type AppSettings,
  type CitationRecord,
  type EvidenceItem,
  type IntentProfile,
  type PanelAnswer,
  type PlannedQuery,
  type ProviderId,
  type ProviderRuntimeSettings,
  type SearchEvent,
  type SearchEventType,
  type SearchMode,
  type SessionSettings,
  type SessionSnapshot,
  type SessionStatus,
  type SourceRecord,
  type UsageRecord,
  type VerificationReport,
} from '@cairn/shared';
import type { DatabaseHandle } from './database.js';
import { answers, appSettings, events, evidence, providerSettings, queries, sessions, sources, usage } from './schema.js';

export interface CreateSessionInput {
  id?: string;
  parentId?: string;
  question: string;
  mode: SearchMode;
  providerIds: ProviderId[];
  settings: SessionSettings;
}

export interface SessionPatch {
  status?: SessionStatus;
  intent?: IntentProfile;
  plan?: PlannedQuery[];
  answer?: string;
  citations?: CitationRecord[];
  consensus?: string;
  verification?: VerificationReport;
  relatedQuestions?: string[];
  error?: string;
  completedAt?: string;
}

/**
 * 全部持久化操作集中于此，Web/MCP/CLI 共享同一契约。
 * 同步 SQLite API 有意保留：单次操作极短，可避免异步竞态和半写入状态。
 */
export class CairnRepository {
  constructor(readonly handle: DatabaseHandle) {}

  createSession(input: CreateSessionInput): SessionSnapshot {
    const id = input.id ?? idOf.session();
    const now = new Date().toISOString();
    this.handle.db.insert(sessions).values({
      id,
      parentId: input.parentId,
      question: input.question,
      mode: input.mode,
      status: 'queued',
      providerIds: input.providerIds,
      settings: input.settings,
      citations: [],
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.getSession(id)!;
  }

  updateSession(id: string, patch: SessionPatch): void {
    const now = new Date().toISOString();
    const completedAt = patch.completedAt
      ?? (patch.status && TERMINAL_STATUSES.includes(patch.status) ? now : undefined);
    this.handle.db.update(sessions).set({ ...patch, completedAt, updatedAt: now }).where(eq(sessions.id, id)).run();
  }

  savePlan(sessionId: string, intent: IntentProfile, plan: PlannedQuery[]): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.db.update(sessions).set({ intent, plan, updatedAt: now }).where(eq(sessions.id, sessionId)).run();
      this.handle.db.delete(queries).where(eq(queries.sessionId, sessionId)).run();
      if (plan.length) {
        this.handle.db.insert(queries).values(plan.map((q) => ({
          id: q.id,
          sessionId,
          role: q.role,
          text: q.text,
          providerId: q.providerId,
          status: 'pending',
        }))).run();
      }
    });
    tx();
  }

  markQueryStarted(queryId: string): void {
    this.handle.db.update(queries).set({ status: 'running', startedAt: new Date().toISOString() })
      .where(eq(queries.id, queryId)).run();
  }

  markQueryFinished(queryId: string, sourceCount: number, error?: string): void {
    this.handle.db.update(queries).set({
      status: error ? 'failed' : 'completed',
      sourceCount,
      error,
      finishedAt: new Date().toISOString(),
    }).where(eq(queries.id, queryId)).run();
  }

  /** canonical URL 唯一约束保证同一会话不会保存重复来源。 */
  addSource(source: SourceRecord): SourceRecord {
    const existing = this.handle.db.select().from(sources)
      .where(and(eq(sources.sessionId, source.sessionId), eq(sources.canonicalUrl, source.canonicalUrl)))
      .get();
    if (existing) return rowToSource(existing);

    this.handle.db.insert(sources).values({
      id: source.id,
      sessionId: source.sessionId,
      queryId: source.queryId,
      providerId: source.providerId,
      url: source.url,
      canonicalUrl: source.canonicalUrl,
      domain: source.domain,
      title: source.title,
      snippet: source.snippet,
      publishedAt: source.publishedAt,
      kind: source.kind,
      social: source.social,
      score: source.score,
      scoreBreakdown: source.scoreBreakdown,
      clusterId: source.clusterId,
    }).run();
    return source;
  }

  updateSource(source: SourceRecord): void {
    this.handle.db.update(sources).set({
      score: source.score,
      scoreBreakdown: source.scoreBreakdown,
      clusterId: source.clusterId,
      kind: source.kind,
      snippet: source.snippet,
      publishedAt: source.publishedAt,
    }).where(eq(sources.id, source.id)).run();
  }

  replaceRankedSources(sessionId: string, ranked: SourceRecord[]): void {
    const tx = this.handle.sqlite.transaction(() => {
      for (const source of ranked) this.updateSource(source);
      const keep = new Set(ranked.map((s) => s.id));
      const all = this.handle.db.select({ id: sources.id }).from(sources).where(eq(sources.sessionId, sessionId)).all();
      for (const row of all) {
        if (!keep.has(row.id)) this.handle.db.delete(sources).where(eq(sources.id, row.id)).run();
      }
    });
    tx();
  }

  addEvidence(item: EvidenceItem): void {
    this.handle.db.insert(evidence).values(item).run();
  }

  addPanelAnswer(sessionId: string, answer: PanelAnswer): void {
    this.handle.db.insert(answers).values({
      id: newId('ans'),
      sessionId,
      providerId: answer.providerId,
      model: answer.model,
      content: answer.content,
      citations: answer.citations,
      elapsedMs: answer.elapsedMs,
      isFinal: false,
      error: answer.error,
      createdAt: new Date().toISOString(),
    }).run();
  }

  setFinalAnswer(sessionId: string, content: string, citations: CitationRecord[], providerId: ProviderId, model = ''): void {
    const now = new Date().toISOString();
    const tx = this.handle.sqlite.transaction(() => {
      this.handle.db.delete(answers)
        .where(and(eq(answers.sessionId, sessionId), eq(answers.isFinal, true))).run();
      this.handle.db.insert(answers).values({
        id: newId('ans'), sessionId, providerId, model, content, citations,
        elapsedMs: 0, isFinal: true, createdAt: now,
      }).run();
      this.handle.db.update(sessions).set({ answer: content, citations, updatedAt: now })
        .where(eq(sessions.id, sessionId)).run();
    });
    tx();
  }

  upsertUsage(sessionId: string, record: UsageRecord): void {
    const existing = this.handle.db.select().from(usage).where(and(
      eq(usage.sessionId, sessionId),
      eq(usage.providerId, record.providerId),
      eq(usage.model, record.model),
    )).get();
    if (existing) {
      this.handle.db.update(usage).set({
        inputTokens: existing.inputTokens + record.inputTokens,
        outputTokens: existing.outputTokens + record.outputTokens,
        calls: existing.calls + record.calls,
        costUsd: (existing.costUsd ?? 0) + (record.costUsd ?? 0),
      }).where(eq(usage.id, existing.id)).run();
      return;
    }
    this.handle.db.insert(usage).values({
      sessionId,
      providerId: record.providerId,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      calls: record.calls,
      costUsd: record.costUsd,
    }).run();
  }

  appendEvent<T extends SearchEventType>(event: SearchEvent<T>): SearchEvent<T> {
    const result = this.handle.db.insert(events).values({
      sessionId: event.sessionId,
      type: event.type,
      ts: event.ts,
      data: event.data,
    }).run();
    return { ...event, seq: Number(result.lastInsertRowid) };
  }

  listEvents(sessionId: string, after = 0, limit = 1000): SearchEvent[] {
    const rows = this.handle.sqlite.prepare(
      'SELECT seq, session_id, type, ts, data FROM events WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?',
    ).all(sessionId, after, limit) as Array<{
      seq: number; session_id: string; type: SearchEventType; ts: string; data: string;
    }>;
    return rows.map((row) => ({
      seq: row.seq,
      sessionId: row.session_id,
      type: row.type,
      ts: row.ts,
      data: JSON.parse(row.data),
    })) as SearchEvent[];
  }

  getSession(id: string): SessionSnapshot | null {
    const row = this.handle.db.select().from(sessions).where(eq(sessions.id, id)).get();
    if (!row) return null;

    const sourceRows = this.handle.db.select().from(sources).where(eq(sources.sessionId, id))
      .orderBy(desc(sources.score)).all();
    const evidenceRows = this.handle.db.select().from(evidence).where(eq(evidence.sessionId, id)).all();
    const answerRows = this.handle.db.select().from(answers).where(eq(answers.sessionId, id)).all();
    const usageRows = this.handle.db.select().from(usage).where(eq(usage.sessionId, id)).all();
    const maxSeqRow = this.handle.sqlite.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE session_id = ?')
      .get(id) as { seq: number };

    const panelAnswers: PanelAnswer[] = answerRows.filter((a) => !a.isFinal).map((a) => ({
      providerId: a.providerId as ProviderId,
      model: a.model,
      content: a.content,
      citations: a.citations ?? [],
      elapsedMs: a.elapsedMs,
      error: a.error ?? undefined,
    }));

    return {
      id: row.id,
      parentId: row.parentId ?? undefined,
      question: row.question,
      mode: row.mode as SearchMode,
      status: row.status as SessionStatus,
      providerIds: row.providerIds,
      settings: row.settings,
      intent: row.intent ?? undefined,
      plan: row.plan ?? undefined,
      answer: row.answer ?? undefined,
      citations: row.citations ?? [],
      sources: sourceRows.map(rowToSource),
      evidence: evidenceRows.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        sourceId: e.sourceId,
        snippet: e.snippet,
        claim: e.claim ?? undefined,
        retrievedAt: e.retrievedAt,
      })),
      panelAnswers: panelAnswers.length ? panelAnswers : undefined,
      consensus: row.consensus ?? undefined,
      verification: row.verification ?? undefined,
      usage: usageRows.map((u) => ({
        providerId: u.providerId as ProviderId,
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        calls: u.calls,
        costUsd: u.costUsd ?? undefined,
      })),
      relatedQuestions: row.relatedQuestions ?? undefined,
      error: row.error ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt ?? undefined,
      lastEventSeq: maxSeqRow.seq,
    };
  }

  listSessions(limit = 20, q?: string): SessionSnapshot[] {
    const rows = q
      ? this.handle.db.select({ id: sessions.id }).from(sessions)
          .where(like(sessions.question, `%${escapeLike(q)}%`)).orderBy(desc(sessions.createdAt)).limit(limit).all()
      : this.handle.db.select({ id: sessions.id }).from(sessions)
          .orderBy(desc(sessions.createdAt)).limit(limit).all();
    return rows.map((row) => this.getSession(row.id)).filter((x): x is SessionSnapshot => x !== null);
  }

  setProviderSettings(providerId: ProviderId, value: ProviderRuntimeSettings): void {
    const now = new Date().toISOString();
    this.handle.db.insert(providerSettings).values({ providerId, settings: value, updatedAt: now })
      .onConflictDoUpdate({ target: providerSettings.providerId, set: { settings: value, updatedAt: now } }).run();
  }

  getProviderSettings(providerId: ProviderId): ProviderRuntimeSettings | null {
    const row = this.handle.db.select().from(providerSettings)
      .where(eq(providerSettings.providerId, providerId)).get();
    return (row?.settings as ProviderRuntimeSettings | undefined) ?? null;
  }

  setAppSettings(value: AppSettings): void {
    const now = new Date().toISOString();
    this.handle.db.insert(appSettings).values({ key: 'global', value, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } }).run();
  }

  getAppSettings(): AppSettings {
    const row = this.handle.db.select().from(appSettings).where(eq(appSettings.key, 'global')).get();
    return (row?.value as AppSettings | undefined) ?? { defaultMode: 'flash', roles: {} };
  }

  close(): void {
    this.handle.close();
  }
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function rowToSource(row: typeof sources.$inferSelect): SourceRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    queryId: row.queryId ?? undefined,
    providerId: row.providerId as ProviderId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    domain: row.domain,
    title: row.title,
    snippet: row.snippet ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    kind: row.kind as SourceRecord['kind'],
    social: row.social,
    score: row.score,
    scoreBreakdown: row.scoreBreakdown ?? undefined,
    clusterId: row.clusterId ?? undefined,
  };
}
