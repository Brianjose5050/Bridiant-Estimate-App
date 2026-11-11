import { SCHEMA, SCHEMA_VERSION } from './schema.js';

/**
 * Database access, independent of runtime. Two adapters implement it:
 * - D1 (Cloudflare Workers, production): see d1-db.ts
 * - SQLite (local development and tests): see node/sqlite-db.ts
 *
 * Multi-statement changes use batch(), which runs all statements atomically. D1 has no BEGIN/COMMIT.
 */
export type Param = string | number | null;

export interface Stmt {
  sql: string;
  params?: Param[];
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: Param[]): Promise<T | null>;
  run(sql: string, params?: Param[]): Promise<{ changes: number; lastRowId: number }>;
  batch(stmts: Stmt[]): Promise<void>;
}

export const REQUEST_STATUSES = ['new', 'under_review', 'contacted', 'estimate_sent', 'booked', 'completed', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export { SCHEMA, SCHEMA_VERSION };

export function nowIso(): string {
  return new Date().toISOString();
}

/** Fixed-window rate limit. Returns true when the action is allowed. */
export async function allowRate(db: Db, key: string, limit: number, windowSeconds: number, nowMs = Date.now()): Promise<boolean> {
  const windowStart = Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
  const row = await db.first<{ window_start: number; count: number }>('SELECT window_start, count FROM rate_limit WHERE key = ?', [key]);
  if (!row || row.window_start !== windowStart) {
    await db.run('INSERT OR REPLACE INTO rate_limit (key, window_start, count) VALUES (?, ?, 1)', [key, windowStart]);
    return true;
  }
  if (row.count >= limit) return false;
  await db.run('UPDATE rate_limit SET count = count + 1 WHERE key = ?', [key]);
  return true;
}

export function auditStmt(action: string, entity: string, entityId: string | null, detail: Record<string, unknown> | null = null): Stmt {
  return {
    sql: 'INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?)',
    params: [action, entity, entityId, detail ? JSON.stringify(detail) : null, nowIso()],
  };
}

export async function audit(db: Db, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> | null = null): Promise<void> {
  const s = auditStmt(action, entity, entityId, detail);
  await db.run(s.sql, s.params);
}

/** Creates or upgrades the schema. Safe to run on every start (CREATE ... IF NOT EXISTS). */
export async function migrate(db: Db): Promise<void> {
  const statements = SCHEMA.split(/;\s*\n/).map((s) => s.trim()).filter((s) => s.length > 0);
  for (const sql of statements) await db.run(sql);
  await db.run('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)', ['schema_version', String(SCHEMA_VERSION)]);
}
