import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.js';
import { jpeg } from './helpers.js';

const script = resolve(import.meta.dirname, '../../../scripts/ops/backup-restore.mjs');
const env = (key: string) => ({ ...process.env, BRIDIANT_BACKUP_KEY: key });

describe('encrypted backup and verified restore (real files)', () => {
  it('backs up a live database and private files, and restores them with every check passing', () => {
    const root = mkdtempSync(join(tmpdir(), 'bk-'));
    const data = join(root, 'data');
    mkdirSync(join(data, 'private', 'gallery'), { recursive: true });
    const db = openDb(join(data, 'bridiant.sqlite'));
    db.prepare("INSERT INTO estimate_request (reference, idempotency_key, received_at, locale, status, services, services_text, home_type, bedrooms, bathrooms, name, ip_hash) VALUES ('BFG-AAAAAA', 'k-restore-000000001', ?, 'en', 'new', '[]', '', 'house', '2', '1', 'Restore Test', 'h')").run(new Date().toISOString());
    db.prepare("INSERT INTO request_note (request_id, body, author, created_at) VALUES (1, 'private note', 'owner', ?)").run(new Date().toISOString());
    writeFileSync(join(data, 'private', 'gallery', 'photo.jpg.enc-source'), jpeg());
    db.close();

    const key = randomBytes(32).toString('base64');
    const backupDir = join(root, 'backup');
    const restoreDir = join(root, 'restored');
    execFileSync('node', [script, 'backup', data, backupDir], { env: env(key), encoding: 'utf8' });
    expect(existsSync(join(backupDir, 'database.sqlite.enc'))).toBe(true);
    // Nothing readable is left in the backup: the database and files are encrypted.
    expect(readFileSync(join(backupDir, 'database.sqlite.enc')).toString('latin1')).not.toContain('Restore Test');

    const out = execFileSync('node', [script, 'restore', backupDir, restoreDir], { env: env(key), encoding: 'utf8' });
    expect(out).toContain('all hashes and row counts match');
    const restored = openDb(join(restoreDir, 'bridiant.sqlite'));
    expect((restored.prepare('SELECT name FROM estimate_request').get() as { name: string }).name).toBe('Restore Test');
    expect((restored.prepare('SELECT body FROM request_note').get() as { body: string }).body).toBe('private note');
    restored.close();
    expect(statSync(join(restoreDir, 'private', 'gallery', 'photo.jpg.enc-source')).size).toBe(jpeg().length);
  });

  it('refuses to restore with the wrong key, and refuses a tampered backup', () => {
    const root = mkdtempSync(join(tmpdir(), 'bk2-'));
    const data = join(root, 'data');
    mkdirSync(data, { recursive: true });
    openDb(join(data, 'bridiant.sqlite')).close();
    const key = randomBytes(32).toString('base64');
    const backupDir = join(root, 'b');
    execFileSync('node', [script, 'backup', data, backupDir], { env: env(key) });
    expect(() => execFileSync('node', [script, 'restore', backupDir, join(root, 'r1')], { env: env(randomBytes(32).toString('base64')), stdio: 'pipe' })).toThrow();
    const file = join(backupDir, 'database.sqlite.enc');
    const bytes = readFileSync(file);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(file, bytes);
    expect(() => execFileSync('node', [script, 'restore', backupDir, join(root, 'r2')], { env: env(key), stdio: 'pipe' })).toThrow();
  });
});
