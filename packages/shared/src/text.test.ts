import { describe, expect, it } from 'vitest';
import { clampText, guessLanguage, htmlToText, jaccard, titlesLookAlike, tokenize } from './text.js';

describe('tokenize', () => {
  it('英文按词、中文按双字滑窗', () => {
    const tokens = tokenize('Next.js 服务端渲染');
    expect(tokens).toContain('next');
    expect(tokens).toContain('js');
    expect(tokens).toContain('服务');
    expect(tokens).toContain('端渲');
  });
});

describe('titlesLookAlike(转载聚类)', () => {
  it('同一新闻的两个标题判定相似', () => {
    expect(
      titlesLookAlike(
        'OpenAI releases new Responses API for developers',
        'OpenAI Releases New Responses API For Developers | TechSite',
      ),
    ).toBe(true);
  });
  it('不同主题不相似', () => {
    expect(titlesLookAlike('Rust 1.80 发布', 'Python 4.0 规划公开')).toBe(false);
  });
});

describe('htmlToText', () => {
  it('剥离 script/style 与标签并保留文本', () => {
    const text = htmlToText(
      '<html><style>.a{}</style><script>alert(1)</script><body><h1>标题</h1><p>第一段 &amp; 实体</p></body></html>',
    );
    expect(text).toContain('标题');
    expect(text).toContain('第一段 & 实体');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('.a{}');
  });
});

describe('clampText', () => {
  it('超长截断加省略号', () => {
    expect(clampText('abcdef', 4)).toBe('abc…');
    expect(clampText('abc', 10)).toBe('abc');
  });
});

describe('guessLanguage', () => {
  it('识别中英', () => {
    expect(guessLanguage('这是一个中文问题,关于服务器部署')).toBe('zh');
    expect(guessLanguage('how to deploy a server')).toBe('en');
  });
});

describe('jaccard', () => {
  it('空集合返回 0', () => {
    expect(jaccard([], [])).toBe(0);
  });
});
