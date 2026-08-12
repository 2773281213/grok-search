import type { ModelInfo, ProviderCapabilities, ProviderId } from '@cairn/shared';
import { ProviderError } from '@cairn/shared';
import type { ProviderConfig, ProviderEvent, ProviderSearchRequest, SearchProvider } from './types.js';

export abstract class BaseProvider implements SearchProvider {
  abstract readonly id: ProviderId;
  abstract readonly label: string;
  protected readonly config: ProviderConfig;
  protected readonly fetchFn: typeof fetch;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.fetchFn = config.fetch ?? fetch;
  }

  abstract capabilities(): ProviderCapabilities;
  abstract listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  abstract search(request: ProviderSearchRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;

  configured(): boolean {
    return Boolean(this.config.apiKey && this.config.defaultModel);
  }

  configStatus(): { hasKey: boolean; baseUrl: string; defaultModel?: string } {
    return {
      hasKey: Boolean(this.config.apiKey),
      baseUrl: this.config.baseUrl,
      defaultModel: this.config.defaultModel,
    };
  }

  protected model(requestModel?: string): string {
    const model = requestModel || this.config.defaultModel;
    if (!model) {
      throw new ProviderError({
        kind: 'bad_request',
        providerId: this.id,
        message: `${this.label} 尚未配置模型 ID`,
      });
    }
    return model;
  }

  protected key(): string {
    if (!this.config.apiKey) {
      throw new ProviderError({ kind: 'auth', providerId: this.id, message: `${this.label} 未配置 API Key` });
    }
    return this.config.apiKey;
  }
}
