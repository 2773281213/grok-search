import type {
  ModelInfo,
  ProviderCapabilities,
  ProviderId,
  SearchMode,
  SourceKind,
} from '@cairn/shared';

export type SearchScope = 'web' | 'social' | 'both' | 'none';

export interface ProviderSearchRequest {
  sessionId: string;
  queryId: string;
  query: string;
  mode: SearchMode;
  /** 模型 ID 始终可由调用方覆盖，不把 latest 写死在业务逻辑中 */
  model?: string;
  scope: SearchScope;
  maxSources: number;
  maxOutputTokens?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** 提醒 Provider 最终答案采用何种语言 */
  language?: string;
  /** 纯生成/综合时提供的系统指令 */
  systemPrompt?: string;
  /** 综合阶段共享的证据上下文；scope=none 时不触发联网工具 */
  evidenceContext?: string;
}

/** Provider 原始来源经最小归一化后的候选项，由 search-core 统一做 canonicalization/评分。 */
export interface ProviderSourceCandidate {
  url: string;
  title: string;
  snippet?: string;
  publishedAt?: string;
  kind?: SourceKind;
  social?: boolean;
}

export type ProviderEvent =
  | { type: 'status'; phase: 'connecting' | 'searching' | 'reading' | 'generating'; detail?: string }
  | { type: 'text.delta'; text: string }
  | { type: 'source'; source: ProviderSourceCandidate }
  | { type: 'citation'; url: string; title?: string; citedText?: string }
  | {
      type: 'usage';
      model: string;
      inputTokens: number;
      outputTokens: number;
      searchCalls?: number;
    }
  | { type: 'done'; finishReason?: string };

export interface ProviderConfig {
  apiKey?: string;
  baseUrl: string;
  defaultModel?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface SearchProvider {
  readonly id: ProviderId;
  readonly label: string;
  capabilities(): ProviderCapabilities;
  /** 密钥与模型已足够执行真实请求 */
  configured(): boolean;
  /** 返回遮蔽后的配置状态，绝不返回密钥本身 */
  configStatus(): { hasKey: boolean; baseUrl: string; defaultModel?: string };
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  search(request: ProviderSearchRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
