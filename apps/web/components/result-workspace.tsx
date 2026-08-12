'use client';

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  FileCheck2,
  Globe2,
  Layers3,
  LoaderCircle,
  MessageSquarePlus,
  PauseCircle,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  TERMINAL_STATUSES,
  type PanelAnswer,
  type SearchEvent,
  type SessionSnapshot,
  type SessionStatus,
  type SourceRecord,
} from '@cairn/shared/client';

const EVENT_NAMES = [
  'session.created', 'session.status', 'intent.resolved', 'plan.created', 'query.started',
  'query.completed', 'source.found', 'source.ranked', 'evidence.added', 'answer.delta',
  'citation.added', 'panel.answer', 'usage.updated', 'verification.done', 'related.questions',
  'note', 'session.completed', 'session.failed',
] as const;

const PIPELINE: Array<{ status: SessionStatus; label: string; icon: typeof Search }> = [
  { status: 'planning', label: '理解与拆分', icon: Sparkles },
  { status: 'searching', label: '并发检索', icon: Globe2 },
  { status: 'fetching', label: '读取原文', icon: BookOpen },
  { status: 'ranking', label: '来源评分', icon: ShieldCheck },
  { status: 'synthesizing', label: '综合与校验', icon: FileCheck2 },
  { status: 'completed', label: '完成', icon: Check },
];

export function ResultWorkspace({ sessionId, compare = false }: { sessionId: string; compare?: boolean }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionSnapshot | null>(null);
  const [liveAnswer, setLiveAnswer] = useState('');
  const [note, setNote] = useState('正在读取会话…');
  const [loadError, setLoadError] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/search/${sessionId}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? '会话读取失败');
    const next = data.session as SessionSnapshot;
    setSession(next);
    setQuestion(next.question);
    if (next.answer) setLiveAnswer(next.answer);
    if (TERMINAL_STATUSES.includes(next.status)) setNote(terminalNote(next.status));
    return next;
  }, [sessionId]);

  useEffect(() => {
    let source: EventSource | undefined;
    let disposed = false;
    void refresh().then((initial) => {
      if (disposed || TERMINAL_STATUSES.includes(initial.status)) return;
      source = new EventSource(`/api/search/${sessionId}/stream?after=${initial.lastEventSeq}`);
      const scheduleRefresh = () => {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void refresh().catch(() => undefined), 100);
      };
      for (const name of EVENT_NAMES) {
        source.addEventListener(name, (raw) => {
          const event = JSON.parse((raw as MessageEvent).data) as SearchEvent;
          if (event.type === 'answer.delta') {
            setLiveAnswer((current) => current + (event.data as { text: string }).text);
          } else if (event.type === 'note') {
            setNote((event.data as { text: string }).text);
          } else if (event.type === 'session.status') {
            const data = event.data as { status: SessionStatus; detail?: string };
            if (data.detail) setNote(data.detail);
          }
          scheduleRefresh();
          if (event.type === 'session.completed' || event.type === 'session.failed') source?.close();
        });
      }
      source.onerror = () => {
        source?.close();
        void refresh().catch(() => setLoadError('流式连接已中断，刷新页面可恢复进度。'));
      };
    }).catch((error) => setLoadError(error instanceof Error ? error.message : '会话读取失败'));
    return () => {
      disposed = true;
      source?.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh, sessionId]);

  const answer = liveAnswer || session?.answer || '';
  const isTerminal = session ? TERMINAL_STATUSES.includes(session.status) : false;
  const elapsed = session ? Math.max(0, Date.parse(session.completedAt ?? session.updatedAt) - Date.parse(session.createdAt)) : 0;

  async function newSearch(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy || !session) return;
    setBusy(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), mode: session.mode, providers: session.providerIds, options: session.settings }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '搜索启动失败');
      router.push(session.mode === 'panel' ? `/compare/${data.session.id}` : `/search/${data.session.id}`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '搜索启动失败');
      setBusy(false);
    }
  }

  async function submitFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!followUp.trim() || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/search/${sessionId}/follow-up`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: followUp.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '追问启动失败');
      router.push(data.session.mode === 'panel' ? `/compare/${data.session.id}` : `/search/${data.session.id}`);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '追问启动失败');
      setBusy(false);
    }
  }

  async function cancel() {
    await fetch(`/api/search/${sessionId}/cancel`, { method: 'POST' });
    await refresh();
  }

  if (!session) {
    return (
      <main className="result-shell loading-shell">
        <div className="loading-orbit"><span /><span /><span /></div>
        <h1>正在恢复研究现场</h1>
        <p>{loadError || '从事件日志读取会话、来源和流式进度…'}</p>
      </main>
    );
  }

  return (
    <main className="result-shell">
      <section className="sticky-query">
        <Link href="/" className="icon-button" aria-label="返回首页"><ArrowLeft size={18} /></Link>
        <form onSubmit={newSearch}>
          <Search size={18} />
          <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="修改问题并重新搜索" />
          <button type="submit" disabled={busy}><ArrowRight size={17} /></button>
        </form>
        {!isTerminal && <button className="danger-quiet" type="button" onClick={cancel}><PauseCircle size={16} />取消</button>}
      </section>

      <header className="result-header">
        <div>
          <span className={`status-badge status-${session.status}`}>{statusLabel(session.status)}</span>
          <h1>{session.question}</h1>
        </div>
        <div className="result-metrics">
          <Metric label="模式" value={modeLabel(session.mode)} />
          <Metric label="来源" value={String(session.sources.length)} />
          <Metric label="耗时" value={elapsed ? formatDuration(elapsed) : '进行中'} />
          <Metric label="模型" value={String(new Set(session.usage.map((u) => u.providerId)).size || session.providerIds.length)} />
        </div>
      </header>

      <section className="pipeline-card" aria-label="搜索进度">
        <div className="pipeline-heading"><span>研究路径</span><small>{note}</small></div>
        <div className="pipeline-track">
          {PIPELINE.map((step, index) => {
            const state = stepState(session.status, step.status);
            const Icon = step.icon;
            return (
              <div key={step.status} className={`pipeline-step ${state}`}>
                <span>{state === 'active' ? <LoaderCircle className="spin" size={17} /> : <Icon size={17} />}</span>
                <small>{step.label}</small>
                {index < PIPELINE.length - 1 && <i />}
              </div>
            );
          })}
        </div>
        {session.plan?.length ? (
          <details className="plan-details">
            <summary>查看结构化查询计划（{session.plan.length} 条）</summary>
            <div>{session.plan.map((query) => <span key={query.id}><b>{query.role}</b>{query.text.split('\n')[0]}<small>{query.providerId}</small></span>)}</div>
          </details>
        ) : null}
      </section>

      {loadError && <div className="inline-alert"><CircleAlert size={17} />{loadError}</div>}
      {session.error && <div className="inline-alert error"><XCircle size={17} />{session.error}</div>}

      {compare || session.mode === 'panel' ? (
        <PanelComparison session={session} answer={answer} />
      ) : (
        <div className="result-grid">
          <article className="answer-card">
            <AnswerHeader session={session} answer={answer} />
            {answer ? <CitedAnswer text={answer} sources={session.sources} /> : <AnswerSkeleton />}
            {session.verification && <VerificationBar session={session} />}
          </article>
          <aside className="source-rail">
            <div className="rail-heading"><span>来源地图</span><small>按证据价值排序</small></div>
            {session.sources.map((source, index) => <SourceCard key={source.id} source={source} marker={index + 1} />)}
            {!session.sources.length && <p className="empty-note">来源到达后会显示在这里。</p>}
          </aside>
        </div>
      )}

      {session.evidence.length > 0 && (
        <section className="evidence-section">
          <div className="section-heading"><span>结论与证据对应</span><small>仅展示可公开的证据片段，不展示隐藏思维链</small></div>
          <div className="evidence-grid">
            {session.evidence.slice(0, 8).map((item) => {
              const source = session.sources.find((s) => s.id === item.sourceId);
              return (
                <blockquote key={item.id}>
                  <p>{item.snippet}</p>
                  <footer>{source ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}<ExternalLink size={12} /></a> : '来源已聚类'}</footer>
                </blockquote>
              );
            })}
          </div>
        </section>
      )}

      <section className="followup-section">
        <div><MessageSquarePlus size={24} /><span><strong>继续追问</strong><small>追问会继承当前模式、Provider 与来源边界。</small></span></div>
        <form onSubmit={submitFollowUp}>
          <input value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="追问证据、限制或实施细节…" />
          <button className="primary-button" type="submit" disabled={busy || followUp.trim().length < 2}>继续研究<ArrowRight size={16} /></button>
        </form>
        {session.relatedQuestions?.length ? <div className="related-row">{session.relatedQuestions.map((item) => <button type="button" key={item} onClick={() => setFollowUp(item)}>{item}</button>)}</div> : null}
      </section>
    </main>
  );
}

function AnswerHeader({ session, answer }: { session: SessionSnapshot; answer: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(answer);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  async function share() {
    if (navigator.share) await navigator.share({ title: session.question, text: answer, url: location.href });
    else await navigator.clipboard.writeText(location.href);
  }
  return (
    <div className="answer-heading">
      <div><Sparkles size={19} /><span><strong>综合答案</strong><small>{session.citations.length} 个内联引用</small></span></div>
      <div><button type="button" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制'}</button><button type="button" onClick={share}><Share2 size={15} />分享</button></div>
    </div>
  );
}

function CitedAnswer({ text, sources }: { text: string; sources: SourceRecord[] }) {
  const blocks = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="answer-prose">
      {blocks.map((block, index) => {
        if (/^#{1,3}\s/.test(block)) return <h2 key={index}>{inline(block.replace(/^#{1,3}\s*/, ''), sources)}</h2>;
        const lines = block.split('\n');
        if (lines.every((line) => /^[-*]\s/.test(line))) {
          return <ul key={index}>{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*]\s*/, ''), sources)}</li>)}</ul>;
        }
        return <p key={index}>{inline(block, sources)}</p>;
      })}
    </div>
  );
}

function inline(text: string, sources: SourceRecord[]): ReactNode[] {
  return text.split(/(\[\d{1,3}\])/g).filter(Boolean).map((part, index) => {
    const match = part.match(/^\[(\d{1,3})\]$/);
    if (!match) return <span key={index}>{part}</span>;
    const marker = Number(match[1]);
    const source = sources[marker - 1];
    if (!source) return <sup key={index} className="citation dangling">{part}</sup>;
    return <a key={index} className="citation" href={source.url} target="_blank" rel="noreferrer" title={source.title}>[{marker}]</a>;
  });
}

function PanelComparison({ session, answer }: { session: SessionSnapshot; answer: string }) {
  const [active, setActive] = useState(session.panelAnswers?.[0]?.providerId ?? session.providerIds[0]);
  const selected = session.panelAnswers?.find((item) => item.providerId === active);
  return (
    <div className="compare-layout">
      <section className="consensus-card">
        <div className="answer-heading"><div><Layers3 size={20} /><span><strong>跨模型综合</strong><small>共识、分歧与证据强弱</small></span></div></div>
        {answer ? <CitedAnswer text={answer} sources={session.sources} /> : <AnswerSkeleton />}
        {session.consensus && <div className="consensus-note"><Check size={16} />{session.consensus}</div>}
        {session.verification && <VerificationBar session={session} />}
      </section>
      <section className="panel-card">
        <div className="panel-tabs" role="tablist" aria-label="模型独立结果">
          {session.panelAnswers?.map((item) => <button key={item.providerId} role="tab" aria-selected={active === item.providerId} className={active === item.providerId ? 'active' : ''} onClick={() => setActive(item.providerId)}><i className={`provider-dot provider-${item.providerId}`} />{providerLabel(item.providerId)}</button>)}
        </div>
        {selected ? <PanelAnswerView answer={selected} sources={session.sources} /> : <p className="empty-note">独立模型结果仍在生成。</p>}
      </section>
      <section className="comparison-metrics">
        {session.usage.map((usage) => <div key={`${usage.providerId}-${usage.model}`}><span><i className={`provider-dot provider-${usage.providerId}`} />{providerLabel(usage.providerId)}</span><strong>{usage.inputTokens + usage.outputTokens}</strong><small>tokens · {usage.calls} calls</small></div>)}
      </section>
      <section className="compare-sources">
        <div className="section-heading"><span>共享来源池</span><small>每个模型独立检索后合并去重</small></div>
        <div className="source-grid">{session.sources.map((source, i) => <SourceCard key={source.id} source={source} marker={i + 1} />)}</div>
      </section>
    </div>
  );
}

function PanelAnswerView({ answer, sources }: { answer: PanelAnswer; sources: SourceRecord[] }) {
  return (
    <div className="panel-answer">
      <div className="panel-answer-meta"><span>{answer.model || '默认模型'}</span><span>{answer.citations.length} 引用</span>{answer.error && <span className="error-text">部分失败</span>}</div>
      <CitedAnswer text={answer.content || answer.error || '模型未返回结果。'} sources={sources} />
    </div>
  );
}

function SourceCard({ source, marker }: { source: SourceRecord; marker: number }) {
  return (
    <a className="source-card" href={source.url} target="_blank" rel="noreferrer">
      <div className="source-top"><span className="source-marker">{marker}</span><span className={`source-kind kind-${source.kind}`}>{kindLabel(source.kind)}</span>{source.social && <span className="unverified">未经证实</span>}<ExternalLink size={14} /></div>
      <strong>{source.title}</strong>
      <small>{source.domain}{source.publishedAt ? ` · ${formatDate(source.publishedAt)}` : ''}</small>
      {source.snippet && <p>{source.snippet}</p>}
      <div className="quality-row"><span><i style={{ width: `${source.score}%` }} /></span><b>{source.score}</b></div>
    </a>
  );
}

function VerificationBar({ session }: { session: SessionSnapshot }) {
  const report = session.verification!;
  const healthy = report.danglingMarkers.length === 0 && report.deadSources.length === 0;
  return (
    <div className={`verification-bar ${healthy ? 'healthy' : 'warning'}`}>
      {healthy ? <ShieldCheck size={17} /> : <CircleAlert size={17} />}
      <span><strong>{healthy ? '引用校验通过' : '引用存在限制'}</strong><small>{report.checked} 个引用已映射 · {report.uncitedFacts.length} 条疑似缺引用事实 · {report.deadSources.length} 个失效来源</small></span>
    </div>
  );
}

function AnswerSkeleton() {
  return <div className="answer-skeleton"><i /><i /><i /><i /></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>;
}

function stepState(current: SessionStatus, step: SessionStatus): 'done' | 'active' | 'idle' {
  if (current === 'failed' || current === 'cancelled') return 'idle';
  if (current === 'partial' || current === 'completed') return 'done';
  const order = ['queued', 'planning', 'searching', 'fetching', 'ranking', 'synthesizing', 'completed'];
  const currentIndex = order.indexOf(current);
  const stepIndex = order.indexOf(step);
  return stepIndex < currentIndex ? 'done' : stepIndex === currentIndex ? 'active' : 'idle';
}

function statusLabel(status: SessionStatus): string {
  return ({ queued: '排队中', planning: '规划中', searching: '检索中', fetching: '读取原文', ranking: '来源评分', synthesizing: '正在综合', completed: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消' } as const)[status];
}

function terminalNote(status: SessionStatus): string {
  return ({
    completed: '检索完成，引用已校验',
    partial: '部分来源不可用，已保留可验证结果',
    failed: '检索失败，可返回首页重试',
    cancelled: '检索已取消',
  } as Partial<Record<SessionStatus, string>>)[status] ?? '检索已结束';
}

function modeLabel(mode: SessionSnapshot['mode']): string {
  return ({ flash: '快速', dive: '深研', panel: '多模型', pulse: 'X 实时' } as const)[mode];
}

function providerLabel(id: string): string {
  return ({ xai: 'Grok', openai: 'GPT', anthropic: 'Claude', mock: 'Mock' } as Record<string, string>)[id] ?? id;
}

function kindLabel(kind: SourceRecord['kind']): string {
  return ({ official: '官方', paper: '论文', gov: '机构', repo: '仓库', news: '新闻', community: '社区', social: 'X', blog: '博客', other: '网页' } as const)[kind];
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round(ms % 60_000 / 1000)}s`;
}

function formatDate(input: string): string {
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : input;
}
