import { lookup as dnsLookup } from 'node:dns/promises';
import {
  FETCH_LIMITS,
  htmlToText,
  isPrivateAddress,
  safeParseUrl,
} from '@cairn/shared';

export interface SecureFetcherOptions {
  fetch?: typeof fetch;
  allowPrivateHosts?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolve?: (host: string) => Promise<string[]>;
}

export interface FetchTextResult {
  url: string;
  text: string;
  contentType: string;
  bytes: number;
}

/**
 * 面向证据抓取的安全 HTTP 客户端：协议白名单、DNS/IP 私网阻断、每跳重验、
 * robots.txt、手动重定向、响应大小/类型/超时限制。不会执行 JavaScript。
 */
export class SecureFetcher {
  private readonly fetchFn: typeof fetch;
  private readonly allowPrivateHosts: boolean;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly resolveHost: (host: string) => Promise<string[]>;
  private readonly robotsCache = new Map<string, { expires: number; body: string }>();

  constructor(options: SecureFetcherOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.allowPrivateHosts = options.allowPrivateHosts ?? process.env.CAIRN_ALLOW_PRIVATE_HOSTS === '1';
    this.maxBytes = options.maxBytes ?? FETCH_LIMITS.maxBytes;
    this.timeoutMs = options.timeoutMs ?? FETCH_LIMITS.timeoutMs;
    this.maxRedirects = options.maxRedirects ?? FETCH_LIMITS.maxRedirects;
    this.resolveHost = options.resolve ?? defaultResolve;
  }

  async fetchText(input: string, parentSignal?: AbortSignal): Promise<FetchTextResult> {
    const url = safeParseUrl(input);
    if (!url) throw new Error('URL 仅允许 http/https 协议');
    await this.assertPublic(url.hostname);
    if (!(await this.robotsAllowed(url, parentSignal))) throw new Error('robots.txt 不允许抓取该路径');
    return this.request(url, parentSignal, 0);
  }

  private async request(url: URL, parentSignal: AbortSignal | undefined, redirects: number): Promise<FetchTextResult> {
    if (redirects > this.maxRedirects) throw new Error('重定向次数过多');
    await this.assertPublic(url.hostname);

    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) controller.abort(parentSignal.reason);
    else parentSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`抓取超时(${this.timeoutMs}ms)`)), this.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': FETCH_LIMITS.userAgent,
          Accept: 'text/html,text/plain,application/xhtml+xml;q=0.9',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`重定向缺少 Location(${response.status})`);
        const next = new URL(location, url);
        if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('重定向到不安全协议');
        await this.assertPublic(next.hostname);
        return await this.request(next, controller.signal, redirects + 1);
      }
      if (!response.ok) throw new Error(`抓取失败 HTTP ${response.status}`);

      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.toLowerCase();
      if (contentType && !FETCH_LIMITS.acceptTypes.includes(contentType)) {
        throw new Error(`不支持的内容类型: ${contentType}`);
      }
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > this.maxBytes) throw new Error(`响应过大(${declared} bytes)`);
      if (!response.body) return { url: url.toString(), text: '', contentType, bytes: 0 };

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.maxBytes) {
          await reader.cancel('response too large');
          throw new Error(`响应超过 ${this.maxBytes} bytes 限制`);
        }
        chunks.push(value);
      }
      const merged = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const raw = new TextDecoder(charsetOf(response.headers.get('content-type'))).decode(merged);
      const text = contentType === 'text/plain' ? raw : htmlToText(raw);
      return { url: url.toString(), text, contentType, bytes };
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  private async robotsAllowed(url: URL, signal?: AbortSignal): Promise<boolean> {
    const origin = url.origin;
    let cached = this.robotsCache.get(origin);
    if (!cached || cached.expires < Date.now()) {
      const robotsUrl = new URL('/robots.txt', origin);
      try {
        const result = await this.requestRobots(robotsUrl, signal);
        cached = { body: result, expires: Date.now() + 60 * 60 * 1000 };
      } catch {
        // robots 不可访问时按通行处理；HTTP 明确 401/403 除外由 requestRobots 返回规则。
        cached = { body: '', expires: Date.now() + 10 * 60 * 1000 };
      }
      this.robotsCache.set(origin, cached);
    }
    return evaluateRobots(cached.body, url.pathname + url.search);
  }

  private async requestRobots(url: URL, parentSignal?: AbortSignal): Promise<string> {
    await this.assertPublic(url.hostname);
    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5000));
    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { 'User-Agent': FETCH_LIMITS.userAgent, Accept: 'text/plain' },
      });
      if (response.status === 401 || response.status === 403) return 'User-agent: *\nDisallow: /';
      if (!response.ok) return '';
      return (await response.text()).slice(0, 256_000);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  private async assertPublic(host: string): Promise<void> {
    if (this.allowPrivateHosts) return;
    if (isPrivateAddress(host)) throw new Error('SSRF 防护：禁止访问私网或保留地址');
    const addresses = await this.resolveHost(host);
    if (!addresses.length) throw new Error('DNS 未返回地址');
    if (addresses.some(isPrivateAddress)) throw new Error('SSRF 防护：域名解析到私网或保留地址');
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  const results = await dnsLookup(host, { all: true, verbatim: true });
  return results.map((item) => item.address);
}

function charsetOf(contentType: string | null): string {
  const match = contentType?.match(/charset=([^;\s]+)/i);
  const charset = match?.[1]?.replace(/["']/g, '').toLowerCase();
  if (!charset || charset === 'utf8') return 'utf-8';
  // TextDecoder 在 Node 支持常见 WHATWG 编码；非法值回退 UTF-8。
  try { new TextDecoder(charset); return charset; } catch { return 'utf-8'; }
}

/** 解析与当前 bot 或 * 匹配的最具体 Allow/Disallow 规则。 */
export function evaluateRobots(body: string, path: string): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const matches = groups.filter((g) => g.agents.some((a) => a === '*' || a.includes('cairnbot')));
  const rules = matches.flatMap((g) => g.rules).filter((r) => path.startsWith(r.path));
  if (!rules.length) return true;
  rules.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow));
  return rules[0]!.allow;
}
