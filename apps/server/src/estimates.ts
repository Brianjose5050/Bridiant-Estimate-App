import { BodyTooLarge } from './limits.js';
import { submitEstimateRequest, SERVICE_IDS, type RequestStore, type StoredRequest, type SubmitResult } from '@bridiant/intake';
import type { Config } from './config.js';
import type { Db, Stmt } from './db.js';
import { allowRate, audit, auditStmt, nowIso } from './db.js';
import type { FileStore } from './files.js';
import { requestEmailStatements } from './email.js';
import { stripMetadata, MetadataError } from './metadata.js';
import { detectFileType, extensionFor, hashIp, randomToken, safeDisplayName, sha256Hex, type DetectedType } from './security.js';

export interface UploadedFile {
  displayName: string;
  buffer: Uint8Array<ArrayBuffer>;
}

// HEIC is refused until a safe metadata-removal path exists (see metadata.ts).
const PHOTO_TYPES: DetectedType[] = ['image/jpeg', 'image/png', 'image/webp'];

export class UploadError extends Error {
  constructor(readonly code: 'unsupported_content_type' | 'file_too_large' | 'too_many_files' | 'total_too_large' | 'malformed') {
    super(code);
    this.name = 'UploadError';
  }
}

export interface ParsedMultipart {
  fields: Record<string, string>;
  files: UploadedFile[];
}

/** FormData entries as an array (the library types here do not declare iteration). */
export function formEntries(form: FormData): Array<[string, FormDataEntryValue]> {
  const out: Array<[string, FormDataEntryValue]> = [];
  form.forEach((value, key) => out.push([key, value]));
  return out;
}

/** Reads a multipart request with hard limits, using the standard FormData parser. */
export async function parseMultipart(request: Request, cfg: Config, fileField: string): Promise<ParsedMultipart> {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('multipart/form-data')) throw new UploadError('unsupported_content_type');
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > cfg.maxTotalBytes + cfg.maxFormBytes) throw new UploadError('total_too_large');
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    if (error instanceof BodyTooLarge) throw new UploadError('total_too_large');
    throw new UploadError('malformed');
  }
  const fields: Record<string, string> = {};
  const files: UploadedFile[] = [];
  let total = 0;
  for (const [name, value] of formEntries(form)) {
    if (typeof value === 'string') {
      if (name.length <= 64 && value.length <= cfg.maxFormBytes) fields[name] = value;
      continue;
    }
    if (name !== fileField) continue;
    if (files.length >= cfg.maxFiles) throw new UploadError('too_many_files');
    if (value.size > cfg.maxFileBytes) throw new UploadError('file_too_large');
    total += value.size;
    if (total > cfg.maxTotalBytes) throw new UploadError('total_too_large');
    files.push({ displayName: safeDisplayName(value.name), buffer: new Uint8Array(await value.arrayBuffer()) });
  }
  return { fields, files };
}

/** Validates that each file is a real, allowed photo by its content, and removes its metadata. */
export function validatePhotos(files: UploadedFile[]): { ok: true; typed: Array<UploadedFile & { type: DetectedType }> } | { ok: false; code: string } {
  const typed: Array<UploadedFile & { type: DetectedType }> = [];
  for (const file of files) {
    if (file.buffer.length === 0) return { ok: false, code: 'empty_file' };
    const type = detectFileType(file.buffer);
    if (!type || !PHOTO_TYPES.includes(type)) return { ok: false, code: 'unsupported_file' };
    try {
      typed.push({ ...file, buffer: stripMetadata(file.buffer, type), type });
    } catch (error) {
      if (error instanceof MetadataError) return { ok: false, code: 'unsupported_file' };
      throw error;
    }
  }
  return { ok: true, typed };
}

export interface IntakeDeps {
  db: Db;
  files: FileStore;
  cfg: Config;
  ip: string;
  now?: () => Date;
}

export interface IntakeResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Server-side intake. Saves the request first, queues emails second, and reports success last. */
export async function handleEstimateSubmit(request: Request, deps: IntakeDeps): Promise<IntakeResponse> {
  const { db, cfg, ip } = deps;
  const ipHash = await hashIp(ip, cfg.ipSalt);

  if (!(await allowRate(db, `estimate:ip:${ipHash}`, 10, 60 * 60))) {
    await audit(db, 'estimate_rate_limited', 'estimate_request', null);
    return { status: 429, body: { status: 'rate_limited' } };
  }

  let parsed: ParsedMultipart;
  try {
    parsed = await parseMultipart(request, cfg, 'photos');
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

  if (cfg.turnstileSecret) {
    const ok = await verifyTurnstile(cfg.turnstileSecret, parsed.fields['cf-turnstile-response'] ?? '', ip);
    if (!ok) return { status: 400, body: { status: 'invalid', issues: [{ field: 'verification', code: 'failed' }] } };
  }

  const store = createRequestStore(db, cfg, deps.files, ipHash, photoCheck.typed);
  const result: SubmitResult = await submitEstimateRequest(payload, deps.now ? { store, now: deps.now } : { store });

  if (result.status === 'received') return { status: 200, body: { status: 'received', reference: result.reference } };
  if (result.status === 'invalid') return { status: 400, body: { status: 'invalid', issues: result.issues } };
  return { status: 503, body: { status: 'unavailable' } };
}

/**
 * Request store. Photos are written to private storage first. The request, its photo rows, its events,
 * its notifications and its audit entry are then written in ONE atomic batch. If the batch fails,
 * the written photos are deleted and nothing is confirmed.
 */
export function createRequestStore(db: Db, cfg: Config, files: FileStore, ipHash: string, photos: Array<UploadedFile & { type: DetectedType }>): RequestStore {
  return {
    async findByIdempotencyKey(key: string): Promise<StoredRequest | null> {
      const row = await db.first<{ reference: string }>('SELECT reference FROM estimate_request WHERE idempotency_key = ?', [key]);
      if (!row) return null;
      return { reference: row.reference, createdAt: '', idempotencyKey: key, request: {} as never, status: 'new' };
    },

    async save(record: StoredRequest): Promise<void> {
      const r = record.request;
      const services = r.services as string[];
      const serviceNames = services.map((id) => ((SERVICE_IDS as readonly string[]).includes(id) ? id : 'unknown'));
      const receivedAt = nowIso();

      const written: Array<{ key: string; photo: UploadedFile & { type: DetectedType }; sha: string }> = [];
      try {
        for (const photo of photos) {
          const key = `requests/${randomToken(18)}.${extensionFor(photo.type)}`;
          await files.put(key, photo.buffer, photo.type);
          written.push({ key, photo, sha: await sha256Hex(photo.buffer) });
        }

        const statements: Stmt[] = [
          {
            sql: `INSERT INTO estimate_request (
                    reference, idempotency_key, received_at, locale, status, services, services_text,
                    home_type, bedrooms, bathrooms, frequency, move_date, name, phone, email, zip, notes, ip_hash)
                  VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            params: [record.reference, record.idempotencyKey, receivedAt, r.locale, JSON.stringify(services), serviceNames.join(' '), r.homeType, r.bedrooms, r.bathrooms, r.frequency, r.moveDate, r.name, r.phone, r.email, r.zip, r.notes, ipHash],
          },
        ];
        for (const w of written) {
          statements.push({
            sql: `INSERT INTO request_photo (request_id, display_name, mime, bytes, sha256, storage_name, created_at)
                  VALUES ((SELECT id FROM estimate_request WHERE reference = ?), ?, ?, ?, ?, ?, ?)`,
            params: [record.reference, w.photo.displayName, w.photo.type, w.photo.buffer.length, w.sha, w.key, receivedAt],
          });
        }
        statements.push({
          sql: "INSERT INTO request_event (request_id, kind, to_value, actor, created_at) VALUES ((SELECT id FROM estimate_request WHERE reference = ?), 'received', 'new', 'website', ?)",
          params: [record.reference, receivedAt],
        });
        statements.push(...requestEmailStatements(cfg, { reference: record.reference, name: r.name, services, receivedAt, locale: r.locale, customerEmail: r.email }));
        statements.push(auditStmt('request_received', 'estimate_request', record.reference, { photos: photos.length }));

        await db.batch(statements);
      } catch (error) {
        // Nothing is confirmed. Remove any photo written before the failure.
        await Promise.all(written.map((w) => files.delete(w.key).catch(() => undefined)));
        throw error;
      }
    },
  };
}

/** Verifies a Cloudflare Turnstile token on the server. Fails closed. */
export async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, remoteip: ip });
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body, signal: AbortSignal.timeout(8_000) });
    const json = (await response.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
