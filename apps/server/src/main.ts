/**
 * Local entry for development and tests. Production runs on Cloudflare Workers (worker.ts).
 * It uses the same app; only the storage and the network layer differ.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig, type EnvRecord } from './config.js';
import { migrate } from './db.js';
import { listen } from './node/http.js';
import { localFiles } from './node/local-files.js';
import { localStatic } from './node/static.js';
import { sqliteDb } from './node/sqlite-db.js';

export interface LocalOptions {
  env: EnvRecord;
  dataDir: string;
  publicDir: string;
  port: number;
  host?: string;
}

/**
 * Development only: keeps a random 32-byte key in the data folder, created on first run.
 * In production the key must come from the environment and this function is never used.
 */
export async function developmentKey(dataDir: string): Promise<Uint8Array<ArrayBuffer>> {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, 'dev-secret.key');
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    const bytes = Uint8Array.from(atob(existing), (c) => c.charCodeAt(0));
    if (bytes.length === 32) return bytes;
  } catch {
    // Not created yet.
  }
  const fresh = randomBytes(32);
  await writeFile(path, Buffer.from(fresh).toString('base64'), { mode: 0o600 });
  return new Uint8Array(fresh);
}

export async function startLocal(options: LocalOptions) {
  const dev = (options.env.BRIDIANT_ENV ?? 'development') !== 'production';
  const secretKey = options.env.BRIDIANT_SECRET_KEY || !dev ? undefined : await developmentKey(options.dataDir);
  const cfg = loadConfig(options.env, secretKey ? { secretKey } : {});
  const db = sqliteDb(join(options.dataDir, 'bridiant.sqlite'));
  await migrate(db);
  const files = localFiles(join(options.dataDir, 'files'));
  const handler = createApp({ cfg, db, files, assets: localStatic(options.publicDir) });
  const server = await listen(handler, options.port, options.host ?? '127.0.0.1');
  return {
    cfg,
    db,
    server,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => {
          db.close();
          done();
        });
      }),
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const dataDir = process.env.BRIDIANT_DATA_DIR ?? join(process.cwd(), 'data');
  // Default: the Astro build next to this package (apps/public/dist), independent of the working directory.
  const publicDir = process.env.BRIDIANT_PUBLIC_DIR ?? fileURLToPath(new URL('../../public/dist', import.meta.url));
  const port = Number(process.env.BRIDIANT_PORT ?? process.env.PORT ?? 8787);
  const started = await startLocal({ env: process.env, dataDir, publicDir, port });
  console.log(`Bridiant local server on http://127.0.0.1:${port} (${started.cfg.env})`);
}
