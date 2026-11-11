import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db, Param, Stmt } from '../db.js';

/** SQLite adapter for local development and tests. Same behaviour as D1: batch() is one transaction. */
export function sqliteDb(path: string): Db & { close(): void; raw: DatabaseSync } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL;');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec('PRAGMA busy_timeout = 5000;');
  const db: Db & { close(): void; raw: DatabaseSync } = {
    raw,
    async all<T>(sql: string, params: Param[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as unknown as T[];
    },
    async first<T>(sql: string, params: Param[] = []): Promise<T | null> {
      const row = raw.prepare(sql).get(...params);
      return (row as unknown as T) ?? null;
    },
    async run(sql: string, params: Param[] = []) {
      const info = raw.prepare(sql).run(...params);
      return { changes: Number(info.changes), lastRowId: Number(info.lastInsertRowid) };
    },
    async batch(stmts: Stmt[]): Promise<void> {
      raw.exec('BEGIN IMMEDIATE');
      try {
        for (const s of stmts) raw.prepare(s.sql).run(...(s.params ?? []));
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      raw.close();
    },
  };
  return db;
}
