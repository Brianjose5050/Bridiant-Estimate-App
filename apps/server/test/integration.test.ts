import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, signIn, submit, validPayload, jpeg, png, pdf, extractCsrf, estimateForm, currentCode, type Harness, PASSWORD, USERNAME } from './helpers.js';
import { seedWelcomePacket } from '../src/welcome.js';
import { processOutbox, type EmailSender } from '../src/email.js';

const packet = JSON.parse(readFileSync(join(import.meta.dirname, '../../../content/seed/welcome-packet.json'), 'utf8'));

function count(h: Harness, sql: string): number {
  return (h.db.prepare(sql).get() as { n: number }).n;
}

async function adminGet(h: Harness, path: string, cookie: string): Promise<Response> {
  return fetch(`${h.base}${path}`, { headers: { cookie }, redirect: 'manual' });
}

async function adminPost(h: Harness, path: string, cookie: string, csrf: string, fields: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams({ csrf, ...fields });
  return fetch(`${h.base}${path}`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' });
}

describe('1. Public estimate intake', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ maxFileBytes: 15 * 1024 * 1024 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('stores a valid request with photos and returns a reference only after saving', async () => {
    const { status, json } = await submit(h, validPayload(), [
      { name: 'kitchen.jpg', data: jpeg(), type: 'image/jpeg' },
      { name: 'counter.png', data: png(), type: 'image/png' },
    ]);
    expect(status).toBe(200);
    expect(json.status).toBe('received');
    expect(String(json.reference)).toMatch(/^BFG-[0-9A-HJKMNP-TV-Z]{6}$/);
    expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(1);
    expect(count(h, 'SELECT COUNT(*) AS n FROM request_photo')).toBe(2);
    expect(count(h, "SELECT COUNT(*) AS n FROM request_event WHERE kind = 'received'")).toBe(1);
  });

  it('writes photos to private storage with random names and records a checksum', async () => {
    const rows = h.db.prepare('SELECT storage_name, sha256, bytes FROM request_photo').all() as Array<{ storage_name: string; sha256: string; bytes: number }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.storage_name).toMatch(/^[A-Za-z0-9_-]+\.(jpg|png)$/);
      expect(existsSync(join(h.cfg.privateDir, row.storage_name))).toBe(true);
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.bytes).toBeGreaterThan(0);
    }
    // Photos are never inside the public folder.
    expect(h.cfg.privateDir.startsWith(h.cfg.publicDir)).toBe(false);
  });

  it('does not create a duplicate for a repeated idempotency key', async () => {
    const payload = validPayload({ idempotencyKey: 'repeat-key-0000001' });
    const first = await submit(h, payload);
    const second = await submit(h, payload);
    expect(second.json.reference).toBe(first.json.reference);
    expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(2);
  });

  it('rejects an invalid form and stores nothing', async () => {
    const before = count(h, 'SELECT COUNT(*) AS n FROM estimate_request');
    const { status, json } = await submit(h, validPayload({ consent: false }));
    expect(status).toBe(400);
    expect(json.status).toBe('invalid');
    expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(before);
  });

  it('rejects a disguised file (an executable renamed to .jpg) and writes nothing', async () => {
    const before = count(h, 'SELECT COUNT(*) AS n FROM estimate_request');
    const filesBefore = readdirSync(h.cfg.privateDir).length;
    const { status, json } = await submit(h, validPayload(), [{ name: 'photo.jpg', data: Buffer.from('MZ\x90\0 not a photo'), type: 'image/jpeg' }]);
    expect(status).toBe(400);
    expect(json.issues).toEqual([{ field: 'photos', code: 'unsupported_file' }]);
    expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(before);
    expect(readdirSync(h.cfg.privateDir).length).toBe(filesBefore);
  });

  it('rejects a PDF sent as a photo', async () => {
    const { status } = await submit(h, validPayload({ idempotencyKey: 'pdf-as-photo-000001' }), [{ name: 'a.pdf', data: pdf(), type: 'application/pdf' }]);
    expect(status).toBe(400);
  });

  it('refuses a filled honeypot without revealing why', async () => {
    const { status, json } = await submit(h, validPayload({ website: 'http://spam.example', idempotencyKey: 'honeypot-key-000001' }));
    expect(status).toBe(400);
    expect(json.status).toBe('invalid');
    expect(JSON.stringify(json)).not.toMatch(/honeypot|website/i);
  });

  it('refuses a non-multipart submission', async () => {
    const response = await fetch(`${h.base}/api/estimate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(415);
  });

  it('returns JSON errors without stack traces or internal paths', async () => {
    const response = await fetch(`${h.base}/api/estimate`, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: 'garbage' });
    const text = await response.text();
    expect(text).not.toMatch(/stack|\/home\/|node_modules|at .*\(/i);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('only accepts POST on the intake route', async () => {
    const response = await fetch(`${h.base}/api/estimate`);
    expect(response.status).toBe(405);
  });
});

describe('2. Storage failure never produces a false confirmation', () => {
  it('reports unavailable and stores nothing when the private folder cannot be written', async () => {
    const h = await startHarness({});
    try {
      // Make the private folder unusable: a file sits where the directory should be.
      const { writeFileSync } = await import('node:fs');
      writeFileSync(h.cfg.privateDir, 'not a directory');
      const { status, json } = await submit(h, validPayload({ idempotencyKey: 'storage-fail-000001' }), [{ name: 'a.jpg', data: jpeg(), type: 'image/jpeg' }]);
      expect(status).toBe(503);
      expect(json).toEqual({ status: 'unavailable' });
      expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(0);
      expect(count(h, 'SELECT COUNT(*) AS n FROM email_outbox')).toBe(0);
    } finally {
      await h.close();
    }
  });
});

describe('3. Rate limiting', () => {
  it('limits repeated submissions from one source', async () => {
    const h = await startHarness({});
    try {
      let last = 0;
      for (let i = 0; i < 11; i += 1) {
        const r = await submit(h, validPayload({ idempotencyKey: `rate-key-${String(i).padStart(8, '0')}` }));
        last = r.status;
      }
      expect(last).toBe(429);
    } finally {
      await h.close();
    }
  });
});

describe('4. Owner panel access control', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({});
    await submit(h, validPayload({ name: 'Visible Customer', services: ['deep-cleaning'], idempotencyKey: 'panel-seed-0000001' }), [{ name: 'p.jpg', data: jpeg(), type: 'image/jpeg' }]);
  });
  afterAll(async () => {
    await h.close();
  });

  it('sends anonymous visitors to sign-in and shows no request data', async () => {
    const response = await fetch(`${h.base}/admin/requests`, { redirect: 'manual' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/admin/login');
    const page = await (await fetch(`${h.base}/admin/requests?x=1`, { redirect: 'manual' })).text();
    expect(page).not.toContain('Visible Customer');
  });

  it('blocks every panel route without a session', async () => {
    for (const path of ['/admin/requests/1', '/admin/requests/1/photos/1', '/admin/welcome', '/admin/status', '/admin/gallery']) {
      const r = await fetch(`${h.base}${path}`, { redirect: 'manual' });
      expect(r.status, path).toBe(303);
    }
  });

  it('rejects a wrong password, a wrong code, and an unknown user with the same generic message', async () => {
    const a = await signIn(h, { password: 'wrong password entirely' });
    const b = await signIn(h, { code: '000000' });
    const c = await signIn(h, { username: 'someone-else' });
    for (const result of [a, b, c]) {
      expect(result.response.status).toBe(401);
      expect(result.cookie).toBe('');
    }
    const text = await a.response.text().catch(() => '');
    expect(text).not.toMatch(/password is wrong|code is wrong|unknown user/i);
  });

  it('signs in with password and authenticator code, with secure cookie attributes', async () => {
    const response = await fetch(`${h.base}/admin/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: USERNAME, password: PASSWORD, code: currentCode(h.totpSecret) }),
      redirect: 'manual',
    });
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/bridiant_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
  });

  it('blocks a cross-site sign-in attempt (Origin mismatch)', async () => {
    const response = await fetch(`${h.base}/admin/login`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: new URLSearchParams({ username: USERNAME, password: PASSWORD, code: currentCode(h.totpSecret) }),
      redirect: 'manual',
    });
    expect(response.status).toBe(403);
  });

  it('locks sign-in after repeated failures, even with the right password', async () => {
    const h3 = await startHarness({});
    try {
      const attempts = [];
      for (let i = 0; i < 9; i += 1) attempts.push(await signIn(h3, { password: `bad-${i}-password-long` }));
      const ok = await signIn(h3);
      expect(ok.cookie).toBe('');
      expect(attempts.every((a) => a.cookie === '')).toBe(true);
    } finally {
      await h3.close();
    }
  });

  it('expires an idle session on the server', async () => {
    const h2 = await startHarness({});
    try {
      await submit(h2, validPayload({ idempotencyKey: 'idle-seed-00000001' }));
      const { cookie } = await signIn(h2);
      expect((await adminGet(h2, '/admin/requests', cookie)).status).toBe(200);
      h2.db.prepare('UPDATE admin_session SET last_seen_at = ?').run(new Date(Date.now() - 31 * 60 * 1000).toISOString());
      expect((await adminGet(h2, '/admin/requests', cookie)).status).toBe(303);
    } finally {
      await h2.close();
    }
  });

  it('requires the session CSRF token for changes and logout', async () => {
    const { cookie, csrf } = await signIn(h);
    expect(csrf).not.toBe('');
    const noToken = await adminPost(h, '/admin/requests/1/status', cookie, '', { status: 'contacted' });
    expect(noToken.status).toBe(403);
    const wrongToken = await adminPost(h, '/admin/requests/1/status', cookie, 'forged', { status: 'contacted' });
    expect(wrongToken.status).toBe(403);
    const status = h.db.prepare('SELECT status FROM estimate_request WHERE id = 1').get() as { status: string };
    expect(status.status).toBe('new');
  });

  it('signs out and then rejects the old session', async () => {
    const { cookie, csrf } = await signIn(h);
    const out = await adminPost(h, '/admin/logout', cookie, csrf, {});
    expect(out.status).toBe(303);
    expect((await adminGet(h, '/admin/requests', cookie)).status).toBe(303);
  });
});

describe('5. Requests in the private panel', () => {
  let h: Harness;
  let cookie = '';
  let csrf = '';
  beforeAll(async () => {
    h = await startHarness({});
    await submit(h, validPayload({ name: 'Alice Example', email: 'alice@example.test', services: ['standard-cleaning'], idempotencyKey: 'list-alice-0000001' }), [{ name: 'kitchen.jpg', data: jpeg(), type: 'image/jpeg' }]);
    await submit(h, validPayload({ name: 'Bob <img src=x onerror=alert(1)>', services: ['move-out-cleaning'], frequency: null, moveDate: '2026-06-01', idempotencyKey: 'list-bob-00000001' }));
    const s = await signIn(h);
    cookie = s.cookie;
    csrf = s.csrf;
  });
  afterAll(async () => {
    await h.close();
  });

  it('lists requests with status, service, and received time', async () => {
    const html = await (await adminGet(h, '/admin/requests', cookie)).text();
    expect(html).toContain('Alice Example');
    expect(html).toContain('Standard Cleaning');
    expect(html).toContain('UTC');
    expect(html).toContain('Not yet opened');
  });

  it('escapes customer text, so injected markup is shown as text', async () => {
    const html = await (await adminGet(h, '/admin/requests', cookie)).text();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('searches by name, email, and service, and filters by status and date', async () => {
    expect(await (await adminGet(h, '/admin/requests?q=alice', cookie)).text()).toContain('Alice Example');
    expect(await (await adminGet(h, '/admin/requests?q=alice', cookie)).text()).not.toContain('Bob');
    expect(await (await adminGet(h, `/admin/requests?q=${encodeURIComponent('Move-Out')}`, cookie)).text()).toContain('Bob');
    expect(await (await adminGet(h, '/admin/requests?status=completed', cookie)).text()).toContain('No requests match');
    const today = new Date().toISOString().slice(0, 10);
    expect(await (await adminGet(h, `/admin/requests?from=${today}&to=${today}`, cookie)).text()).toContain('Alice Example');
    expect(await (await adminGet(h, '/admin/requests?from=2001-01-01&to=2001-01-02', cookie)).text()).toContain('No requests match');
  });

  it('wildcard characters in search do not match everything', async () => {
    expect(await (await adminGet(h, `/admin/requests?q=${encodeURIComponent('%')}`, cookie)).text()).toContain('No requests match');
  });

  it('opens a request, shows contact and answers, and marks it as opened', async () => {
    const id = (h.db.prepare("SELECT id FROM estimate_request WHERE name = 'Alice Example'").get() as { id: number }).id;
    const html = await (await adminGet(h, `/admin/requests/${id}`, cookie)).text();
    expect(html).toContain('alice@example.test');
    expect(html).toContain('Standard Cleaning');
    expect(html).toContain('Private test note');
    const reviewed = h.db.prepare('SELECT reviewed_at FROM estimate_request WHERE id = ?').get(id) as { reviewed_at: string | null };
    expect(reviewed.reviewed_at).not.toBeNull();
  });

  it('shows photos only through an authenticated route', async () => {
    const row = h.db.prepare('SELECT request_id, id, storage_name FROM request_photo').get() as { request_id: number; id: number; storage_name: string };
    const anon = await fetch(`${h.base}/admin/requests/${row.request_id}/photos/${row.id}`, { redirect: 'manual' });
    expect(anon.status).toBe(303);
    const ok = await adminGet(h, `/admin/requests/${row.request_id}/photos/${row.id}`, cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-security-policy')).toContain('sandbox');
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it('does not serve a photo through a mismatched request id', async () => {
    const row = h.db.prepare('SELECT id FROM request_photo LIMIT 1').get() as { id: number };
    const response = await adminGet(h, `/admin/requests/9999/photos/${row.id}`, cookie);
    expect(response.status).toBe(404);
  });

  it('changes status with an audit event that records the old and new value', async () => {
    const id = (h.db.prepare("SELECT id FROM estimate_request WHERE name = 'Alice Example'").get() as { id: number }).id;
    const r = await adminPost(h, `/admin/requests/${id}/status`, cookie, csrf, { status: 'contacted' });
    expect(r.status).toBe(303);
    const row = h.db.prepare('SELECT status FROM estimate_request WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('contacted');
    const event = h.db.prepare("SELECT from_value, to_value FROM request_event WHERE request_id = ? AND kind = 'status_changed'").get(id) as { from_value: string; to_value: string };
    expect(event).toEqual({ from_value: 'new', to_value: 'contacted' });
  });

  it('rejects an unknown status value', async () => {
    const r = await adminPost(h, '/admin/requests/1/status', cookie, csrf, { status: 'deleted' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('err=');
  });

  it('adds a private note that appears in the panel and never in public responses', async () => {
    const id = (h.db.prepare("SELECT id FROM estimate_request WHERE name = 'Alice Example'").get() as { id: number }).id;
    const r = await adminPost(h, `/admin/requests/${id}/notes`, cookie, csrf, { body: 'INTERNAL: call after 5pm' });
    expect(r.status).toBe(303);
    const html = await (await adminGet(h, `/admin/requests/${id}`, cookie)).text();
    expect(html).toContain('INTERNAL: call after 5pm');
    const publicApi = await (await fetch(`${h.base}/api/welcome?lang=en`)).text();
    const publicHome = await (await fetch(`${h.base}/`)).text();
    expect(publicApi).not.toContain('INTERNAL');
    expect(publicHome).not.toContain('INTERNAL');
  });

  it('keeps notes and history after a status change (nothing is overwritten)', async () => {
    const id = (h.db.prepare("SELECT id FROM estimate_request WHERE name = 'Alice Example'").get() as { id: number }).id;
    await adminPost(h, `/admin/requests/${id}/status`, cookie, csrf, { status: 'booked' });
    const html = await (await adminGet(h, `/admin/requests/${id}`, cookie)).text();
    expect(html).toContain('INTERNAL: call after 5pm');
    expect(html).toContain('Status changed');
    const kinds = (h.db.prepare('SELECT kind FROM request_event WHERE request_id = ? ORDER BY id').all(id) as Array<{ kind: string }>).map((x) => x.kind);
    expect(kinds).toContain('received');
    expect(kinds.filter((k) => k === 'status_changed').length).toBeGreaterThanOrEqual(2);
  });

  it('refuses an empty note', async () => {
    const r = await adminPost(h, '/admin/requests/1/notes', cookie, csrf, { body: '   ' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('err=');
  });
});

describe('6. Welcome Center: publishing rules', () => {
  let h: Harness;
  let cookie = '';
  let csrf = '';
  let letterId = 0;
  beforeAll(async () => {
    h = await startHarness({});
    seedWelcomePacket(h.db, packet);
    const s = await signIn(h);
    cookie = s.cookie;
    csrf = s.csrf;
    letterId = (h.db.prepare("SELECT id FROM welcome_resource WHERE chapter_key = 'letter'").get() as { id: number }).id;
  });
  afterAll(async () => {
    await h.close();
  });

  const titles = async (lang: string) => ((await (await fetch(`${h.base}/api/welcome?lang=${lang}`)).json()) as { items: Array<{ key: string; title: string }> }).items.map((i) => i.key);

  it('seeds the five packet chapters unapproved and unpublished', async () => {
    expect(count(h, 'SELECT COUNT(*) AS n FROM welcome_resource')).toBe(5);
    expect(count(h, 'SELECT COUNT(*) AS n FROM welcome_resource WHERE published = 1 OR approved_en = 1 OR approved_es = 1')).toBe(0);
    expect(await titles('en')).toEqual([]);
  });

  it('seeding again adds nothing and changes nothing', async () => {
    expect(seedWelcomePacket(h.db, packet)).toBe(0);
    expect(count(h, 'SELECT COUNT(*) AS n FROM welcome_resource')).toBe(5);
  });

  it('a draft that is not published never reaches the public list', async () => {
    await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...fieldsFor(h, letterId), approvedEn: '1' });
    expect(await titles('en')).toEqual([]);
  });

  it('refuses to publish when no language is approved', async () => {
    const r = await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...fieldsFor(h, letterId), published: '1' });
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('err=');
    expect(await titles('en')).toEqual([]);
  });

  it('publishes an approved English chapter, visible in English only', async () => {
    const r = await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...fieldsFor(h, letterId), approvedEn: '1', published: '1' });
    expect(r.headers.get('location')).toContain('ok=saved');
    expect(await titles('en')).toEqual(['letter']);
    expect(await titles('es')).toEqual([]);
  });

  it('shows a Spanish version only after Spanish is approved', async () => {
    await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...fieldsFor(h, letterId), approvedEn: '1', approvedEs: '1', published: '1' });
    expect(await titles('es')).toEqual(['letter']);
    const item = (await (await fetch(`${h.base}/api/welcome?lang=es`)).json()) as { items: Array<{ title: string; body: string }> };
    expect(item.items[0]?.title).toBe('Bienvenido a Bridiant');
  });

  it('editing approved text removes that language approval until it is approved again', async () => {
    const fields = fieldsFor(h, letterId);
    const edited = { ...fields, bodyEn: `${fields.bodyEn}\n\nA new sentence.`, approvedEn: '' };
    await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...edited, published: '1' });
    const row = h.db.prepare('SELECT approved_en FROM welcome_resource WHERE id = ?').get(letterId) as { approved_en: number };
    expect(row.approved_en).toBe(0);
    expect(await titles('en')).toEqual([]);
  });

  it('withdrawing a chapter removes it at once', async () => {
    await adminPost(h, `/admin/welcome/${letterId}`, cookie, csrf, { ...fieldsFor(h, letterId), approvedEn: '1', approvedEs: '1', published: '0' });
    expect(await titles('en')).toEqual([]);
    expect(await titles('es')).toEqual([]);
  });

  it('never returns the access tiers that are not yet connected', async () => {
    const privateId = (h.db.prepare("SELECT id FROM welcome_resource WHERE chapter_key = 'contact'").get() as { id: number }).id;
    h.db.prepare("UPDATE welcome_resource SET access_tier = 'after_approval', published = 1, approved_en = 1, approved_es = 1 WHERE id = ?").run(privateId);
    expect(await titles('en')).not.toContain('contact');
    h.db.prepare("UPDATE welcome_resource SET access_tier = 'public', published = 0 WHERE id = ?").run(privateId);
  });

  it('creates a new resource from the panel, unpublished by default', async () => {
    const r = await adminPost(h, '/admin/welcome', cookie, csrf, {
      kind: 'faq', accessTier: 'public', titleEn: 'Questions', titleEs: 'Preguntas', subtitleEn: '', subtitleEs: '', bodyEn: 'Q | A', bodyEs: '', sortOrder: '9',
    });
    expect(r.status).toBe(303);
    expect(count(h, 'SELECT COUNT(*) AS n FROM welcome_resource WHERE published = 1')).toBe(0);
  });

  it('shows the Welcome Center form in the panel', async () => {
    const html = await (await adminGet(h, `/admin/welcome/${letterId}`, cookie)).text();
    expect(html).toContain('Subtitle (English)');
    expect(html).toContain('Format:');
  });
});

function fieldsFor(h: Harness, id: number): Record<string, string> {
  const r = h.db.prepare('SELECT * FROM welcome_resource WHERE id = ?').get(id) as Record<string, string | number>;
  return {
    kind: String(r.kind),
    accessTier: String(r.access_tier),
    titleEn: String(r.title_en),
    titleEs: String(r.title_es),
    subtitleEn: String(r.subtitle_en),
    subtitleEs: String(r.subtitle_es),
    bodyEn: String(r.body_en),
    bodyEs: String(r.body_es),
    sortOrder: String(r.sort_order),
  };
}

describe('7. Welcome Center documents', () => {
  let h: Harness;
  let cookie = '';
  let csrf = '';
  let id = 0;
  beforeAll(async () => {
    h = await startHarness({});
    seedWelcomePacket(h.db, packet);
    const s = await signIn(h);
    cookie = s.cookie;
    csrf = s.csrf;
    id = (h.db.prepare("SELECT id FROM welcome_resource WHERE chapter_key = 'prepare'").get() as { id: number }).id;
  });
  afterAll(async () => {
    await h.close();
  });

  async function upload(data: Buffer, name: string, type: string) {
    const fd = new FormData();
    fd.append('csrf', csrf);
    fd.append('document', new Blob([new Uint8Array(data)], { type }), name);
    return fetch(`${h.base}/admin/welcome/${id}/document`, { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' });
  }

  it('rejects a non-PDF disguised as a PDF', async () => {
    const r = await upload(Buffer.from('MZ\x90\0 executable'), 'guide.pdf', 'application/pdf');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toContain('err=');
    expect(count(h, `SELECT COUNT(*) AS n FROM welcome_resource WHERE id = ${id} AND document_storage IS NOT NULL`)).toBe(0);
  });

  it('stores a real PDF privately, and does not serve it until it is published and approved', async () => {
    const r = await upload(pdf(), 'guide.pdf', 'application/pdf');
    expect(r.headers.get('location')).toContain('ok=saved');
    const stored = h.db.prepare('SELECT document_storage FROM welcome_resource WHERE id = ?').get(id) as { document_storage: string };
    expect(existsSync(join(h.cfg.privateDir, stored.document_storage))).toBe(true);
    expect((await fetch(`${h.base}/api/welcome/documents/${id}?lang=en`)).status).toBe(404);
    expect((await fetch(`${h.base}/${stored.document_storage}`)).status).toBe(404);
  });

  it('serves the PDF to the public only after publication and approval, inline and as PDF', async () => {
    await adminPost(h, `/admin/welcome/${id}`, cookie, csrf, { ...fieldsFor(h, id), approvedEn: '1', published: '1' });
    const response = await fetch(`${h.base}/api/welcome/documents/${id}?lang=en`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toMatch(/^inline/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await fetch(`${h.base}/api/welcome/documents/${id}?lang=es`).then((x) => x.status)).toBe(404);
  });

  it('shows the document link in the public list only when it is available', async () => {
    const items = (await (await fetch(`${h.base}/api/welcome?lang=en`)).json()) as { items: Array<{ documentUrl: string | null }> };
    expect(items.items[0]?.documentUrl).toBe(`/api/welcome/documents/${id}?lang=en`);
  });
});

describe('8. Email queue: notifications, persistence, retries, no duplicates', () => {
  it('queues notifications only for stored requests, once per request', async () => {
    const h = await startHarness({ ownerEmail: 'owner@example.invalid', emailFrom: 'alerts@example.invalid', emailApiKey: null });
    try {
      await submit(h, validPayload({ email: 'client@example.invalid', idempotencyKey: 'mail-once-00000001' }));
      await submit(h, validPayload({ email: 'client@example.invalid', idempotencyKey: 'mail-once-00000001' }));
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'owner_alert'")).toBe(1);
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE kind = 'customer_ack'")).toBe(1);
      const alert = h.db.prepare("SELECT subject, body_text FROM email_outbox WHERE kind = 'owner_alert'").get() as { subject: string; body_text: string };
      expect(alert.body_text).toContain('Test Customer');
      expect(alert.body_text).not.toContain('5550101234');
      expect(alert.body_text).not.toContain('client@example.invalid');
      expect(alert.body_text).not.toMatch(/Private test note/);
    } finally {
      await h.close();
    }
  });

  it('keeps messages queued and visible when no provider is configured', async () => {
    const h = await startHarness({ ownerEmail: 'owner@example.invalid' });
    try {
      await submit(h, validPayload({ email: 'client@example.invalid', idempotencyKey: 'mail-pending-0000001' }));
      const { senderFor } = await import('../src/email.js');
      const result = await processOutbox(h.db, senderFor(h.cfg));
      expect(result.sent).toBe(0);
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'queued'")).toBe(2);
      expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('records a skipped alert when the owner address is not configured, and keeps the request', async () => {
    const h = await startHarness({});
    try {
      await submit(h, validPayload({ idempotencyKey: 'mail-skip-00000001' }));
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'skipped_no_recipient'")).toBe(1);
      expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('retries failed sends, marks them failed after three attempts, and retries them on request', async () => {
    const h = await startHarness({ ownerEmail: 'owner@example.invalid' });
    try {
      await submit(h, validPayload({ idempotencyKey: 'mail-retry-00000001' }));
      const failing: EmailSender = { send: async () => { throw new Error('provider_http_500'); } };
      await processOutbox(h.db, failing);
      await processOutbox(h.db, failing);
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'queued' AND attempts = 2")).toBe(1);
      await processOutbox(h.db, failing);
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'failed'")).toBe(1);
      const { retryFailedEmails } = await import('../src/email.js');
      expect(retryFailedEmails(h.db)).toBe(1);
      const sent: string[] = [];
      const ok: EmailSender = { send: async (m) => { sent.push(m.to); } };
      const result = await processOutbox(h.db, ok);
      expect(result.sent).toBe(1);
      expect(sent).toEqual(['owner@example.invalid']);
      expect(count(h, "SELECT COUNT(*) AS n FROM email_outbox WHERE status = 'sent'")).toBe(1);
      expect(count(h, 'SELECT COUNT(*) AS n FROM estimate_request')).toBe(1);
    } finally {
      await h.close();
    }
  });
});

describe('9. Exposure: what the public can and cannot reach', () => {
  let h: Harness;
  let photoStorage = '';
  beforeAll(async () => {
    h = await startHarness({});
    await submit(h, validPayload({ idempotencyKey: 'expose-seed-0000001' }), [{ name: 'a.jpg', data: jpeg(), type: 'image/jpeg' }]);
    photoStorage = (h.db.prepare('SELECT storage_name FROM request_photo').get() as { storage_name: string }).storage_name;
  });
  afterAll(async () => {
    await h.close();
  });

  it('does not expose the request, photo, or database through public URLs', async () => {
    for (const path of ['/api/requests', '/api/estimate', `/${photoStorage}`, '/private/' + photoStorage, '/bridiant.sqlite', '/test.sqlite', '/api/welcome/documents/999?lang=en&raw=1']) {
      const r = await fetch(`${h.base}${path}`, { redirect: 'manual' });
      expect([404, 405], path).toContain(r.status);
    }
  });

  it('blocks path traversal attempts', async () => {
    for (const path of ['/..%2F..%2Fetc%2Fpasswd', '/%2e%2e/%2e%2e/secret.key', '/..\\..\\secret', '/%00index.html']) {
      const r = await fetch(`${h.base}${path}`);
      expect(r.status, path).toBe(404);
    }
  });

  it('sends strict security headers on panel and public pages', async () => {
    const admin = await fetch(`${h.base}/admin/login`);
    expect(admin.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(admin.headers.get('cache-control')).toBe('no-store');
    expect(admin.headers.get('x-frame-options')).toBe('DENY');
    expect(admin.headers.get('x-content-type-options')).toBe('nosniff');
    const pub = await fetch(`${h.base}/`);
    expect(pub.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(pub.headers.get('x-frame-options')).toBe('DENY');
  });

  it('keeps the signing secret and database out of every response', async () => {
    const pages = await Promise.all(['/', '/admin/login', '/api/welcome?lang=en'].map((p) => fetch(`${h.base}${p}`).then((r) => r.text())));
    for (const body of pages) {
      expect(body).not.toContain(h.cfg.secretKey.toString('base64'));
      expect(body).not.toContain(h.cfg.ipSalt);
      expect(body).not.toContain('password_hash');
    }
  });

  it('stores the password as a salted scrypt hash and the authenticator secret encrypted', async () => {
    const row = h.db.prepare('SELECT password_hash, totp_secret_enc FROM admin_user').get() as { password_hash: string; totp_secret_enc: string };
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.totp_secret_enc.startsWith('v1.')).toBe(true);
    expect(row.totp_secret_enc).not.toContain(h.totpSecret);
  });
});
