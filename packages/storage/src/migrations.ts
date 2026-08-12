import type Database from 'better-sqlite3';

/**
 * 内嵌式迁移系统:按序执行、以 PRAGMA user_version 记录版本。
 * 不依赖文件系统读取迁移目录,因此 CLI/MCP 打包后同样可用。
 * 新增迁移 = 向数组末尾追加 {version, name, sql},禁止修改历史条目。
 */
interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  question TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ids TEXT NOT NULL,
  settings TEXT NOT NULL,
  intent TEXT,
  plan TEXT,
  answer TEXT,
  citations TEXT,
  consensus TEXT,
  verification TEXT,
  related_questions TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_id);

CREATE TABLE IF NOT EXISTS queries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_queries_session ON queries(session_id);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  query_id TEXT,
  provider_id TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  published_at TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  social INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  score_breakdown TEXT,
  cluster_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_sources_session ON sources(session_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_dedupe ON sources(session_id, canonical_url);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  snippet TEXT NOT NULL,
  claim TEXT,
  retrieved_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_session ON evidence(session_id);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  citations TEXT,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  is_final INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_key ON usage(session_id, provider_id, model);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  ts TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, seq);

CREATE TABLE IF NOT EXISTS provider_settings (
  provider_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    name: 'app-settings',
    sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
];

export function runMigrations(sqlite: Database.Database): void {
  const current = (sqlite.pragma('user_version', { simple: true }) as number) ?? 0;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const apply = sqlite.transaction(() => {
      sqlite.exec(m.sql);
      sqlite.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;
