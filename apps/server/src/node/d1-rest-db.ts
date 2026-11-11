import type { Db, Param } from '../db.js';

/**
 * Db adapter over the Cloudflare D1 REST API. Used only by the one-time remote initialisation command.
 * The token is sent in the Authorization header and is never included in an error message.
 * batch() is refused: the REST API cannot guarantee an atomic multi-statement write, and the
 * initialisation path does not need one. The request's SQL and parameters are not echoed in errors.
 */
export interface D1RestOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface D1RestResult {
  results?: Array<Record<string, unknown>>;
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

interface D1RestBody {
  success?: boolean;
  result?: D1RestResult[];
}

export function d1RestDb(options: D1RestOptions): Db {
  const base = options.baseUrl ?? 'https://api.cloudflare.com/client/v4';
  const url = `${base}/accounts/${encodeURIComponent(options.accountId)}/d1/database/${encodeURIComponent(options.databaseId)}/query`;
  const send = options.fetchImpl ?? fetch;

  async function query(sql: string, params: Param[] = []): Promise<D1RestResult> {
    let response: Response;
    try {
      response = await send(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, params }),
      });
    } catch {
      throw new Error('d1_request_failed');
    }
    const body = (await response.json().catch(() => ({}))) as D1RestBody;
    const first = body.result?.[0];
    if (!response.ok || body.success !== true || !first || first.success === false) {
      throw new Error(`d1_query_failed_${response.status}`);
    }
    return first;
  }

  return {
    async all<T>(sql: string, params: Param[] = []): Promise<T[]> {
      return ((await query(sql, params)).results ?? []) as unknown as T[];
    },
    async first<T>(sql: string, params: Param[] = []): Promise<T | null> {
      const rows = (await query(sql, params)).results ?? [];
      return (rows[0] as unknown as T) ?? null;
    },
    async run(sql: string, params: Param[] = []) {
      const result = await query(sql, params);
      return { changes: result.meta?.changes ?? 0, lastRowId: result.meta?.last_row_id ?? 0 };
    },
    async batch() {
      throw new Error('d1_rest_batch_not_supported');
    },
  };
}
