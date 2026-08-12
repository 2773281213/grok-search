import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractDomain, isPrivateAddress, safeParseUrl } from './url.js';

describe('canonicalizeUrl', () => {
  it('剥离跟踪参数并按名排序其余参数', () => {
    expect(
      canonicalizeUrl('https://example.com/a?utm_source=x&b=2&a=1&fbclid=zzz'),
    ).toBe('https://example.com/a?a=1&b=2');
  });

  it('统一协议、去 www、去尾斜杠、去 hash', () => {
    expect(canonicalizeUrl('http://www.Example.COM/path/#section')).toBe('https://example.com/path');
  });

  it('展开 AMP 路径', () => {
    expect(canonicalizeUrl('https://news.site.com/story/amp/')).toBe('https://news.site.com/story');
  });

  it('保留非常规端口', () => {
    expect(canonicalizeUrl('https://example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  it('拒绝非 http(s) 协议', () => {
    expect(canonicalizeUrl('ftp://example.com/file')).toBeNull();
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('同一文章的两种形态归一到同一 URL', () => {
    const a = canonicalizeUrl('https://www.blog.dev/post/1?utm_campaign=aa');
    const b = canonicalizeUrl('http://blog.dev/post/1/');
    expect(a).toBe(b);
  });
});

describe('extractDomain', () => {
  it('提取小写去 www 域名', () => {
    expect(extractDomain('https://WWW.GitHub.com/x')).toBe('github.com');
  });
  it('非法输入返回空串', () => {
    expect(extractDomain('not a url')).toBe('');
  });
});

describe('isPrivateAddress(SSRF 防护)', () => {
  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['fc00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['example.com', false],
  ])('%s → %s', (host, expected) => {
    expect(isPrivateAddress(host)).toBe(expected);
  });
});

describe('safeParseUrl', () => {
  it('只接受 http/https', () => {
    expect(safeParseUrl('https://a.com')).not.toBeNull();
    expect(safeParseUrl('file:///etc/passwd')).toBeNull();
  });
});
