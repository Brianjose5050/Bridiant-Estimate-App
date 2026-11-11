import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { Config } from './config.js';
import { openDb, type Db } from './db.js';
import { handleAdmin, sessionCookieName, type AdminCtx } from './admin/routes.js';
import { handleEstimateSubmit } from './estimates.js';
import { publicDocumentPath, publicResources, type Lang } from './welcome.js';
import { publicGallery, publicMediaPath } from './gallery.js';

export interface ServerHandle {
  server: Server;
  db: Db;
  cfg: Config;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

function securityHeaders(cfg: Config, kind: 'admin' | 'public' | 'api' | 'file'): Record<string, string> {
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

function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string>): void {
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(cfg: Config, res: ServerResponse, status: number, data: unknown): void {
  send(res, status, JSON.stringify(data), { ...securityHeaders(cfg, 'api'), 'Content-Type': 'application/json; charset=utf-8' });
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key && out[key] === undefined) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/** Reads a small urlencoded form. Anything larger than the limit is refused. */
function readForm(req: IncomingMessage, limit: number): Promise<Record<string, string> | null> {
  return new Promise((resolveBody) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolveBody(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const out: Record<string, string> = {};
      let count = 0;
      for (const [k, v] of params) {
        if (count++ > 60) break;
        if (k.length <= 64 && out[k] === undefined) out[k] = v.slice(0, 8000);
      }
      resolveBody(out);
    });
    req.on('error', () => resolveBody(null));
  });
}

async function serveStatic(cfg: Config, res: ServerResponse, root: string, urlPath: string): Promise<void> {
  if (urlPath.includes('\0') || urlPath.includes('\\')) return sendNotFound(cfg, res, root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return sendNotFound(cfg, res, root);
  }
  const base = resolve(root);
  let target = resolve(join(base, normalize(decoded)));
  if (target !== base && !target.startsWith(base + sep)) return sendNotFound(cfg, res, root);
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, 'index.html');
    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
    const cache = extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600';
    send(res, 200, data, { ...securityHeaders(cfg, 'public'), 'Content-Type': type, 'Cache-Control': cache });
  } catch {
    sendNotFound(cfg, res, root);
  }
}

async function sendNotFound(cfg: Config, res: ServerResponse, root: string): Promise<void> {
  try {
    const page = await readFile(join(root, '404.html'));
    send(res, 404, page, { ...securityHeaders(cfg, 'public'), 'Content-Type': 'text/html; charset=utf-8' });
  } catch {
    send(res, 404, 'Not found', { ...securityHeaders(cfg, 'public'), 'Content-Type': 'text/plain; charset=utf-8' });
  }
}

export function createApp(cfg: Config, db: Db) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const ip = clientIp(req);
    try {
      // ----- Estimate intake (multipart, no body read here) -----
      if (path === '/api/estimate') {
        if (method !== 'POST') return sendJson(cfg, res, 405, { status: 'method_not_allowed' });
        const result = await handleEstimateSubmit(req, { db, cfg, ip });
        return sendJson(cfg, res, result.status, result.body);
      }

      // ----- Welcome Center (public, published and approved only) -----
      if (path === '/api/welcome' && method === 'GET') {
        const lang: Lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
        return sendJson(cfg, res, 200, { items: publicResources(db, lang) });
      }
      if (path === '/api/gallery' && method === 'GET') {
        const lang: Lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
        return sendJson(cfg, res, 200, { items: publicGallery(db, lang) });
      }
      const media = /^\/api\/gallery\/media\/(\d+)$/.exec(path);
      if (media && method === 'GET') {
        const found = publicMediaPath(db, cfg, Number(media[1]));
        if (!found) return sendJson(cfg, res, 404, { status: 'not_found' });
        res.writeHead(200, { ...securityHeaders(cfg, 'file'), 'Content-Type': found.mime, 'Cache-Control': 'public, max-age=300' });
        createReadStream(found.path).on('error', () => res.destroy()).pipe(res);
        return;
      }
      const doc = /^\/api\/welcome\/documents\/(\d+)$/.exec(path);
      if (doc && method === 'GET') {
        const lang: Lang = url.searchParams.get('lang') === 'es' ? 'es' : 'en';
        const filePath = publicDocumentPath(db, cfg, Number(doc[1]), lang);
        if (!filePath) return sendJson(cfg, res, 404, { status: 'not_found' });
        const headers = { ...securityHeaders(cfg, 'file'), 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="document.pdf"' };
        res.writeHead(200, headers);
        createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
        return;
      }

      // ----- Private owner panel -----
      if (path === '/admin' || path.startsWith('/admin/')) {
        const isMultipart = (req.headers['content-type'] ?? '').toLowerCase().startsWith('multipart/form-data');
        let body: Record<string, string> = {};
        if (method === 'POST' && !isMultipart) {
          const parsed = await readForm(req, cfg.maxFormBytes);
          if (parsed === null) return send(res, 413, 'Request too large', securityHeaders(cfg, 'admin'));
          body = parsed;
        }
        const ctx: AdminCtx = {
          method,
          path: path.replace(/\/+$/, '') || '/admin',
          query: url.searchParams,
          body,
          cookies: parseCookies(req.headers.cookie),
          headers: { origin: req.headers.origin, host: req.headers.host },
          ip,
          cfg,
          db,
          req: req as never,
        };
        const result = await handleAdmin(ctx);
        const headers = { ...securityHeaders(cfg, 'admin'), ...(result.headers ?? {}) };
        if (result.file) {
          const data = await readFile(result.file.path).catch(() => null);
          if (!data) return send(res, 404, 'Not found', headers);
          const fileHeaders: Record<string, string> = {
            ...securityHeaders(cfg, result.file.mime.startsWith('text/css') ? 'admin' : 'file'),
            'Content-Type': result.file.mime,
            'Content-Disposition': `${result.file.inline ? 'inline' : 'attachment'}; filename="${result.file.name.replace(/["\\]/g, '')}"`,
          };
          if (result.file.mime.startsWith('text/css')) fileHeaders['Cache-Control'] = 'public, max-age=300';
          return send(res, result.status, data, fileHeaders);
        }
        return send(res, result.status, result.html ?? '', { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
      }

      // ----- Public static site -----
      if (method === 'GET' || method === 'HEAD') return await serveStatic(cfg, res, cfg.publicDir, path);
      return sendJson(cfg, res, 405, { status: 'method_not_allowed' });
    } catch {
      // Never expose internal details. The customer is told only that the request did not complete.
      if (!res.headersSent) {
        if (path.startsWith('/api/')) return sendJson(cfg, res, 503, { status: 'unavailable' });
        return send(res, 500, 'Something went wrong.', securityHeaders(cfg, 'admin'));
      }
      res.end();
    }
  };
}

export function startServer(cfg: Config, port: number, host = '127.0.0.1'): Promise<ServerHandle> {
  const db = openDb(cfg.dbPath);
  const app = createApp(cfg, db);
  const server = createServer((req, res) => {
    void app(req, res);
  });
  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStart({ server, db, cfg }));
  });
}

export { sessionCookieName };
