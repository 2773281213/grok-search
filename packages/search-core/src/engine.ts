import type { ProviderEvent, ProviderRegistry, ProviderSearchRequest, SearchProvider } from '@cairn/providers';
import {
  MODE_PROFILES,
  SearchRequestSchema,
  createLimiter,
  defaultSettings,
  idOf,
  makeEvent,
  type PlannedQuery,
  type ProviderId,
  type QueryRole,
  type SearchEvent,
  type SearchEventType,
  type SearchMode,
  type SearchRequestInput,
  type SessionSettings,
  type SessionSnapshot,
  type SourceRecord,
  type VerificationReport,
} from '@cairn/shared';
import type { CairnRepository } from '@cairn/storage';
import { mapInlineCitations, verifyCitations } from './citations.js';
import { extractEvidence, formatEvidenceContext } from './evidence.js';
import { EventHub, type EventListener } from './event-hub.js';
import { SecureFetcher } from './fetcher.js';
import { classifyIntent } from './intent.js';
import { planQueries } from './planner.js';
import { executeProviderCall, type ProviderCallResult } from './provider-call.js';
import { relatedQuestions, synthesisQuestion, synthesisSystemPrompt } from './prompts.js';
import { dedupeAndCluster, normalizeSource, scoreSources } from './sources.js';

export interface SearchEngineOptions {
  fetcher?: SecureFetcher;
  retries?: number;
}

export interface StartOptions {
  parentId?: string;
  signal?: AbortSignal;
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<SessionSnapshot>;
}

interface QueryResult {
  query: PlannedQuery;
  providerId: ProviderId;
  call: ProviderCallResult;
  sources: SourceRecord[];
}

/**
 * 搜索编排器：所有入口(Web/MCP/CLI)复用同一实例和业务逻辑。
 * start() 立即返回 session ID，后台执行；事件先持久化再广播，支持 SSE 序号恢复。
 */
export class SearchEngine {
  readonly hub: EventHub;
  private readonly fetcher: SecureFetcher;
  private readonly retries: number;
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    readonly repo: CairnRepository,
    readonly providers: ProviderRegistry,
    options: SearchEngineOptions = {},
  ) {
    this.hub = new EventHub(repo);
    this.fetcher = options.fetcher ?? new SecureFetcher();
    this.retries = options.retries ?? 2;
  }

  start(raw: SearchRequestInput, options: StartOptions = {}): SessionSnapshot {
    const request = SearchRequestSchema.parse(raw);
    const providerIds = this.selectProviders(request.mode, request.providers);
    const settings = mergeSettings(request.mode, request.options);
    const session = this.repo.createSession({
      parentId: options.parentId,
      question: request.question,
      mode: request.mode,
      providerIds,
      settings,
    });
    this.publish(session.id, 'session.created', {
      sessionId: session.id,
      question: session.question,
      mode: session.mode,
    });

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) controller.abort(options.signal.reason);
    else options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const promise = this.execute(session.id, controller.signal)
      .finally(() => {
        options.signal?.removeEventListener('abort', onExternalAbort);
        this.active.delete(session.id);
      });
    this.active.set(session.id, { controller, promise });
    return this.repo.getSession(session.id)!;
  }

  async run(raw: SearchRequestInput, options: StartOptions = {}): Promise<SessionSnapshot> {
    const session = this.start(raw, options);
    return this.wait(session.id);
  }

  async wait(sessionId: string): Promise<SessionSnapshot> {
    const active = this.active.get(sessionId);
    if (active) return active.promise;
    const snapshot = this.repo.getSession(sessionId);
    if (!snapshot) throw new Error(`会话不存在: ${sessionId}`);
    return snapshot;
  }

  cancel(sessionId: string): boolean {
    const run = this.active.get(sessionId);
    if (!run) return false;
    run.controller.abort(new Error('用户取消搜索'));
    return true;
  }

  get(sessionId: string): SessionSnapshot | null {
    return this.repo.getSession(sessionId);
  }

  history(limit = 20, q?: string): SessionSnapshot[] {
    return this.repo.listSessions(limit, q);
  }

  events(sessionId: string, after = 0): SearchEvent[] {
    return this.repo.listEvents(sessionId, after);
  }

  subscribe(sessionId: string, listener: EventListener): () => void {
    return this.hub.subscribe(sessionId, listener);
  }

  async shutdown(): Promise<void> {
    const pending = [...this.active.values()];
    for (const run of pending) run.controller.abort(new Error('服务正在关闭'));
    await Promise.allSettled(pending.map((run) => run.promise));
  }

  private async execute(sessionId: string, signal: AbortSignal): Promise<SessionSnapshot> {
    const started = Date.now();
    let partialFailures = 0;
    try {
      const session = this.requiredSession(sessionId);
      this.setStatus(sessionId, 'planning', '正在理解问题并拆分查询');
      const intent = classifyIntent(session.question, session.mode);
      this.publish(sessionId, 'intent.resolved', { intent });
      const plan = await this.createPlan(session, intent, signal);
      this.repo.savePlan(sessionId, intent, plan);
      this.publish(sessionId, 'plan.created', { queries: plan });

      this.setStatus(sessionId, 'searching', `正在并发执行 ${plan.length} 条差异化查询`);
      const limit = createLimiter(session.settings.maxConcurrency);
      const queryResults = await Promise.all(plan.map((query) => limit(async () => {
        try {
          return await this.runQuery(session, query, signal);
        } catch (err) {
          partialFailures++;
          const message = errorMessage(err);
          this.repo.markQueryFinished(query.id, 0, message);
          this.publish(sessionId, 'query.completed', {
            queryId: query.id,
            providerId: query.providerId,
            sourceCount: 0,
            elapsedMs: 0,
            error: message,
          });
          return { query, providerId: query.providerId, call: emptyCall(message), sources: [] } satisfies QueryResult;
        }
      })));

      let allSources = dedupeAndCluster(queryResults.flatMap((result) => result.sources));
      allSources = scoreSources(session.question, allSources).slice(0, session.settings.maxSources);
      for (const source of allSources) this.repo.updateSource(source);
      this.repo.replaceRankedSources(sessionId, allSources);
      this.setStatus(sessionId, 'ranking', `已筛选 ${allSources.length} 个高价值来源`);
      this.publish(sessionId, 'source.ranked', { sources: allSources });

      const { bodies, deadSources } = await this.fetchBodiesIfNeeded(session, allSources, signal);
      const evidence = extractEvidence(session.question, allSources, bodies);
      for (const item of evidence) {
        this.repo.addEvidence(item);
        this.publish(sessionId, 'evidence.added', { sourceId: item.sourceId, snippet: item.snippet });
      }

      if (session.mode === 'panel') this.persistPanelAnswers(sessionId, queryResults, allSources);

      this.setStatus(sessionId, 'synthesizing', '正在综合证据并校验引用');
      const evidenceContext = buildSynthesisContext(allSources, evidence, queryResults, session.mode);
      const synthesis = await this.synthesize(session, intent, evidenceContext, signal);
      if (synthesis.error) partialFailures++;
      let answer = synthesis.text.trim();
      if (!answer) answer = fallbackAnswer(session.question, allSources);
      answer = ensureAtLeastOneCitation(answer, allSources);
      const citations = mapInlineCitations(answer, allSources);
      let verification = verifyCitations(answer, allSources, citations, deadSources);
      verification = await this.judgeVerification(session, answer, allSources, verification, signal);
      const related = relatedQuestions(session.question, intent);

      this.repo.setFinalAnswer(
        sessionId,
        answer,
        citations,
        synthesis.providerId,
        synthesis.model,
      );
      const status = partialFailures > 0 ? 'partial' : 'completed';
      this.repo.updateSession(sessionId, {
        status,
        verification,
        relatedQuestions: related,
        consensus: session.mode === 'panel' ? deriveConsensus(queryResults) : undefined,
      });
      this.publish(sessionId, 'verification.done', { report: verification });
      this.publish(sessionId, 'related.questions', { questions: related });
      this.publish(sessionId, 'session.completed', { status, elapsedMs: Date.now() - started });
      return this.requiredSession(sessionId);
    } catch (err) {
      if (signal.aborted) {
        this.repo.updateSession(sessionId, { status: 'cancelled', error: errorMessage(signal.reason ?? err) });
        this.publish(sessionId, 'session.status', { status: 'cancelled', detail: '搜索已取消' });
        return this.requiredSession(sessionId);
      }
      const message = errorMessage(err);
      this.repo.updateSession(sessionId, { status: 'failed', error: message });
      this.publish(sessionId, 'session.failed', { error: message });
      return this.requiredSession(sessionId);
    }
  }

  private async createPlan(
    session: SessionSnapshot,
    intent: ReturnType<typeof classifyIntent>,
    signal: AbortSignal,
  ): Promise<PlannedQuery[]> {
    const fallback = planQueries(session.question, session.mode, intent, session.providerIds);
    const plannerId = session.settings.plannerProviderId;
    if (!plannerId || session.mode === 'panel') return fallback;
    const provider = this.providers.get(plannerId);
    if (!provider?.configured() || !provider.capabilities().plainGeneration) {
      this.publish(session.id, 'note', { text: 'Planner 不可用，使用本地确定性查询规划' });
      return fallback;
    }
    try {
      const call = await executeProviderCall(provider, {
        sessionId: session.id,
        queryId: `planner_${session.id}`,
        query: [
          `用户问题：${session.question}`,
          `意图标签：${JSON.stringify(intent)}`,
          `本地基线计划：${JSON.stringify(fallback.map((q) => ({ role: q.role, text: q.text, providerId: q.providerId })))}`,
          '只返回 JSON 数组，每项为 {"role":"core|latest|official|counter|altlang|social","text":"检索式","providerId":"可选"}。保留角色差异，禁止同义重复。',
        ].join('\n'),
        mode: session.mode,
        model: session.settings.models?.[plannerId],
        scope: 'none',
        maxSources: 0,
        maxOutputTokens: 1800,
        systemPrompt: '你是查询规划器。只输出可解析 JSON，不输出思维链、Markdown 或解释。',
      }, signal, {
        timeoutMs: Math.min(session.settings.timeoutMs, 90_000),
        retries: this.retries,
        onEvent: (event) => {
          if (event.type === 'usage') {
            this.repo.upsertUsage(session.id, {
              providerId: plannerId,
              model: event.model,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              calls: 1,
            });
          }
        },
      });
      const refined = parseModelPlan(call.text, session.providerIds);
      if (refined.length >= MODE_PROFILES[session.mode].queryRange[0]) {
        this.publish(session.id, 'note', { text: `${provider.label} 已细化查询计划` });
        return refined.slice(0, MODE_PROFILES[session.mode].queryRange[1]);
      }
      this.publish(session.id, 'note', { text: 'Planner 输出不完整，保留本地计划' });
    } catch (err) {
      this.publish(session.id, 'note', { text: `Planner 回退：${errorMessage(err)}` });
    }
    return fallback;
  }

  private async judgeVerification(
    session: SessionSnapshot,
    answer: string,
    sources: SourceRecord[],
    report: VerificationReport,
    signal: AbortSignal,
  ): Promise<VerificationReport> {
    const judgeId = session.settings.judgeProviderId;
    if (!judgeId) return report;
    const provider = this.providers.get(judgeId);
    if (!provider?.configured() || !provider.capabilities().plainGeneration) return report;
    try {
      const call = await executeProviderCall(provider, {
        sessionId: session.id,
        queryId: `judge_${session.id}`,
        query: [
          `答案：\n${answer.slice(0, 28_000)}`,
          `来源：\n${sources.map((s, i) => `[${i + 1}] ${s.title} | ${s.url} | ${s.snippet ?? ''}`).join('\n').slice(0, 28_000)}`,
          `本地校验：${JSON.stringify(report)}`,
          '只返回 JSON：{"notes":["公开可展示的简短问题"],"uncitedFacts":["缺引用事实句"]}。没有补充则返回空数组。',
        ].join('\n\n'),
        mode: session.mode,
        model: session.settings.models?.[judgeId],
        scope: 'none',
        maxSources: 0,
        maxOutputTokens: 1200,
        systemPrompt: '你是证据引用裁判。尝试反驳引用是否真正支持相邻结论；只输出 JSON，不输出隐藏思维链。',
      }, signal, {
        timeoutMs: Math.min(session.settings.timeoutMs, 90_000),
        retries: this.retries,
        onEvent: (event) => {
          if (event.type === 'usage') {
            this.repo.upsertUsage(session.id, {
              providerId: judgeId,
              model: event.model,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              calls: 1,
            });
          }
        },
      });
      const judged = parseJudgeResult(call.text);
      return {
        ...report,
        notes: [...new Set([...report.notes, ...judged.notes])].slice(0, 12),
        uncitedFacts: [...new Set([...report.uncitedFacts, ...judged.uncitedFacts])].slice(0, 8),
      };
    } catch (err) {
      this.publish(session.id, 'note', { text: `Judge 回退到本地规则：${errorMessage(err)}` });
      return report;
    }
  }

  private async runQuery(session: SessionSnapshot, query: PlannedQuery, signal: AbortSignal): Promise<QueryResult> {
    const started = Date.now();
    this.repo.markQueryStarted(query.id);
    this.publish(session.id, 'query.started', {
      queryId: query.id,
      role: query.role,
      text: query.text,
      providerId: query.providerId,
    });

    const sources: SourceRecord[] = [];
    const requested = this.providers.get(query.providerId);
    const provider = requested?.configured() ? requested : this.fallbackProvider(query.providerId, query.role === 'social');
    const providerId = provider.id;
    const request: ProviderSearchRequest = {
      sessionId: session.id,
      queryId: query.id,
      query: query.text,
      mode: session.mode,
      model: session.settings.models?.[providerId],
      scope: query.role === 'social' ? 'social' : session.mode === 'pulse' ? 'both' : 'web',
      maxSources: Math.max(3, Math.ceil(session.settings.maxSources / Math.max(1, session.plan?.length ?? 1))),
      allowedDomains: session.settings.allowedDomains,
      blockedDomains: session.settings.blockedDomains,
      language: query.language,
    };

    const call = await executeProviderCall(provider, request, signal, {
      timeoutMs: session.settings.timeoutMs,
      retries: this.retries,
      onRetry: (attempt, message) => this.publish(session.id, 'note', {
        text: `${provider.label} 第 ${attempt} 次重试：${message}`,
      }),
      onEvent: async (event) => {
        if (event.type === 'source') {
          const normalized = normalizeSource(event.source, {
            sessionId: session.id,
            queryId: query.id,
            providerId,
          });
          if (!normalized) return;
          const stored = this.repo.addSource(normalized);
          if (!sources.some((s) => s.id === stored.id)) sources.push(stored);
          this.publish(session.id, 'source.found', { source: stored });
        } else if (event.type === 'usage') {
          const record = {
            providerId,
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            calls: 1,
          };
          this.repo.upsertUsage(session.id, record);
          this.publish(session.id, 'usage.updated', { usage: this.requiredSession(session.id).usage });
        } else if (event.type === 'status' && event.detail) {
          this.publish(session.id, 'note', { text: event.detail });
        }
      },
    });

    this.repo.markQueryFinished(query.id, sources.length, call.error);
    this.publish(session.id, 'query.completed', {
      queryId: query.id,
      providerId,
      sourceCount: sources.length,
      elapsedMs: Date.now() - started,
      error: call.error,
    });
    return { query, providerId, call, sources };
  }

  private async synthesize(
    session: SessionSnapshot,
    intent: ReturnType<typeof classifyIntent>,
    evidenceContext: string,
    signal: AbortSignal,
  ): Promise<{ text: string; providerId: ProviderId; model: string; error?: string }> {
    const provider = this.synthesisProvider(session);
    const model = session.settings.models?.[provider.id] ?? provider.configStatus().defaultModel ?? '';
    const request: ProviderSearchRequest = {
      sessionId: session.id,
      queryId: `synthesis_${session.id}`,
      query: synthesisQuestion(session.question, session.mode),
      mode: session.mode,
      model: model || undefined,
      scope: 'none',
      maxSources: session.settings.maxSources,
      maxOutputTokens: session.mode === 'dive' || session.mode === 'panel' ? 6000 : 3000,
      systemPrompt: synthesisSystemPrompt(session.mode, intent),
      evidenceContext,
    };
    const call = await executeProviderCall(provider, request, signal, {
      timeoutMs: session.settings.timeoutMs,
      retries: this.retries,
      onEvent: (event: ProviderEvent) => {
        if (event.type === 'text.delta') this.publish(session.id, 'answer.delta', { text: event.text, providerId: provider.id });
        else if (event.type === 'citation') {
          const source = this.requiredSession(session.id).sources.find((s) => s.canonicalUrl === canonical(event.url));
          if (source) {
            const marker = this.requiredSession(session.id).sources.findIndex((s) => s.id === source.id) + 1;
            this.publish(session.id, 'citation.added', { citation: { marker, sourceId: source.id } });
          }
        } else if (event.type === 'usage') {
          this.repo.upsertUsage(session.id, {
            providerId: provider.id,
            model: event.model,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            calls: 1,
          });
          this.publish(session.id, 'usage.updated', { usage: this.requiredSession(session.id).usage });
        }
      },
    });
    return { text: call.text, providerId: provider.id, model: call.usage?.model ?? model, error: call.error };
  }

  private async fetchBodiesIfNeeded(
    session: SessionSnapshot,
    sources: SourceRecord[],
    signal: AbortSignal,
  ): Promise<{ bodies: Map<string, string>; deadSources: string[] }> {
    const bodies = new Map<string, string>();
    const deadSources: string[] = [];
    if (!MODE_PROFILES[session.mode].fetchBodies || !sources.length) return { bodies, deadSources };
    this.setStatus(session.id, 'fetching', '正在安全抓取高价值来源原文');
    const limit = createLimiter(Math.min(3, session.settings.maxConcurrency));
    await Promise.all(sources.slice(0, 10).map((source) => limit(async () => {
      const provider = this.providers.get(source.providerId);
      if (provider?.configStatus().baseUrl.startsWith('mock:')) return;
      try {
        const result = await this.fetcher.fetchText(source.url, signal);
        bodies.set(source.id, result.text.slice(0, 80_000));
      } catch (err) {
        deadSources.push(source.id);
        this.publish(session.id, 'note', { text: `来源抓取跳过：${source.domain}（${errorMessage(err)}）` });
      }
    })));
    return { bodies, deadSources };
  }

  private persistPanelAnswers(sessionId: string, results: QueryResult[], ranked: SourceRecord[]): void {
    for (const result of results) {
      const citations = result.call.citationUrls.map((url) => canonical(url))
        .map((url) => ranked.findIndex((source) => source.canonicalUrl === url))
        .filter((index) => index >= 0)
        .map((index) => ({ marker: index + 1, sourceId: ranked[index]!.id }));
      const answer = {
        providerId: result.providerId,
        model: result.call.usage?.model ?? '',
        content: result.call.text,
        citations,
        elapsedMs: 0,
        error: result.call.error,
      };
      this.repo.addPanelAnswer(sessionId, answer);
      this.publish(sessionId, 'panel.answer', { answer });
    }
  }

  private synthesisProvider(session: SessionSnapshot): SearchProvider {
    const preferred = session.settings.synthesizerProviderId;
    if (preferred) {
      const provider = this.providers.get(preferred);
      if (provider?.configured() && provider.capabilities().plainGeneration) return provider;
    }
    for (const id of session.providerIds) {
      const provider = this.providers.get(id);
      if (provider?.configured() && provider.capabilities().plainGeneration) return provider;
    }
    return this.providers.require('mock');
  }

  private fallbackProvider(exclude: ProviderId, social: boolean): SearchProvider {
    for (const id of this.providers.preferredIds()) {
      if (id === exclude) continue;
      const provider = this.providers.get(id);
      if (!provider?.configured()) continue;
      if (social && !provider.capabilities().socialSearch) continue;
      return provider;
    }
    const mock = this.providers.get('mock');
    if (mock) return mock;
    throw new Error(`Provider ${exclude} 不可用，且没有可用降级 Provider`);
  }

  private selectProviders(mode: SearchMode, requested?: ProviderId[]): ProviderId[] {
    const candidates = requested?.length ? requested : this.providers.preferredIds();
    const available = candidates.filter((id) => this.providers.get(id)?.configured());
    if (mode === 'pulse') {
      if (available.includes('xai')) return ['xai'];
      if (available.includes('mock')) return ['mock'];
      const social = available.find((id) => this.providers.get(id)?.capabilities().socialSearch);
      if (social) return [social];
    }
    if (mode === 'panel') return available.slice(0, 3);
    if (available.length) return available.slice(0, mode === 'dive' ? 3 : 1);
    const mock = this.providers.get('mock');
    if (mock) return ['mock'];
    throw new Error('没有已配置且启用的 Provider');
  }

  private setStatus(sessionId: string, status: SessionSnapshot['status'], detail?: string): void {
    this.repo.updateSession(sessionId, { status });
    this.publish(sessionId, 'session.status', { status, detail });
  }

  private publish<T extends SearchEventType>(sessionId: string, type: T, data: SearchEvent<T>['data']): SearchEvent<T> {
    return this.hub.publish(makeEvent(sessionId, type, data)) as SearchEvent<T>;
  }

  private requiredSession(id: string): SessionSnapshot {
    const session = this.repo.getSession(id);
    if (!session) throw new Error(`会话不存在: ${id}`);
    return session;
  }
}

function parseModelPlan(text: string, providers: ProviderId[]): PlannedQuery[] {
  const parsed = parseJsonFragment(text);
  if (!Array.isArray(parsed) || !providers.length) return [];
  const allowedRoles = new Set<QueryRole>(['core', 'latest', 'official', 'counter', 'altlang', 'social']);
  const seenRoles = new Set<QueryRole>();
  const result: PlannedQuery[] = [];
  for (const [index, raw] of parsed.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const value = raw as Record<string, unknown>;
    const role = value.role as QueryRole;
    const textValue = typeof value.text === 'string' ? value.text.trim() : '';
    if (!allowedRoles.has(role) || seenRoles.has(role) || textValue.length < 2 || textValue.length > 1200) continue;
    const requestedProvider = typeof value.providerId === 'string' ? value.providerId as ProviderId : undefined;
    const providerId = requestedProvider && providers.includes(requestedProvider)
      ? requestedProvider
      : role === 'social' && providers.includes('xai')
        ? 'xai'
        : providers[index % providers.length]!;
    result.push({ id: idOf.query(), role, text: textValue, providerId });
    seenRoles.add(role);
  }
  return result;
}

function parseJudgeResult(text: string): { notes: string[]; uncitedFacts: string[] } {
  const parsed = parseJsonFragment(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { notes: [], uncitedFacts: [] };
  const value = parsed as Record<string, unknown>;
  return {
    notes: stringArray(value.notes, 12, 240),
    uncitedFacts: stringArray(value.uncitedFacts, 8, 240),
  };
}

function parseJsonFragment(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {
    const arrayStart = trimmed.indexOf('[');
    const arrayEnd = trimmed.lastIndexOf(']');
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    const start = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart) ? arrayStart : objectStart;
    const end = start === arrayStart ? arrayEnd : objectEnd;
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  }
}

function stringArray(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function mergeSettings(mode: SearchMode, patch?: SearchRequestInput['options']): SessionSettings {
  return { ...defaultSettings(mode), ...patch };
}

function buildSynthesisContext(
  sources: SourceRecord[],
  evidence: ReturnType<typeof extractEvidence>,
  results: QueryResult[],
  mode: SearchMode,
): string {
  const evidenceText = formatEvidenceContext(sources, evidence);
  if (mode !== 'panel') return evidenceText;
  const panel = results.map((result) => [
    `模型研究报告(${result.providerId})：`,
    result.call.text || `该模型失败：${result.call.error ?? '无输出'}`,
  ].join('\n')).join('\n\n');
  return `${evidenceText}\n\n--- 独立模型研究报告（仅作为比较线索，事实仍须由上方证据支持） ---\n${panel}`;
}

function fallbackAnswer(question: string, sources: SourceRecord[]): string {
  if (!sources.length) return `未能为“${question}”找到足够、可验证的来源。请缩小问题范围或配置可用 Provider 后重试。`;
  return [
    `针对“${question}”，当前已找到 ${sources.length} 个可核验来源，但综合模型未返回完整文本。`,
    '',
    '可先核对以下高质量来源：',
    ...sources.slice(0, 5).map((source, i) => `- [${i + 1}] ${source.title}（${source.domain}，质量分 ${source.score}）`),
  ].join('\n');
}

function ensureAtLeastOneCitation(answer: string, sources: SourceRecord[]): string {
  if (!sources.length || /\[\d{1,3}\]/.test(answer)) return answer;
  return `${answer}\n\n关键来源：${sources.slice(0, 3).map((source, i) => `[${i + 1}] ${source.title}`).join('；')}`;
}

function deriveConsensus(results: QueryResult[]): string {
  const succeeded = results.filter((result) => result.call.text && !result.call.error);
  if (succeeded.length < 2) return '可用的独立模型结果不足，无法可靠判断跨模型共识。';
  return `${succeeded.length} 个模型完成独立研究；最终答案保留了共同结论与可见分歧。`;
}

function canonical(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    parsed.searchParams.forEach((_v, key) => {
      if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    });
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/$/, '');
    return parsed.toString();
  } catch { return url; }
}

function emptyCall(error: string): ProviderCallResult {
  return { text: '', citationUrls: [], sourceEvents: 0, error };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
