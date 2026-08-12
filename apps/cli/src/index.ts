import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import pc from 'picocolors';
import {
  type ProviderId,
  type SearchEvent,
  type SearchMode,
  type SessionSnapshot,
} from '@cairn/shared';
import {
  createNodeSearchRuntime,
  serializeSession,
  type NodeSearchRuntime,
} from '@cairn/search-core';

let runtime: NodeSearchRuntime | undefined;
const getRuntime = () => runtime ??= createNodeSearchRuntime();

export function createProgram(): Command {
  const program = new Command();
  program
    .name('cairn')
    .description('Cairn evidence-first AI search CLI')
    .version('0.1.0');

  program.command('search')
    .description('发起搜索并流式显示可观察进度')
    .argument('<question...>', '搜索问题')
    .option('-m, --mode <mode>', 'flash|dive|panel|pulse', 'flash')
    .option('-p, --provider <provider...>', 'xai openai anthropic mock')
    .option('--model <id>', '覆盖单个 Provider 的模型 ID')
    .option('--max-sources <number>', '最多来源数', parseInteger)
    .option('--timeout <seconds>', '超时秒数', parseInteger)
    .option('--json', '输出结构化 JSON')
    .action(async (questionParts: string[], options: SearchOptions) => {
      const question = questionParts.join(' ');
      const mode = parseMode(options.mode);
      const providers = parseProviders(options.provider);
      const maxSources = options.maxSources ?? (mode === 'dive' ? 16 : 8);
      const timeoutMs = (options.timeout ?? (mode === 'dive' ? 300 : 120)) * 1000;
      const engine = getRuntime().engine;
      const session = engine.start({
        question,
        mode,
        providers,
        options: {
          maxSources,
          timeoutMs,
          models: options.model && providers?.length === 1 ? { [providers[0]!]: options.model } : undefined,
          includeSocial: mode === 'pulse',
        },
      });
      const unsubscribe = options.json ? () => undefined : streamToTerminal(engine, session.id);
      const result = await engine.wait(session.id);
      unsubscribe();
      if (!options.json) process.stderr.write('\n');
      print(Boolean(options.json), options.json ? serializeSession(result) : prettyResult(result));
      if (result.status === 'failed') process.exitCode = 1;
    });

  program.command('compare')
    .description('让多个 Provider 独立研究并综合共识与分歧')
    .argument('<question...>')
    .option('-p, --provider <provider...>', '指定 2–3 个 Provider')
    .option('--json')
    .action(async (parts: string[], options: { provider?: string[]; json?: boolean }) => {
      const providers = parseProviders(options.provider);
      if (providers && providers.length < 2) throw new Error('compare 至少需要两个 Provider');
      const engine = getRuntime().engine;
      const session = engine.start({ question: parts.join(' '), mode: 'panel', providers });
      const unsubscribe = options.json ? () => undefined : streamToTerminal(engine, session.id);
      const result = await engine.wait(session.id);
      unsubscribe();
      if (!options.json) process.stderr.write('\n');
      print(Boolean(options.json), options.json ? serializeSession(result) : prettyResult(result));
    });

  program.command('status')
    .description('查询会话状态')
    .argument('<session-id>')
    .option('--json')
    .action((id: string, options: { json?: boolean }) => {
      const session = requiredSession(id);
      print(Boolean(options.json), options.json ? serializeSession(session) : {
        id: session.id,
        status: session.status,
        mode: session.mode,
        question: session.question,
        sources: session.sources.length,
        citations: session.citations.length,
        updatedAt: session.updatedAt,
      });
    });

  program.command('result')
    .description('获取完整结构化结果')
    .argument('<session-id>')
    .option('--json')
    .action((id: string, options: { json?: boolean }) => {
      const session = requiredSession(id);
      print(Boolean(options.json), options.json ? serializeSession(session) : prettyResult(session));
    });

  program.command('cancel')
    .description('取消运行中的任务')
    .argument('<session-id>')
    .action((id: string) => {
      const cancelled = getRuntime().engine.cancel(id);
      process.stdout.write(cancelled ? `${pc.yellow('cancelled')} ${id}\n` : `${pc.dim('not running')} ${id}\n`);
    });

  program.command('history')
    .description('查看最近历史')
    .option('-n, --limit <number>', '数量', parseInteger, 20)
    .option('-q, --query <text>', '问题关键词')
    .option('--json')
    .action((options: { limit: number; query?: string; json?: boolean }) => {
      const sessions = getRuntime().engine.history(options.limit, options.query);
      if (options.json) {
        print(true, sessions.map(serializeSession));
        return;
      }
      if (!sessions.length) {
        process.stdout.write(`${pc.dim('No sessions.')}\n`);
        return;
      }
      for (const session of sessions) {
        process.stdout.write(`${statusColor(session.status)} ${pc.bold(session.id)} ${pc.dim(modeName(session.mode))}\n`);
        process.stdout.write(`  ${session.question}\n  ${pc.dim(`${session.sources.length} sources · ${new Date(session.createdAt).toLocaleString()}`)}\n`);
      }
    });

  program.command('providers')
    .description('显示 Provider 能力和遮蔽配置状态')
    .option('--json')
    .action((options: { json?: boolean }) => {
      const entries = getRuntime().providers.all().map(({ provider, enabled }) => ({
        id: provider.id,
        label: provider.label,
        enabled,
        configured: provider.configured(),
        simulated: provider.configStatus().baseUrl.startsWith('mock:'),
        capabilities: provider.capabilities(),
        config: provider.configStatus(),
      }));
      print(Boolean(options.json), entries);
    });

  return program;
}

async function main(): Promise<void> {
  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } finally {
    if (runtime) await runtime.close();
  }
}

function streamToTerminal(engine: NodeSearchRuntime['engine'], sessionId: string): () => void {
  return engine.subscribe(sessionId, (event: SearchEvent) => {
    if (event.type === 'answer.delta') {
      process.stdout.write((event.data as { text: string }).text);
      return;
    }
    if (event.type === 'session.status') {
      const data = event.data as { status: string; detail?: string };
      process.stderr.write(`\r${pc.cyan('◆')} ${data.detail ?? data.status}${' '.repeat(18)}`);
      return;
    }
    if (event.type === 'note') {
      process.stderr.write(`\r${pc.dim((event.data as { text: string }).text.slice(0, 80))}${' '.repeat(12)}`);
    }
  });
}

function prettyResult(session: SessionSnapshot): string {
  const lines: string[] = [];
  if (session.answer) lines.push(session.answer.trim());
  lines.push('', pc.bold('Sources'));
  for (const [index, source] of session.sources.entries()) {
    lines.push(`${pc.cyan(`[${index + 1}]`)} ${source.title}`);
    lines.push(`    ${pc.dim(source.url)} · score ${source.score} · ${source.kind}${source.social ? ' · unverified social' : ''}`);
  }
  lines.push('', `${pc.dim('session')} ${session.id} · ${statusColor(session.status)}`);
  if (session.error) lines.push(pc.red(session.error));
  return lines.join('\n');
}

function requiredSession(id: string): SessionSnapshot {
  const session = getRuntime().engine.get(id);
  if (!session) throw new Error(`Session not found: ${id}`);
  return session;
}

function print(json: boolean, value: unknown): void {
  process.stdout.write(typeof value === 'string' && !json ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function parseMode(value: string): SearchMode {
  if (!['flash', 'dive', 'panel', 'pulse'].includes(value)) throw new Error(`Invalid mode: ${value}`);
  return value as SearchMode;
}

function parseProviders(values?: string[]): ProviderId[] | undefined {
  if (!values?.length) return undefined;
  for (const value of values) {
    if (!['xai', 'openai', 'anthropic', 'mock'].includes(value)) throw new Error(`Invalid provider: ${value}`);
  }
  return values as ProviderId[];
}

function statusColor(status: SessionSnapshot['status']): string {
  if (status === 'completed') return pc.green(status);
  if (status === 'partial') return pc.yellow(status);
  if (status === 'failed' || status === 'cancelled') return pc.red(status);
  return pc.cyan(status);
}

function modeName(mode: SearchMode): string {
  return ({ flash: 'flash', dive: 'deep research', panel: 'model panel', pulse: 'X pulse' } as const)[mode];
}

interface SearchOptions {
  mode: string;
  provider?: string[];
  model?: string;
  maxSources?: number;
  timeout?: number;
  json?: boolean;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${pc.red('error')} ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { main };
