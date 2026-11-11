import type { Config } from './config.js';
import type { Db } from './db.js';
import { allowRate, audit, nowIso } from './db.js';
import { constantTimeEqual, decryptSecret, encryptSecret, generateTotpSecret, hashPassword, hashIp, otpauthUri, randomToken, sha256Hex, verifyPassword, verifyTotp } from './security.js';

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;

const MIN_PASSWORD_LENGTH = 12;
// Used only to keep timing similar when no owner account exists yet.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function createAdmin(db: Db, cfg: Config, username: string, password: string): Promise<{ totpSecret: string; otpauth: string }> {
  const existing = db.prepare('SELECT id FROM admin_user WHERE id = 1').get();
  if (existing) throw new Error('An owner account already exists. This system supports one administrator.');
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  const name = username.trim();
  if (!/^[A-Za-z0-9._@-]{3,80}$/.test(name)) throw new Error('Invalid username.');
  const totpSecret = generateTotpSecret();
  db.prepare('INSERT INTO admin_user (id, username, password_hash, totp_secret_enc, created_at) VALUES (1, ?, ?, ?, ?)').run(
    name,
    await hashPassword(password),
    encryptSecret(cfg.secretKey, totpSecret),
    nowIso(),
  );
  audit(db, 'admin_created', 'admin_user', '1');
  return { totpSecret, otpauth: otpauthUri(totpSecret, name, 'Bridiant Facility Group') };
}

export interface LoginResult {
  ok: boolean;
  token?: string;
  csrf?: string;
}

/** Login with password and authenticator code. Failures never say which part was wrong. */
export async function login(db: Db, cfg: Config, input: { username: string; password: string; code: string; ip: string }): Promise<LoginResult> {
  const ipKey = `login:ip:${hashIp(input.ip, cfg.ipSalt)}`;
  const userKey = `login:user:${sha256Hex(input.username.trim().toLowerCase()).slice(0, 24)}`;
  const allowedIp = allowRate(db, ipKey, 20, 15 * 60);
  const allowedUser = allowRate(db, userKey, 8, 15 * 60);
  if (!allowedIp || !allowedUser) {
    audit(db, 'login_rate_limited', 'admin_user', null);
    return { ok: false };
  }

  const row = db.prepare('SELECT username, password_hash, totp_secret_enc FROM admin_user WHERE id = 1').get() as
    | { username: string; password_hash: string; totp_secret_enc: string }
    | undefined;

  // Always run the password check, even for an unknown user, to keep timing similar.
  const passwordOk = row ? await verifyPassword(input.password, row.password_hash) : await verifyPassword(input.password, DUMMY_HASH).then(() => false);
  const userOk = !!row && constantTimeEqual(row.username, input.username.trim());
  const totpOk = !!row && verifyTotp(decryptSecret(cfg.secretKey, row.totp_secret_enc), input.code.trim());

  if (!row || !userOk || !passwordOk || !totpOk) {
    audit(db, 'login_failed', 'admin_user', null);
    return { ok: false };
  }

  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = nowIso();
  db.prepare('INSERT INTO admin_session (token_hash, csrf, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256Hex(token),
    csrf,
    now,
    now,
    new Date(Date.now() + SESSION_ABSOLUTE_MS).toISOString(),
  );
  audit(db, 'login_succeeded', 'admin_user', '1');
  return { ok: true, token, csrf };
}

export interface Session {
  csrf: string;
  username: string;
}

/** Returns the session when valid. Enforces idle and absolute timeouts on the server. */
export function getSession(db: Db, token: string | undefined): Session | null {
  if (!token) return null;
  const hash = sha256Hex(token);
  const row = db.prepare('SELECT csrf, created_at, last_seen_at, expires_at FROM admin_session WHERE token_hash = ?').get(hash) as
    | { csrf: string; created_at: string; last_seen_at: string; expires_at: string }
    | undefined;
  if (!row) return null;
  const now = Date.now();
  const idleExpired = now - Date.parse(row.last_seen_at) > SESSION_IDLE_MS;
  const absoluteExpired = now > Date.parse(row.expires_at);
  if (idleExpired || absoluteExpired) {
    db.prepare('DELETE FROM admin_session WHERE token_hash = ?').run(hash);
    return null;
  }
  db.prepare('UPDATE admin_session SET last_seen_at = ? WHERE token_hash = ?').run(nowIso(), hash);
  const admin = db.prepare('SELECT username FROM admin_user WHERE id = 1').get() as { username: string } | undefined;
  if (!admin) return null;
  return { csrf: row.csrf, username: admin.username };
}

export function logout(db: Db, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM admin_session WHERE token_hash = ?').run(sha256Hex(token));
  audit(db, 'logout', 'admin_user', '1');
}
