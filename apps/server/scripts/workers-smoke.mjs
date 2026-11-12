/**
 * Smoke and regression checks against the real Worker under `wrangler dev` (local D1 and R2 emulators).
 * Local only. Never deploys and never touches remote resources.
 *
 * Steps (from apps/server):
 *   1. npx wrangler d1 migrations apply bridiant-prod --local
 *   2. node scripts/workers-local-seed.mjs            (prints localOwnerTotpSecret)
 *   3. npx wrangler dev src/worker.ts --port 8788 --ip 127.0.0.1   (in another terminal)
 *   4. BRIDIANT_LOCAL_TOTP=<secret> node scripts/workers-smoke.mjs
 * Optional: BRIDIANT_WORKER_URL (default http://127.0.0.1:8788), BRIDIANT_LOCAL_PASSWORD.
 * Public site must be built first (npm run build:preview -w @bridiant/public) for the page checks.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const BASE = process.env.BRIDIANT_WORKER_URL ?? 'http://127.0.0.1:8788';
const TOTP = process.env.BRIDIANT_LOCAL_TOTP;
const PASSWORD = process.env.BRIDIANT_LOCAL_PASSWORD ?? 'correct horse battery staple';
if (!TOTP) throw new Error('Set BRIDIANT_LOCAL_TOTP to the secret printed by scripts/workers-local-seed.mjs');
const dbDir = join(serverRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const dbName = existsSync(dbDir) ? readdirSync(dbDir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : undefined;
if (!dbName) throw new Error('No local D1 database. Run the seed step first.');
const dbFile = join(dbDir, dbName);

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) with node:crypto, for the local owner account only.
function base32Decode(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const out = [];
  for (const ch of text.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const code = ((mac[o] & 0x7f) << 24 | mac[o + 1] << 16 | mac[o + 2] << 8 | mac[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

// Fixtures generated here: a structurally valid JPEG, and the same JPEG with GPS data in an EXIF segment.
function jpeg(size = 2048) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(8)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([soi, app0, dqt, sof, sos, Buffer.alloc(size, 0x55), Buffer.from([0xff, 0xd9])]);
}

const results = [];
const ok = (name, cond, extra = '') => { results.push(Boolean(cond)); console.log(cond ? 'PASS' : 'FAIL', '-', name, extra ? '(' + extra + ')' : ''); };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const csrfOf = (html) => (/name="csrf" value="([^"]+)"/.exec(html) ?? [])[1] ?? '';
const cookieOf = (res) => (/bridiant_admin=([^;]+)/.exec(res.headers.get('set-cookie') ?? '') ?? [])[0] ?? '';
const payload = (over = {}) => ({ locale: 'en', services: ['standard-cleaning'], homeType: 'house', bedrooms: '3', bathrooms: '2', frequency: 'monthly', moveDate: null, name: 'Workers Test', phone: '5550101234', email: '', zip: '', notes: 'workers test note', consent: true, website: '', idempotencyKey: randomBytes(12).toString('hex'), ...over });
const form = (p, files = []) => { const f = new FormData(); f.append('payload', JSON.stringify(p)); for (const x of files) f.append('photos', new Blob([x.data], { type: x.type }), x.name); return f; };
// Local database access for setup and cleanup (the local emulator file only).
const withDb = (fn) => { const d = new DatabaseSync(dbFile); try { return fn(d); } finally { d.close(); } };
const rateReset = () => withDb((d) => d.exec('DELETE FROM rate_limit'));
const jpegBase = jpeg();
const gpsPayload = Buffer.from('Exif\0\0GPSLatitude=40.7128N;', 'latin1');
const gpsLen = gpsPayload.length + 2;
const gpsSeg = Buffer.concat([Buffer.from([0xff, 0xe1, gpsLen >> 8, gpsLen & 0xff]), gpsPayload]);
const jpegGps = Buffer.concat([jpegBase.subarray(0, 2), gpsSeg, jpegBase.subarray(2)]);
await rateReset();

// ---- Public site and public APIs
const pubs = await Promise.all(['/en/', '/es/', '/en/request-estimate/', '/en/welcome/', '/en/our-work/', '/en/services/'].map((p) => fetch(BASE + p).then((r) => [p, r.status])));
ok('public pages render on the Worker', pubs.every(([, s]) => s === 200), pubs.map(([p, s]) => p + ' ' + s).join(', '));
const welcomeEmpty = await (await fetch(BASE + '/api/welcome?lang=en')).json();
ok('Welcome API shows nothing before approval', Array.isArray(welcomeEmpty.items) && welcomeEmpty.items.length === 0);
const galleryEmpty = await (await fetch(BASE + '/api/gallery?lang=en')).json();
ok('gallery API shows nothing before approval', galleryEmpty.items.length === 0);

// ---- Estimate intake (multipart, photos, rate limit, refusals)
const good = await fetch(BASE + '/api/estimate', { method: 'POST', body: form(payload(), [{ name: 'kitchen.jpg', data: jpegBase, type: 'image/jpeg' }]) });
const goodJson = await good.json();
ok('valid request with a photo is saved and confirmed', good.status === 200 && /^BFG-/.test(goodJson.reference ?? ''), goodJson.reference);
const idem = payload();
const first = await (await fetch(BASE + '/api/estimate', { method: 'POST', body: form(idem) })).json();
const again = await (await fetch(BASE + '/api/estimate', { method: 'POST', body: form(idem) })).json();
ok('repeated idempotency key returns the same reference', first.reference && first.reference === again.reference);
const honey = await (await fetch(BASE + '/api/estimate', { method: 'POST', body: form(payload({ website: 'spam' })) })).json();
ok('honeypot is refused without naming the field', JSON.stringify(honey).includes('"form"') && !JSON.stringify(honey).includes('website'));
const disguised = await fetch(BASE + '/api/estimate', { method: 'POST', body: form(payload(), [{ name: 'evil.jpg', data: Buffer.from('MZ\x90\0 not an image'), type: 'image/jpeg' }]) });
ok('executable renamed to .jpg is refused with 400', disguised.status === 400);
const notForm = await fetch(BASE + '/api/estimate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok('non-multipart submission is refused with 415', notForm.status === 415);
const huge = Buffer.alloc(16 * 1024 * 1024, 0x55); huge.set(jpegBase.subarray(0, 4), 0);
const tooBig = await fetch(BASE + '/api/estimate', { method: 'POST', body: form(payload(), [{ name: 'big.jpg', data: huge, type: 'image/jpeg' }]) });
ok('file over 15 MB is refused with 413', tooBig.status === 413, String(tooBig.status));
const stored = await (await fetch(BASE + '/api/estimate', { method: 'POST', body: form(payload()) })).json().catch(() => ({}));
ok('request without photos is accepted and confirmed', stored.status === 'received', JSON.stringify(stored).slice(0, 80));

// ---- Owner authentication (password + TOTP, CSRF, cookies)
const anon = await fetch(BASE + '/admin/requests', { redirect: 'manual' });
ok('panel redirects anonymous visitors to sign-in', anon.status === 303 && (anon.headers.get('location') ?? '').includes('/admin/login'));
const badPw = await fetch(BASE + '/admin/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ username: 'owner', password: 'wrong wrong wrong', code: totp(TOTP) }) });
ok('wrong password is refused generically', badPw.status === 401);
const login = await fetch(BASE + '/admin/login', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ username: 'owner', password: PASSWORD, code: totp(TOTP) }) });
const cookie = cookieOf(login);
const setCookie = login.headers.get('set-cookie') ?? '';
ok('sign-in with password and code sets a session cookie', login.status === 303 && cookie.length > 20);
ok('session cookie is HttpOnly and SameSite=Strict', /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie));
const page = async (path) => (await fetch(BASE + path, { headers: { cookie } })).text();
const requestsHtml = await page('/admin/requests');
const csrf = csrfOf(requestsHtml);
ok('panel lists the saved requests by name', requestsHtml.includes('Workers Test') && /href="\/admin\/requests\/\d+"/.test(requestsHtml));
const css = await fetch(BASE + '/admin/static/admin.css');
ok('panel stylesheet is served as CSS on the Worker', css.headers.get('content-type') === 'text/css; charset=utf-8');
const panelHeaders = await fetch(BASE + '/admin/requests', { headers: { cookie } });
ok('panel sends no-store and a strict CSP', panelHeaders.headers.get('cache-control') === 'no-store' && /default-src 'none'/.test(panelHeaders.headers.get('content-security-policy') ?? ''));
const noCsrf = await fetch(BASE + '/admin/gallery/upload', { method: 'POST', headers: { cookie }, body: (() => { const f = new FormData(); f.append('photos', new Blob([jpegBase], { type: 'image/jpeg' }), 'x.jpg'); return f; })(), redirect: 'manual' });
ok('change without the session token is refused (403)', noCsrf.status === 403, String(noCsrf.status));

// ---- Requests: detail, photo, status, note
const reqRow = withDb((d) => d.prepare('SELECT id FROM estimate_request WHERE reference = ?').get(goodJson.reference));
const reqId = Number(reqRow?.id);
ok('the request with the photo is found by its reference', reqId > 0, 'id ' + reqId);
const detailHtml = await page('/admin/requests/' + reqId);
ok('request detail shows contact and answers', detailHtml.includes('Workers Test') && detailHtml.includes('workers test note'));
const photoLink = (/\/admin\/requests\/\d+\/photos\/(\d+)/.exec(detailHtml) ?? [])[0];
const pr = await fetch(BASE + photoLink, { headers: { cookie } });
ok('request photo opens for the signed-in owner as a JPEG', pr.status === 200 && pr.headers.get('content-type') === 'image/jpeg', photoLink);
const prAnon = await fetch(BASE + photoLink, { redirect: 'manual' });
ok('request photo is refused without a session', prAnon.status === 303);
const st = await fetch(BASE + `/admin/requests/${reqId}/status`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ csrf, status: 'contacted' }) });
ok('status change is saved', st.status === 303 && (st.headers.get('location') ?? '').includes('ok=saved'), String(st.status));
const note = await fetch(BASE + `/admin/requests/${reqId}/notes`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ csrf, body: 'Workers internal note' }) });
ok('internal note is saved', note.status === 303);
const detail2 = await page('/admin/requests/' + reqId);
ok('note and history appear in the panel', detail2.includes('Workers internal note') && detail2.includes('contacted'));
const publicLeak = await (await fetch(BASE + '/api/welcome?lang=en')).text();
ok('internal note does not reach any public response', !publicLeak.includes('Workers internal note'));

// ---- Gallery: upload (two files), metadata removal, approval, public media
const up = await fetch(BASE + '/admin/gallery/upload', { method: 'POST', headers: { cookie }, redirect: 'manual', body: (() => { const f = new FormData(); f.append('csrf', csrf); f.append('photos', new Blob([jpegBase], { type: 'image/jpeg' }), 'kitchen.jpg'); f.append('photos', new Blob([jpegGps], { type: 'image/jpeg' }), 'gps.jpg'); return f; })() });
ok('gallery upload of two photos is confirmed', up.status === 303 && (up.headers.get('location') ?? '').includes('ok=2'), up.headers.get('location'));
const gal = await page('/admin/gallery');
const ids = [...new Set([...gal.matchAll(/\/admin\/gallery\/photos\/(\d+)"/g)].map((m) => Number(m[1])))];
ok('both photos are private and listed in the panel', ids.length >= 2, 'ids ' + ids.join(','));
const [p1, p2] = ids.slice(-2);
const pubBefore = await (await fetch(BASE + '/api/gallery?lang=en')).json();
ok('uploaded photos are not public before approval', pubBefore.items.length === 0);
const approve = (id) => fetch(BASE + `/admin/gallery/photos/${id}`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ csrf, kind: 'regular', projectId: '', serviceId: 'standard-cleaning', ownershipConfirmed: '1', peopleStatus: 'none_visible', captionEn: 'Kitchen', captionEs: 'Cocina', altEn: 'Kitchen counter', altEs: 'Encimera de cocina', visible: '1', approveCaptionEn: '1', approveCaptionEs: '1', approveAltEn: '1', approveAltEs: '1', reviewStatus: 'approved' }) });
const ap = await approve(p1);
ok('owner approves and publishes a photo', ap.status === 303 && (ap.headers.get('location') ?? '').includes('ok=saved'), ap.headers.get('location'));
const pubAfter = await (await fetch(BASE + '/api/gallery?lang=en')).json();
ok('approved photo appears on the public gallery API', pubAfter.items.length === 1);
const media = await fetch(BASE + pubAfter.items[0].photos[0].src);
ok('public media is served as an image from private storage', media.status === 200 && media.headers.get('content-type') === 'image/jpeg', String(media.status));
const unapproved = await fetch(BASE + `/api/gallery/media/${p2}`);
ok('unapproved photo is not reachable publicly by URL', unapproved.status === 404, String(unapproved.status));
const privateGps = Buffer.from(await (await fetch(BASE + `/admin/gallery/photos/${p2}/file`, { headers: { cookie } })).arrayBuffer());
ok('GPS data is removed from the stored photo on the Worker', !privateGps.includes(Buffer.from('GPSLatitude')));
ok('stored photo keeps a valid JPEG structure', privateGps[0] === 0xff && privateGps[1] === 0xd8 && privateGps.includes(Buffer.from([0xff, 0xd9])));

// ---- Welcome Center: chapter, document upload, publish, public PDF
const welcomeHtml = await page('/admin/welcome');
ok('Welcome Center list shows the five packet chapters', [...new Set([...welcomeHtml.matchAll(/\/admin\/welcome\/(\d+)"/g)].map((m) => m[1]))].length >= 5);
const chapter = withDb((d) => d.prepare('SELECT * FROM welcome_resource WHERE chapter_key = ?').get('prepare'));
const doc = await fetch(BASE + `/admin/welcome/${chapter.id}/document`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: (() => { const f = new FormData(); f.append('csrf', csrf); f.append('document', new Blob([pdf], { type: 'application/pdf' }), 'prepare.pdf'); return f; })() });
ok('PDF document is stored privately', doc.status === 303 && (doc.headers.get('location') ?? '').includes('ok=saved'), doc.headers.get('location'));
const disguisedDoc = await fetch(BASE + `/admin/welcome/${chapter.id}/document`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: (() => { const f = new FormData(); f.append('csrf', csrf); f.append('document', new Blob([Buffer.from('MZ bad')], { type: 'application/pdf' }), 'fake.pdf'); return f; })() });
ok('a non-PDF renamed to .pdf is refused', (disguisedDoc.headers.get('location') ?? '').includes('err='));
const publish = await fetch(BASE + `/admin/welcome/${chapter.id}`, { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ csrf, kind: chapter.kind, accessTier: 'public', titleEn: chapter.title_en, titleEs: chapter.title_es, subtitleEn: chapter.subtitle_en, subtitleEs: chapter.subtitle_es, bodyEn: chapter.body_en, bodyEs: chapter.body_es, sortOrder: String(chapter.sort_order), approvedEn: '1', published: '1' }) });
ok('English approval and publish of one chapter is saved', publish.status === 303 && (publish.headers.get('location') ?? '').includes('ok=saved'), publish.headers.get('location'));
const wEn = await (await fetch(BASE + '/api/welcome?lang=en')).json();
ok('only the approved, published chapter is public in English', wEn.items.length === 1 && wEn.items[0].documentUrl !== null, JSON.stringify(wEn.items.map((i) => i.key)));
const wEs = await (await fetch(BASE + '/api/welcome?lang=es')).json();
ok('Spanish stays hidden until Spanish is approved', wEs.items.length === 0);
const pdfRes = await fetch(BASE + wEn.items[0].documentUrl);
ok('public PDF is served inline as application/pdf', pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf' && /inline/.test(pdfRes.headers.get('content-disposition') ?? ''));
ok('public PDF is not served in Spanish', (await fetch(BASE + `/api/welcome/documents/${chapter.id}?lang=es`)).status === 404);

// ---- System page and sign-out
const status = await fetch(BASE + '/admin/status', { headers: { cookie } });
ok('system page loads', status.status === 200);
const logout = await fetch(BASE + '/admin/logout', { method: 'POST', headers: { cookie }, redirect: 'manual', body: new URLSearchParams({ csrf }) });
ok('sign-out succeeds', logout.status === 303);
const afterLogout = await fetch(BASE + '/admin/requests', { headers: { cookie }, redirect: 'manual' });
ok('old session is rejected after sign-out', afterLogout.status === 303);

// ---- Limits without Content-Length, and a valid 12 MB photo
function largeJpeg(total) {
  // A JPEG segment holds at most 65533 bytes, so the padding is split into COM segments (removed on storage).
  const segs = [];
  let used = 0;
  while (used < total - jpegBase.length) {
    const n = Math.min(60000, total - jpegBase.length - used - 4);
    if (n <= 0) break;
    const len = n + 2;
    segs.push(Buffer.concat([Buffer.from([0xff, 0xfe, len >> 8, len & 0xff]), Buffer.alloc(n, 0x41)]));
    used += n + 4;
  }
  return Buffer.concat([jpegBase.subarray(0, 2), ...segs, jpegBase.subarray(2)]);
}
const chunkedText = (text) => { const bytes = new TextEncoder().encode(text); return new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 1024) c.enqueue(bytes.subarray(i, i + 1024)); c.close(); } }); };
const chunkBig = await fetch(BASE + '/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: chunkedText('username=owner&password=' + 'x'.repeat(40000)), duplex: 'half', redirect: 'manual' });
ok('chunked panel form over the limit is cut off with 413', chunkBig.status === 413, String(chunkBig.status));
const bigIntake = new FormData();
bigIntake.append('payload', JSON.stringify(payload()));
bigIntake.append('photos', new Blob([largeJpeg(12 * 1024 * 1024)], { type: 'image/jpeg' }), 'large.jpg');
const bigRes = await fetch(BASE + '/api/estimate', { method: 'POST', body: bigIntake });
ok('valid 12 MB photo is accepted by the public intake', bigRes.status === 200, String(bigRes.status));

const pass = results.filter(Boolean).length;
console.log(`\nTotal: ${results.length}, failed: ${results.length - pass}`);
if (pass !== results.length) process.exitCode = 1;
