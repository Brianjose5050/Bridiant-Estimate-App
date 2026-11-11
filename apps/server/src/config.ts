import { base64ToBytes } from './security.js';

export type EnvRecord = Record<string, string | undefined>;

export interface Config {
  env: 'development' | 'production';
  secretKey: Uint8Array<ArrayBuffer>;
  ipSalt: string;
  cookieSecure: boolean;
  /** Owner notification address. Null until the owner provides and approves it. */
  ownerEmail: string | null;
  /** Sender address. Null until the owner provides and approves it. */
  emailFrom: string | null;
  /** Email provider key. Null means no provider is connected, and messages stay queued. */
  emailApiKey: string | null;
  /** Public address of the private panel, used in owner alerts. */
  adminBaseUrl: string | null;
  /** Turnstile secret. Required in production. */
  turnstileSecret: string | null;
  maxFileBytes: number;
  maxFiles: number;
  maxTotalBytes: number;
  maxFormBytes: number;
  maxDocumentBytes: number;
}

/**
 * Builds configuration from an environment record (Worker bindings or process.env).
 * Production refuses to start without its secrets. Development without a secret key is handled
 * by the Node adapter, which creates a local key file in its data directory.
 */
export function loadConfig(env: EnvRecord, overrides: Partial<Pick<Config, 'secretKey'>> = {}): Config {
  const mode = env.BRIDIANT_ENV === 'production' ? 'production' : 'development';
  let secretKey: Uint8Array<ArrayBuffer>;
  if (overrides.secretKey) {
    secretKey = overrides.secretKey;
  } else if (env.BRIDIANT_SECRET_KEY) {
    secretKey = base64ToBytes(env.BRIDIANT_SECRET_KEY);
  } else if (mode === 'production') {
    throw new Error('BRIDIANT_SECRET_KEY is required in production.');
  } else {
    throw new Error('A secret key must be supplied in development.');
  }
  if (secretKey.length !== 32) throw new Error('The secret key must be 32 bytes (base64).');

  const ipSalt = env.BRIDIANT_IP_SALT ?? (mode === 'production' ? '' : 'development-only-salt');
  if (mode === 'production' && ipSalt.length < 16) throw new Error('BRIDIANT_IP_SALT (16+ characters) is required in production.');
  if (mode === 'production' && !env.BRIDIANT_TURNSTILE_SECRET) {
    throw new Error('BRIDIANT_TURNSTILE_SECRET is required in production (human verification).');
  }

  return {
    env: mode,
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
  };
}
