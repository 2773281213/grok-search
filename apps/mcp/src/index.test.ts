import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createNodeSearchRuntime, type NodeSearchRuntime } from '@cairn/search-core';
import { createCairnMcpServer } from './index.js';

let runtime: NodeSearchRuntime;
let client: Client;
let closeServer: () => Promise<void>;

beforeEach(async () => {
  vi.stubEnv('CAIRN_MOCK', '1');
  runtime = createNodeSearchRuntime({ dbPath: ':memory:', engine: { retries: 0 } });
  const server = createCairnMcpServer(runtime.engine);
  client = new Client({ name: 'cairn-test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closeServer = async () => {
    await client.close();
    await server.close();
  };
});

afterEach(async () => {
  await closeServer();
  await runtime.close();
  vi.unstubAllEnvs();
});

describe('Cairn MCP server', () => {
  it('暴露完整语义工具集', async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'cairn_flash_search',
      'cairn_deep_research',
      'cairn_parallel_questions',
      'cairn_compare_models',
      'cairn_task_status',
      'cairn_get_result',
      'cairn_cancel_task',
      'cairn_recent_history',
    ]));
  });

  it('快速搜索返回结构化答案、引用和来源', async () => {
    const result = await client.callTool({
      name: 'cairn_flash_search',
      arguments: {
        question: 'How should an AI search engine validate citations?',
        provider: 'mock',
        waitForCompletion: true,
        waitTimeoutMs: 10000,
      },
    });
    expect(result.isError).not.toBe(true);
    const structured = result.structuredContent as Record<string, any>;
    expect(structured.status).toBe('completed');
    expect(structured.answer).toContain('[1]');
    expect(structured.sources.length).toBeGreaterThan(0);
    expect(structured.citations.length).toBeGreaterThan(0);
  });

  it('深度任务异步返回 ID，随后可查询状态和结果', async () => {
    const started = await client.callTool({
      name: 'cairn_deep_research',
      arguments: { question: 'Research source quality scoring and SSRF protection', providers: ['mock'] },
    });
    const sessionId = (started.structuredContent as Record<string, string>).sessionId;
    expect(sessionId).toMatch(/^ses_/);
    if (!sessionId) throw new Error('MCP 未返回 sessionId');
    await runtime.engine.wait(sessionId);

    const status = await client.callTool({ name: 'cairn_task_status', arguments: { sessionId } });
    expect((status.structuredContent as Record<string, unknown>).status).toBe('completed');
    const full = await client.callTool({ name: 'cairn_get_result', arguments: { sessionId, includeEvidence: true } });
    expect((full.structuredContent as Record<string, any>).evidence.length).toBeGreaterThan(0);
  });

  it('并行问题为每个问题创建独立会话', async () => {
    const result = await client.callTool({
      name: 'cairn_parallel_questions',
      arguments: { questions: ['Question one?', 'Question two?'], provider: 'mock' },
    });
    const sessions = (result.structuredContent as Record<string, any>).sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).not.toBe(sessions[1].sessionId);
  });
});
