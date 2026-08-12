import type { ModelInfo, ProviderCapabilities, ProviderId } from '@cairn/shared';
import { sleep } from '@cairn/shared';
import type {
  ProviderConfig,
  ProviderEvent,
  ProviderSearchRequest,
  ProviderSourceCandidate,
  SearchProvider,
} from './types.js';

const FIXTURES: ProviderSourceCandidate[] = [
  {
    url: 'https://www.w3.org/WAI/fundamentals/accessibility-intro/',
    title: 'Introduction to Web Accessibility — W3C WAI',
    snippet: 'Web accessibility means that websites, tools, and technologies are designed so people with disabilities can use them.',
    kind: 'official',
    social: false,
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events',
    title: 'Using server-sent events — MDN Web Docs',
    snippet: 'Server-sent events let a server push updates to a web page over a persistent HTTP connection.',
    kind: 'official',
    social: false,
  },
  {
    url: 'https://www.sqlite.org/wal.html',
    title: 'Write-Ahead Logging — SQLite',
    snippet: 'WAL provides more concurrency because readers do not block writers and a writer does not block readers.',
    kind: 'official',
    social: false,
  },
  {
    url: 'https://owasp.org/www-community/attacks/Server_Side_Request_Forgery',
    title: 'Server Side Request Forgery — OWASP',
    snippet: 'SSRF lets an attacker induce a server-side application to make requests to an unintended location.',
    kind: 'official',
    social: false,
  },
  {
    url: 'https://github.com/modelcontextprotocol/typescript-sdk',
    title: 'Model Context Protocol TypeScript SDK',
    snippet: 'The official TypeScript SDK for building MCP clients and servers.',
    kind: 'repo',
    social: false,
  },
  {
    url: 'https://x.com/example/status/123456789',
    title: 'Example real-time community post',
    snippet: 'A mock social post used only for local development and end-to-end tests.',
    kind: 'social',
    social: true,
  },
];

/** 无密钥即可完整跑通流水线的确定性 Provider，可模拟三家适配器做 panel E2E。 */
export class MockProvider implements SearchProvider {
  readonly id: ProviderId;
  readonly label: string;
  private readonly delayMs: number;
  private readonly modelId: string;

  constructor(config: Partial<ProviderConfig> & {
    delayMs?: number;
    id?: ProviderId;
    label?: string;
    modelId?: string;
  } = {}) {
    this.id = config.id ?? 'mock';
    this.label = config.label ?? 'Cairn Mock';
    this.modelId = config.modelId ?? `cairn-mock-${this.id}-1`;
    this.delayMs = config.delayMs ?? 8;
  }

  capabilities(): ProviderCapabilities {
    return {
      nativeWebSearch: true,
      socialSearch: true,
      streaming: true,
      citations: true,
      modelDiscovery: true,
      configurableBaseUrl: false,
      plainGeneration: true,
    };
  }

  configured(): boolean { return true; }

  configStatus(): { hasKey: boolean; baseUrl: string; defaultModel?: string } {
    return { hasKey: false, baseUrl: 'mock://local', defaultModel: this.modelId };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: this.modelId, label: `${this.label} (Mock)` }];
  }

  async *search(request: ProviderSearchRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
    const model = request.model ?? this.modelId;
    yield { type: 'status', phase: 'connecting', detail: `${this.label} 本地模拟` };
    await sleep(this.delayMs, signal);

    const selected = selectFixtures(request);
    if (request.scope !== 'none') {
      yield { type: 'status', phase: 'searching', detail: `检索“${request.query.slice(0, 48)}”` };
      for (const source of selected) {
        await sleep(this.delayMs, signal);
        yield { type: 'source', source };
      }
    }

    yield { type: 'status', phase: 'generating' };
    const answer = mockAnswer(request, selected);
    for (const chunk of chunkText(answer, 24)) {
      await sleep(this.delayMs, signal);
      yield { type: 'text.delta', text: chunk };
    }
    for (const source of selected.slice(0, 3)) {
      yield { type: 'citation', url: source.url, title: source.title, citedText: source.snippet };
    }
    yield {
      type: 'usage',
      model,
      inputTokens: Math.ceil((request.query.length + (request.evidenceContext?.length ?? 0)) / 3),
      outputTokens: Math.ceil(answer.length / 3),
      searchCalls: request.scope === 'none' ? 0 : 1,
    };
    yield { type: 'done', finishReason: 'mock_completed' };
  }
}

function selectFixtures(request: ProviderSearchRequest): ProviderSourceCandidate[] {
  const social = request.scope === 'social';
  const both = request.scope === 'both';
  const pool = social ? FIXTURES.filter((s) => s.social) : both ? FIXTURES : FIXTURES.filter((s) => !s.social);
  return pool.slice(0, Math.max(1, request.maxSources));
}

function mockAnswer(request: ProviderSearchRequest, sources: ProviderSourceCandidate[]): string {
  if (request.evidenceContext) {
    return `基于已筛选证据，${request.query} 的结论应以可验证来源为准。证据显示流式传输、持久化恢复和输入边界防护是实现可靠 AI 搜索的关键。[1][2] 对安全敏感的来源抓取还必须阻止 SSRF，并限制协议、地址范围、响应大小与超时。[3]`;
  }
  if (request.scope === 'social') {
    return `这是 X 实时模式的 Mock 结果。社交内容可用于发现线索和观点，但未经独立来源交叉验证前不能视为事实。[1]`;
  }
  const marks = sources.slice(0, 3).map((_, i) => `[${i + 1}]`).join('');
  return `针对“${request.query}”，可靠实现需要把可观察的流式进度、可恢复的事件日志与来源质量控制结合起来。SSE 适合单向流式更新，SQLite WAL 有利于读写并发，而安全抓取必须防范 SSRF。${marks}`;
}

function* chunkText(text: string, size: number): Generator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
