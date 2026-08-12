import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type {
  CitationRecord,
  IntentProfile,
  PlannedQuery,
  ProviderId,
  ScoreBreakdown,
  SessionSettings,
  VerificationReport,
} from '@cairn/shared';

/**
 * Drizzle 表定义 —— 与 migrations.ts 中的 DDL 保持一致。
 * 会话即一次搜索任务;follow-up 通过 parent_id 串成会话链。
 */

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  parentId: text('parent_id'),
  question: text('question').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  providerIds: text('provider_ids', { mode: 'json' }).$type<ProviderId[]>().notNull(),
  settings: text('settings', { mode: 'json' }).$type<SessionSettings>().notNull(),
  intent: text('intent', { mode: 'json' }).$type<IntentProfile>(),
  plan: text('plan', { mode: 'json' }).$type<PlannedQuery[]>(),
  answer: text('answer'),
  citations: text('citations', { mode: 'json' }).$type<CitationRecord[]>(),
  consensus: text('consensus'),
  verification: text('verification', { mode: 'json' }).$type<VerificationReport>(),
  relatedQuestions: text('related_questions', { mode: 'json' }).$type<string[]>(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at'),
});

export const queries = sqliteTable('queries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  role: text('role').notNull(),
  text: text('text').notNull(),
  providerId: text('provider_id').notNull(),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  sourceCount: integer('source_count').notNull().default(0),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  queryId: text('query_id'),
  providerId: text('provider_id').notNull(),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  domain: text('domain').notNull(),
  title: text('title').notNull(),
  snippet: text('snippet'),
  publishedAt: text('published_at'),
  kind: text('kind').notNull().default('other'),
  social: integer('social', { mode: 'boolean' }).notNull().default(false),
  score: real('score').notNull().default(0),
  scoreBreakdown: text('score_breakdown', { mode: 'json' }).$type<ScoreBreakdown>(),
  clusterId: text('cluster_id'),
});

export const evidence = sqliteTable('evidence', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  sourceId: text('source_id').notNull(),
  snippet: text('snippet').notNull(),
  claim: text('claim'),
  retrievedAt: text('retrieved_at').notNull(),
});

/** 答案:is_final=1 为面向用户的综合答案;panel 模式下每个 Provider 一行 is_final=0 */
export const answers = sqliteTable('answers', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  providerId: text('provider_id').notNull(),
  model: text('model').notNull().default(''),
  content: text('content').notNull().default(''),
  citations: text('citations', { mode: 'json' }).$type<CitationRecord[]>(),
  elapsedMs: integer('elapsed_ms').notNull().default(0),
  isFinal: integer('is_final', { mode: 'boolean' }).notNull().default(false),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

export const usage = sqliteTable('usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  providerId: text('provider_id').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  calls: integer('calls').notNull().default(0),
  costUsd: real('cost_usd'),
});

/** 事件流:seq 全局自增,SSE 断线重连按 seq 续传 */
export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  type: text('type').notNull(),
  ts: text('ts').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
});

export const providerSettings = sqliteTable('provider_settings', {
  providerId: text('provider_id').primaryKey(),
  settings: text('settings', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
});
