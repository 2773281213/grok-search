import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ProviderId, SearchMode, SessionSnapshot } from '@cairn/shared';
import {
  createNodeSearchRuntime,
  serializeSession,
  type NodeSearchRuntime,
  type SearchEngine,
} from '@cairn/search-core';

const ProviderIdSchema = z.enum(['xai', 'openai', 'anthropic', 'mock']);

export function createCairnMcpServer(engine: SearchEngine): McpServer {
  const server = new McpServer({ name: 'cairn-search', version: '0.1.0' });

  server.registerTool('cairn_flash_search', {
    title: 'Cairn 快速搜索',
    description: '发起低延迟、证据优先的网页搜索。适合事实查询和最新 API 查证；可等待短任务完成或立即返回 session ID。',
    inputSchema: {
      question: z.string().min(2).max(2000).describe('明确、可检索的问题'),
      provider: ProviderIdSchema.optional().describe('指定研究 Provider；省略时使用默认配置'),
      model: z.string().max(120).optional().describe('覆盖该 Provider 的模型 ID'),
      maxSources: z.number().int().min(1).max(12).default(8),
      waitForCompletion: z.boolean().default(true),
      waitTimeoutMs: z.number().int().min(1000).max(120000).default(60000),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const session = engine.start({
      question: args.question,
      mode: 'flash',
      providers: args.provider ? [args.provider] : undefined,
      options: {
        maxSources: args.maxSources,
        models: args.provider && args.model ? { [args.provider]: args.model } : undefined,
      },
    });
    const result = args.waitForCompletion
      ? await waitForSession(engine, session.id, args.waitTimeoutMs)
      : session;
    return toolResult(serializeSession(result));
  });

  server.registerTool('cairn_deep_research', {
    title: 'Cairn 深度研究',
    description: '发起多轮查询、来源抓取、评分、证据抽取与冲突分析。默认异步返回 session ID，稍后用 cairn_task_status 或 cairn_get_result 查询。',
    inputSchema: {
      question: z.string().min(2).max(2000),
      providers: z.array(ProviderIdSchema).min(1).max(3).optional(),
      maxSources: z.number().int().min(5).max(30).default(16),
      timeoutMs: z.number().int().min(10000).max(600000).default(300000),
      allowedDomains: z.array(z.string()).max(20).optional(),
      blockedDomains: z.array(z.string()).max(20).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const session = engine.start({
      question: args.question,
      mode: 'dive',
      providers: args.providers,
      options: {
        maxSources: args.maxSources,
        timeoutMs: args.timeoutMs,
        allowedDomains: args.allowedDomains,
        blockedDomains: args.blockedDomains,
      },
    });
    return toolResult({ sessionId: session.id, status: session.status, next: 'Use cairn_task_status or cairn_get_result.' });
  });

  server.registerTool('cairn_parallel_questions', {
    title: 'Cairn 并行问题研究',
    description: '并行发起多个彼此独立的问题，每个问题获得独立 session ID；适合批量技术查证，不要用来拆分同一个复杂问题。',
    inputSchema: {
      questions: z.array(z.string().min(2).max(2000)).min(1).max(10),
      mode: z.enum(['flash', 'dive']).default('flash'),
      provider: ProviderIdSchema.optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const sessions = args.questions.map((question: string) => engine.start({
      question,
      mode: args.mode,
      providers: args.provider ? [args.provider] : undefined,
    }));
    return toolResult({ sessions: sessions.map((session: SessionSnapshot, index: number) => ({
      index,
      question: session.question,
      sessionId: session.id,
      status: session.status,
    })) });
  });

  server.registerTool('cairn_compare_models', {
    title: 'Cairn 多模型对比研究',
    description: '让 Grok、GPT、Claude（或已配置替代项）独立研究，再综合共识、分歧和证据强弱。异步返回 session ID。',
    inputSchema: {
      question: z.string().min(2).max(2000),
      providers: z.array(ProviderIdSchema).min(2).max(3).optional(),
      synthesizer: ProviderIdSchema.optional(),
      maxSources: z.number().int().min(5).max(30).default(12),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const session = engine.start({
      question: args.question,
      mode: 'panel',
      providers: args.providers,
      options: { maxSources: args.maxSources, synthesizerProviderId: args.synthesizer },
    });
    return toolResult({ sessionId: session.id, status: session.status, providers: session.providerIds, next: 'Use cairn_task_status or cairn_get_result.' });
  });

  server.registerTool('cairn_x_pulse', {
    title: 'Cairn X 实时脉搏',
    description: '使用支持 x_search 的 Provider 检索 X 实时讨论，并将社交线索与网页事实分开标注。',
    inputSchema: {
      question: z.string().min(2).max(2000),
      waitForCompletion: z.boolean().default(false),
      waitTimeoutMs: z.number().int().min(1000).max(120000).default(60000),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async (args) => {
    const session = engine.start({ question: args.question, mode: 'pulse', options: { includeSocial: true } });
    const result = args.waitForCompletion ? await waitForSession(engine, session.id, args.waitTimeoutMs) : session;
    return toolResult(serializeSession(result));
  });

  server.registerTool('cairn_task_status', {
    title: 'Cairn 任务状态',
    description: '查询异步搜索任务的状态、进度、来源数和最后事件序号。',
    inputSchema: { sessionId: z.string().min(5) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    const session = engine.get(sessionId);
    if (!session) return toolError('Session not found');
    return toolResult({
      sessionId: session.id,
      status: session.status,
      mode: session.mode,
      question: session.question,
      sourceCount: session.sources.length,
      citationCount: session.citations.length,
      lastEventSeq: session.lastEventSeq,
      updatedAt: session.updatedAt,
      error: session.error,
    });
  });

  server.registerTool('cairn_get_result', {
    title: 'Cairn 完整结果',
    description: '获取会话的结构化答案、内联引用映射、来源、证据、模型对比、用量与校验报告。任务未完成时也返回已有部分结果。',
    inputSchema: {
      sessionId: z.string().min(5),
      includeEvidence: z.boolean().default(true),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ sessionId, includeEvidence }) => {
    const session = engine.get(sessionId);
    if (!session) return toolError('Session not found');
    const serialized = serializeSession(session);
    if (!includeEvidence) delete (serialized as Record<string, unknown>).evidence;
    return toolResult(serialized);
  });

  server.registerTool('cairn_cancel_task', {
    title: 'Cairn 取消任务',
    description: '取消仍在运行的搜索任务；已完成任务不会被修改。',
    inputSchema: { sessionId: z.string().min(5) },
    annotations: { destructiveHint: true, openWorldHint: false },
  }, async ({ sessionId }) => {
    const cancelled = engine.cancel(sessionId);
    return toolResult({ sessionId, cancelled, status: engine.get(sessionId)?.status ?? 'not_found' });
  });

  server.registerTool('cairn_recent_history', {
    title: 'Cairn 最近历史',
    description: '查看最近的本地搜索历史，可按问题关键词过滤。',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
      query: z.string().max(200).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ limit, query }) => toolResult({
    sessions: engine.history(limit, query).map((session) => ({
      sessionId: session.id,
      question: session.question,
      mode: session.mode,
      status: session.status,
      sourceCount: session.sources.length,
      createdAt: session.createdAt,
    })),
  }));

  return server;
}

async function main(): Promise<void> {
  const runtime = createNodeSearchRuntime();
  const server = createCairnMcpServer(runtime.engine);
  const transport = new StdioServerTransport();
  const shutdown = async () => {
    await server.close().catch(() => undefined);
    await runtime.close();
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  await server.connect(transport);
}

async function waitForSession(engine: SearchEngine, id: string, timeoutMs: number): Promise<SessionSnapshot> {
  const result = await Promise.race([
    engine.wait(id),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  return result ?? engine.get(id)!;
}

function toolResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    // stdio 的 stdout 是 MCP 协议通道，错误只能写 stderr。
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export type { NodeSearchRuntime, ProviderId, SearchMode };
