import { createProviderRegistry, type ProviderRegistry } from '@cairn/providers';
import { PROVIDER_IDS, type ProviderId, type ProviderRuntimeSettings } from '@cairn/shared';
import { CairnRepository, openDatabase } from '@cairn/storage';
import { SearchEngine, type SearchEngineOptions } from './engine.js';

export interface NodeSearchRuntime {
  repo: CairnRepository;
  providers: ProviderRegistry;
  engine: SearchEngine;
  close(): Promise<void>;
}

export interface NodeSearchRuntimeOptions {
  dbPath?: string;
  engine?: SearchEngineOptions;
  fetch?: typeof fetch;
}

/** Web、MCP、CLI 共用的 Node 运行时工厂。密钥仅由 Provider 工厂从环境读取。 */
export function createNodeSearchRuntime(options: NodeSearchRuntimeOptions = {}): NodeSearchRuntime {
  const repo = new CairnRepository(openDatabase(options.dbPath));
  const settings: Partial<Record<ProviderId, ProviderRuntimeSettings>> = {};
  for (const id of PROVIDER_IDS) {
    const value = repo.getProviderSettings(id);
    if (value) settings[id] = value;
  }
  const providers = createProviderRegistry({ settings, fetch: options.fetch });
  const engine = new SearchEngine(repo, providers, options.engine);
  return {
    repo,
    providers,
    engine,
    async close() {
      await engine.shutdown();
      repo.close();
    },
  };
}
