/**
 * Local Workers development only. Seeds the LOCAL D1 emulator state written by `wrangler dev`
 * (apps/server/.wrangler). Never touches a remote database. Run after `wrangler d1 migrations apply <db> --local`.
 * Prints the owner's authenticator secret once, for local testing.
 * Usage (from apps/server):  node scripts/workers-local-seed.mjs
 * Requires apps/server/.dev.vars with BRIDIANT_SECRET_KEY (32 bytes, base64) and BRIDIANT_IP_SALT.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdmin } from '../dist/auth.js';
import { loadConfig } from '../dist/config.js';
import { migrate } from '../dist/db.js';
import { sqliteDb } from '../dist/node/sqlite-db.js';
import { seedWelcomePacket } from '../dist/welcome.js';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const repoRoot = resolve(serverRoot, '../..');
const vars = Object.fromEntries(
  readFileSync(join(serverRoot, '.dev.vars'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const cfg = loadConfig({ BRIDIANT_SECRET_KEY: vars.BRIDIANT_SECRET_KEY, BRIDIANT_IP_SALT: vars.BRIDIANT_IP_SALT });
const dir = join(serverRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const file = readdirSync(dir).find((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite');
if (!file) throw new Error('No local D1 database found. Run: npx wrangler d1 migrations apply bridiant-prod --local');
const db = sqliteDb(join(dir, file));
try {
  await migrate(db);
  const admin = await createAdmin(db, cfg, 'owner', process.env.BRIDIANT_LOCAL_PASSWORD ?? 'correct horse battery staple');
  const packet = JSON.parse(readFileSync(join(repoRoot, 'content/seed/welcome-packet.json'), 'utf8'));
  const added = await seedWelcomePacket(db, packet);
  console.log(JSON.stringify({ localOwnerTotpSecret: admin.totpSecret, welcomeChaptersAdded: added }));
} finally {
  db.close();
}
