import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { loadConfig, type Config } from '../src/config.js';
import { startServer } from '../src/server.js';
import { createAdmin } from '../src/auth.js';
import { totpCode } from '../src/security.js';
import type { Db } from '../src/db.js';

export const PASSWORD = 'correct horse battery staple';
export const USERNAME = 'owner';

export interface Harness {
  base: string;
  cfg: Config;
  db: Db;
  server: Server;
  root: string;
  totpSecret: string;
  close: () => Promise<void>;
}

/** Starts a real HTTP server with a temporary database, private folder, and public site. */
export async function startHarness(over: Partial<Config> = {}, opts: { admin?: boolean } = {}): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), 'bridiant-test-'));
  const publicDir = join(root, 'public');
  mkdirSync(publicDir, { recursive: true });
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>Home</title><p>Public home</p>');
  writeFileSync(join(publicDir, '404.html'), '<!doctype html><p>Not found page</p>');
  const cfg = loadConfig(
    { BRIDIANT_ENV: 'development' },
    {
      dataDir: root,
      dbPath: join(root, 'test.sqlite'),
      privateDir: join(root, 'private'),
      publicDir,
      secretKey: randomBytes(32),
      ipSalt: 'test-salt-for-integration-tests',
      ...over,
    },
  );
  const { server, db } = await startServer(cfg, 0, '127.0.0.1');
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let totpSecret = '';
  if (opts.admin !== false) {
    const created = await createAdmin(db, cfg, USERNAME, PASSWORD);
    totpSecret = created.totpSecret;
  }
  return {
    base: `http://127.0.0.1:${port}`,
    cfg,
    db,
    server,
    root,
    totpSecret,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function currentCode(secret: string): string {
  return totpCode(secret, Date.now());
}

/** Signs in and returns the session cookie and CSRF token. */
export async function signIn(h: Harness, overrides: { password?: string; code?: string; username?: string } = {}): Promise<{ cookie: string; csrf: string; response: Response }> {
  const body = new URLSearchParams({
    username: overrides.username ?? USERNAME,
    password: overrides.password ?? PASSWORD,
    code: overrides.code ?? currentCode(h.totpSecret),
  });
  const response = await fetch(`${h.base}/admin/login`, { method: 'POST', body, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = /bridiant_admin=([^;]+)/.exec(setCookie);
  const cookie = match ? `bridiant_admin=${match[1]}` : '';
  let csrf = '';
  if (cookie) {
    const page = await fetch(`${h.base}/admin/requests`, { headers: { cookie } });
    csrf = extractCsrf(await page.text());
  }
  return { cookie, csrf, response };
}

export function extractCsrf(html: string): string {
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  return m?.[1] ?? '';
}

export function jpeg(size = 2048): Buffer {
  const b = Buffer.alloc(size, 7);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  return b;
}

export function png(size = 1024): Buffer {
  const b = Buffer.alloc(size, 3);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  return b;
}

export function pdf(size = 1500): Buffer {
  const b = Buffer.alloc(size, 0x20);
  Buffer.from('%PDF-1.4\n').copy(b);
  return b;
}

export function validPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    locale: 'en',
    services: ['standard-cleaning'],
    homeType: 'house',
    bedrooms: '3',
    bathrooms: '2',
    frequency: 'monthly',
    moveDate: null,
    name: 'Test Customer',
    phone: '5550101234',
    email: '',
    zip: '',
    notes: 'Private test note',
    consent: true,
    website: '',
    idempotencyKey: randomBytes(12).toString('hex'),
    ...over,
  };
}

export function estimateForm(payload: Record<string, unknown>, files: Array<{ name: string; data: Buffer; type: string }> = []): FormData {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const f of files) fd.append('photos', new Blob([new Uint8Array(f.data)], { type: f.type }), f.name);
  return fd;
}

export async function submit(h: Harness, payload: Record<string, unknown>, files: Array<{ name: string; data: Buffer; type: string }> = []) {
  const response = await fetch(`${h.base}/api/estimate`, { method: 'POST', body: estimateForm(payload, files) });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}
