import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { REQUEST_STATUSES, nowIso, type Db, type RequestStatus } from '../db.js';
import type { Config } from '../config.js';
import { getSession, login, logout, SESSION_ABSOLUTE_MS } from '../auth.js';
import { ACCESS_TIERS, WELCOME_KINDS, attachDocument, createResource, getResource, listResources, parseResourceInput, setApproval, setPublished, updateResource, type ResourceRow } from '../welcome.js';
import { processOutbox, retryFailedEmails, senderFor } from '../email.js';
import { parseMultipart, UploadError } from '../estimates.js';
import { t, KIND_LABELS, TIER_LABELS, FREQUENCY_LABELS, type AdminLang } from './i18n.js';
import { checkbox, esc, formatDate, homeLabel, label, layout, selectField, serviceNames, statusLabel, statusPill, textField, type LayoutOptions } from './view.js';
import { audit } from '../db.js';

export interface AdminCtx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, string>;
  cookies: Record<string, string>;
  headers: Record<string, string | undefined>;
  ip: string;
  cfg: Config;
  db: Db;
  req: NodeJS.ReadableStream & { headers: Record<string, string | string[] | undefined> };
}

export interface AdminResponse {
  status: number;
  html?: string;
  headers?: Record<string, string>;
  file?: { path: string; mime: string; name: string; inline: boolean };
}

const SESSION_COOKIE_DEV = 'bridiant_admin';
const SESSION_COOKIE_PROD = '__Host-bridiant_admin';
const LANG_COOKIE = 'bridiant_lang';
const PAGE_SIZE = 25;

export function sessionCookieName(cfg: Config): string {
  return cfg.env === 'production' ? SESSION_COOKIE_PROD : SESSION_COOKIE_DEV;
}

function cookieAttrs(cfg: Config, maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.cookieSecure ? '; Secure' : ''}`;
}

function redirect(location: string, extra: Record<string, string> = {}): AdminResponse {
  return { status: 303, headers: { Location: location, ...extra } };
}

function html(status: number, body: string, extra: Record<string, string> = {}): AdminResponse {
  return { status, html: body, headers: extra };
}

function langOf(ctx: AdminCtx): AdminLang {
  return ctx.cookies[LANG_COOKIE] === 'es' ? 'es' : 'en';
}

function flashFrom(ctx: AdminCtx, lang: AdminLang): LayoutOptions['flash'] {
  const key = ctx.query.get('ok');
  const err = ctx.query.get('err');
  if (key === 'saved') return { kind: 'ok', text: t(lang, 'saved') };
  if (err) return { kind: 'error', text: err };
  return null;
}

function page(ctx: AdminCtx, lang: AdminLang, o: Omit<LayoutOptions, 'lang' | 'path' | 'signedIn' | 'csrf'> & { csrf?: string | null; signedIn?: boolean }): AdminResponse {
  return html(200, layout({ ...o, lang, path: ctx.path, signedIn: o.signedIn ?? true, csrf: o.csrf ?? null }));
}

function requireCsrf(ctx: AdminCtx, csrf: string): boolean {
  return typeof ctx.body.csrf === 'string' && ctx.body.csrf.length > 0 && ctx.body.csrf === csrf;
}

/** Login POSTs must come from this site. A cross-site form cannot pass this check. */
function sameOrigin(ctx: AdminCtx): boolean {
  const origin = ctx.headers.origin;
  const host = ctx.headers.host;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handleAdmin(ctx: AdminCtx): Promise<AdminResponse> {
  const { method, path, db, cfg } = ctx;
  const lang = langOf(ctx);

  // Static assets and language switch need no session.
  if (method === 'GET' && path === '/admin/static/admin.css') return { status: 200, file: { path: join(cfg.adminStaticDir, 'admin.css'), mime: 'text/css; charset=utf-8', name: 'admin.css', inline: true } };
  if (method === 'GET' && path === '/admin/static/tokens.css') return { status: 200, file: { path: cfg.tokensCssPath, mime: 'text/css; charset=utf-8', name: 'tokens.css', inline: true } };
  if (method === 'GET' && path === '/admin/lang') {
    const to = ctx.query.get('to') === 'es' ? 'es' : 'en';
    const next = ctx.query.get('next') ?? '/admin/login';
    const safeNext = next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin/login';
    return redirect(safeNext, { 'Set-Cookie': `${LANG_COOKIE}=${to}; Path=/; SameSite=Strict; Max-Age=31536000${cfg.cookieSecure ? '; Secure' : ''}` });
  }

  if (path === '/admin/login' || path === '/admin' || path === '/admin/') {
    if (method === 'GET' && (path === '/admin' || path === '/admin/')) return redirect('/admin/requests');
    const existing = getSession(db, ctx.cookies[sessionCookieName(cfg)]);
    if (method === 'GET' && path === '/admin/login') {
      if (existing) return redirect('/admin/requests');
      return page(ctx, lang, { title: t(lang, 'login'), body: loginForm(lang, null), signedIn: false, flash: ctx.query.get('expired') ? { kind: 'error', text: t(lang, 'sessionEnded') } : null, csrf: null });
    }
  }

  if (method === 'POST' && path === '/admin/login') {
    if (!sameOrigin(ctx)) return html(403, loginPage(lang, t(lang, 'forbidden')));
    const result = await login(db, cfg, {
      username: ctx.body.username ?? '',
      password: ctx.body.password ?? '',
      code: ctx.body.code ?? '',
      ip: ctx.ip,
    });
    if (!result.ok || !result.token) return html(401, loginPage(lang, t(lang, 'loginFailed')));
    return redirect('/admin/requests', {
      'Set-Cookie': `${sessionCookieName(cfg)}=${result.token}; ${cookieAttrs(cfg, Math.floor(SESSION_ABSOLUTE_MS / 1000))}`,
    });
  }

  // Everything below requires a valid owner session.
  const session = getSession(db, ctx.cookies[sessionCookieName(cfg)]);
  if (!session) {
    if (method === 'GET') return redirect('/admin/login?expired=1');
    return redirect('/admin/login?expired=1', { 'Set-Cookie': `${sessionCookieName(cfg)}=; ${cookieAttrs(cfg, 0)}` });
  }
  const csrf = session.csrf;

  if (method === 'POST' && path === '/admin/logout') {
    if (!requireCsrf(ctx, csrf)) return html(403, loginPage(lang, t(lang, 'forbidden')));
    logout(db, ctx.cookies[sessionCookieName(cfg)]);
    return redirect('/admin/login', { 'Set-Cookie': `${sessionCookieName(cfg)}=; ${cookieAttrs(cfg, 0)}` });
  }

  const base = { lang, csrf, signedIn: true as const, path, flash: flashFrom(ctx, lang) };

  // ---------- Requests ----------
  if (method === 'GET' && path === '/admin/requests') return requestList(ctx, base);

  const detail = /^\/admin\/requests\/(\d+)$/.exec(path);
  if (method === 'GET' && detail) return requestDetail(ctx, Number(detail[1]), base);

  const statusPost = /^\/admin\/requests\/(\d+)\/status$/.exec(path);
  if (method === 'POST' && statusPost) {
    if (!requireCsrf(ctx, csrf)) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    return changeStatus(ctx, Number(statusPost[1]), lang);
  }

  const notePost = /^\/admin\/requests\/(\d+)\/notes$/.exec(path);
  if (method === 'POST' && notePost) {
    if (!requireCsrf(ctx, csrf)) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    return addNote(ctx, Number(notePost[1]), session.username, lang);
  }

  const photo = /^\/admin\/requests\/(\d+)\/photos\/(\d+)$/.exec(path);
  if (method === 'GET' && photo) {
    const row = db.prepare('SELECT p.storage_name, p.mime, p.display_name FROM request_photo p WHERE p.id = ? AND p.request_id = ?').get(Number(photo[2]), Number(photo[1])) as
      | { storage_name: string; mime: string; display_name: string }
      | undefined;
    if (!row) return { status: 404, html: 'Not found' };
    audit(db, 'photo_viewed', 'request_photo', photo[2] ?? null);
    return { status: 200, file: { path: join(cfg.privateDir, row.storage_name), mime: row.mime, name: row.display_name, inline: true } };
  }

  // ---------- Welcome Center ----------
  if (method === 'GET' && path === '/admin/welcome') return welcomeList(ctx, base);
  if (method === 'GET' && path === '/admin/welcome/new') return page(ctx, lang, { ...base, title: t(lang, 'newResource'), body: resourceForm(lang, csrf, null, null) });
  if (method === 'POST' && path === '/admin/welcome') {
    if (!requireCsrf(ctx, csrf)) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    const parsed = parseResourceInput(ctx.body);
    if (!parsed.ok) return redirect('/admin/welcome/new?err=' + encodeURIComponent(parsed.code));
    const id = createResource(db, parsed.value);
    return redirect(`/admin/welcome/${id}?ok=saved`);
  }

  const resource = /^\/admin\/welcome\/(\d+)$/.exec(path);
  if (method === 'GET' && resource) {
    const row = getResource(db, Number(resource[1]));
    if (!row) return page(ctx, lang, { ...base, title: t(lang, 'notFound'), body: `<p>${esc(t(lang, 'notFound'))}</p>` });
    return page(ctx, lang, { ...base, title: row.title_en || row.title_es || 'Resource', body: resourceForm(lang, csrf, row, ctx.query.get('ok')) });
  }
  if (method === 'POST' && resource) {
    if (!requireCsrf(ctx, csrf)) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    const id = Number(resource[1]);
    if (!getResource(db, id)) return redirect('/admin/welcome?err=' + encodeURIComponent('not_found'));
    const parsed = parseResourceInput(ctx.body);
    if (!parsed.ok) return redirect(`/admin/welcome/${id}?err=${encodeURIComponent(parsed.code)}`);
    updateResource(db, id, parsed.value);
    setApproval(db, id, 'en', ctx.body.approvedEn === '1' && parsed.value.titleEn.length > 0);
    setApproval(db, id, 'es', ctx.body.approvedEs === '1' && parsed.value.titleEs.length > 0);
    const approvedAny = ctx.body.approvedEn === '1' || ctx.body.approvedEs === '1';
    if (ctx.body.published === '1' && !approvedAny) {
      setPublished(db, id, false);
      return redirect(`/admin/welcome/${id}?err=${encodeURIComponent(t(lang, 'publishNeedsApproval'))}`);
    }
    setPublished(db, id, ctx.body.published === '1');
    return redirect(`/admin/welcome/${id}?ok=saved`);
  }

  const upload = /^\/admin\/welcome\/(\d+)\/document$/.exec(path);
  if (method === 'POST' && upload) {
    // Multipart: the CSRF token travels as a form field, checked before the file is stored.
    const parsed = await parseMultipart(ctx.req as never, cfg).catch((e: unknown) => (e instanceof UploadError ? e : null));
    if (!parsed || parsed instanceof UploadError) return redirect(`/admin/welcome/${upload[1]}?err=${encodeURIComponent('upload_failed')}`);
    if (parsed.fields.csrf !== csrf) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    const file = parsed.files[0];
    if (!file) return redirect(`/admin/welcome/${upload[1]}?err=${encodeURIComponent('unsupported_file')}`);
    try {
      await attachDocument(db, cfg, Number(upload[1]), file.buffer);
      return redirect(`/admin/welcome/${upload[1]}?ok=saved`);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'upload_failed';
      return redirect(`/admin/welcome/${upload[1]}?err=${encodeURIComponent(code)}`);
    }
  }

  // ---------- Gallery and system ----------
  if (method === 'POST' && path === '/admin/status/send-queue') {
    if (!requireCsrf(ctx, csrf)) return html(403, layout({ ...base, title: t(lang, 'forbidden'), body: '', path }));
    if (ctx.body.action === 'retry') retryFailedEmails(db);
    const result = await processOutbox(db, senderFor(cfg));
    audit(db, 'email_queue_processed', 'email_outbox', null, { sent: result.sent, failed: result.failed });
    return redirect('/admin/status?ok=saved');
  }
  if (method === 'GET' && path === '/admin/gallery') {
    return page(ctx, lang, { ...base, activeNav: 'gallery', title: t(lang, 'galleryTitle'), body: `<section class="card"><h1>${esc(t(lang, 'galleryTitle'))}</h1><p class="muted">${esc(t(lang, 'galleryBody'))}</p></section>` });
  }
  if (method === 'GET' && path === '/admin/status') return systemStatus(ctx, base);

  return { status: 404, html: layout({ ...base, title: t(lang, 'notFound'), body: `<p>${esc(t(lang, 'notFound'))}</p>`, path }) };
}

function loginForm(lang: AdminLang, error: string | null): string {
  return `<section class="login card">
    <h1>${esc(t(lang, 'loginTitle'))}</h1>
    <p class="muted">${esc(t(lang, 'loginHelp'))}</p>
    ${error ? `<p class="flash flash--error" role="alert">${esc(error)}</p>` : ''}
    <form method="post" action="/admin/login" class="stack" autocomplete="on">
      ${textField('username', t(lang, 'username'), '', { required: true, autocomplete: 'username', max: 80 })}
      ${textField('password', t(lang, 'password'), '', { type: 'password', required: true, autocomplete: 'current-password', max: 256 })}
      ${textField('code', t(lang, 'code'), '', { required: true, autocomplete: 'one-time-code', inputmode: 'numeric', max: 6 })}
      <button class="btn btn--primary" type="submit">${esc(t(lang, 'login'))}</button>
    </form>
  </section>`;
}

function loginPage(lang: AdminLang, error: string): string {
  return layout({ lang, title: t(lang, 'login'), csrf: null, signedIn: false, path: '/admin/login', body: loginForm(lang, error) });
}

function requestList(ctx: AdminCtx, base: { lang: AdminLang; csrf: string; signedIn: true; path: string; flash: LayoutOptions['flash'] }) {
  const { db, query } = ctx;
  const { lang } = base;
  const q = (query.get('q') ?? '').trim().slice(0, 80);
  const status = query.get('status') ?? '';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const pageNo = Math.max(1, Number(query.get('page') ?? '1') || 1);

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR services_text LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  if ((REQUEST_STATUSES as readonly string[]).includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push('received_at >= ?');
    params.push(`${from}T00:00:00.000Z`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push('received_at <= ?');
    params.push(`${to}T23:59:59.999Z`);
  }
  where.push('archived_at IS NULL');
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM estimate_request ${clause}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT id, name, email, services, received_at, status, reviewed_at FROM estimate_request ${clause} ORDER BY received_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE) as Array<{ id: number; name: string; email: string | null; services: string; received_at: string; status: string; reviewed_at: string | null }>;

  const counts = db.prepare('SELECT COUNT(*) AS n FROM estimate_request WHERE status = ? AND archived_at IS NULL').get('new') as { n: number };
  const keep = new URLSearchParams();
  if (q) keep.set('q', q);
  if (status) keep.set('status', status);
  if (from) keep.set('from', from);
  if (to) keep.set('to', to);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageLink = (n: number) => {
    const p = new URLSearchParams(keep);
    p.set('page', String(n));
    return `/admin/requests?${p.toString()}`;
  };

  const body = `
  <section class="summary">
    <div class="stat"><span>${esc(t(lang, 'newRequests'))}</span><strong>${counts.n}</strong></div>
    <div class="stat"><span>${esc(t(lang, 'totalRequests'))}</span><strong>${total}</strong></div>
  </section>
  <form method="get" action="/admin/requests" class="filters card" role="search">
    ${textField('q', t(lang, 'search'), q, { max: 80 })}
    <div class="row">
      ${selectField('status', t(lang, 'statusFilter'), [{ value: '', label: t(lang, 'all') }, ...REQUEST_STATUSES.map((s) => ({ value: s, label: statusLabel(s, lang) }))], status)}
      ${textField('from', t(lang, 'from'), from, { type: 'date' })}
      ${textField('to', t(lang, 'to'), to, { type: 'date' })}
    </div>
    <div class="row">
      <button class="btn btn--primary" type="submit">${esc(t(lang, 'apply'))}</button>
      <a class="btn btn--ghost" href="/admin/requests">${esc(t(lang, 'clear'))}</a>
    </div>
  </form>
  ${rows.length === 0 ? `<p class="card muted">${esc(t(lang, 'noRequests'))}</p>` : `<ul class="list">
    ${rows
      .map(
        (r) => `<li class="card item">
          <a class="item__link" href="/admin/requests/${r.id}">
            <span class="item__top">
              <strong>${esc(r.name)}</strong>
              ${statusPill(r.status, lang)}
            </span>
            <span class="muted">${esc(serviceNames(JSON.parse(r.services) as string[], lang))}</span>
            <span class="item__meta">${esc(formatDate(r.received_at, lang))}${r.reviewed_at ? '' : ` · <em>${esc(t(lang, 'unreviewed'))}</em>`}</span>
          </a>
        </li>`,
      )
      .join('')}
  </ul>`}
  <nav class="pager" aria-label="Pages">
    ${pageNo > 1 ? `<a class="btn btn--ghost" href="${pageLink(pageNo - 1)}">${esc(t(lang, 'prev'))}</a>` : ''}
    <span class="muted">${esc(t(lang, 'pageOf'))} ${pageNo} / ${pages}</span>
    ${pageNo < pages ? `<a class="btn btn--ghost" href="${pageLink(pageNo + 1)}">${esc(t(lang, 'next'))}</a>` : ''}
  </nav>`;
  return html(200, layout({ ...base, activeNav: 'requests', title: t(lang, 'navRequests'), body, path: base.path, csrf: base.csrf, signedIn: true, flash: base.flash, lang }));
}

function requestDetail(ctx: AdminCtx, id: number, base: { lang: AdminLang; csrf: string; signedIn: true; path: string; flash: LayoutOptions['flash'] }) {
  const { db, cfg } = ctx;
  const { lang, csrf } = base;
  const r = db.prepare('SELECT * FROM estimate_request WHERE id = ?').get(id) as Record<string, string | number | null> | undefined;
  if (!r) return html(404, layout({ ...base, activeNav: 'requests', title: t(lang, 'notFound'), body: `<p>${esc(t(lang, 'notFound'))}</p>`, path: base.path, csrf, signedIn: true, lang }));

  if (!r.reviewed_at) {
    const now = nowIso();
    db.prepare('UPDATE estimate_request SET reviewed_at = ? WHERE id = ?').run(now, id);
    db.prepare('INSERT INTO request_event (request_id, kind, actor, created_at) VALUES (?, ?, ?, ?)').run(id, 'viewed', 'owner', now);
  }

  const photos = db.prepare('SELECT id, display_name, mime, bytes, created_at FROM request_photo WHERE request_id = ? ORDER BY id').all(id) as Array<{ id: number; display_name: string; mime: string; bytes: number; created_at: string }>;
  const notes = db.prepare('SELECT body, author, created_at FROM request_note WHERE request_id = ? ORDER BY id DESC').all(id) as Array<{ body: string; author: string; created_at: string }>;
  const events = db.prepare('SELECT kind, from_value, to_value, actor, created_at FROM request_event WHERE request_id = ? ORDER BY id DESC').all(id) as Array<{ kind: string; from_value: string | null; to_value: string | null; actor: string; created_at: string }>;
  const services = JSON.parse(String(r.services ?? '[]')) as string[];
  const freq = r.frequency ? label(FREQUENCY_LABELS, String(r.frequency), lang) : '';
  const status = String(r.status);

  const body = `
  <a class="back" href="/admin/requests">← ${esc(t(lang, 'back'))}</a>
  <section class="card hero-card">
    <div class="item__top"><h1>${esc(r.name)}</h1>${statusPill(status, lang)}</div>
    <p class="muted">${esc(serviceNames(services, lang))}</p>
    <p class="item__meta">${esc(t(lang, 'received'))}: ${esc(formatDate(String(r.received_at), lang))}</p>
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'contact'))}</h2>
    <dl class="facts">
      <dt>${esc(t(lang, 'name'))}</dt><dd>${esc(r.name)}</dd>
      <dt>${esc(t(lang, 'phone'))}</dt><dd>${r.phone ? `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>` : '—'}</dd>
      <dt>${esc(t(lang, 'email'))}</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '—'}</dd>
      <dt>${esc(t(lang, 'zip'))}</dt><dd>${esc(r.zip) || '—'}</dd>
    </dl>
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'answers'))}</h2>
    <dl class="facts">
      <dt>${esc(t(lang, 'service'))}</dt><dd>${esc(serviceNames(services, lang))}</dd>
      <dt>${esc(t(lang, 'homeType'))}</dt><dd>${esc(homeLabel(String(r.home_type), lang))}</dd>
      <dt>${esc(t(lang, 'bedrooms'))}</dt><dd>${esc(String(r.bedrooms).replace('-plus', '+'))}</dd>
      <dt>${esc(t(lang, 'bathrooms'))}</dt><dd>${esc(String(r.bathrooms).replace('-plus', '+'))}</dd>
      ${r.frequency ? `<dt>${esc(t(lang, 'frequency'))}</dt><dd>${esc(freq)}</dd>` : ''}
      ${r.move_date ? `<dt>${esc(t(lang, 'moveDate'))}</dt><dd>${esc(r.move_date)}</dd>` : ''}
      <dt>${esc(t(lang, 'consent'))}</dt><dd>✓</dd>
    </dl>
    ${r.notes ? `<h3>${esc(t(lang, 'notes'))}</h3><p class="pre">${esc(r.notes)}</p>` : ''}
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'photos'))}</h2>
    ${photos.length === 0 ? `<p class="muted">${esc(t(lang, 'noPhotos'))}</p>` : `<p class="muted small">${esc(t(lang, 'photoNote'))}</p>
    <ul class="photos">${photos
      .map((p) => `<li><a href="/admin/requests/${id}/photos/${p.id}" target="_blank" rel="noopener"><span>${esc(p.display_name)}</span><small>${Math.round(p.bytes / 1024)} KB</small></a></li>`)
      .join('')}</ul>`}
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'changeStatus'))}</h2>
    <form method="post" action="/admin/requests/${id}/status" class="row">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      ${selectField('status', t(lang, 'statusLabel'), REQUEST_STATUSES.map((s) => ({ value: s, label: statusLabel(s, lang) })), status)}
      <button class="btn btn--primary" type="submit">${esc(t(lang, 'saveResource'))}</button>
    </form>
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'internalNotes'))}</h2>
    <p class="muted small">${esc(t(lang, 'internalNotesHelp'))}</p>
    <form method="post" action="/admin/requests/${id}/notes" class="stack">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label class="field"><span>${esc(t(lang, 'addNote'))}</span><textarea name="body" rows="3" maxlength="2000" required></textarea></label>
      <button class="btn btn--primary" type="submit">${esc(t(lang, 'addNote'))}</button>
    </form>
    ${notes.length === 0 ? `<p class="muted">${esc(t(lang, 'noNotes'))}</p>` : `<ul class="timeline">${notes
      .map((n) => `<li><p class="pre">${esc(n.body)}</p><small class="muted">${esc(n.author)} · ${esc(formatDate(n.created_at, lang))}</small></li>`)
      .join('')}</ul>`}
  </section>

  <section class="card">
    <h2>${esc(t(lang, 'history'))}</h2>
    <ul class="timeline">${events
      .map((e) => {
        const what =
          e.kind === 'received' ? t(lang, 'receivedEvent') : e.kind === 'status_changed' ? `${t(lang, 'statusChanged')}: ${statusLabel(String(e.from_value ?? ''), lang)} → ${statusLabel(String(e.to_value ?? ''), lang)}` : e.kind === 'note_added' ? t(lang, 'noteAdded') : e.kind;
        return `<li><span>${esc(what)}</span><small class="muted">${esc(e.actor)} · ${esc(formatDate(e.created_at, lang))}</small></li>`;
      })
      .join('')}</ul>
  </section>`;

  return html(200, layout({ ...base, activeNav: 'requests', title: String(r.name), body, path: base.path, csrf, signedIn: true, flash: base.flash, lang }));
}

function changeStatus(ctx: AdminCtx, id: number, lang: AdminLang): AdminResponse {
  const next = ctx.body.status as RequestStatus;
  if (!(REQUEST_STATUSES as readonly string[]).includes(next)) return redirect(`/admin/requests/${id}?err=${encodeURIComponent('invalid_status')}`);
  const current = ctx.db.prepare('SELECT status FROM estimate_request WHERE id = ?').get(id) as { status: string } | undefined;
  if (!current) return redirect('/admin/requests?err=not_found');
  if (current.status !== next) {
    const now = nowIso();
    ctx.db.exec('BEGIN IMMEDIATE');
    try {
      ctx.db.prepare('UPDATE estimate_request SET status = ? WHERE id = ?').run(next, id);
      ctx.db.prepare('INSERT INTO request_event (request_id, kind, from_value, to_value, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'status_changed', current.status, next, 'owner', now);
      ctx.db.exec('COMMIT');
    } catch (error) {
      ctx.db.exec('ROLLBACK');
      throw error;
    }
  }
  return redirect(`/admin/requests/${id}?ok=saved`);
}

function addNote(ctx: AdminCtx, id: number, author: string, lang: AdminLang): AdminResponse {
  const body = (ctx.body.body ?? '').trim();
  if (body.length === 0) return redirect(`/admin/requests/${id}?err=${encodeURIComponent(t(lang, 'noteEmpty'))}`);
  const now = nowIso();
  const exists = ctx.db.prepare('SELECT id FROM estimate_request WHERE id = ?').get(id);
  if (!exists) return redirect('/admin/requests?err=not_found');
  ctx.db.exec('BEGIN IMMEDIATE');
  try {
    ctx.db.prepare('INSERT INTO request_note (request_id, body, author, created_at) VALUES (?, ?, ?, ?)').run(id, body.slice(0, 2000), author, now);
    ctx.db.prepare('INSERT INTO request_event (request_id, kind, actor, created_at) VALUES (?, ?, ?, ?)').run(id, 'note_added', 'owner', now);
    ctx.db.exec('COMMIT');
  } catch (error) {
    ctx.db.exec('ROLLBACK');
    throw error;
  }
  return redirect(`/admin/requests/${id}?ok=saved`);
}

function welcomeList(ctx: AdminCtx, base: { lang: AdminLang; csrf: string; signedIn: true; path: string; flash: LayoutOptions['flash'] }) {
  const { lang, csrf } = base;
  const rows = listResources(ctx.db);
  const body = `
  <section class="card head-row">
    <h1>${esc(t(lang, 'resources'))}</h1>
    <a class="btn btn--primary" href="/admin/welcome/new">${esc(t(lang, 'newResource'))}</a>
  </section>
  ${rows.length === 0 ? '<p class="card muted">—</p>' : `<ul class="list">${rows
    .map((r) => {
      const title = r.title_en || r.title_es || '—';
      return `<li class="card item"><a class="item__link" href="/admin/welcome/${r.id}">
        <span class="item__top"><strong>${esc(title)}</strong>${r.published ? '<span class="pill pill--new">Live</span>' : '<span class="pill">Draft</span>'}</span>
        <span class="muted">${esc(label(KIND_LABELS, r.kind, lang))} · ${esc(label(TIER_LABELS, r.access_tier, lang))}</span>
        <span class="item__meta">EN ${r.approved_en ? '✓' : '—'} · ES ${r.approved_es ? '✓' : '—'}</span>
      </a></li>`;
    })
    .join('')}</ul>`}
  <p class="muted small">${esc(t(lang, 'tierPending'))}</p>`;
  return html(200, layout({ ...base, activeNav: 'welcome', title: t(lang, 'navWelcome'), body, path: base.path, csrf, signedIn: true, flash: base.flash, lang }));
}

function resourceForm(lang: AdminLang, csrf: string, r: ResourceRow | null, ok: string | null): string {
  const kind = r?.kind ?? 'presentation';
  const tier = r?.access_tier ?? 'public';
  const id = r?.id;
  const action = id ? `/admin/welcome/${id}` : '/admin/welcome';
  return `
  <a class="back" href="/admin/welcome">← ${esc(t(lang, 'resources'))}</a>
  ${ok ? `<p class="flash flash--ok" role="status">${esc(t(lang, 'saved'))}</p>` : ''}
  <form method="post" action="${action}" class="card stack">
    <input type="hidden" name="csrf" value="${esc(csrf)}">
    ${selectField('kind', t(lang, 'kind'), WELCOME_KINDS.map((k) => ({ value: k, label: label(KIND_LABELS, k, lang) })), kind)}
    ${selectField('accessTier', t(lang, 'tier'), ACCESS_TIERS.map((a) => ({ value: a, label: label(TIER_LABELS, a, lang) })), tier)}
    ${textField('titleEn', t(lang, 'titleEn'), r?.title_en ?? '', { max: 160 })}
    ${textField('subtitleEn', t(lang, 'subtitleEn'), r?.subtitle_en ?? '', { max: 240 })}
    ${textField('subtitleEs', t(lang, 'subtitleEs'), r?.subtitle_es ?? '', { max: 240 })}
    ${textField('titleEs', t(lang, 'titleEs'), r?.title_es ?? '', { max: 160 })}
    <label class="field"><span>${esc(t(lang, 'bodyEn'))}</span><textarea name="bodyEn" rows="6" maxlength="8000">${esc(r?.body_en ?? '')}</textarea></label>
    <label class="field"><span>${esc(t(lang, 'bodyEs'))}</span><textarea name="bodyEs" rows="6" maxlength="8000">${esc(r?.body_es ?? '')}</textarea></label>
    ${textField('sortOrder', t(lang, 'sortOrder'), String(r?.sort_order ?? 0), { type: 'number', inputmode: 'numeric' })}
    <p class="muted small">${esc(t(lang, 'resourceHelp'))}</p>
    <p class="muted small">${esc(t(lang, 'bodyFormatHelp'))}</p>
    ${checkbox('approvedEn', t(lang, 'approvedEn'), !!r?.approved_en)}
    ${checkbox('approvedEs', t(lang, 'approvedEs'), !!r?.approved_es)}
    ${checkbox('published', t(lang, 'publishedLabel'), !!r?.published)}
    <button class="btn btn--primary" type="submit">${esc(t(lang, 'saveResource'))}</button>
  </form>
  ${id ? `
  <section class="card stack">
    <h2>${esc(t(lang, 'document'))}</h2>
    <p class="muted">${r?.document_storage ? `${esc(t(lang, 'currentDocument'))}: ${Math.round((r.document_bytes ?? 0) / 1024)} KB` : esc(t(lang, 'noDocument'))}</p>
    <form method="post" action="/admin/welcome/${id}/document" enctype="multipart/form-data" class="stack">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label class="field"><span>${esc(t(lang, 'uploadDocument'))}</span><input type="file" name="document" accept="application/pdf"></label>
      <button class="btn btn--ghost" type="submit">${esc(t(lang, 'uploadDocument'))}</button>
    </form>
  </section>` : ''}`;
}

function systemStatus(ctx: AdminCtx, base: { lang: AdminLang; csrf: string; signedIn: true; path: string; flash: LayoutOptions['flash'] }) {
  const { lang, csrf } = base;
  const { cfg, db } = ctx;
  const counts = db.prepare("SELECT status, COUNT(*) AS n FROM email_outbox GROUP BY status").all() as Array<{ status: string; n: number }>;
  const c = (s: string) => counts.find((x) => x.status === s)?.n ?? 0;
  const yes = (v: boolean) => (v ? t(lang, 'configured') : t(lang, 'notConfigured'));
  const body = `
  <section class="card">
    <h1>${esc(t(lang, 'statusTitle'))}</h1>
    <dl class="facts">
      <dt>${esc(t(lang, 'ownerEmailRow'))}</dt><dd>${yes(!!cfg.ownerEmail)}</dd>
      <dt>${esc(t(lang, 'providerRow'))}</dt><dd>${yes(!!cfg.emailApiKey && !!cfg.emailFrom)}</dd>
      <dt>${esc(t(lang, 'adminLinkRow'))}</dt><dd>${yes(!!cfg.adminBaseUrl)}</dd>
      <dt>${esc(t(lang, 'turnstileRow'))}</dt><dd>${yes(!!cfg.turnstileSecret)}</dd>
    </dl>
    ${!cfg.ownerEmail ? `<p class="flash flash--error">${esc(t(lang, 'emailNotConfigured'))}</p>` : ''}
  </section>
  <section class="card">
    <h2>${esc(t(lang, 'mailStatus'))}</h2>
    <dl class="facts">
      <dt>${esc(t(lang, 'mailQueued'))}</dt><dd>${c('queued')}</dd>
      <dt>${esc(t(lang, 'mailSent'))}</dt><dd>${c('sent')}</dd>
      <dt>${esc(t(lang, 'mailFailed'))}</dt><dd>${c('failed')}</dd>
      <dt>${esc(t(lang, 'mailSkipped'))}</dt><dd>${c('skipped_no_recipient')}</dd>
    </dl>
    <form method="post" action="/admin/status/send-queue" class="row">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <button class="btn btn--ghost" type="submit" name="action" value="send">${esc(t(lang, 'sendQueue'))}</button>
      <button class="btn btn--ghost" type="submit" name="action" value="retry">${esc(t(lang, 'retryFailed'))}</button>
    </form>
  </section>`;
  return html(200, layout({ ...base, activeNav: 'status', title: t(lang, 'navStatus'), body, path: base.path, csrf, signedIn: true, flash: base.flash, lang }));
}

/** Streams a private file to the panel only after the session check passed. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

