import { describe, expect, it } from 'vitest';
import { SecureFetcher, evaluateRobots } from './fetcher.js';

function fakeFetch(routes: Record<string, Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : input.toString();
    const response = routes[url];
    return response ? response.clone() : new Response('not found', { status: 404 });
  }) as typeof fetch;
}

const publicResolve = async () => ['93.184.216.34'];

describe('evaluateRobots', () => {
  it('最长 Allow 覆盖较短 Disallow', () => {
    const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/public';
    expect(evaluateRobots(robots, '/private/secret')).toBe(false);
    expect(evaluateRobots(robots, '/private/public/page')).toBe(true);
  });
});

describe('SecureFetcher', () => {
  it('DNS 前阻止显式私网地址', async () => {
    let called = false;
    const fetcher = new SecureFetcher({
      fetch: (async () => { called = true; return new Response('x'); }) as typeof fetch,
      resolve: publicResolve,
    });
    await expect(fetcher.fetchText('http://127.0.0.1/admin')).rejects.toThrow('SSRF');
    expect(called).toBe(false);
  });

  it('读取 robots 后抓取并清洗 HTML', async () => {
    const fetcher = new SecureFetcher({
      fetch: fakeFetch({
        'https://example.com/robots.txt': new Response('User-agent: *\nAllow: /', { status: 200 }),
        'https://example.com/page': new Response('<html><script>bad()</script><h1>Title</h1><p>Evidence text</p></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
      }),
      resolve: publicResolve,
    });
    const result = await fetcher.fetchText('https://example.com/page');
    expect(result.text).toContain('Title');
    expect(result.text).toContain('Evidence text');
    expect(result.text).not.toContain('bad()');
  });

  it('遵守 robots 禁止规则', async () => {
    const fetcher = new SecureFetcher({
      fetch: fakeFetch({
        'https://example.com/robots.txt': new Response('User-agent: *\nDisallow: /private', { status: 200 }),
      }),
      resolve: publicResolve,
    });
    await expect(fetcher.fetchText('https://example.com/private/data')).rejects.toThrow('robots.txt');
  });

  it('每次重定向重新验证地址并阻止跳到私网', async () => {
    const fetcher = new SecureFetcher({
      fetch: fakeFetch({
        'https://example.com/robots.txt': new Response('', { status: 200 }),
        'https://example.com/go': new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/secret' } }),
      }),
      resolve: publicResolve,
    });
    await expect(fetcher.fetchText('https://example.com/go')).rejects.toThrow('SSRF');
  });

  it('限制响应大小', async () => {
    const fetcher = new SecureFetcher({
      fetch: fakeFetch({
        'https://example.com/robots.txt': new Response('', { status: 200 }),
        'https://example.com/big': new Response('x'.repeat(101), {
          status: 200,
          headers: { 'Content-Type': 'text/plain', 'Content-Length': '101' },
        }),
      }),
      resolve: publicResolve,
      maxBytes: 100,
    });
    await expect(fetcher.fetchText('https://example.com/big')).rejects.toThrow('响应过大');
  });
});
