import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { d1RestDb } from '../src/node/d1-rest-db.js';
import { sqliteDb } from '../src/node/sqlite-db.js';
import { migrate } from '../src/db.js';
import { assertSafeInvocation, EXPECTED_DATABASE_NAME, initializeRemote, InitRefused } from '../src/init-remote.js';
import type { PacketChapter } from '../src/welcome.js';

const packet = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../content/seed/welcome-packet.json'), 'utf8')) as { chapters: PacketChapter[] };
const PASSWORD = 'a long owner passphrase';
const TOKEN = 'cf_api_token_must_never_appear_in_output';

/** A stand-in for the D1 REST endpoint. It executes the same SQL on a SQLite database and answers in D1's response shape. */
function fakeD1(db: ReturnType<typeof sqliteDb>) {
  const calls: Array<{ url: string; auth: string | null; body: { sql: string; params: unknown[] } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { sql: string; params: unknown[] };
    calls.push({ url: String(url), auth: new Headers(init.headers).get('authorization'), body });
    const raw = db.raw;
    const stmt = raw.prepare(body.sql);
    const params = body.params as Array<string | number | null>;
    let result: Record<string, unknown>;
    if (/^\s*(select|pragma|with)/i.test(body.sql)) {
      result = { results: stmt.all(...params), success: true, meta: {} };
    } else {
      const info = stmt.run(...params);
      result = { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
    }
    return new Response(JSON.stringify({ success: true, result: [result], errors: [], messages: [] }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function freshDb() {
  const db = sqliteDb(':memory:');
  return db;
}

const cfg = () => loadConfig({ BRIDIANT_SECRET_KEY: randomBytes(32).toString('base64') });
const count = (db: ReturnType<typeof sqliteDb>, sql: string) => db.raw.prepare(sql).get() as { n: number };

describe('remote initialisation: invocation guards', () => {
  it('refuses any database name other than the production name, before any request', () => {
    expect(() => assertSafeInvocation({ database: 'bridiant-staging', confirm: undefined, apply: false })).toThrow(InitRefused);
    expect(() => assertSafeInvocation({ database: undefined, confirm: undefined, apply: false })).toThrow(InitRefused);
  });
  it('refuses to write without repeating the database name', () => {
    expect(() => assertSafeInvocation({ database: EXPECTED_DATABASE_NAME, confirm: undefined, apply: true })).toThrow(/confirm/);
    expect(() => assertSafeInvocation({ database: EXPECTED_DATABASE_NAME, confirm: 'bridiant-prd', apply: true })).toThrow(/confirm/);
  });
  it('allows a dry run without confirmation, and a write with the exact name', () => {
    expect(() => assertSafeInvocation({ database: EXPECTED_DATABASE_NAME, confirm: undefined, apply: false })).not.toThrow();
    expect(() => assertSafeInvocation({ database: EXPECTED_DATABASE_NAME, confirm: EXPECTED_DATABASE_NAME, apply: true })).not.toThrow();
  });
});

describe('remote initialisation: behaviour on a migrated database', () => {
  it('a dry run reads the plan and writes nothing', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    const result = await initializeRemote(remote, cfg(), { username: 'owner', apply: false, packet });
    expect(result.applied).toBe(false);
    expect(result.plan).toEqual({ ownerCount: 0, chaptersPresent: 0, chaptersMissing: 5 });
    expect(count(db, 'SELECT COUNT(*) AS n FROM admin_user').n).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM welcome_resource').n).toBe(0);
  });

  it('apply creates the single owner and the five unapproved, unpublished chapters', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    const result = await initializeRemote(remote, cfg(), { username: 'owner', password: PASSWORD, apply: true, packet });
    expect(result.ownerCreated).toBe(true);
    expect(result.ownerTotpSecret).toMatch(/^[A-Z2-7]{32}$/);
    expect(result.chaptersAdded).toBe(5);
    expect(count(db, 'SELECT COUNT(*) AS n FROM admin_user').n).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM welcome_resource WHERE published = 1 OR approved_en = 1 OR approved_es = 1').n).toBe(0);
    const stored = db.raw.prepare('SELECT password_hash, totp_secret_enc FROM admin_user').get() as { password_hash: string; totp_secret_enc: string };
    expect(stored.password_hash.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(stored.password_hash).not.toContain(PASSWORD);
    expect(stored.totp_secret_enc.startsWith('v1.')).toBe(true);
  });

  it('a second apply never creates a second owner and never duplicates chapters', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    await initializeRemote(remote, cfg(), { username: 'owner', password: PASSWORD, apply: true, packet });
    const again = await initializeRemote(remote, cfg(), { username: 'intruder', password: PASSWORD, apply: true, packet });
    expect(again.ownerCreated).toBe(false);
    expect(again.ownerTotpSecret).toBeUndefined();
    expect(again.chaptersAdded).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM admin_user').n).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM admin_user WHERE username = 'intruder'").n).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM welcome_resource').n).toBe(5);
  });

  it('an existing approved and published chapter is never overwritten by initialisation', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    await initializeRemote(remote, cfg(), { username: 'owner', password: PASSWORD, apply: true, packet });
    db.raw.prepare("UPDATE welcome_resource SET title_en = 'Owner edited', approved_en = 1, published = 1 WHERE chapter_key = 'letter'").run();
    const second = await initializeRemote(remote, cfg(), { username: 'owner', password: PASSWORD, apply: true, packet });
    expect(second.chaptersAdded).toBe(0);
    const row = db.raw.prepare("SELECT title_en, approved_en, published FROM welcome_resource WHERE chapter_key = 'letter'").get() as { title_en: string; approved_en: number; published: number };
    expect(row).toEqual({ title_en: 'Owner edited', approved_en: 1, published: 1 });
  });

  it('refuses a database without the expected schema, before writing anything', async () => {
    const db = freshDb(); // not migrated
    const { fetchImpl } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    await expect(initializeRemote(remote, cfg(), { username: 'owner', password: PASSWORD, apply: true, packet })).rejects.toMatchObject({ code: 'schema_missing' });
    expect(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'admin_user'").n).toBe(0);
  });

  it('refuses a short password before creating anything', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl, calls } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl });
    await expect(initializeRemote(remote, cfg(), { username: 'owner', password: 'short', apply: true, packet })).rejects.toMatchObject({ code: 'password_too_short' });
    expect(count(db, 'SELECT COUNT(*) AS n FROM admin_user').n).toBe(0);
    expect(calls.every((c) => !/INSERT/i.test(c.body.sql))).toBe(true);
  });
});

describe('D1 REST adapter', () => {
  it('sends the token only in the Authorization header, to the account and database URL', async () => {
    const db = freshDb();
    await migrate(db);
    const { fetchImpl, calls } = fakeD1(db);
    const remote = d1RestDb({ accountId: 'acc-1', databaseId: 'db-1', apiToken: TOKEN, fetchImpl });
    await remote.first('SELECT 1 AS x');
    expect(calls[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc-1/d1/database/db-1/query');
    expect(calls[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(TOKEN);
  });

  it('does not put the token or the SQL in errors when the API refuses', async () => {
    const failing = (async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'x' }] }), { status: 403 })) as typeof fetch;
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl: failing });
    const error = await remote.run('DELETE FROM admin_user').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('d1_query_failed_403');
    expect((error as Error).message).not.toContain(TOKEN);
    expect((error as Error).message).not.toContain('DELETE');
  });

  it('refuses batch, so no multi-statement write can be silently non-atomic', async () => {
    const remote = d1RestDb({ accountId: 'acc', databaseId: 'db', apiToken: TOKEN, fetchImpl: (async () => new Response('{}')) as typeof fetch });
    await expect(remote.batch([{ sql: 'SELECT 1' }])).rejects.toThrow('d1_rest_batch_not_supported');
  });
});
