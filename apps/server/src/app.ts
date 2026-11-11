/**
 * The whole server as one function: Request in, Response out. No Node APIs and no Cloudflare
 * APIs here. The Workers entry (worker.ts) and the local Node adapter (main.ts) both call it.
 */
import type { AdminCtx, AdminInput, AdminResponse } from './admin/context.js';
import { handleAdmin } from './admin/routes.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import type { FileStore } from './files.js';
import { handleEstimateSubmit } from './estimates.js';
import { publicGallery, publicMediaKey } from './gallery.js';
import { publicDocumentKey, publicResources, type Lang } from './welcome.js';

export interface AppDeps {
  cfg: Config;
  db: Db;
  files: FileStore;
  /** Serves the public static site. The adapter decides where the files come from. */
  assets: (request: Request) => Promise<Response>;
}

export interface RequestMeta {
  /** Client address as seen by the edge or the local socket. Only a salted hash is stored. */
  ip: string;
}

export type Handler = (request: Request, meta: RequestMeta) => Promise<Response>;

export function securityHeaders(cfg: Config, kind: 'admin' | 'public' | 'api' | 'file'): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (cfg.env === 'production') headers['Strict-Transport-Security'] = 'max-age=31536000';
  if (kind === 'admin') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
    headers['Cache-Control'] = 'no-store';
    // same-origin keeps the referrer private to this site and lets browsers send a real Origin on forms.
    headers['Referrer-Policy'] = 'same-origin';
  } else if (kind === 'public') {
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'";
  } else if (kind === 'api') {
    headers['Cache-Control'] = 'no-store';
    headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'";
  } else {
    headers['Content-Security-Policy'] = "default-src 'none'; sandbox";
    headers['Cache-Control'] = 'no-store';
  }
  return headers;
}

/** Copies a response and adds headers. Used for static assets served by the platform. */
export function withHeaders(response: Response, extra: Record<string, string>): Response {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(extra)) out.headers.set(key, value);
  return out;
}

function json(cfg: Config, status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders(cfg, 'api'), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key || out[key] !== undefined) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // A malformed cookie is ignored rather than failing the whole request.
    }
  }
  return out;
}

function langOf(url: URL): Lang {
  return url.searchParams.get('lang') === 'es' ? 'es' : 'en';
}

const MAX_FIELDS = 60;
const MAX_FIELD_CHARS = 8000;

export class InputTooLarge extends Error {}

/**
 * Reads an admin form (urlencoded or multipart). Declared sizes are checked before reading,
 * and every uploaded file is checked against the per-file limit. Limits come from the config.
 */
export async function readAdminInput(request: Request, cfg: Config): Promise<AdminInput> {
  const type = (request.headers.get('content-type') ?? '').toLowerCase();
  const multipart = type.startsWith('multipart/form-data');
  const declared = Number(request.headers.get('content-length') ?? '0');
  const limit = multipart ? cfg.maxTotalBytes + cfg.maxFormBytes : cfg.maxFormBytes;
  if (Number.isFinite(declared) && declared > limit) throw new InputTooLarge();

  const input: AdminInput = { fields: {}, files: {} };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return input;
  }
  const entries: Array<[string, FormDataEntryValue]> = [];
  form.forEach((value, key) => entries.push([key, value]));
  let fieldCount = 0;
  let fileCount = 0;
  for (const [key, value] of entries) {
    if (typeof value === 'string') {
      if (fieldCount++ >= MAX_FIELDS || key.length > 64) continue;
      if (input.fields[key] === undefined) input.fields[key] = value.slice(0, MAX_FIELD_CHARS);
      continue;
    }
    // An empty file input submits a zero-byte unnamed part. It is not an upload.
    if (value.size === 0 && value.name === '') continue;
    if (value.size > cfg.maxFileBytes) throw new InputTooLarge();
    if (++fileCount > cfg.maxFiles) throw new InputTooLarge();
    const file = value;
    (input.files[key] ??= []).push({
      name: file.name,
      size: file.size,
      data: async () => new Uint8Array(await file.arrayBuffer()),
    });
  }
  return input;
}

async function adminResponse(cfg: Config, result: AdminResponse, files: FileStore): Promise<Response> {
  const headers: Record<string, string> = { ...securityHeaders(cfg, 'admin'), ...(result.headers ?? {}) };
  if (result.file) {
    const data = await files.get(result.file.key);
    if (!data) return new Response('Not found', { status: 404, headers });
    const fileHeaders: Record<string, string> = {
      ...securityHeaders(cfg, 'file'),
      'Content-Type': result.file.mime,
      'Content-Disposition': `${result.file.inline ? 'inline' : 'attachment'}; filename="${result.file.name.replace(/["\\\r\n]/g, '')}"`,
    };
    return new Response(data, { status: result.status, headers: fileHeaders });
  }
  // Each route states its own type (the panel's stylesheets are text/css). HTML is the default.
  const contentType = result.headers?.['Content-Type'] ?? 'text/html; charset=utf-8';
  return new Response(result.html ?? '', {
    status: result.status,
    headers: { ...headers, 'Content-Type': contentType },
  });
}

export function createApp(deps: AppDeps): Handler {
  const { cfg, db, files, assets } = deps;

  return async function handle(request, meta) {
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // ----- Estimate intake (multipart). Success is reported only after the save is confirmed. -----
      if (path === '/api/estimate') {
        if (method !== 'POST') return json(cfg, 405, { status: 'method_not_allowed' });
        const result = await handleEstimateSubmit(request, { db, files, cfg, ip: meta.ip });
        return json(cfg, result.status, result.body);
      }

      // ----- Welcome Center and gallery: public, published and approved only -----
      if (path === '/api/welcome' && method === 'GET') {
        return json(cfg, 200, { items: await publicResources(db, langOf(url)) });
      }
      if (path === '/api/gallery' && method === 'GET') {
        return json(cfg, 200, { items: await publicGallery(db, langOf(url)) });
      }
      const media = /^\/api\/gallery\/media\/(\d+)$/.exec(path);
      if (media && method === 'GET') {
        const found = await publicMediaKey(db, Number(media[1]));
        const data = found ? await files.get(found.key) : null;
        if (!found || !data) return json(cfg, 404, { status: 'not_found' });
        return new Response(data, {
          status: 200,
          headers: { ...securityHeaders(cfg, 'file'), 'Content-Type': found.mime, 'Cache-Control': 'public, max-age=300' },
        });
      }
      const doc = /^\/api\/welcome\/documents\/(\d+)$/.exec(path);
      if (doc && method === 'GET') {
        const key = await publicDocumentKey(db, Number(doc[1]), langOf(url));
        const data = key ? await files.get(key) : null;
        if (!data) return json(cfg, 404, { status: 'not_found' });
        return new Response(data, {
          status: 200,
          headers: {
            ...securityHeaders(cfg, 'file'),
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline; filename="document.pdf"',
          },
        });
      }

      // ----- Private owner panel -----
      if (path === '/admin' || path.startsWith('/admin/')) {
        let input: AdminInput = { fields: {}, files: {} };
        if (method === 'POST') {
          try {
            input = await readAdminInput(request, cfg);
          } catch (error) {
            if (error instanceof InputTooLarge) {
              return new Response('Request too large', { status: 413, headers: securityHeaders(cfg, 'admin') });
            }
            throw error;
          }
        }
        const ctx: AdminCtx = {
          method,
          path: path.replace(/\/+$/, '') || '/admin',
          query: url.searchParams,
          input,
          cookies: parseCookies(request.headers.get('cookie')),
          ip: meta.ip,
          origin: request.headers.get('origin'),
          // Compared with Origin for CSRF. Taken from the URL the request was made to.
          host: url.host,
          cfg,
          db,
          files,
        };
        return adminResponse(cfg, await handleAdmin(ctx), files);
      }

      // ----- Public static site -----
      if (method === 'GET' || method === 'HEAD') {
        return withHeaders(await assets(request), securityHeaders(cfg, 'public'));
      }
      return json(cfg, 405, { status: 'method_not_allowed' });
    } catch {
      // Never expose internal details. The customer is told only that the request did not complete.
      if (path.startsWith('/api/')) return json(cfg, 503, { status: 'unavailable' });
      return new Response('Something went wrong.', { status: 500, headers: securityHeaders(cfg, 'admin') });
    }
  };
}
