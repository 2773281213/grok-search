import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { runMigrations } from './migrations.js';
import * as schema from './schema.js';

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
  path: string;
  close(): void;
}

/** 打开 SQLite、设置可靠性 PRAGMA、执行增量迁移。 */
export function openDatabase(path = process.env.CAIRN_DB_PATH ?? './data/cairn.db'): DatabaseHandle {
  const resolvedPath = path === ':memory:' ? path : resolve(path);
  if (resolvedPath !== ':memory:') mkdirSync(dirname(resolvedPath), { recursive: true });

  const sqlite = new Database(resolvedPath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (resolvedPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
  }
  runMigrations(sqlite);

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    path: resolvedPath,
    close: () => sqlite.close(),
  };
}
