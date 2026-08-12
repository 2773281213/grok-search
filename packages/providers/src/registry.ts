import type { ProviderId, ProviderRuntimeSettings } from '@cairn/shared';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';
import type { SearchProvider } from './types.js';
import { XAIProvider } from './xai.js';

export interface RegistryEntry {
  provider: SearchProvider;
  enabled: boolean;
}

export class ProviderRegistry {
  private readonly entries = new Map<ProviderId, RegistryEntry>();

  constructor(entries: RegistryEntry[]) {
    for (const entry of entries) this.entries.set(entry.provider.id, entry);
  }

  get(id: ProviderId): SearchProvider | undefined {
    const entry = this.entries.get(id);
    return entry?.enabled ? entry.provider : undefined;
  }

  require(id: ProviderId): SearchProvider {
    const provider = this.get(id);
    if (!provider) throw new Error(`Provider ${id} 未启用`);
    return provider;
  }

  all(): RegistryEntry[] {
    return [...this.entries.values()];
  }

  availableIds(): ProviderId[] {
    return this.all().filter((e) => e.enabled && e.provider.configured()).map((e) => e.provider.id);
  }

  preferredIds(): ProviderId[] {
    const real = this.availableIds().filter((id) => id !== 'mock');
    return real.length ? real : this.availableIds();
  }
}

export interface RegistryOverrides {
  settings?: Partial<Record<ProviderId, ProviderRuntimeSettings>>;
  fetch?: typeof fetch;
}

/**
 * 从环境密钥 + 数据库可公开设置创建注册表。
 * API Key 只读环境变量，设置表永不存储密钥。
 */
export function createProviderRegistry(overrides: RegistryOverrides = {}): ProviderRegistry {
  const settings = overrides.settings ?? {};
  const xai = settings.xai;
  const openai = settings.openai;
  const anthropic = settings.anthropic;
  const mock = settings.mock;

  // 开发/测试模式用三个有独立身份的 Mock Provider 跑通真正的 panel 编排，
  // 不发送付费请求，也不冒充真实 API 结果（UI 会显示 Mock 标记）。
  if (process.env.CAIRN_MOCK === '1') {
    return new ProviderRegistry([
      { enabled: xai?.enabled ?? true, provider: new MockProvider({ id: 'xai', label: 'Grok 模拟', modelId: xai?.defaultModel ?? 'mock-grok-research' }) },
      { enabled: openai?.enabled ?? true, provider: new MockProvider({ id: 'openai', label: 'GPT 模拟', modelId: openai?.defaultModel ?? 'mock-gpt-research' }) },
      { enabled: anthropic?.enabled ?? true, provider: new MockProvider({ id: 'anthropic', label: 'Claude 模拟', modelId: anthropic?.defaultModel ?? 'mock-claude-research' }) },
      { enabled: mock?.enabled ?? true, provider: new MockProvider() },
    ]);
  }

  const entries: RegistryEntry[] = [
    {
      enabled: xai?.enabled ?? true,
      provider: new XAIProvider({
        apiKey: process.env.XAI_API_KEY,
        baseUrl: xai?.baseUrl || process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
        defaultModel: xai?.defaultModel || process.env.XAI_MODEL || 'grok-4.5',
        timeoutMs: xai?.timeoutMs,
        fetch: overrides.fetch,
      }),
    },
    {
      enabled: openai?.enabled ?? true,
      provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: openai?.baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        defaultModel: openai?.defaultModel || process.env.OPENAI_MODEL || 'gpt-5.6',
        timeoutMs: openai?.timeoutMs,
        fetch: overrides.fetch,
      }),
    },
    {
      enabled: anthropic?.enabled ?? true,
      provider: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        baseUrl: anthropic?.baseUrl || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        defaultModel: anthropic?.defaultModel || process.env.ANTHROPIC_MODEL || 'claude-opus-5',
        timeoutMs: anthropic?.timeoutMs,
        fetch: overrides.fetch,
      }),
    },
    {
      enabled: mock?.enabled ?? true,
      provider: new MockProvider(),
    },
  ];
  return new ProviderRegistry(entries);
}
