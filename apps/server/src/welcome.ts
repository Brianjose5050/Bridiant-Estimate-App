import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { audit, nowIso } from './db.js';
import { detectFileType, randomToken, sha256Hex } from './security.js';

export const WELCOME_KINDS = ['presentation', 'service_info', 'standards', 'preparation', 'policy', 'document', 'faq'] as const;
export const ACCESS_TIERS = ['public', 'after_request', 'after_approval'] as const;
export type Lang = 'en' | 'es';
export type WelcomeKind = (typeof WELCOME_KINDS)[number];
export type AccessTier = (typeof ACCESS_TIERS)[number];

export interface ResourceInput {
  kind: WelcomeKind;
  accessTier: AccessTier;
  titleEn: string;
  titleEs: string;
  subtitleEn: string;
  subtitleEs: string;
  bodyEn: string;
  bodyEs: string;
  sortOrder: number;
}

export interface ResourceRow {
  id: number;
  chapter_key: string | null;
  kind: WelcomeKind;
  access_tier: AccessTier;
  title_en: string;
  title_es: string;
  subtitle_en: string;
  subtitle_es: string;
  body_en: string;
  body_es: string;
  approved_en: number;
  approved_es: number;
  published: number;
  sort_order: number;
  document_storage: string | null;
  document_mime: string | null;
  document_bytes: number | null;
  document_sha256: string | null;
  updated_at: string;
}

const MAX_TITLE = 160;
const MAX_SUBTITLE = 240;
const MAX_BODY = 12000;

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function parseResourceInput(body: Record<string, unknown>): { ok: true; value: ResourceInput } | { ok: false; code: string } {
  const kind = body.kind;
  const tier = body.accessTier;
  if (!WELCOME_KINDS.includes(kind as WelcomeKind)) return { ok: false, code: 'invalid_kind' };
  if (!ACCESS_TIERS.includes(tier as AccessTier)) return { ok: false, code: 'invalid_tier' };
  const sort = Number(body.sortOrder ?? 0);
  return {
    ok: true,
    value: {
      kind: kind as WelcomeKind,
      accessTier: tier as AccessTier,
      titleEn: clean(body.titleEn, MAX_TITLE),
      titleEs: clean(body.titleEs, MAX_TITLE),
      subtitleEn: clean(body.subtitleEn, MAX_SUBTITLE),
      subtitleEs: clean(body.subtitleEs, MAX_SUBTITLE),
      bodyEn: clean(body.bodyEn, MAX_BODY),
      bodyEs: clean(body.bodyEs, MAX_BODY),
      sortOrder: Number.isFinite(sort) ? Math.max(0, Math.min(9999, Math.trunc(sort))) : 0,
    },
  };
}

export function createResource(db: Db, input: ResourceInput, chapterKey: string | null = null): number {
  const now = nowIso();
  const info = db
    .prepare(
      'INSERT INTO welcome_resource (chapter_key, kind, access_tier, title_en, title_es, subtitle_en, subtitle_es, body_en, body_es, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(chapterKey, input.kind, input.accessTier, input.titleEn, input.titleEs, input.subtitleEn, input.subtitleEs, input.bodyEn, input.bodyEs, input.sortOrder, now, now);
  const id = Number(info.lastInsertRowid);
  audit(db, 'resource_created', 'welcome_resource', String(id));
  return id;
}

/**
 * Updates text. Changing a language's title, subtitle, or body resets that language's approval,
 * because replacing approved content needs a new approval.
 */
export function updateResource(db: Db, id: number, input: ResourceInput): void {
  const current = getResource(db, id);
  if (!current) throw new Error('not_found');
  const enChanged = current.title_en !== input.titleEn || current.subtitle_en !== input.subtitleEn || current.body_en !== input.bodyEn;
  const esChanged = current.title_es !== input.titleEs || current.subtitle_es !== input.subtitleEs || current.body_es !== input.bodyEs;
  db.prepare(`
    UPDATE welcome_resource SET kind = ?, access_tier = ?, title_en = ?, title_es = ?, subtitle_en = ?, subtitle_es = ?,
      body_en = ?, body_es = ?, sort_order = ?,
      approved_en = CASE WHEN ? THEN 0 ELSE approved_en END,
      approved_es = CASE WHEN ? THEN 0 ELSE approved_es END,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.kind,
    input.accessTier,
    input.titleEn,
    input.titleEs,
    input.subtitleEn,
    input.subtitleEs,
    input.bodyEn,
    input.bodyEs,
    input.sortOrder,
    enChanged ? 1 : 0,
    esChanged ? 1 : 0,
    nowIso(),
    id,
  );
  audit(db, 'resource_updated', 'welcome_resource', String(id), { enChanged, esChanged });
}

export function getResource(db: Db, id: number): ResourceRow | undefined {
  return db.prepare('SELECT * FROM welcome_resource WHERE id = ?').get(id) as ResourceRow | undefined;
}

export function listResources(db: Db): ResourceRow[] {
  return db.prepare('SELECT * FROM welcome_resource ORDER BY sort_order, id').all() as unknown as ResourceRow[];
}

/** The owner approves each language separately. Approval is an explicit action. */
export function setApproval(db: Db, id: number, lang: Lang, approved: boolean): void {
  const column = lang === 'en' ? 'approved_en' : 'approved_es';
  db.prepare(`UPDATE welcome_resource SET ${column} = ?, updated_at = ? WHERE id = ?`).run(approved ? 1 : 0, nowIso(), id);
  audit(db, approved ? 'resource_approved' : 'resource_unapproved', 'welcome_resource', String(id), { lang });
}

export function setPublished(db: Db, id: number, published: boolean): void {
  db.prepare('UPDATE welcome_resource SET published = ?, updated_at = ? WHERE id = ?').run(published ? 1 : 0, nowIso(), id);
  audit(db, published ? 'resource_published' : 'resource_unpublished', 'welcome_resource', String(id));
}

/** Adds packet chapters that do not exist yet. Existing chapters are never overwritten. */
export function seedWelcomePacket(
  db: Db,
  packet: { chapters: Array<{ key: string; sortOrder: number; kind: WelcomeKind; accessTier: AccessTier; title: { en: string; es: string }; subtitle: { en: string; es: string }; body: { en: string; es: string } }> },
): number {
  let added = 0;
  for (const c of packet.chapters) {
    const exists = db.prepare('SELECT id FROM welcome_resource WHERE chapter_key = ?').get(c.key);
    if (exists) continue;
    createResource(
      db,
      {
        kind: c.kind,
        accessTier: c.accessTier,
        titleEn: c.title.en,
        titleEs: c.title.es,
        subtitleEn: c.subtitle.en,
        subtitleEs: c.subtitle.es,
        bodyEn: c.body.en,
        bodyEs: c.body.es,
        sortOrder: c.sortOrder,
      },
      c.key,
    );
    added += 1;
  }
  return added;
}

/**
 * Stores a PDF for a resource. Files go to the private directory and are served only through
 * the public document route when the resource is published, public, and approved in that language.
 */
export async function attachDocument(db: Db, cfg: Config, id: number, buffer: Buffer): Promise<void> {
  if (!getResource(db, id)) throw new Error('not_found');
  if (buffer.length === 0) throw new Error('empty_file');
  if (buffer.length > cfg.maxDocumentBytes) throw new Error('file_too_large');
  const type = detectFileType(buffer);
  if (type !== 'application/pdf') throw new Error('unsupported_file');
  await mkdir(join(cfg.privateDir, 'documents'), { recursive: true });
  const storage = `documents/${randomToken(18)}.pdf`;
  await writeFile(join(cfg.privateDir, storage), buffer, { mode: 0o600, flag: 'wx' });
  const previous = getResource(db, id)?.document_storage;
  db.prepare('UPDATE welcome_resource SET document_storage = ?, document_mime = ?, document_bytes = ?, document_sha256 = ?, updated_at = ? WHERE id = ?').run(
    storage,
    'application/pdf',
    buffer.length,
    sha256Hex(buffer),
    nowIso(),
    id,
  );
  if (previous) await unlink(join(cfg.privateDir, previous)).catch(() => undefined);
  audit(db, 'document_uploaded', 'welcome_resource', String(id), { bytes: buffer.length });
}

export interface PublicResource {
  id: number;
  key: string | null;
  kind: WelcomeKind;
  title: string;
  subtitle: string;
  body: string;
  documentUrl: string | null;
}

/**
 * Public list. Only items that are published, public, and approved in this language are returned.
 * Drafts, unpublished items, and other access tiers never leave the server.
 */
export function publicResources(db: Db, lang: Lang): PublicResource[] {
  const approved = lang === 'en' ? 'approved_en' : 'approved_es';
  const rows = db
    .prepare(`SELECT * FROM welcome_resource WHERE published = 1 AND access_tier = 'public' AND ${approved} = 1 ORDER BY sort_order, id`)
    .all() as unknown as ResourceRow[];
  return rows.map((row) => ({
    id: row.id,
    key: row.chapter_key,
    kind: row.kind,
    title: lang === 'en' ? row.title_en : row.title_es,
    subtitle: lang === 'en' ? row.subtitle_en : row.subtitle_es,
    body: lang === 'en' ? row.body_en : row.body_es,
    documentUrl: row.document_storage ? `/api/welcome/documents/${row.id}?lang=${lang}` : null,
  }));
}

/** Returns the stored PDF path only when the resource is publicly visible in this language. */
export function publicDocumentPath(db: Db, cfg: Config, id: number, lang: Lang): string | null {
  const approved = lang === 'en' ? 'approved_en' : 'approved_es';
  const row = db
    .prepare(`SELECT document_storage FROM welcome_resource WHERE id = ? AND published = 1 AND access_tier = 'public' AND ${approved} = 1`)
    .get(id) as { document_storage: string | null } | undefined;
  if (!row?.document_storage) return null;
  return join(cfg.privateDir, row.document_storage);
}
