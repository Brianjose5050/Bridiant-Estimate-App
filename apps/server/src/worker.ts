/**
 * Cloudflare Workers entry. Bindings: DB (D1), PRIVATE_FILES (R2, private bucket), ASSETS (built public site).
 * Secrets and settings come from the environment (wrangler secret put / dashboard). Nothing is hard-coded here.
 */
import { createApp, withHeaders, securityHeaders, type Handler } from './app.js';
import { loadConfig, type EnvRecord } from './config.js';
import { d1Db, type D1Like } from './d1-db.js';
import { r2Files, type R2Like } from './files.js';

export interface WorkerEnv {
  DB: D1Like;
  PRIVATE_FILES: R2Like;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  [name: string]: unknown;
}

let cached: Handler | null = null;

function settings(env: WorkerEnv): EnvRecord {
  const out: EnvRecord = {};
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === 'string') out[name] = value;
  }
  return out;
}

function handlerFor(env: WorkerEnv): Handler {
  if (cached) return cached;
  const cfg = loadConfig(settings(env));
  cached = createApp({
    cfg,
    db: d1Db(env.DB),
    files: r2Files(env.PRIVATE_FILES),
    assets: async (request) => {
      if (!env.ASSETS) return new Response('Not found', { status: 404 });
      return withHeaders(await env.ASSETS.fetch(request), securityHeaders(cfg, 'public'));
    },
  });
  return cached;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    return handlerFor(env)(request, { ip });
  },
};
