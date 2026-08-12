'use client';

import { Check, KeyRound, LoaderCircle, PlugZap, RefreshCw, Save, ServerCog, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AppSettings, ProviderId, ProviderRuntimeSettings, RoleModelConfig, SearchMode } from '@cairn/shared/client';

interface ProviderView {
  id: ProviderId;
  label: string;
  enabled: boolean;
  configured: boolean;
  simulated: boolean;
  capabilities: Record<string, boolean>;
  config: { hasKey: boolean; baseUrl: string; defaultModel?: string };
}

interface ProviderForm extends ProviderRuntimeSettings {
  baseUrl: string;
  defaultModel: string;
}

const ROLE_INFO: Array<{ id: keyof RoleModelConfig; label: string; description: string }> = [
  { id: 'planner', label: 'Planner', description: '复杂问题的查询拆分；不可用时回退到本地确定性规划。' },
  { id: 'researcher', label: 'Researcher', description: '默认执行联网检索的 Provider 与模型。' },
  { id: 'synthesizer', label: 'Synthesizer', description: '基于证据生成最终答案、共识与分歧。' },
  { id: 'judge', label: 'Judge', description: '引用和证据质量复核；始终保留本地规则校验。' },
];

export function SettingsConsole() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [forms, setForms] = useState<Partial<Record<ProviderId, ProviderForm>>>({});
  const [settings, setSettings] = useState<AppSettings>({ defaultMode: 'flash', roles: {} });
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const [providerResponse, settingsResponse] = await Promise.all([
      fetch('/api/providers', { cache: 'no-store' }),
      fetch('/api/settings', { cache: 'no-store' }),
    ]);
    const providerData = await providerResponse.json();
    const settingsData = await settingsResponse.json();
    const list = (providerData.providers ?? []) as ProviderView[];
    setProviders(list);
    setForms(Object.fromEntries(list.map((p) => [p.id, {
      enabled: p.enabled,
      baseUrl: p.config.baseUrl,
      defaultModel: p.config.defaultModel ?? '',
    }] as const)));
    setSettings(settingsData.settings ?? { defaultMode: 'flash', roles: {} });
  }

  useEffect(() => { void load().catch(() => setError('配置读取失败')); }, []);

  function patch(id: ProviderId, change: Partial<ProviderForm>) {
    setForms((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));
  }

  async function saveProvider(id: ProviderId) {
    setBusy(`save-${id}`); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/providers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forms[id]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '保存失败');
      setMessage(`${providerName(id)} 设置已保存`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setBusy(''); }
  }

  async function testProvider(id: ProviderId) {
    setBusy(`test-${id}`); setError(''); setMessage('');
    try {
      const response = await fetch(`/api/providers/${id}/test`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '连接失败');
      setMessage(`${providerName(id)} 连接成功：${data.latencyMs}ms，发现 ${data.modelCount} 个模型`);
    } catch (err) { setError(err instanceof Error ? err.message : '连接失败'); }
    finally { setBusy(''); }
  }

  async function loadModels(id: ProviderId) {
    setBusy(`models-${id}`); setError('');
    try {
      const response = await fetch(`/api/providers/${id}/models`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '模型列表读取失败');
      setModels((current) => ({ ...current, [id]: data.models.map((item: { id: string }) => item.id) }));
      setMessage(`${providerName(id)} 模型列表已刷新`);
    } catch (err) { setError(err instanceof Error ? err.message : '模型列表读取失败'); }
    finally { setBusy(''); }
  }

  function setRole(role: keyof RoleModelConfig, field: 'providerId' | 'model', value: string) {
    setSettings((current) => ({
      ...current,
      roles: {
        ...current.roles,
        [role]: {
          providerId: field === 'providerId' ? value as ProviderId : current.roles[role]?.providerId ?? 'mock',
          model: field === 'model' ? value || undefined : current.roles[role]?.model,
        },
      },
    }));
  }

  async function saveRoles() {
    setBusy('roles'); setError(''); setMessage('');
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '角色设置保存失败');
      setMessage('默认模式与角色模型设置已保存');
    } catch (err) { setError(err instanceof Error ? err.message : '角色设置保存失败'); }
    finally { setBusy(''); }
  }

  return (
    <main className="page-shell settings-shell">
      <header className="page-intro">
        <span className="eyebrow"><ServerCog size={15} /> SERVER-SIDE PROVIDER CONTROL</span>
        <h1>Provider 设置</h1>
        <p>这里只保存启用状态、Base URL 与模型 ID。API Key 仅从服务器环境变量读取，浏览器永远不会获得完整密钥。</p>
      </header>

      {message && <div className="inline-alert success"><Check size={17} />{message}</div>}
      {error && <div className="inline-alert error"><TriangleAlert size={17} />{error}</div>}

      <section className="provider-settings-grid">
        {providers.map((provider) => {
          const form = forms[provider.id];
          if (!form) return null;
          return (
            <article className="provider-setting-card" key={provider.id}>
              <header>
                <div><i className={`provider-dot provider-${provider.id}`} /><span><strong>{provider.label}</strong><small>{provider.simulated ? '本地 Mock 模拟，不产生费用' : provider.configured ? '已配置' : '等待服务端密钥或模型'}</small></span></div>
                <label className="toggle"><input type="checkbox" checked={form.enabled} onChange={(e) => patch(provider.id, { enabled: e.target.checked })} /><span /></label>
              </header>
              <div className="key-status"><KeyRound size={15} /><span>API Key</span><b>{provider.config.hasKey ? '•••••••• 已由环境变量提供' : provider.simulated ? 'Mock 无需密钥' : '未配置'}</b></div>
              <label>默认模型 ID
                <input list={`models-${provider.id}`} value={form.defaultModel} onChange={(e) => patch(provider.id, { defaultModel: e.target.value })} placeholder="可配置的模型 ID" />
                <datalist id={`models-${provider.id}`}>{models[provider.id]?.map((model) => <option key={model} value={model} />)}</datalist>
              </label>
              {provider.capabilities.configurableBaseUrl && <label>Base URL<input value={form.baseUrl} onChange={(e) => patch(provider.id, { baseUrl: e.target.value })} placeholder="https://api.example.com/v1" /></label>}
              <div className="capability-row">
                {Object.entries(provider.capabilities).filter(([, enabled]) => enabled).slice(0, 5).map(([name]) => <span key={name}>{capabilityLabel(name)}</span>)}
              </div>
              <footer>
                <button type="button" onClick={() => loadModels(provider.id)} disabled={Boolean(busy)}>{busy === `models-${provider.id}` ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}模型列表</button>
                <button type="button" onClick={() => testProvider(provider.id)} disabled={Boolean(busy)}>{busy === `test-${provider.id}` ? <LoaderCircle className="spin" size={15} /> : <PlugZap size={15} />}测试连接</button>
                <button className="primary-button" type="button" onClick={() => saveProvider(provider.id)} disabled={Boolean(busy)}>{busy === `save-${provider.id}` ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存</button>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="role-settings">
        <div className="section-heading"><span>工作流角色</span><small>按角色选择 Provider 与模型；不可用时自动回退，不中断整个搜索。</small></div>
        <div className="default-mode-row">
          <label>默认搜索模式<select value={settings.defaultMode} onChange={(e) => setSettings((s) => ({ ...s, defaultMode: e.target.value as SearchMode }))}><option value="flash">快速搜索</option><option value="dive">深度研究</option><option value="panel">多模型对比</option><option value="pulse">X 实时模式</option></select></label>
          <div><ShieldCheck size={18} /><span><strong>本地规则始终生效</strong><small>SSRF、去重、评分、引用映射和输入校验不会被模型配置绕过。</small></span></div>
        </div>
        <div className="role-grid">
          {ROLE_INFO.map((role) => {
            const value = settings.roles[role.id];
            return (
              <div className="role-card" key={role.id}>
                <span><strong>{role.label}</strong><small>{role.description}</small></span>
                <label>Provider<select value={value?.providerId ?? ''} onChange={(e) => setRole(role.id, 'providerId', e.target.value)}><option value="">自动</option>{providers.filter((p) => p.enabled).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
                <label>模型 ID<input value={value?.model ?? ''} onChange={(e) => setRole(role.id, 'model', e.target.value)} placeholder="留空使用 Provider 默认" /></label>
              </div>
            );
          })}
        </div>
        <button className="primary-button settings-save" type="button" onClick={saveRoles} disabled={Boolean(busy)}>{busy === 'roles' ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存工作流设置</button>
      </section>
    </main>
  );
}

function providerName(id: ProviderId): string {
  return ({ xai: 'xAI / Grok', openai: 'OpenAI / GPT', anthropic: 'Anthropic / Claude', mock: 'Cairn Mock' } as const)[id];
}

function capabilityLabel(name: string): string {
  return ({ nativeWebSearch: 'Web Search', socialSearch: 'X Search', streaming: 'Streaming', citations: 'Citations', modelDiscovery: 'Model List', configurableBaseUrl: 'Custom URL', plainGeneration: 'Synthesis' } as Record<string, string>)[name] ?? name;
}
