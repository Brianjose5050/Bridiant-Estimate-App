import type { Db, Param, Stmt } from './db.js';

/** The subset of the Cloudflare D1 binding API used here. */
export interface D1Like {
  prepare(sql: string): {
    bind(...params: Param[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes: number; last_row_id: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}

/** D1 adapter for Cloudflare Workers. batch() is atomic on D1. */
export function d1Db(d1: D1Like): Db {
  return {
    async all<T>(sql: string, params: Param[] = []): Promise<T[]> {
      const result = await d1.prepare(sql).bind(...params).all<T>();
      return result.results;
    },
    async first<T>(sql: string, params: Param[] = []): Promise<T | null> {
      return d1.prepare(sql).bind(...params).first<T>();
    },
    async run(sql: string, params: Param[] = []) {
      const result = await d1.prepare(sql).bind(...params).run();
      return { changes: result.meta.changes, lastRowId: result.meta.last_row_id };
    },
    async batch(stmts: Stmt[]): Promise<void> {
      const prepared = stmts.map((s) => d1.prepare(s.sql).bind(...(s.params ?? [])));
      await d1.batch(prepared);
    },
  };
}
