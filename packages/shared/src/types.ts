/**
 * Cairn 核心领域类型 —— 全仓唯一事实来源。
 */

/** 搜索模式:flash=快速搜索,dive=深度研究,panel=多模型对比,pulse=X 实时脉搏 */
export type SearchMode = 'flash' | 'dive' | 'panel' | 'pulse';

export const SEARCH_MODES: SearchMode[] = ['flash', 'dive', 'panel', 'pulse'];

/** 会话生命周期状态 */
export type SessionStatus =
  | 'queued'
  | 'planning'
  | 'searching'
  | 'fetching'
  | 'ranking'
  | 'synthesizing'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

/** 终态集合:进入后不再变化 */
export const TERMINAL_STATUSES: SessionStatus[] = ['completed', 'partial', 'failed', 'cancelled'];

/** 子查询角色 —— 查询规划阶段为每条子查询赋予的检索意图 */
export type QueryRole =
  | 'core'        // 核心事实
  | 'latest'      // 最新进展
  | 'official'    // 官方来源
  | 'counter'     // 反方观点 / 风险
  | 'altlang'     // 其他语言关键词
  | 'social';     // X 平台实时讨论

/** 来源类型 */
export type SourceKind =
  | 'official'    // 官方文档 / 产品公告
  | 'paper'       // 论文 / 学术
  | 'gov'         // 政府 / 标准组织
  | 'repo'        // 代码仓库 / Issue
  | 'news'        // 新闻媒体
  | 'community'   // 论坛 / 问答社区
  | 'social'      // X / 社交平台
  | 'blog'        // 个人 / 公司博客
  | 'other';

/** Provider 标识 */
export type ProviderId = 'xai' | 'openai' | 'anthropic' | 'mock';

export const PROVIDER_IDS: ProviderId[] = ['xai', 'openai', 'anthropic', 'mock'];

/** 意图画像 —— 意图识别阶段的输出 */
export interface IntentProfile {
  /** 问题类型 */
  kind: 'factual' | 'howto' | 'comparison' | 'news' | 'research' | 'troubleshooting' | 'opinion';
  /** 时间敏感度:0=常识性,1=一般,2=强时效 */
  timeSensitivity: 0 | 1 | 2;
  /** 主要语言(BCP-47 粗粒度,如 zh / en) */
  language: string;
  /** 领域标签 */
  domains: string[];
  /** 期望深度:1=速答,2=标准,3=深挖 */
  depth: 1 | 2 | 3;
  /** 是否值得引入社交实时信息 */
  socialRelevant: boolean;
}

/** 规划出的子查询 */
export interface PlannedQuery {
  id: string;
  role: QueryRole;
  text: string;
  /** 指派执行的 Provider */
  providerId: ProviderId;
  /** 语言提示 */
  language?: string;
}

/** 归一化后的来源 */
export interface SourceRecord {
  id: string;
  sessionId: string;
  queryId?: string;
  providerId: ProviderId;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  snippet?: string;
  publishedAt?: string;
  kind: SourceKind;
  /** 是否社交内容(单独车道展示,不与网页来源混排) */
  social: boolean;
  /** 0-100 综合质量分 */
  score: number;
  scoreBreakdown?: ScoreBreakdown;
  /** 同一事件转载聚类的代表元素 id;自身为代表时等于自身 id */
  clusterId?: string;
}

export interface ScoreBreakdown {
  relevance: number;
  freshness: number;
  authority: number;
  corroboration: number;
  diversity: number;
  penalty: number;
}

/** 证据条目 —— 从来源中抽取的、支撑具体结论的片段 */
export interface EvidenceItem {
  id: string;
  sessionId: string;
  sourceId: string;
  /** 证据片段原文 */
  snippet: string;
  /** 该证据支撑的结论(可选,由综合阶段回填) */
  claim?: string;
  retrievedAt: string;
}

/** 内联引用:答案中的 [n] 与来源的映射 */
export interface CitationRecord {
  marker: number;
  sourceId: string;
}

/** 单 Provider 的用量统计 */
export interface UsageRecord {
  providerId: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** 配置了价格表时的估算费用(USD) */
  costUsd?: number;
}

/** panel 模式下单个 Provider 的独立答案 */
export interface PanelAnswer {
  providerId: ProviderId;
  model: string;
  content: string;
  citations: CitationRecord[];
  elapsedMs: number;
  usage?: UsageRecord;
  error?: string;
}

/** 引用校验报告 */
export interface VerificationReport {
  /** 校验过的引用数 */
  checked: number;
  /** 答案中出现但来源列表没有的标记 */
  danglingMarkers: number[];
  /** 疑似缺引用的事实句(截断展示) */
  uncitedFacts: string[];
  /** 单一来源支撑的关键结论占比 0-1 */
  singleSourceRatio: number;
  /** 失效链接的 sourceId */
  deadSources: string[];
  notes: string[];
}

/** 会话设置(请求时可覆盖的部分) */
export interface SessionSettings {
  maxSources: number;
  timeoutMs: number;
  maxConcurrency: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  includeSocial: boolean;
  /** 可选模型规划者；失败时回退本地差异化规划 */
  plannerProviderId?: ProviderId;
  /** panel 模式及普通模式的最终综合者 */
  synthesizerProviderId?: ProviderId;
  /** 可选引用裁判；本地规则始终先执行 */
  judgeProviderId?: ProviderId;
  /** 每 Provider 的模型覆盖 */
  models?: Partial<Record<ProviderId, string>>;
}

/** 会话完整快照(结果页恢复用) */
export interface SessionSnapshot {
  id: string;
  parentId?: string;
  question: string;
  mode: SearchMode;
  status: SessionStatus;
  providerIds: ProviderId[];
  settings: SessionSettings;
  intent?: IntentProfile;
  plan?: PlannedQuery[];
  answer?: string;
  citations: CitationRecord[];
  sources: SourceRecord[];
  evidence: EvidenceItem[];
  panelAnswers?: PanelAnswer[];
  consensus?: string;
  verification?: VerificationReport;
  usage: UsageRecord[];
  relatedQuestions?: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  /** 事件流最后一个序号,SSE 断线重连从此恢复 */
  lastEventSeq: number;
}

/** Provider 能力声明 */
export interface ProviderCapabilities {
  nativeWebSearch: boolean;
  socialSearch: boolean;
  streaming: boolean;
  citations: boolean;
  modelDiscovery: boolean;
  configurableBaseUrl: boolean;
  /** 是否支持无搜索的纯生成(规划/综合/裁判可用) */
  plainGeneration: boolean;
}

export interface ModelInfo {
  id: string;
  label?: string;
  contextWindow?: number;
}

/** Provider 运行时设置(设置页可改,密钥除外) */
export interface ProviderRuntimeSettings {
  enabled: boolean;
  defaultModel?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

/** 全局角色模型配置:规划者/研究者/综合者/裁判 */
export interface RoleModelConfig {
  planner?: { providerId: ProviderId; model?: string };
  researcher?: { providerId: ProviderId; model?: string };
  synthesizer?: { providerId: ProviderId; model?: string };
  judge?: { providerId: ProviderId; model?: string };
}

export interface AppSettings {
  defaultMode: SearchMode;
  roles: RoleModelConfig;
}
