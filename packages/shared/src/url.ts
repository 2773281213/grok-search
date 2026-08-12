/** URL 规范化与安全解析 —— 去重、聚类、SSRF 防护的地基 */

const TRACKER_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'msclkid', 'dclid', 'twclid', 'igshid', 'mc_cid', 'mc_eid',
  'ref', 'ref_src', 'ref_url', 'spm', 'scm', 'share_token', 'from', 'src',
  '_hsenc', '_hsmi', 'vero_id', 'yclid', 's_kwcid',
]);

export function safeParseUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u;
  } catch {
    return null;
  }
}

/**
 * 规范化 URL 用于去重:
 * - 统一 https、去 www 前缀、主机小写
 * - 剔除跟踪参数,其余参数按名排序
 * - 展开常见 AMP 路径、去 hash、去尾斜杠
 */
export function canonicalizeUrl(input: string): string | null {
  const u = safeParseUrl(input);
  if (!u) return null;

  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);

  let path = u.pathname
    .replace(/\/amp\/?$/i, '/')
    .replace(/^\/amp\//i, '/');
  // 连续斜杠折叠
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  const params: [string, string][] = [];
  for (const [k, v] of u.searchParams) {
    if (TRACKER_PARAMS.has(k.toLowerCase())) continue;
    params.push([k, v]);
  }
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const qs = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';

  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';
  return `https://${host}${port}${path}${qs}`;
}

export function extractDomain(input: string): string {
  const u = safeParseUrl(input);
  if (!u) return '';
  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/** 判断 IP 是否属于私网/保留地址(SSRF 防护) */
export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv4
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // 组播与保留
    return false;
  }
  // IPv6
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (/^f[cd]/i.test(h)) return true;       // fc00::/7 ULA
    if (/^fe[89ab]/i.test(h)) return true;    // fe80::/10 link-local
    if (h.startsWith('::ffff:')) return isPrivateAddress(h.slice(7));
  }
  return false;
}
