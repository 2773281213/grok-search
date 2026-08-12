'use client';

import { ArrowRight, CalendarDays, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { SearchMode, SessionSnapshot } from '@cairn/shared/client';

export function HistoryList() {
  const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/history?limit=100${query ? `&q=${encodeURIComponent(query)}` : ''}`, { cache: 'no-store' })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? '历史读取失败');
          setSessions(data.sessions ?? []);
          setError('');
        })
        .catch((err) => setError(err instanceof Error ? err.message : '历史读取失败'))
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const visible = useMemo(() => sessions.filter((item) => mode === 'all' || item.mode === mode), [sessions, mode]);

  return (
    <main className="page-shell history-shell">
      <header className="page-intro">
        <span className="eyebrow"><CalendarDays size={15} /> LOCAL RESEARCH ARCHIVE</span>
        <h1>搜索历史</h1>
        <p>完整结果、来源、用量与事件进度都保存在本机 SQLite；刷新结果页即可恢复。</p>
      </header>

      <section className="history-toolbar">
        <label><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索问题…" /></label>
        <div className="segmented" aria-label="按模式筛选">
          {([['all', '全部'], ['flash', '快速'], ['dive', '深研'], ['panel', '多模型'], ['pulse', 'X 实时']] as const).map(([id, label]) => (
            <button type="button" key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>{label}</button>
          ))}
        </div>
      </section>

      {error && <div className="inline-alert error">{error}</div>}
      <section className="history-list">
        {loading ? Array.from({ length: 4 }, (_, i) => <div className="history-skeleton" key={i} />) : visible.map((session) => (
          <Link key={session.id} className="history-card" href={session.mode === 'panel' ? `/compare/${session.id}` : `/search/${session.id}`}>
            <div className="history-card-top">
              <span className={`status-badge status-${session.status}`}>{statusLabel(session.status)}</span>
              <span>{new Date(session.createdAt).toLocaleString('zh-CN')}</span>
            </div>
            <h2>{session.question}</h2>
            <div className="history-stats">
              <span><SlidersHorizontal size={14} />{modeLabel(session.mode)}</span>
              <span>{session.sources.length} 个来源</span>
              <span>{session.citations.length} 个引用</span>
              <span>{session.usage.reduce((sum, u) => sum + u.inputTokens + u.outputTokens, 0)} tokens</span>
            </div>
            <ArrowRight className="history-arrow" size={18} />
          </Link>
        ))}
        {!loading && !visible.length && <div className="large-empty"><Search size={28} /><strong>没有匹配的研究会话</strong><p>换一个关键词或从首页开始第一次搜索。</p><Link href="/">开始搜索</Link></div>}
      </section>
    </main>
  );
}

function modeLabel(mode: SearchMode): string {
  return ({ flash: '快速搜索', dive: '深度研究', panel: '多模型对比', pulse: 'X 实时模式' } as const)[mode];
}

function statusLabel(status: SessionSnapshot['status']): string {
  return ({ queued: '排队', planning: '规划', searching: '检索', fetching: '抓取', ranking: '评分', synthesizing: '综合', completed: '完成', partial: '部分完成', failed: '失败', cancelled: '取消' } as const)[status];
}
