/** 文本处理:分词、相似度、标题归一化、HTML 清洗、语言猜测 */

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[‘’“”'"''“”]/g, '')
    .replace(/[-–—|·:：]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 中英混合友好的粗分词:英文按词、CJK 按双字滑窗 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const ascii = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  tokens.push(...ascii);
  const cjk = text.match(/[一-鿿぀-ヿ가-힯]+/g) ?? [];
  for (const run of cjk) {
    if (run.length === 1) tokens.push(run);
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** 标题近似判定(转载聚类用) */
export function titlesLookAlike(a: string, b: string, threshold = 0.6): boolean {
  return jaccard(tokenize(normalizeTitle(a)), tokenize(normalizeTitle(b))) >= threshold;
}

/** 轻量 HTML → 纯文本:剥 script/style、标签,压缩空白(不追求完备,仅用于证据抽取) */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** 粗粒度语言猜测:zh / en / other */
export function guessLanguage(text: string): string {
  const cjkCount = (text.match(/[一-鿿]/g) ?? []).length;
  if (cjkCount / Math.max(text.length, 1) > 0.15) return 'zh';
  if (/[a-z]{3,}/i.test(text)) return 'en';
  return 'other';
}
