import { randomUUID } from 'node:crypto';

/** 生成带前缀的短 id,如 ses_9f3a…、qry_…、src_… */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

export const idOf = {
  session: () => newId('ses'),
  query: () => newId('qry'),
  source: () => newId('src'),
  evidence: () => newId('evd'),
};
