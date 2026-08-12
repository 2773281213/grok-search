import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider, ProviderRegistry, createProviderRegistry } from '@cairn/providers';
import { openDatabase, CairnRepository } from '@cairn/storage';
import { SearchEngine } from './engine.js';

const engines: SearchEngine[] = [];
const repos: CairnRepository[] = [];

function memoryEngine(registry = createProviderRegistry()): SearchEngine {
  const repo = new CairnRepository(openDatabase(':memory:'));
  const engine = new SearchEngine(repo, registry, { retries: 0 });
  repos.push(repo);
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  await Promise.allSettled(engines.splice(0).map((engine) => engine.shutdown()));
  for (const repo of repos.splice(0)) repo.close();
  vi.unstubAllEnvs();
});

describe('SearchEngine Mock integration', () => {
  it('快速搜索完整执行并可从持久化快照恢复', async () => {
    vi.stubEnv('CAIRN_MOCK', '1');
    const engine = memoryEngine(createProviderRegistry());
    const session = await engine.run({
      question: '如何实现可靠的流式 AI 搜索？',
      mode: 'flash',
      providers: ['mock'],
    });
    expect(session.status).toBe('completed');
    expect(session.plan?.length).toBeGreaterThanOrEqual(1);
    expect(session.sources.length).toBeGreaterThanOrEqual(3);
    expect(session.evidence.length).toBeGreaterThan(0);
    expect(session.answer).toContain('[1]');
    expect(session.citations.length).toBeGreaterThan(0);
    expect(session.verification?.danglingMarkers).toEqual([]);
    expect(session.usage.length).toBeGreaterThan(0);
    expect(engine.get(session.id)?.answer).toBe(session.answer);
  });

  it('事件先落库且 after 序号可恢复', async () => {
    vi.stubEnv('CAIRN_MOCK', '1');
    const engine = memoryEngine(createProviderRegistry());
    const live: number[] = [];
    const started = engine.start({ question: '查询 SSE 事件恢复', mode: 'flash', providers: ['mock'] });
    const unsubscribe = engine.subscribe(started.id, (event) => live.push(event.seq));
    const done = await engine.wait(started.id);
    unsubscribe();
    const persisted = engine.events(done.id, 0);
    expect(persisted.length).toBeGreaterThan(8);
    expect(persisted.every((event, i) => i === 0 || event.seq > persisted[i - 1]!.seq)).toBe(true);
    const midpoint = persisted[Math.floor(persisted.length / 2)]!.seq;
    expect(engine.events(done.id, midpoint).every((event) => event.seq > midpoint)).toBe(true);
    expect(live.length).toBeGreaterThan(0);
  });

  it('Mock panel 模式生成三个独立 Provider 结果、共识与最终综合', async () => {
    vi.stubEnv('CAIRN_MOCK', '1');
    const engine = memoryEngine(createProviderRegistry());
    const session = await engine.run({
      question: '比较 SSE 与 WebSocket 在 AI 搜索流式输出中的取舍',
      mode: 'panel',
    });
    expect(session.status).toBe('completed');
    expect(session.providerIds).toEqual(['xai', 'openai', 'anthropic']);
    expect(session.panelAnswers).toHaveLength(3);
    expect(new Set(session.panelAnswers?.map((a) => a.providerId))).toEqual(new Set(['xai', 'openai', 'anthropic']));
    expect(session.consensus).toContain('3 个模型');
    expect(session.answer).toContain('[1]');
  });

  it('深度研究在 Mock 下跳过真实抓取但仍完成证据流水线', async () => {
    vi.stubEnv('CAIRN_MOCK', '1');
    const engine = memoryEngine(createProviderRegistry());
    const session = await engine.run({
      question: '深入研究 AI 搜索中的来源质量、SSRF 和引用校验',
      mode: 'dive',
    });
    expect(session.status).toBe('completed');
    expect(session.plan?.some((q) => q.role === 'counter')).toBe(true);
    expect(session.sources.some((s) => s.kind === 'official')).toBe(true);
    expect(session.verification).toBeDefined();
  });

  it('用户取消后进入 cancelled 终态', async () => {
    const registry = new ProviderRegistry([{
      enabled: true,
      provider: new MockProvider({ id: 'mock', delayMs: 50 }),
    }]);
    const engine = memoryEngine(registry);
    const started = engine.start({ question: '一个会被取消的长搜索', mode: 'dive', providers: ['mock'] });
    expect(engine.cancel(started.id)).toBe(true);
    const result = await engine.wait(started.id);
    expect(result.status).toBe('cancelled');
    expect(result.error).toContain('用户取消');
  });

  it('未配置的显式 Provider 自动降级到 Mock', async () => {
    vi.stubEnv('CAIRN_MOCK', '0');
    vi.stubEnv('XAI_API_KEY', '');
    const engine = memoryEngine(createProviderRegistry());
    const result = await engine.run({ question: 'fallback test', mode: 'flash', providers: ['xai'] });
    expect(result.status).toBe('completed');
    expect(result.providerIds).toEqual(['mock']);
  });
});
