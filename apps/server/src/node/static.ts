import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

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

/** Local static server for the built public site. Mirrors what the Pages assets binding does in Workers. */
export function localStatic(root: string): (request: Request) => Promise<Response> {
  const base = resolve(root);

  async function notFound(): Promise<Response> {
    try {
      const page = await readFile(join(base, '404.html'));
      return new Response(page, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  }

  return async function serve(request) {
    const { pathname } = new URL(request.url);
    if (pathname.includes('\0') || pathname.includes('\\')) return notFound();
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }
    let target = resolve(join(base, normalize(decoded)));
    if (target !== base && !target.startsWith(base + sep)) return notFound();
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = join(target, 'index.html');
      const data = await readFile(target);
      const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream';
      const cache = extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600';
      return new Response(request.method === 'HEAD' ? null : data, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': cache } });
    } catch {
      return notFound();
    }
  };
}
