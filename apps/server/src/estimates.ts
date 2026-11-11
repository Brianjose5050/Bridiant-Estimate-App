import { unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import Busboy from 'busboy';
import { submitEstimateRequest, SERVICE_IDS, type RequestStore, type StoredRequest, type SubmitResult } from '@bridiant/intake';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { allowRate, audit, nowIso } from './db.js';
import { queueRequestEmails } from './email.js';
import { detectFileType, extensionFor, hashIp, randomToken, safeDisplayName, sha256Hex, type DetectedType } from './security.js';

export interface UploadedFile {
  displayName: string;
  buffer: Buffer;
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

export class UploadError extends Error {
  constructor(readonly code: 'unsupported_content_type' | 'file_too_large' | 'too_many_files' | 'total_too_large' | 'malformed') {
    super(code);
    this.name = 'UploadError';
  }
}

/** Parses multipart/form-data with hard limits. Files are kept in memory only until validated. */
export function parseMultipart(req: IncomingMessage, cfg: Config): Promise<ParsedMultipart> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return Promise.reject(new UploadError('unsupported_content_type'));
  }
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: UploadedFile[] = [];
    let total = 0;
    let failed: UploadError | null = null;
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          fileSize: cfg.maxFileBytes,
          files: cfg.maxFiles,
          fields: 20,
          fieldSize: cfg.maxFormBytes,
          parts: cfg.maxFiles + 25,
        },
      });
    } catch {
      reject(new UploadError('malformed'));
      return;
    }
    const fail = (error: UploadError) => {
      failed = error;
      req.unpipe(parser);
      req.resume();
      reject(error);
    };
    parser.on('field', (name: string, value: string) => {
      if (name.length > 64) return;
      fields[name] = value;
    });
    parser.on('file', (name: string, stream: NodeJS.ReadableStream, info: { filename: string }) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > cfg.maxTotalBytes) fail(new UploadError('total_too_large'));
        chunks.push(chunk);
      });
      stream.on('limit', () => fail(new UploadError('file_too_large')));
      stream.on('end', () => {
        if (failed) return;
        if (name === 'photos' || name === 'document') files.push({ displayName: safeDisplayName(info.filename), buffer: Buffer.concat(chunks) });
      });
    });
    parser.on('filesLimit', () => fail(new UploadError('too_many_files')));
    parser.on('error', () => fail(new UploadError('malformed')));
    parser.on('close', () => {
      if (!failed) resolve({ fields, files });
    });
    req.pipe(parser);
  });
}

const PHOTO_TYPES: DetectedType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** Validates that each file is a real, allowed photo by its content. Returns the detected type. */
export function validatePhotos(files: UploadedFile[]): { ok: true; typed: Array<UploadedFile & { type: DetectedType }> } | { ok: false; code: string } {
  const typed: Array<UploadedFile & { type: DetectedType }> = [];
  for (const file of files) {
    if (file.buffer.length === 0) return { ok: false, code: 'empty_file' };
    const type = detectFileType(file.buffer);
    if (!type || !PHOTO_TYPES.includes(type)) return { ok: false, code: 'unsupported_file' };
    typed.push({ ...file, type });
  }
  return { ok: true, typed };
}

export interface IntakeDeps {
  db: Db;
  cfg: Config;
  ip: string;
  now?: () => Date;
}

export interface IntakeResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Server-side intake. Saves the request first, queues emails second, and reports success last. */
export async function handleEstimateSubmit(req: IncomingMessage, deps: IntakeDeps): Promise<IntakeResponse> {
  const { db, cfg, ip } = deps;
  const ipHash = hashIp(ip, cfg.ipSalt);

  if (!allowRate(db, `estimate:ip:${ipHash}`, 10, 60 * 60)) {
    audit(db, 'estimate_rate_limited', 'estimate_request', null);
    return { status: 429, body: { status: 'rate_limited' } };
  }

  let parsed: ParsedMultipart;
  try {
    parsed = await parseMultipart(req, cfg);
  } catch (error) {
    const code = error instanceof UploadError ? error.code : 'malformed';
    const status = code === 'unsupported_content_type' ? 415 : code === 'file_too_large' || code === 'total_too_large' ? 413 : 400;
    return { status, body: { status: 'invalid', issues: [{ field: 'photos', code }] } };
  }

  const photoCheck = validatePhotos(parsed.files);
  if (!photoCheck.ok) return { status: 400, body: { status: 'invalid', issues: [{ field: 'photos', code: photoCheck.code }] } };

  let payload: unknown;
  try {
    payload = JSON.parse(parsed.fields.payload ?? '');
  } catch {
    return { status: 400, body: { status: 'invalid', issues: [{ field: 'form', code: 'malformed' }] } };
  }

  // Human-verification gate. Enforced when a Turnstile secret is configured.
  if (cfg.turnstileSecret) {
    const ok = await verifyTurnstile(cfg.turnstileSecret, parsed.fields['cf-turnstile-response'] ?? '', ip);
    if (!ok) return { status: 400, body: { status: 'invalid', issues: [{ field: 'verification', code: 'failed' }] } };
  }

  const files = photoCheck.typed;
  const store = createRequestStore(db, cfg, ipHash, files, deps.now);
  const result: SubmitResult = await submitEstimateRequest(payload, deps.now ? { store, now: deps.now } : { store });

  if (result.status === 'received') return { status: 200, body: { status: 'received', reference: result.reference } };
  if (result.status === 'invalid') return { status: 400, body: { status: 'invalid', issues: result.issues } };
  return { status: 503, body: { status: 'unavailable' } };
}

/** Request store: writes photos, then the request and its audit events, in one transaction. */
export function createRequestStore(
  db: Db,
  cfg: Config,
  ipHash: string,
  files: Array<UploadedFile & { type: DetectedType }>,
  now: () => Date = () => new Date(),
): RequestStore {
  return {
    async findByIdempotencyKey(key: string): Promise<StoredRequest | null> {
      const row = db.prepare('SELECT reference FROM estimate_request WHERE idempotency_key = ?').get(key) as { reference: string } | undefined;
      if (!row) return null;
      return { reference: row.reference, createdAt: '', idempotencyKey: key, request: {} as never, status: 'new' };
    },

    async save(record: StoredRequest): Promise<void> {
      const r = record.request;
      const services = r.services as string[];
      const serviceNames = services.map((id) => (SERVICE_IDS as readonly string[]).includes(id) ? id : 'unknown');
      const receivedAt = nowIso();
      await mkdir(cfg.privateDir, { recursive: true });

      const written: string[] = [];
      try {
        const photoRows: Array<{ displayName: string; mime: string; bytes: number; sha256: string; storage: string }> = [];
        for (const file of files) {
          const storage = `${randomToken(18)}.${extensionFor(file.type)}`;
          await writeFile(join(cfg.privateDir, storage), file.buffer, { mode: 0o600, flag: 'wx' });
          written.push(storage);
          photoRows.push({ displayName: file.displayName, mime: file.type, bytes: file.buffer.length, sha256: sha256Hex(file.buffer), storage });
        }

        db.exec('BEGIN IMMEDIATE');
        try {
          const insert = db.prepare(`
            INSERT INTO estimate_request (
              reference, idempotency_key, received_at, locale, status, services, services_text,
              home_type, bedrooms, bathrooms, frequency, move_date, name, phone, email, zip, notes, ip_hash
            ) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const info = insert.run(
            record.reference,
            record.idempotencyKey,
            receivedAt,
            r.locale,
            JSON.stringify(services),
            serviceNames.join(' '),
            r.homeType,
            r.bedrooms,
            r.bathrooms,
            r.frequency,
            r.moveDate,
            r.name,
            r.phone,
            r.email,
            r.zip,
            r.notes,
            ipHash,
          );
          const requestId = Number(info.lastInsertRowid);
          const photoInsert = db.prepare(
            'INSERT INTO request_photo (request_id, display_name, mime, bytes, sha256, storage_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          );
          for (const p of photoRows) photoInsert.run(requestId, p.displayName, p.mime, p.bytes, p.sha256, p.storage, receivedAt);
          db.prepare('INSERT INTO request_event (request_id, kind, to_value, actor, created_at) VALUES (?, ?, ?, ?, ?)').run(
            requestId,
            'received',
            'new',
            'website',
            receivedAt,
          );
          queueRequestEmails(db, cfg, {
            requestId,
            reference: record.reference,
            name: r.name,
            services,
            receivedAt,
            locale: r.locale,
            customerEmail: r.email,
          });
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        // Nothing is confirmed. Remove any photo written before the failure.
        await Promise.all(written.map((name) => unlink(join(cfg.privateDir, name)).catch(() => undefined)));
        throw error;
      }
    },
  };
}

/** Verifies a Cloudflare Turnstile token on the server. */
export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await response.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
