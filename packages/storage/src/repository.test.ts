import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultSettings,
  idOf,
  makeEvent,
  type SourceRecord,
} from '@cairn/shared';
import { openDatabase } from './database.js';
import { LATEST_SCHEMA_VERSION } from './migrations.js';
import { CairnRepository } from './repository.js';

let repo: CairnRepository;

beforeEach(() => {
  repo = new CairnRepository(openDatabase(':memory:'));
});

afterEach(() => repo.close());

function createSession() {
  return repo.createSession({
    question: 'What changed in the latest API?',
    mode: 'flash',
    providerIds: ['mock'],
    settings: defaultSettings('flash'),
  });
}

function source(sessionId: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: idOf.source(),
    sessionId,
    queryId: idOf.query(),
    providerId: 'mock',
    url: 'https://example.com/docs?utm_source=test',
    canonicalUrl: 'https://example.com/docs',
    domain: 'example.com',
    title: 'Official documentation',
    snippet: 'The API changed.',
    kind: 'official',
    social: false,
    score: 88,
    ...overrides,
  };
}

describe('migrations', () => {
  it('初始化到最新 schema 版本', () => {
    expect(repo.handle.sqlite.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
  });
});

describe('session snapshots', () => {
  it('创建、更新并恢复完整会话', () => {
    const session = createSession();
    repo.updateSession(session.id, { status: 'planning' });
    repo.savePlan(
      session.id,
      {
        kind: 'news',
        timeSensitivity: 2,
        language: 'en',
        domains: ['software'],
        depth: 1,
        socialRelevant: false,
      },
      [{ id: idOf.query(), role: 'latest', text: 'latest API changes', providerId: 'mock' }],
    );
    repo.setFinalAnswer(session.id, 'It changed [1].', [{ marker: 1, sourceId: 'src_x' }], 'mock', 'mock-v1');
    repo.updateSession(session.id, { status: 'completed', relatedQuestions: ['What is deprecated?'] });

    const restored = repo.getSession(session.id)!;
    expect(restored.status).toBe('completed');
    expect(restored.answer).toBe('It changed [1].');
    expect(restored.plan).toHaveLength(1);
    expect(restored.completedAt).toBeTruthy();
    expect(restored.relatedQuestions).toEqual(['What is deprecated?']);
  });

  it('支持 follow-up 父子关系', () => {
    const parent = createSession();
    const child = repo.createSession({
      parentId: parent.id,
      question: 'Explain the migration path',
      mode: 'dive',
      providerIds: ['mock'],
      settings: defaultSettings('dive'),
    });
    expect(repo.getSession(child.id)?.parentId).toBe(parent.id);
  });

  it('历史按时间倒序且可搜索', () => {
    repo.createSession({ question: 'Rust changes', mode: 'flash', providerIds: ['mock'], settings: defaultSettings('flash') });
    repo.createSession({ question: 'Python changes', mode: 'flash', providerIds: ['mock'], settings: defaultSettings('flash') });
    expect(repo.listSessions(10)).toHaveLength(2);
    expect(repo.listSessions(10, 'Rust')).toHaveLength(1);
  });
});

describe('sources and evidence', () => {
  it('按 canonical URL 去重', () => {
    const session = createSession();
    const first = source(session.id);
    const duplicate = source(session.id, { id: idOf.source(), title: '转载标题' });
    expect(repo.addSource(first).id).toBe(first.id);
    expect(repo.addSource(duplicate).id).toBe(first.id);
    expect(repo.getSession(session.id)?.sources).toHaveLength(1);
  });

  it('保存来源评分与证据', () => {
    const session = createSession();
    const item = source(session.id);
    repo.addSource(item);
    item.score = 93;
    item.scoreBreakdown = { relevance: 30, freshness: 15, authority: 25, corroboration: 15, diversity: 8, penalty: 0 };
    repo.updateSource(item);
    repo.addEvidence({
      id: idOf.evidence(),
      sessionId: session.id,
      sourceId: item.id,
      snippet: 'Direct evidence',
      retrievedAt: new Date().toISOString(),
    });
    const snapshot = repo.getSession(session.id)!;
    expect(snapshot.sources[0]?.score).toBe(93);
    expect(snapshot.evidence[0]?.snippet).toBe('Direct evidence');
  });
});

describe('event resume', () => {
  it('持久化单调递增事件并按 after 恢复', () => {
    const session = createSession();
    const first = repo.appendEvent(makeEvent(session.id, 'session.created', {
      sessionId: session.id,
      question: session.question,
      mode: session.mode,
    }));
    const second = repo.appendEvent(makeEvent(session.id, 'session.status', { status: 'planning' }));
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(repo.listEvents(session.id, first.seq)).toEqual([second]);
    expect(repo.getSession(session.id)?.lastEventSeq).toBe(second.seq);
  });
});

describe('answers, usage and provider settings', () => {
  it('保存 panel 答案与累加用量', () => {
    const session = createSession();
    repo.addPanelAnswer(session.id, {
      providerId: 'mock', model: 'mock-v1', content: 'answer', citations: [], elapsedMs: 12,
    });
    repo.upsertUsage(session.id, {
      providerId: 'mock', model: 'mock-v1', inputTokens: 10, outputTokens: 20, calls: 1,
    });
    repo.upsertUsage(session.id, {
      providerId: 'mock', model: 'mock-v1', inputTokens: 5, outputTokens: 5, calls: 1,
    });
    const snapshot = repo.getSession(session.id)!;
    expect(snapshot.panelAnswers).toHaveLength(1);
    expect(snapshot.usage[0]).toMatchObject({ inputTokens: 15, outputTokens: 25, calls: 2 });
  });

  it('更新 Provider 设置但不保存密钥', () => {
    repo.setProviderSettings('openai', { enabled: true, defaultModel: 'configured-model', timeoutMs: 80_000 });
    expect(repo.getProviderSettings('openai')).toEqual({
      enabled: true, defaultModel: 'configured-model', timeoutMs: 80_000,
    });
  });
});
