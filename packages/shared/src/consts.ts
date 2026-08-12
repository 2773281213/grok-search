import type { SearchMode, SessionSettings } from './types.js';

/** 各模式的默认档位 —— 预算、来源数、超时的单一事实来源 */
export interface ModeProfile {
  /** 规划的子查询数量范围 */
  queryRange: [number, number];
  /** 最终保留的来源数 */
  maxSources: number;
  /** 候选来源上限(评分前) */
  maxCandidates: number;
  /** 整体超时 */
  timeoutMs: number;
  /** Provider 调用次数预算 */
  callBudget: number;
  /** 是否抓取原文补充证据 */
  fetchBodies: boolean;
}

export const MODE_PROFILES: Record<SearchMode, ModeProfile> = {
  flash: { queryRange: [1, 3], maxSources: 8, maxCandidates: 20, timeoutMs: 90_000, callBudget: 5, fetchBodies: false },
  dive: { queryRange: [4, 8], maxSources: 16, maxCandidates: 40, timeoutMs: 300_000, callBudget: 14, fetchBodies: true },
  panel: { queryRange: [1, 2], maxSources: 10, maxCandidates: 30, timeoutMs: 240_000, callBudget: 8, fetchBodies: false },
  pulse: { queryRange: [2, 4], maxSources: 12, maxCandidates: 30, timeoutMs: 120_000, callBudget: 6, fetchBodies: false },
};

export function defaultSettings(mode: SearchMode): SessionSettings {
  const p = MODE_PROFILES[mode];
  return {
    maxSources: p.maxSources,
    timeoutMs: p.timeoutMs,
    maxConcurrency: Number(process.env.CAIRN_MAX_CONCURRENCY ?? 4),
    includeSocial: mode === 'pulse',
  };
}

/** 抓取网页正文的硬限制 */
export const FETCH_LIMITS = {
  maxBytes: 1_500_000,
  timeoutMs: 12_000,
  maxRedirects: 3,
  userAgent: 'CairnBot/0.1 (+https://github.com/cairn-search/cairn; evidence fetcher)',
  acceptTypes: ['text/html', 'text/plain', 'application/xhtml+xml'],
};
