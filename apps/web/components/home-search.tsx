'use client';

import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  Check,
  Columns3,
  Globe2,
  Radio,
  Search,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  X,
  Zap,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderId, SearchMode, SessionSnapshot } from '@cairn/shared/client';

interface ProviderView {
  id: ProviderId;
  label: string;
  enabled: boolean;
  configured: boolean;
  simulated: boolean;
  capabilities: { socialSearch: boolean; nativeWebSearch: boolean };
  config: { defaultModel?: string };
}

const MODES: Array<{ id: SearchMode; label: string; short: string; icon: typeof Zap }> = [
  { id: 'flash', label: '快速搜索', short: '低延迟 · 5–8 个来源', icon: Zap },
  { id: 'dive', label: '深度研究', short: '多轮检索 · 证据校验', icon: Telescope },
  { id: 'panel', label: '多模型对比', short: '共识、分歧与证据强弱', icon: Columns3 },
  { id: 'pulse', label: 'X 实时模式', short: '网页与社交线索分开展示', icon: Radio },
];

const SUGGESTIONS = [
  '比较 PostgreSQL 与 SQLite 在边缘应用中的取舍',
  '调查最近一个月 AI Agent 安全领域的重要进展',
  '查找 Next.js 构建内存溢出的 GitHub Issue 解决方案',
  '从正反两面研究 AI 搜索引用是否真正可靠',
];

export function HomeSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<SearchMode>('flash');
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [selected, setSelected] = useState<ProviderId[]>([]);
  const [recent, setRecent] = useState<SessionSnapshot[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [maxSources, setMaxSources] = useState(8);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [filterKind, setFilterKind] = useState<'none' | 'allow' | 'block'>('none');
  const [domains, setDomains] = useState('');
  const [social, setSocial] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/providers').then((r) => r.json()),
      fetch('/api/history?limit=5').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ]).then(([providerData, historyData, settingsData]) => {
      const list = (providerData.providers ?? []) as ProviderView[];
      setProviders(list);
      const available = list.filter((p) => p.enabled && p.configured);
      const preferred = available.find((p) => p.id !== 'mock') ?? available[0];
      if (preferred) setSelected([preferred.id]);
      setRecent(historyData.sessions ?? []);
      if (settingsData.settings?.defaultMode) setMode(settingsData.settings.defaultMode);
    }).catch(() => setError('无法读取本地 Provider 配置'));
  }, []);

  const usableProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.configured && (mode !== 'pulse' || p.capabilities.socialSearch)),
    [providers, mode],
  );

  function chooseMode(next: SearchMode) {
    setMode(next);
    setSocial(next === 'pulse');
    const eligible = providers.filter((p) => p.enabled && p.configured && (next !== 'pulse' || p.capabilities.socialSearch));
    if (next === 'panel') setSelected(eligible.filter((p) => p.id !== 'mock').slice(0, 3).map((p) => p.id));
    else {
      const current = eligible.find((p) => selected.includes(p.id));
      setSelected(current ? [current.id] : eligible[0] ? [eligible[0].id] : []);
    }
    setMaxSources(next === 'flash' ? 8 : next === 'dive' ? 16 : 12);
    setTimeoutSeconds(next === 'dive' ? 300 : next === 'panel' ? 240 : 120);
  }

  function toggleProvider(id: ProviderId) {
    if (mode === 'panel') {
      setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(0, 3));
    } else {
      setSelected([id]);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length < 2 || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const domainList = domains.split(',').map((x) => x.trim()).filter(Boolean);
      const options: Record<string, unknown> = {
        maxSources,
        timeoutMs: timeoutSeconds * 1000,
        includeSocial: social || mode === 'pulse',
      };
      if (filterKind === 'allow' && domainList.length) options.allowedDomains = domainList;
      if (filterKind === 'block' && domainList.length) options.blockedDomains = domainList;
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          mode,
          providers: selected.length ? selected : undefined,
          options,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '搜索启动失败');
      router.push(mode === 'panel' ? `/compare/${data.session.id}` : `/search/${data.session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索启动失败');
      setSubmitting(false);
    }
  }

  return (
    <main className="home-shell">
      <section className="hero" aria-labelledby="hero-title">
        <div className="eyebrow"><Sparkles size={15} /> EVIDENCE-FIRST AI SEARCH</div>
        <h1 id="hero-title">答案会变化，<em>证据不该模糊。</em></h1>
        <p className="hero-copy">Cairn 让多个模型独立检索，再把来源、冲突与可信度垒成一份可核验的答案。</p>

        <form className="search-console" onSubmit={submit}>
          <label className="sr-only" htmlFor="main-question">输入搜索问题</label>
          <textarea
            ref={inputRef}
            id="main-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="问一个值得查证的问题…"
            rows={2}
            maxLength={2000}
            autoFocus
          />
          <div className="search-console-footer">
            <div className="provider-pills" aria-label="选择 Provider">
              {usableProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  className={selected.includes(provider.id) ? 'provider-pill selected' : 'provider-pill'}
                  onClick={() => toggleProvider(provider.id)}
                  aria-pressed={selected.includes(provider.id)}
                >
                  <span className={`provider-dot provider-${provider.id}`} />
                  {provider.label.replace(' / ', ' · ')}
                  {provider.simulated && <small>Mock</small>}
                  {selected.includes(provider.id) && <Check size={13} />}
                </button>
              ))}
              {!usableProviders.length && <span className="muted-inline">正在读取 Provider…</span>}
            </div>
            <div className="search-actions">
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button className="quiet-button" type="button"><SlidersHorizontal size={17} />高级</button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-overlay" />
                  <Dialog.Content className="advanced-dialog" aria-describedby="advanced-description">
                    <div className="dialog-heading">
                      <div>
                        <Dialog.Title>高级搜索边界</Dialog.Title>
                        <Dialog.Description id="advanced-description">控制来源数量、超时和域名范围。密钥始终只留在服务端。</Dialog.Description>
                      </div>
                      <Dialog.Close className="icon-button" aria-label="关闭"><X size={18} /></Dialog.Close>
                    </div>
                    <div className="field-grid two">
                      <label>最多来源<input type="number" min={1} max={30} value={maxSources} onChange={(e) => setMaxSources(Number(e.target.value))} /></label>
                      <label>超时（秒）<input type="number" min={5} max={600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} /></label>
                    </div>
                    <fieldset className="domain-filter">
                      <legend>域名筛选</legend>
                      <div className="segmented compact">
                        {([['none', '不限'], ['allow', '仅允许'], ['block', '排除']] as const).map(([id, label]) => (
                          <button key={id} type="button" className={filterKind === id ? 'active' : ''} onClick={() => setFilterKind(id)}>{label}</button>
                        ))}
                      </div>
                      {filterKind !== 'none' && (
                        <label>域名（逗号分隔）<input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="docs.example.com, github.com" /></label>
                      )}
                    </fieldset>
                    <label className="check-row">
                      <input type="checkbox" checked={social} onChange={(e) => setSocial(e.target.checked)} />
                      <span><strong>允许社交实时线索</strong><small>X 内容会独立展示，并标注为未经证实。</small></span>
                    </label>
                    <Dialog.Close asChild><button type="button" className="primary-button wide">应用边界</button></Dialog.Close>
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
              <button className="search-submit" type="submit" disabled={submitting || question.trim().length < 2}>
                {submitting ? <span className="spinner" /> : <Search size={20} />}
                <span>{submitting ? '建立会话' : '搜索'}</span>
                {!submitting && <ArrowRight size={18} />}
              </button>
            </div>
          </div>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="mode-grid" role="radiogroup" aria-label="搜索模式">
          {MODES.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} type="button" className={mode === item.id ? 'mode-card selected' : 'mode-card'} onClick={() => chooseMode(item.id)} role="radio" aria-checked={mode === item.id}>
                <Icon size={19} />
                <span><strong>{item.label}</strong><small>{item.short}</small></span>
                <i />
              </button>
            );
          })}
        </div>

        <div className="suggestion-row" aria-label="搜索建议">
          <span>试着搜索</span>
          {SUGGESTIONS.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); inputRef.current?.focus(); }}>{suggestion}</button>
          ))}
        </div>
      </section>

      <section className="home-lower">
        <div className="manifesto-card">
          <Globe2 size={23} />
          <div><strong>来源不是脚注，是答案的一部分。</strong><p>官方材料、论文、新闻与社区观点被分型、去重和评分；X 帖子永远不会和已验证事实混为一谈。</p></div>
        </div>
        <div className="recent-panel">
          <div className="section-heading"><span>最近搜索</span><a href="/history">查看全部</a></div>
          {recent.length ? recent.slice(0, 4).map((item) => (
            <a className="recent-item" key={item.id} href={item.mode === 'panel' ? `/compare/${item.id}` : `/search/${item.id}`}>
              <span className={`status-dot status-${item.status}`} />
              <strong>{item.question}</strong>
              <small>{modeLabel(item.mode)} · {item.sources.length} 个来源</small>
              <ArrowRight size={15} />
            </a>
          )) : <p className="empty-note">完成第一次搜索后，会话会在这里留下可恢复的记录。</p>}
        </div>
      </section>
    </main>
  );
}

function modeLabel(mode: SearchMode): string {
  return MODES.find((item) => item.id === mode)?.label ?? mode;
}
