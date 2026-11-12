#!/usr/bin/env node
/**
 * Encrypted backup and verified restore for the Bridiant database and private files.
 *
 *   node scripts/ops/backup-restore.mjs backup  <dataDir> <backupDir>
 *   node scripts/ops/backup-restore.mjs restore <backupDir> <restoreDir>
 *
 * Key: BRIDIANT_BACKUP_KEY (32 bytes, base64). Keep it in a password manager, never in the repository.
 * Every file is encrypted with AES-256-GCM. The manifest keeps SHA-256 hashes and row counts, so a
 * restore is accepted only if every hash and count matches.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [, , command, source, target] = process.argv;

function key() {
  const raw = process.env.BRIDIANT_BACKUP_KEY;
  if (!raw) throw new Error('BRIDIANT_BACKUP_KEY is required (32 bytes, base64).');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('BRIDIANT_BACKUP_KEY must decode to 32 bytes.');
  return buf;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function encrypt(k, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', k, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(k, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv('aes-256-gcm', k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

function tableCounts(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n]));
  } finally {
    db.close();
  }
}

function backup(dataDir, outDir) {
  const k = key();
  const dbPath = join(dataDir, 'bridiant.sqlite');
  if (!existsSync(dbPath)) throw new Error('Database file not found.');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'files'), { recursive: true });

  // A consistent copy, even while the server is running (SQLite online copy).
  const snapshot = join(outDir, 'snapshot.tmp.sqlite');
  const live = new DatabaseSync(dbPath);
  live.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  live.close();
  const dbPlain = readFileSync(snapshot);
  rmSync(snapshot);
  const counts = tableCounts(dbPath);

  writeFileSync(join(outDir, 'database.sqlite.enc'), encrypt(k, dbPlain));
  const files = [];
  const privateDir = join(dataDir, 'private');
  if (existsSync(privateDir)) {
    const walk = (dir, rel = '') => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, relPath);
        else {
          const data = readFileSync(full);
          const name = relPath.replace(/\//g, '__') + '.enc';
          writeFileSync(join(outDir, 'files', name), encrypt(k, data));
          files.push({ path: relPath, file: name, sha256: sha256(data), bytes: data.length });
        }
      }
    };
    walk(privateDir);
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    database: { sha256: sha256(dbPlain), bytes: dbPlain.length, rows: counts },
    files,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Backup written: ${basename(outDir)} · ${Object.keys(counts).length} tables · ${files.length} private file(s).`);
  return manifest;
}

function restore(backupDir, restoreDir) {
  const k = key();
  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'));
  const dbPlain = decrypt(k, readFileSync(join(backupDir, 'database.sqlite.enc')));
  if (sha256(dbPlain) !== manifest.database.sha256) throw new Error('Database checksum does not match the manifest. Restore refused.');

  mkdirSync(restoreDir, { recursive: true });
  const dbPath = join(restoreDir, 'bridiant.sqlite');
  rmSync(dbPath, { force: true });
  writeFileSync(dbPath, dbPlain);

  const check = new DatabaseSync(dbPath, { readOnly: true });
  const integrity = check.prepare('PRAGMA integrity_check').get();
  check.close();
  if (Object.values(integrity)[0] !== 'ok') throw new Error('Database integrity check failed.');
  const counts = tableCounts(dbPath);
  for (const [table, rows] of Object.entries(manifest.database.rows)) {
    if (counts[table] !== rows) throw new Error(`Row count mismatch in ${table}.`);
  }

  const privateDir = join(restoreDir, 'private');
  for (const f of manifest.files) {
    const data = decrypt(k, readFileSync(join(backupDir, 'files', f.file)));
    if (sha256(data) !== f.sha256) throw new Error(`Checksum mismatch for ${f.path}. Restore refused.`);
    const out = join(privateDir, f.path);
    mkdirSync(join(out, '..'), { recursive: true });
    writeFileSync(out, data, { mode: 0o600 });
  }
  console.log(`Restore verified: ${Object.keys(counts).length} tables, ${manifest.files.length} file(s), all hashes and row counts match.`);
}

try {
  if (command === 'backup') backup(source, target);
  else if (command === 'restore') restore(source, target);
  else console.log('Usage: backup <dataDir> <backupDir> | restore <backupDir> <restoreDir>');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operation failed.');
  process.exitCode = 1;
}
