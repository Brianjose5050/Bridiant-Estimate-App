import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  env: 'development' | 'production';
  dataDir: string;
  dbPath: string;
  privateDir: string;
  publicDir: string;
  adminStaticDir: string;
  /** Shared brand tokens, served to the panel so there is one source of truth. */
  tokensCssPath: string;
  secretKey: Buffer;
  ipSalt: string;
  cookieSecure: boolean;
  /** Owner notification address. Null until the owner provides and approves it. */
  ownerEmail: string | null;
  /** Sender address. Null until the owner provides and approves it. */
  emailFrom: string | null;
  /** Email API key. Null means no provider is connected, and messages stay queued. */
  emailApiKey: string | null;
  /** Public address of the private panel, used in owner alerts. Null means the link is omitted. */
  adminBaseUrl: string | null;
  /** Turnstile secret. Null means the check is disabled and the server reports it. */
  turnstileSecret: string | null;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFormBytes: number;
  maxDocumentBytes: number;
}

const here = fileURLToPath(new URL('.', import.meta.url));
const serverRoot = resolve(here, '..');
const repoRoot = resolve(serverRoot, '../..');

function loadOrCreateKey(path: string): Buffer {
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
  mkdirSync(join(path, '..'), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString('base64'), { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

/**
 * Loads configuration. Production requires the secret key and salt to be set explicitly.
 * In development, a local key file is created inside the git-ignored data directory.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const mode = env.BRIDIANT_ENV === 'production' ? 'production' : 'development';
  const dataDir = overrides.dataDir ?? env.BRIDIANT_DATA_DIR ?? join(serverRoot, 'data');

  let secretKey: Buffer;
  if (overrides.secretKey) {
    secretKey = overrides.secretKey;
  } else if (env.BRIDIANT_SECRET_KEY) {
    secretKey = Buffer.from(env.BRIDIANT_SECRET_KEY, 'base64');
  } else if (mode === 'production') {
    throw new Error('BRIDIANT_SECRET_KEY is required in production.');
  } else {
    secretKey = loadOrCreateKey(join(dataDir, 'secret.key'));
  }
  if (secretKey.length !== 32) throw new Error('The secret key must be 32 bytes (base64).');

  const ipSalt = overrides.ipSalt ?? env.BRIDIANT_IP_SALT ?? (mode === 'production' ? '' : 'development-only-salt');
  if (mode === 'production' && ipSalt.length < 16) throw new Error('BRIDIANT_IP_SALT (16+ characters) is required in production.');

  if (mode === 'production' && !env.BRIDIANT_TURNSTILE_SECRET) {
    throw new Error('BRIDIANT_TURNSTILE_SECRET is required in production (human verification).');
  }
  return {
    env: mode,
    dataDir,
    dbPath: overrides.dbPath ?? join(dataDir, 'bridiant.sqlite'),
    privateDir: overrides.privateDir ?? join(dataDir, 'private'),
    publicDir: overrides.publicDir ?? resolve(repoRoot, 'apps/public/dist'),
    adminStaticDir: overrides.adminStaticDir ?? resolve(serverRoot, 'static'),
    tokensCssPath: overrides.tokensCssPath ?? resolve(repoRoot, 'packages/ui/src/tokens.css'),
    secretKey,
    ipSalt,
    cookieSecure: mode === 'production',
    ownerEmail: env.BRIDIANT_OWNER_EMAIL ?? null,
    emailFrom: env.BRIDIANT_EMAIL_FROM ?? null,
    emailApiKey: env.BRIDIANT_EMAIL_API_KEY ?? null,
    adminBaseUrl: env.BRIDIANT_ADMIN_URL ?? null,
    turnstileSecret: env.BRIDIANT_TURNSTILE_SECRET ?? null,
    maxFileBytes: 15 * 1024 * 1024,
    maxFiles: 30,
    maxTotalBytes: 150 * 1024 * 1024,
    maxFormBytes: 16 * 1024,
    maxDocumentBytes: 20 * 1024 * 1024,
    ...overrides,
  };
}
