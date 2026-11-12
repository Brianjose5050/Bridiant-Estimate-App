import { buildPublishPlan, validatePair, type GalleryItem, type GalleryPair, type PublishUnit } from '@bridiant/gallery';
import type { Config } from './config.js';
import type { Db, Stmt } from './db.js';
import { audit, auditStmt, nowIso } from './db.js';
import type { FileStore } from './files.js';
import { stripMetadata } from './metadata.js';
import { detectFileType, extensionFor, randomToken, sha256Hex, type DetectedType } from './security.js';

/**
 * Gallery: owner-supplied photos stay private until the owner approves, classifies, and publishes them.
 * Publishing decisions use the shared rules in packages/gallery. The public never sees a photo that the
 * plan does not include.
 */
export const PHOTO_KINDS = ['unclassified', 'before', 'after', 'regular'] as const;
export const PHOTO_TYPES: DetectedType[] = ['image/jpeg', 'image/png', 'image/webp'];
export const SERVICE_IDS = ['standard-cleaning', 'deep-cleaning', 'move-in-cleaning', 'move-out-cleaning'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

export interface PhotoRow {
  id: number;
  display_name: string;
  mime: string;
  bytes: number;
  storage_name: string;
  kind: PhotoKind;
  project_id: number | null;
  service_id: string | null;
  review_status: 'pending' | 'approved' | 'rejected';
  ownership_confirmed: number;
  people_status: 'none_visible' | 'permission_on_file' | 'unknown';
  caption_en: string;
  caption_es: string;
  alt_en: string;
  alt_es: string;
  approved_caption_en: number;
  approved_caption_es: number;
  approved_alt_en: number;
  approved_alt_es: number;
  visible: number;
  deleted_at: string | null;
  sort_order: number;
}

export interface ProjectRow {
  id: number;
  title_en: string;
  title_es: string;
  service_id: string | null;
  approved_en: number;
  approved_es: number;
  visible: number;
  sort_order: number;
}

export interface PairRow {
  id: number;
  before_id: number;
  after_id: number;
  project_id: number;
}

export const listPhotos = (db: Db) => db.all<PhotoRow>('SELECT * FROM gallery_photo WHERE deleted_at IS NULL ORDER BY sort_order, id');
export const getPhoto = (db: Db, id: number) => db.first<PhotoRow>('SELECT * FROM gallery_photo WHERE id = ?', [id]);
export const listProjects = (db: Db) => db.all<ProjectRow>('SELECT * FROM gallery_project ORDER BY sort_order, id');
export const listPairs = (db: Db) => db.all<PairRow>('SELECT id, before_id, after_id, project_id FROM gallery_pair ORDER BY sort_order, id');

/** Maps a stored photo to the rule model used by packages/gallery. */
function toItem(p: PhotoRow): GalleryItem {
  return {
    id: String(p.id),
    projectId: p.project_id === null ? null : String(p.project_id),
    serviceId: p.service_id,
    // An unclassified photo can never be approved (see updatePhoto), so its kind here is only a placeholder.
    kind: p.kind === 'before' ? 'before' : p.kind === 'after' ? 'after' : 'regular',
    reviewStatus: p.review_status,
    ownershipConfirmed: p.ownership_confirmed === 1 && p.kind !== 'unclassified',
    peopleStatus: p.people_status,
    caption: { en: p.caption_en, es: p.caption_es },
    captionApproved: { en: p.approved_caption_en === 1, es: p.approved_caption_es === 1 },
    alt: { en: p.alt_en, es: p.alt_es },
    altApproved: { en: p.approved_alt_en === 1, es: p.approved_alt_es === 1 },
    visible: p.visible === 1,
    deleted: p.deleted_at !== null,
    sortOrder: p.sort_order,
  };
}

export interface PublishState {
  plan: PublishUnit[];
  publishable: Set<number>;
}

/**
 * The single publish decision. Pairs publish as units. Single photos publish only when classified as regular.
 * An unpaired Before or After photo is never shown on its own.
 */
export async function publishState(db: Db): Promise<PublishState> {
  const photos = await listPhotos(db);
  const items = photos.map(toItem);
  const pairs: GalleryPair[] = (await listPairs(db)).map((p) => ({ id: String(p.id), beforeId: String(p.before_id), afterId: String(p.after_id) }));
  const plan = buildPublishPlan(items, pairs).filter((unit) => unit.type === 'pair' || unit.item.kind === 'regular');
  const publishable = new Set<number>();
  for (const unit of plan) {
    if (unit.type === 'pair') {
      publishable.add(Number(unit.before.id));
      publishable.add(Number(unit.after.id));
    } else {
      publishable.add(Number(unit.item.id));
    }
  }
  return { plan, publishable };
}

export interface PublicGalleryItem {
  type: 'single' | 'pair';
  id: string;
  projectTitle: string | null;
  serviceId: string | null;
  photos: Array<{ id: number; src: string; alt: string; caption: string }>;
}

export async function publicGallery(db: Db, lang: 'en' | 'es'): Promise<PublicGalleryItem[]> {
  const { plan } = await publishState(db);
  const projects = new Map((await listProjects(db)).map((p) => [p.id, p]));
  const photos = new Map((await listPhotos(db)).map((p) => [p.id, p]));
  const photoOf = (item: GalleryItem) => {
    const row = photos.get(Number(item.id));
    return {
      id: Number(item.id),
      src: `/api/gallery/media/${item.id}`,
      alt: lang === 'en' ? row?.alt_en ?? '' : row?.alt_es ?? '',
      caption: lang === 'en' ? row?.caption_en ?? '' : row?.caption_es ?? '',
    };
  };
  return plan.map((unit) => {
    const projectId = unit.type === 'pair' ? Number(unit.before.projectId) : Number(unit.item.projectId);
    const project = Number.isFinite(projectId) ? projects.get(projectId) : undefined;
    const projectOk = project && project.visible === 1 && (lang === 'en' ? project.approved_en === 1 : project.approved_es === 1);
    const projectTitle = projectOk && project ? (lang === 'en' ? project.title_en : project.title_es) : null;
    if (unit.type === 'pair') {
      return { type: 'pair' as const, id: `pair-${unit.pairId}`, projectTitle, serviceId: unit.before.serviceId, photos: [photoOf(unit.before), photoOf(unit.after)] };
    }
    return { type: 'single' as const, id: `photo-${unit.item.id}`, projectTitle, serviceId: unit.item.serviceId, photos: [photoOf(unit.item)] };
  });
}

/** The stored file key and type, only if the photo is in the publish plan. */
export async function publicMediaKey(db: Db, id: number): Promise<{ key: string; mime: string } | null> {
  if (!(await publishState(db)).publishable.has(id)) return null;
  const row = await getPhoto(db, id);
  if (!row) return null;
  return { key: row.storage_name, mime: row.mime };
}

/** Saves uploaded photos as private, unclassified, unapproved items. Metadata is removed before storage. */
export async function uploadPhotos(db: Db, files: FileStore, files_: Array<{ displayName: string; buffer: Uint8Array<ArrayBuffer> }>): Promise<number> {
  // Check and clean every file before anything is stored: one bad file leaves nothing behind.
  const prepared = files_.map((file) => {
    const type = detectFileType(file.buffer);
    if (!type || !PHOTO_TYPES.includes(type)) throw new Error('unsupported_file');
    if (file.buffer.length === 0) throw new Error('empty_file');
    return { displayName: file.displayName, type, clean: stripMetadata(file.buffer, type) };
  });
  if (prepared.length === 0) return 0;

  const max = (await db.first<{ m: number }>('SELECT COALESCE(MAX(sort_order), 0) AS m FROM gallery_photo'))?.m ?? 0;
  const now = nowIso();
  const written: string[] = [];
  try {
    const statements: Stmt[] = [];
    for (const [index, item] of prepared.entries()) {
      const key = `gallery/${randomToken(18)}.${extensionFor(item.type)}`;
      await files.put(key, item.clean, item.type);
      written.push(key);
      statements.push({
        sql: 'INSERT INTO gallery_photo (display_name, mime, bytes, sha256, storage_name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        params: [item.displayName, item.type, item.clean.length, await sha256Hex(item.clean), key, max + index + 1, now, now],
      });
    }
    statements.push(auditStmt('gallery_uploaded', 'gallery_photo', null, { count: prepared.length }));
    await db.batch(statements);
  } catch (error) {
    // The rows were not saved, so the files written so far are removed.
    for (const key of written) await files.delete(key).catch(() => undefined);
    throw error;
  }
  return prepared.length;
}

export interface PhotoInput {
  kind: PhotoKind;
  projectId: number | null;
  serviceId: string | null;
  ownershipConfirmed: boolean;
  peopleStatus: 'none_visible' | 'permission_on_file' | 'unknown';
  captionEn: string;
  captionEs: string;
  altEn: string;
  altEs: string;
  visible: boolean;
  approveCaptionEn: boolean;
  approveCaptionEs: boolean;
  approveAltEn: boolean;
  approveAltEs: boolean;
  reviewStatus: 'pending' | 'approved' | 'rejected';
}

/**
 * Updates a photo. Rules:
 * - An unclassified photo cannot be approved.
 * - Approved text that changes loses its approval (the owner approves the new text in a later save).
 * - Changing kind, project, or service breaks any pair the photo belongs to.
 */
export async function updatePhoto(db: Db, id: number, input: PhotoInput): Promise<{ ok: true } | { ok: false; code: string }> {
  const current = await getPhoto(db, id);
  if (!current) return { ok: false, code: 'not_found' };
  if (input.kind === 'unclassified' && input.reviewStatus === 'approved') return { ok: false, code: 'classify_before_approval' };
  if (input.kind !== 'unclassified' && input.kind !== 'regular' && input.projectId === null) return { ok: false, code: 'project_required' };

  const keeps = (wasApproved: number, before: string, after: string) => wasApproved === 0 || before === after;
  const approvals = {
    captionEn: input.approveCaptionEn && keeps(current.approved_caption_en, current.caption_en, input.captionEn),
    captionEs: input.approveCaptionEs && keeps(current.approved_caption_es, current.caption_es, input.captionEs),
    altEn: input.approveAltEn && keeps(current.approved_alt_en, current.alt_en, input.altEn),
    altEs: input.approveAltEs && keeps(current.approved_alt_es, current.alt_es, input.altEs),
  };
  if (input.reviewStatus === 'approved' && (!input.ownershipConfirmed || !approvals.captionEn || !approvals.captionEs || !approvals.altEn || !approvals.altEs)) {
    return { ok: false, code: 'approval_incomplete' };
  }
  const structural = current.kind !== input.kind || current.project_id !== input.projectId || current.service_id !== input.serviceId;

  const statements: Stmt[] = [];
  if (structural) statements.push({ sql: 'DELETE FROM gallery_pair WHERE before_id = ? OR after_id = ?', params: [id, id] });
  statements.push({
    sql: `UPDATE gallery_photo SET kind = ?, project_id = ?, service_id = ?, review_status = ?, ownership_confirmed = ?, people_status = ?,
            caption_en = ?, caption_es = ?, alt_en = ?, alt_es = ?,
            approved_caption_en = ?, approved_caption_es = ?, approved_alt_en = ?, approved_alt_es = ?,
            visible = ?, updated_at = ? WHERE id = ?`,
    params: [
      input.kind, input.projectId, input.serviceId, input.reviewStatus, input.ownershipConfirmed ? 1 : 0, input.peopleStatus,
      input.captionEn, input.captionEs, input.altEn, input.altEs,
      approvals.captionEn ? 1 : 0, approvals.captionEs ? 1 : 0, approvals.altEn ? 1 : 0, approvals.altEs ? 1 : 0,
      input.visible ? 1 : 0, nowIso(), id,
    ],
  });
  statements.push(auditStmt('gallery_photo_updated', 'gallery_photo', String(id), { kind: input.kind, review: input.reviewStatus, structural }));
  await db.batch(statements);
  return { ok: true };
}

export async function softDeletePhoto(db: Db, id: number): Promise<boolean> {
  if (!(await getPhoto(db, id))) return false;
  const now = nowIso();
  await db.batch([
    { sql: 'DELETE FROM gallery_pair WHERE before_id = ? OR after_id = ?', params: [id, id] },
    { sql: "UPDATE gallery_photo SET deleted_at = ?, review_status = 'rejected', updated_at = ? WHERE id = ?", params: [now, now, id] },
    auditStmt('gallery_photo_deleted', 'gallery_photo', String(id)),
  ]);
  return true;
}

export async function movePhoto(db: Db, id: number, direction: -1 | 1): Promise<void> {
  const ordered = await listPhotos(db);
  const index = ordered.findIndex((p) => p.id === id);
  const target = ordered[index + direction];
  const a = ordered[index];
  if (index === -1 || !target || !a) return;
  await db.batch([
    { sql: 'UPDATE gallery_photo SET sort_order = ? WHERE id = ?', params: [target.sort_order, a.id] },
    { sql: 'UPDATE gallery_photo SET sort_order = ? WHERE id = ?', params: [a.sort_order, target.id] },
  ]);
}

/** Creates a pair only when the shared rules allow it. */
export async function createPair(db: Db, beforeId: number, afterId: number): Promise<{ ok: true } | { ok: false; code: string }> {
  const before = await getPhoto(db, beforeId);
  const after = await getPhoto(db, afterId);
  if (!before || !after || before.deleted_at || after.deleted_at) return { ok: false, code: 'not_found' };
  const existing = (await listPairs(db)).map((p) => ({ id: String(p.id), beforeId: String(p.before_id), afterId: String(p.after_id) }));
  const problems = validatePair(toItem(before), toItem(after), existing);
  if (problems.length > 0) return { ok: false, code: problems[0] ?? 'invalid_pair' };
  await db.batch([
    {
      sql: 'INSERT INTO gallery_pair (before_id, after_id, project_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [beforeId, afterId, before.project_id ?? 0, Math.min(before.sort_order, after.sort_order), nowIso()],
    },
  ]);
  await audit(db, 'gallery_pair_created', 'gallery_pair', `${beforeId}-${afterId}`);
  return { ok: true };
}

export async function deletePair(db: Db, id: number): Promise<void> {
  await db.batch([{ sql: 'DELETE FROM gallery_pair WHERE id = ?', params: [id] }, auditStmt('gallery_pair_deleted', 'gallery_pair', String(id))]);
}

/** Saves a project. A changed title loses its approval. */
export async function saveProject(db: Db, id: number | null, input: { titleEn: string; titleEs: string; serviceId: string | null; visible: boolean; approveEn: boolean; approveEs: boolean }): Promise<number> {
  const now = nowIso();
  const titleEn = input.titleEn.slice(0, 120);
  const titleEs = input.titleEs.slice(0, 120);
  if (id === null) {
    const info = await db.run(
      'INSERT INTO gallery_project (title_en, title_es, service_id, approved_en, approved_es, visible, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
      [titleEn, titleEs, input.serviceId, input.visible ? 1 : 0, now, now],
    );
    await audit(db, 'gallery_project_created', 'gallery_project', String(info.lastRowId));
    return info.lastRowId;
  }
  const current = await db.first<{ title_en: string; title_es: string; approved_en: number; approved_es: number }>(
    'SELECT title_en, title_es, approved_en, approved_es FROM gallery_project WHERE id = ?',
    [id],
  );
  if (!current) throw new Error('not_found');
  const keepEn = current.approved_en === 0 || current.title_en === titleEn;
  const keepEs = current.approved_es === 0 || current.title_es === titleEs;
  await db.batch([
    {
      sql: 'UPDATE gallery_project SET title_en = ?, title_es = ?, service_id = ?, visible = ?, approved_en = ?, approved_es = ?, updated_at = ? WHERE id = ?',
      params: [titleEn, titleEs, input.serviceId, input.visible ? 1 : 0, input.approveEn && keepEn ? 1 : 0, input.approveEs && keepEs ? 1 : 0, now, id],
    },
    auditStmt('gallery_project_updated', 'gallery_project', String(id)),
  ]);
  return id;
}
