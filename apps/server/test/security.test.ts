import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { base32Encode, base32Decode, decryptSecret, detectFileType, encryptSecret, hashPassword, safeDisplayName, totpCode, verifyPassword, verifyTotp, hashIp } from '../src/security.js';

describe('TOTP (RFC 6238 reference vectors, SHA-1, 8-digit values truncated to 6)', () => {
  // RFC 6238 test secret "12345678901234567890" (ASCII). Reference 8-digit values; the 6-digit codes are the last six digits.
  const secret = base32Encode(new Uint8Array(Buffer.from('12345678901234567890', 'ascii')));
  it('matches the RFC vector at T=59 (94287082 -> 287082)', async () => {
    expect(await totpCode(secret, 59_000)).toBe('287082');
  });
  it('matches the RFC vector at T=1111111109 (07081804 -> 081804)', async () => {
    expect(await totpCode(secret, 1111111109_000)).toBe('081804');
  });
  it('accepts the current code and rejects a wrong one', async () => {
    const now = 1_700_000_000_000;
    expect(await verifyTotp(secret, await totpCode(secret, now), now)).toBe(true);
    expect(await verifyTotp(secret, '000000', now)).toBe(false);
    expect(await verifyTotp(secret, 'abc', now)).toBe(false);
  });
  it('tolerates one 30-second clock drift and nothing more', async () => {
    const now = 1_700_000_000_000;
    expect(await verifyTotp(secret, await totpCode(secret, now - 30_000), now)).toBe(true);
    expect(await verifyTotp(secret, await totpCode(secret, now - 90_000), now)).toBe(false);
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = new Uint8Array(randomBytes(20));
    expect(Buffer.from(base32Decode(base32Encode(buf))).equals(Buffer.from(buf))).toBe(true);
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('a very long passphrase');
    expect(await verifyPassword('a very long passphrase', hash)).toBe(true);
    expect(await verifyPassword('wrong passphrase', hash)).toBe(false);
    expect(hash).not.toContain('a very long passphrase');
  });
});

describe('encryption at rest', () => {
  it('round-trips and detects tampering', async () => {
    const key = new Uint8Array(randomBytes(32));
    const enc = await encryptSecret(key, 'totp-secret');
    expect(await decryptSecret(key, enc)).toBe('totp-secret');
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
    await expect(decryptSecret(key, tampered)).rejects.toThrow();
    await expect(decryptSecret(new Uint8Array(randomBytes(32)), enc)).rejects.toThrow();
  });
});

describe('file type detection uses content, not the file name', () => {
  const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));
  it('recognises real photo and PDF signatures', () => {
    expect(detectFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(detectFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectFileType(bytes('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(bytes('\0\0\0\x18ftypheic\0\0\0\0'))).toBe('image/heic');
    expect(detectFileType(bytes('%PDF-1.7'))).toBe('application/pdf');
  });
  it('rejects executables, scripts, and archives, even when renamed', () => {
    expect(detectFileType(bytes('MZ\x90\0'))).toBeNull();
    expect(detectFileType(bytes('<?php echo 1;'))).toBeNull();
    expect(detectFileType(bytes('PK\x03\x04'))).toBeNull();
    expect(detectFileType(bytes('<script>alert(1)</script>'))).toBeNull();
  });
});

describe('display names and IP fingerprints', () => {
  it('removes paths and unsafe characters from file names', () => {
    expect(safeDisplayName('../../etc/passwd')).toBe('passwd');
    expect(safeDisplayName('x<script>.jpg')).toBe('xscript.jpg');
    expect(safeDisplayName('')).toBe('file');
    expect(safeDisplayName('a'.repeat(300)).length).toBeLessThanOrEqual(80);
  });
  it('fingerprints IPs without storing the address', async () => {
    const h = await hashIp('203.0.113.9', 'salt-one-long-enough');
    expect(h).toHaveLength(32);
    expect(h).not.toContain('203.0.113');
    expect(await hashIp('203.0.113.9', 'other-salt-long-enough')).not.toBe(h);
  });
});

describe('production configuration safety', () => {
  it('refuses to start in production without a secret key, salt, and human-verification secret', async () => {
    const { loadConfig } = await import('../src/config.js');
    expect(() => loadConfig({ BRIDIANT_ENV: 'production' })).toThrow(/BRIDIANT_SECRET_KEY/);
    const key = randomBytes(32).toString('base64');
    expect(() => loadConfig({ BRIDIANT_ENV: 'production', BRIDIANT_SECRET_KEY: key, BRIDIANT_IP_SALT: 'a-long-enough-salt-value' })).toThrow(/TURNSTILE/);
    const cfg = loadConfig({ BRIDIANT_ENV: 'production', BRIDIANT_SECRET_KEY: key, BRIDIANT_IP_SALT: 'a-long-enough-salt-value', BRIDIANT_TURNSTILE_SECRET: 'x' });
    expect(cfg.cookieSecure).toBe(true);
  });
});
