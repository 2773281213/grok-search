import type {
  CitationRecord,
  IntentProfile,
  PanelAnswer,
  PlannedQuery,
  ProviderId,
  SessionStatus,
  SourceRecord,
  UsageRecord,
  VerificationReport,
} from './types.js';

/**
 * 统一流式事件协议 —— Web SSE、CLI、MCP 共用。
 * 事件先持久化再广播,seq 全会话单调递增,断线后以 ?after=seq 恢复。
 */

export type SearchEventType =
  | 'session.created'
  | 'session.status'
  | 'intent.resolved'
  | 'plan.created'
  | 'query.started'
  | 'query.completed'
  | 'source.found'
  | 'source.ranked'
  | 'evidence.added'
  | 'answer.delta'
  | 'answer.section'
  | 'citation.added'
  | 'panel.answer'
  | 'usage.updated'
  | 'verification.done'
  | 'related.questions'
  | 'note'
  | 'session.completed'
  | 'session.failed';

interface EventDataMap {
  'session.created': { sessionId: string; question: string; mode: string };
  'session.status': { status: SessionStatus; detail?: string };
  'intent.resolved': { intent: IntentProfile };
  'plan.created': { queries: PlannedQuery[] };
  'query.started': { queryId: string; role: string; text: string; providerId: ProviderId };
  'query.completed': {
    queryId: string;
    providerId: ProviderId;
    sourceCount: number;
    elapsedMs: number;
    error?: string;
  };
  'source.found': { source: SourceRecord };
  'source.ranked': { sources: SourceRecord[] };
  'evidence.added': { sourceId: string; snippet: string };
  'answer.delta': { text: string; providerId?: ProviderId };
  'answer.section': { section: 'consensus' | 'divergence' | 'evidence' };
  'citation.added': { citation: CitationRecord };
  'panel.answer': { answer: PanelAnswer };
  'usage.updated': { usage: UsageRecord[] };
  'verification.done': { report: VerificationReport };
  'related.questions': { questions: string[] };
  note: { text: string };
  'session.completed': { status: 'completed' | 'partial'; elapsedMs: number };
  'session.failed': { error: string };
}

export interface SearchEvent<T extends SearchEventType = SearchEventType> {
  /** 持久化后由存储层赋值,全会话单调递增 */
  seq: number;
  sessionId: string;
  type: T;
  ts: string;
  data: T extends keyof EventDataMap ? EventDataMap[T] : never;
}

/** 构造未持久化(seq=0)的事件,存储层落库时补 seq */
export function makeEvent<T extends SearchEventType>(
  sessionId: string,
  type: T,
  data: SearchEvent<T>['data'],
): SearchEvent<T> {
  return { seq: 0, sessionId, type, ts: new Date().toISOString(), data };
}

/** SSE 帧编码:event: 行 + data: JSON 行 + id: seq,便于 EventSource lastEventId 恢复 */
export function encodeSseFrame(event: SearchEvent): string {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** 心跳注释帧,防止代理超时切断 */
export const SSE_HEARTBEAT = ': ping\n\n';
