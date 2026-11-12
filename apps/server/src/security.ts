/**
 * Security primitives on Web Crypto. Runs unchanged in Cloudflare Workers and in Node 22.
 * No Node-only APIs: no Buffer, no node:crypto.
 */

export const PBKDF2_ITERATIONS = 100_000; // Workers' WebCrypto limit for PBKDF2.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toBytes(input: string | Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return typeof input === 'string' ? enc.encode(input) : input;
}

export function bytesToBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.trim());
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(length = 32): string {
  return bytesToBase64Url(randomBytes(length));
}

/** Constant-time comparison of two byte arrays or strings. */
export function constantTimeEqual(a: string | Uint8Array<ArrayBuffer>, b: string | Uint8Array<ArrayBuffer>): boolean {
  const x = toBytes(a);
  const y = toBytes(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function sha256(input: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toBytes(input)));
}

export function toHex(bytes: Uint8Array<ArrayBuffer>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string | Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await sha256(input));
}

async function hmacKey(key: Uint8Array<ArrayBuffer>, hash: 'SHA-1' | 'SHA-256'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
}

/** Salted, non-reversible IP fingerprint for rate limits and audit. Raw IPs are never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await hmacKey(toBytes(salt), 'SHA-256');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, toBytes(ip)));
  return toHex(mac).slice(0, 32);
}

// ---------- Passwords (PBKDF2-SHA256) ----------

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey('raw', toBytes(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, 256);
  return new Uint8Array(bits);
}

/** Format: pbkdf2-sha256$iterations$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return ['pbkdf2-sha256', PBKDF2_ITERATIONS, bytesToBase64Url(salt), bytesToBase64Url(hash)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false;
  const salt = base64UrlToBytes(parts[2] ?? '');
  const expected = base64UrlToBytes(parts[3] ?? '');
  const actual = await pbkdf2(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

// ---------- Base32 and TOTP (RFC 6238, HMAC-SHA1, 30 s, 6 digits) ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Uint8Array<ArrayBuffer>): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array<ArrayBuffer> {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = B32.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export async function totpCode(secret: string, atMs: number, step = 30, digits = 6): Promise<string> {
  const counter = Math.floor(atMs / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const key = await hmacKey(base32Decode(secret), 'SHA-1');
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    ((hmac[offset] ?? 0) & 0x7f) * 0x1000000 +
    ((hmac[offset + 1] ?? 0) & 0xff) * 0x10000 +
    ((hmac[offset + 2] ?? 0) & 0xff) * 0x100 +
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Accepts the current code and one 30-second step either side (clock drift). */
export async function verifyTotp(secret: string, code: string, atMs = Date.now()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    if (constantTimeEqual(await totpCode(secret, atMs + drift * 30_000), code)) ok = true;
  }
  return ok;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ---------- Encryption at rest (AES-256-GCM) ----------

async function aesKey(key: Uint8Array<ArrayBuffer>, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error('Key must be 32 bytes.');
  return crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, [usage]);
}

export async function encryptSecret(key: Uint8Array<ArrayBuffer>, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'encrypt'), toBytes(plaintext)));
  return ['v1', bytesToBase64Url(iv), bytesToBase64Url(ct)].join('.');
}

export async function decryptSecret(key: Uint8Array<ArrayBuffer>, payload: string): Promise<string> {
  const [version, ivB, ctB] = payload.split('.');
  if (version !== 'v1' || !ivB || !ctB) throw new Error('Unsupported ciphertext');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivB) }, await aesKey(key, 'decrypt'), base64UrlToBytes(ctB));
  return dec.decode(plain);
}

/** Encrypts bytes (used for backups and private file envelopes). Output: iv(12) || ciphertext+tag. */
export async function encryptBytes(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'encrypt'), data));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export async function decryptBytes(key: Uint8Array<ArrayBuffer>, blob: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'decrypt'), ct));
}

// ---------- File type detection from content, never from the file name ----------

export type DetectedType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic' | 'application/pdf';

function startsWithAscii(bytes: Uint8Array<ArrayBuffer>, text: string, offset = 0): boolean {
  for (let i = 0; i < text.length; i += 1) if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function detectFileType(buf: Uint8Array<ArrayBuffer>): DetectedType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return 'image/png';
  if (buf.length >= 12 && startsWithAscii(buf, 'RIFF') && startsWithAscii(buf, 'WEBP', 8)) return 'image/webp';
  if (buf.length >= 12 && startsWithAscii(buf, 'ftyp', 4)) {
    const brand = dec.decode(buf.subarray(8, 12));
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'image/heic';
  }
  if (buf.length >= 5 && startsWithAscii(buf, '%PDF-')) return 'application/pdf';
  return null;
}

/** Keeps a safe, short display name. Never used as a storage path. */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^\p{L}\p{N} ._()-]/gu, '').trim().slice(0, 80);
  return cleaned.length > 0 ? cleaned : 'file';
}

export function extensionFor(type: DetectedType): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' }[type];
}
