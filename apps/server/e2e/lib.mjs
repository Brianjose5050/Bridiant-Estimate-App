/**
 * Shared helpers for the browser suites. Target: a running server (local wrangler dev or any environment
 * the owner chooses). Nothing here deploys or writes to a remote system: the suites only use the public
 * site and the owner panel with the owner's own credentials, supplied through environment variables.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

export function config() {
  const base = process.env.BRIDIANT_BASE_URL;
  const totp = process.env.BRIDIANT_OWNER_TOTP;
  if (!base) throw new Error('Set BRIDIANT_BASE_URL (for example http://127.0.0.1:8788).');
  if (!totp) throw new Error('Set BRIDIANT_OWNER_TOTP to the owner authenticator secret (local testing only).');
  return {
    base: base.replace(/\/$/, ''),
    totp,
    password: process.env.BRIDIANT_OWNER_PASSWORD ?? 'correct horse battery staple',
    shots: process.env.BRIDIANT_E2E_SHOTS ?? null,
    chromium: process.env.BRIDIANT_CHROMIUM ?? undefined,
  };
}

/** Loads Playwright from the environment. Chromium must already be installed; nothing is downloaded here. */
export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright is not available. Install it or set NODE_PATH to a folder that contains it.');
  }
}

export function recorder() {
  const results = [];
  const ok = (name, pass, extra = '') => {
    results.push({ name, pass: Boolean(pass) });
    console.log(pass ? 'PASS' : 'FAIL', '-', name, extra ? '(' + extra + ')' : '');
  };
  const finish = () => {
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\nTotal: ${results.length}, failed: ${failed}`);
    if (failed > 0) process.exitCode = 1;
  };
  return { ok, finish };
}

export function shotPath(cfg, name) {
  if (!cfg.shots) return null;
  mkdirSync(cfg.shots, { recursive: true });
  return join(cfg.shots, name);
}

/** RFC 6238 code for the owner's secret. Computed locally; the secret is never sent anywhere else. */
export function code(secret, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const bytes = [];
  for (const ch of secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(ch); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const o = mac[mac.length - 1] & 0x0f;
  const n = (((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1_000_000;
  return String(n).padStart(6, '0');
}

/** A structurally valid JPEG generated here (no owner photos are needed or stored in the repository). */
export function jpegFixture(size = 4096) {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const dqt = Buffer.from([0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(8)]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  return Buffer.concat([soi, app0, dqt, sof, sos, Buffer.alloc(size, 0x55), Buffer.from([0xff, 0xd9])]);
}

/** Writes a fixture to a private temporary folder for file inputs. */
export function tempFile(name, data) {
  const dir = mkdtempSync(join(tmpdir(), 'bridiant-e2e-'));
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
