import { join } from 'node:path';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { audit } from '../db.js';
import { parseMultipart, UploadError } from '../estimates.js';
import { createPair, deletePair, getPhoto, listPairs, listPhotos, listProjects, movePhoto, publishState, saveProject, softDeletePhoto, updatePhoto, uploadPhotos, PHOTO_KINDS, SERVICE_IDS, type PhotoKind } from '../gallery.js';
import { esc, layout } from './view.js';
import type { AdminLang } from './i18n.js';

/** Owner gallery screens. Every change requires the session CSRF token. Labels are working labels for the owner. */

export interface GalleryCtx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, string>;
  cfg: Config;
  db: Db;
  req: never;
}

export interface GalleryBase {
  lang: AdminLang;
  csrf: string;
  path: string;
  username: string;
}

export interface GalleryResult {
  status: number;
  html?: string;
  headers?: Record<string, string>;
  file?: { path: string; mime: string; name: string; inline: boolean };
}

const L = (lang: AdminLang, en: string, es: string) => (lang === 'es' ? es : en);
const KIND_LABEL: Record<PhotoKind, { en: string; es: string }> = {
  unclassified: { en: 'Unclassified', es: 'Sin clasificar' },
  before: { en: 'Before', es: 'Antes' },
  after: { en: 'After', es: 'Después' },
  regular: { en: 'Regular', es: 'Regular' },
};

function redirect(location: string): GalleryResult {
  return { status: 303, headers: { Location: location } };
}

function page(base: GalleryBase, title: string, body: string, flash: string | null, error = false): GalleryResult {
  const html = layout({
    lang: base.lang,
    title,
    csrf: base.csrf,
    signedIn: true,
    activeNav: 'gallery',
    path: base.path,
    flash: flash ? { kind: error ? 'error' : 'ok', text: flash } : null,
    body,
  });
  return { status: 200, html };
}

function selectOpts(options: Array<{ value: string; label: string }>, selected: string | null): string {
  return options.map((o) => `<option value="${esc(o.value)}"${o.value === (selected ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
}

const SERVICE_NAMES: Record<string, { en: string; es: string }> = {
  'standard-cleaning': { en: 'Standard Cleaning', es: 'Limpieza estándar' },
  'deep-cleaning': { en: 'Deep Cleaning', es: 'Limpieza profunda' },
  'move-in-cleaning': { en: 'Move-In Cleaning', es: 'Limpieza de entrada' },
  'move-out-cleaning': { en: 'Move-Out Cleaning', es: 'Limpieza de salida' },
};

function serviceOptions(lang: AdminLang, selected: string | null): string {
  return selectOpts([{ value: '', label: L(lang, 'None', 'Ninguno') }, ...SERVICE_IDS.map((s) => ({ value: s, label: SERVICE_NAMES[s]?.[lang] ?? s }))], selected);
}

function projectOptions(db: Db, lang: AdminLang, selected: number | null): string {
  const projects = listProjects(db);
  return selectOpts(
    [{ value: '', label: L(lang, 'No project', 'Sin proyecto') }, ...projects.map((p) => ({ value: String(p.id), label: (lang === 'es' ? p.title_es : p.title_en) || `#${p.id}` }))],
    selected === null ? null : String(selected),
  );
}

export function handleGallery(ctx: GalleryCtx, base: GalleryBase): Promise<GalleryResult> | GalleryResult | null {
  const { method, path, db, cfg } = ctx;
  const { lang, csrf } = base;
  const csrfOk = (token: string | undefined) => typeof token === 'string' && token === csrf;
  const forbidden = () => ({ status: 403, html: layout({ lang, title: 'Forbidden', csrf, signedIn: true, path, body: `<p>${L(lang, 'This action could not be verified. Reload the page and try again.', 'No se pudo verificar la acción. Recargue la página e intente de nuevo.')}</p>` }) });

  // ----- Upload (multipart) -----
  if (method === 'POST' && path === '/admin/gallery/upload') {
    return (async (): Promise<GalleryResult> => {
      const parsed = await parseMultipart(ctx.req as never, cfg).catch((e: unknown) => (e instanceof UploadError ? e : null));
      if (!parsed || parsed instanceof UploadError) return redirect('/admin/gallery?err=' + encodeURIComponent('upload_failed'));
      if (!csrfOk(parsed.fields.csrf)) return forbidden();
      if (parsed.files.length === 0) return redirect('/admin/gallery?err=' + encodeURIComponent('no_files'));
      try {
        const added = await uploadPhotos(db, cfg, parsed.files);
        return redirect(`/admin/gallery?ok=${added}`);
      } catch (error) {
        return redirect('/admin/gallery?err=' + encodeURIComponent(error instanceof Error ? error.message : 'upload_failed'));
      }
    })();
  }

  // ----- Projects -----
  if (method === 'POST' && path === '/admin/gallery/projects') {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    saveProject(db, null, {
      titleEn: (ctx.body.titleEn ?? '').trim(),
      titleEs: (ctx.body.titleEs ?? '').trim(),
      serviceId: (SERVICE_IDS as readonly string[]).includes(ctx.body.serviceId ?? '') ? ctx.body.serviceId! : null,
      visible: false,
      approveEn: false,
      approveEs: false,
    });
    return redirect('/admin/gallery?ok=saved');
  }
  const project = /^\/admin\/gallery\/projects\/(\d+)$/.exec(path);
  if (method === 'POST' && project) {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    saveProject(db, Number(project[1]), {
      titleEn: (ctx.body.titleEn ?? '').trim(),
      titleEs: (ctx.body.titleEs ?? '').trim(),
      serviceId: (SERVICE_IDS as readonly string[]).includes(ctx.body.serviceId ?? '') ? ctx.body.serviceId! : null,
      visible: ctx.body.visible === '1',
      approveEn: ctx.body.approveEn === '1' && (ctx.body.titleEn ?? '').trim() !== '',
      approveEs: ctx.body.approveEs === '1' && (ctx.body.titleEs ?? '').trim() !== '',
    });
    return redirect('/admin/gallery?ok=saved');
  }

  // ----- Pairs -----
  if (method === 'POST' && path === '/admin/gallery/pairs') {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    const result = createPair(db, Number(ctx.body.before), Number(ctx.body.after));
    return redirect(result.ok ? '/admin/gallery?ok=saved' : '/admin/gallery?err=' + encodeURIComponent(result.code));
  }
  const pairDelete = /^\/admin\/gallery\/pairs\/(\d+)\/delete$/.exec(path);
  if (method === 'POST' && pairDelete) {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    deletePair(db, Number(pairDelete[1]));
    return redirect('/admin/gallery?ok=saved');
  }

  // ----- Photos -----
  const file = /^\/admin\/gallery\/photos\/(\d+)\/file$/.exec(path);
  if (method === 'GET' && file) {
    const row = getPhoto(db, Number(file[1]));
    if (!row) return { status: 404, html: 'Not found' };
    audit(db, 'gallery_photo_viewed', 'gallery_photo', file[1] ?? null);
    return { status: 200, file: { path: join(cfg.privateDir, 'gallery', row.storage_name), mime: row.mime, name: row.display_name, inline: true } };
  }

  const move = /^\/admin\/gallery\/photos\/(\d+)\/move$/.exec(path);
  if (method === 'POST' && move) {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    movePhoto(db, Number(move[1]), ctx.body.direction === 'up' ? -1 : 1);
    return redirect('/admin/gallery?ok=saved');
  }

  const del = /^\/admin\/gallery\/photos\/(\d+)\/delete$/.exec(path);
  if (method === 'POST' && del) {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    softDeletePhoto(db, Number(del[1]));
    return redirect('/admin/gallery?ok=saved');
  }

  const edit = /^\/admin\/gallery\/photos\/(\d+)$/.exec(path);
  if (method === 'POST' && edit) {
    if (!csrfOk(ctx.body.csrf)) return forbidden();
    const id = Number(edit[1]);
    const b = ctx.body;
    const kind = (PHOTO_KINDS as readonly string[]).includes(b.kind ?? '') ? (b.kind as PhotoKind) : 'unclassified';
    const result = updatePhoto(db, id, {
      kind,
      projectId: b.projectId ? Number(b.projectId) : null,
      serviceId: (SERVICE_IDS as readonly string[]).includes(b.serviceId ?? '') ? b.serviceId! : null,
      ownershipConfirmed: b.ownershipConfirmed === '1',
      peopleStatus: b.peopleStatus === 'none_visible' || b.peopleStatus === 'permission_on_file' ? b.peopleStatus : 'unknown',
      captionEn: (b.captionEn ?? '').trim().slice(0, 240),
      captionEs: (b.captionEs ?? '').trim().slice(0, 240),
      altEn: (b.altEn ?? '').trim().slice(0, 240),
      altEs: (b.altEs ?? '').trim().slice(0, 240),
      visible: b.visible === '1',
      approveCaptionEn: b.approveCaptionEn === '1',
      approveCaptionEs: b.approveCaptionEs === '1',
      approveAltEn: b.approveAltEn === '1',
      approveAltEs: b.approveAltEs === '1',
      reviewStatus: b.reviewStatus === 'approved' || b.reviewStatus === 'rejected' ? b.reviewStatus : 'pending',
    });
    if (!result.ok) return redirect(`/admin/gallery/photos/${id}?err=${encodeURIComponent(result.code)}`);
    return redirect(`/admin/gallery/photos/${id}?ok=saved`);
  }

  if (method === 'GET' && edit) {
    const row = getPhoto(db, Number(edit[1]));
    if (!row) return page(base, 'Not found', `<p>${L(lang, 'Not found.', 'No encontrado.')}</p>`, null);
    const state = publishState(db);
    const published = state.publishable.has(row.id);
    const candidates = listPhotos(db).filter((p) => p.id !== row.id && p.project_id === row.project_id);
    const body = `
    <a class="back" href="/admin/gallery">← ${L(lang, 'Gallery', 'Galería')}</a>
    <section class="card hero-card">
      <h1>${esc(row.display_name)}</h1>
      <p><span class="pill ${published ? 'pill--new' : ''}">${published ? L(lang, 'Published', 'Publicada') : L(lang, 'Not published', 'No publicada')}</span></p>
      <img src="/admin/gallery/photos/${row.id}/file" alt="" style="width:100%;border-radius:12px;max-height:60vh;object-fit:contain;background:#F1F3F5">
    </section>
    <form method="post" action="/admin/gallery/photos/${row.id}" class="card stack">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label class="field"><span>${L(lang, 'Classification', 'Clasificación')}</span><select name="kind">${selectOpts(PHOTO_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k][lang] })), row.kind)}</select></label>
      <label class="field"><span>${L(lang, 'Project', 'Proyecto')}</span><select name="projectId">${projectOptions(db, lang, row.project_id)}</select></label>
      <label class="field"><span>${L(lang, 'Service', 'Servicio')}</span><select name="serviceId">${serviceOptions(lang, row.service_id)}</select></label>
      <label class="check"><input type="checkbox" name="ownershipConfirmed" value="1"${row.ownership_confirmed ? ' checked' : ''}><span>${L(lang, 'I confirm the company took this photo or has permission to use it.', 'Confirmo que la empresa tomó esta foto o tiene permiso para usarla.')}</span></label>
      <label class="field"><span>${L(lang, 'People in the photo', 'Personas en la foto')}</span><select name="peopleStatus">${selectOpts([
        { value: 'unknown', label: L(lang, 'Not yet checked', 'Sin revisar') },
        { value: 'none_visible', label: L(lang, 'No identifiable people', 'Sin personas identificables') },
        { value: 'permission_on_file', label: L(lang, 'Identifiable people, written permission on file', 'Personas identificables, permiso escrito archivado') },
      ], row.people_status)}</select></label>
      <label class="field"><span>${L(lang, 'Caption (English)', 'Leyenda (inglés)')}</span><input name="captionEn" value="${esc(row.caption_en)}" maxlength="240"></label>
      <label class="field"><span>${L(lang, 'Caption (Spanish)', 'Leyenda (español)')}</span><input name="captionEs" value="${esc(row.caption_es)}" maxlength="240"></label>
      <label class="field"><span>${L(lang, 'Alt text (English)', 'Texto alternativo (inglés)')}</span><input name="altEn" value="${esc(row.alt_en)}" maxlength="240"></label>
      <label class="field"><span>${L(lang, 'Alt text (Spanish)', 'Texto alternativo (español)')}</span><input name="altEs" value="${esc(row.alt_es)}" maxlength="240"></label>
      <p class="muted small">${L(lang, 'Changing a caption or alt text removes its approval. Approve again after review.', 'Si cambia una leyenda o un texto alternativo, pierde su aprobación. Apruébelo de nuevo tras revisarlo.')}</p>
      <label class="check"><input type="checkbox" name="approveCaptionEn" value="1"${row.approved_caption_en ? ' checked' : ''}><span>${L(lang, 'Caption approved (English)', 'Leyenda aprobada (inglés)')}</span></label>
      <label class="check"><input type="checkbox" name="approveCaptionEs" value="1"${row.approved_caption_es ? ' checked' : ''}><span>${L(lang, 'Caption approved (Spanish)', 'Leyenda aprobada (español)')}</span></label>
      <label class="check"><input type="checkbox" name="approveAltEn" value="1"${row.approved_alt_en ? ' checked' : ''}><span>${L(lang, 'Alt text approved (English)', 'Texto alternativo aprobado (inglés)')}</span></label>
      <label class="check"><input type="checkbox" name="approveAltEs" value="1"${row.approved_alt_es ? ' checked' : ''}><span>${L(lang, 'Alt text approved (Spanish)', 'Texto alternativo aprobado (español)')}</span></label>
      <label class="field"><span>${L(lang, 'Review', 'Revisión')}</span><select name="reviewStatus">${selectOpts([
        { value: 'pending', label: L(lang, 'Pending', 'Pendiente') },
        { value: 'approved', label: L(lang, 'Approved', 'Aprobada') },
        { value: 'rejected', label: L(lang, 'Rejected', 'Rechazada') },
      ], row.review_status)}</select></label>
      <label class="check"><input type="checkbox" name="visible" value="1"${row.visible ? ' checked' : ''}><span>${L(lang, 'Visible on the site when published', 'Visible en el sitio cuando esté publicada')}</span></label>
      <button class="btn btn--primary" type="submit">${L(lang, 'Save', 'Guardar')}</button>
    </form>
    ${row.kind === 'before' || row.kind === 'after' ? '' : ''}
    <form method="post" action="/admin/gallery/photos/${row.id}/delete" class="card">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <p class="muted small">${L(lang, 'Removing a photo hides it everywhere and breaks any pair. The file is kept privately for the record.', 'Quitar una foto la oculta en todas partes y deshace cualquier par. El archivo se conserva en privado.')}</p>
      <button class="btn btn--ghost" type="submit">${L(lang, 'Remove photo', 'Quitar foto')}</button>
    </form>
    ${candidates.length > 0 ? `<p class="muted small">${L(lang, 'Pairs are created from the gallery list.', 'Los pares se crean desde la lista de la galería.')}</p>` : ''}`;
    return page(base, row.display_name, body, ctx.query.get('ok') ? L(lang, 'Saved.', 'Guardado.') : ctx.query.get('err') ? `${L(lang, 'Not saved:', 'No guardado:')} ${ctx.query.get('err')}` : null, !!ctx.query.get('err'));
  }

  // ----- Gallery overview -----
  if (method === 'GET' && path === '/admin/gallery') {
    const photos = listPhotos(db);
    const pairs = listPairs(db);
    const state = publishState(db);
    const pairedIds = new Set(pairs.flatMap((p) => [p.before_id, p.after_id]));
    const unpairedBefore = photos.filter((p) => p.kind === 'before' && !pairedIds.has(p.id));
    const unpairedAfter = photos.filter((p) => p.kind === 'after' && !pairedIds.has(p.id));
    const flash = ctx.query.get('ok') ? (ctx.query.get('ok') === 'saved' ? L(lang, 'Saved.', 'Guardado.') : `${ctx.query.get('ok')} ${L(lang, 'photo(s) uploaded. They stay private until you approve them.', 'foto(s) subidas. Permanecen privadas hasta que las apruebe.')}`) : ctx.query.get('err') ? `${L(lang, 'Not saved:', 'No guardado:')} ${ctx.query.get('err')}` : null;
    const body = `
    <section class="card stack">
      <h1>${L(lang, 'Gallery', 'Galería')}</h1>
      <p class="muted">${L(lang, 'Photos stay private until you classify, approve, and publish them. Public visitors only see what is published here.', 'Las fotos permanecen privadas hasta que las clasifique, apruebe y publique. Los visitantes solo ven lo publicado aquí.')}</p>
      <p class="small">${L(lang, 'Published now', 'Publicadas ahora')}: <strong>${state.publishable.size}</strong> · ${L(lang, 'Total photos', 'Fotos totales')}: <strong>${photos.length}</strong></p>
    </section>
    <form method="post" action="/admin/gallery/upload" enctype="multipart/form-data" class="card stack">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label class="field"><span>${L(lang, 'Upload photos', 'Subir fotos')}</span><input type="file" name="photos" accept="image/jpeg,image/png,image/webp,image/heic" multiple required></label>
      <p class="muted small">${L(lang, 'JPEG, PNG, WebP, or HEIC. Up to 15 MB each. No limit on the number of photos.', 'JPEG, PNG, WebP o HEIC. Hasta 15 MB cada una. Sin límite de número de fotos.')}</p>
      <button class="btn btn--primary" type="submit">${L(lang, 'Upload', 'Subir')}</button>
    </form>
    <section class="card stack">
      <h2>${L(lang, 'Projects', 'Proyectos')}</h2>
      <ul class="list">${listProjects(db).map((p) => `<li class="item"><a class="item__link" href="#project-${p.id}"><strong>${esc(p.title_en || '—')}</strong> · ${esc(p.title_es || '—')} <span class="item__meta">${p.visible && p.approved_en && p.approved_es ? L(lang, 'Visible', 'Visible') : L(lang, 'Hidden until approved', 'Oculto hasta aprobarse')}</span></a>
        <form method="post" action="/admin/gallery/projects/${p.id}" class="stack" id="project-${p.id}" style="padding:0 18px 16px">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <input name="titleEn" value="${esc(p.title_en)}" maxlength="120" placeholder="Title (EN)">
          <input name="titleEs" value="${esc(p.title_es)}" maxlength="120" placeholder="Título (ES)">
          <select name="serviceId">${serviceOptions(lang, p.service_id)}</select>
          <label class="check"><input type="checkbox" name="approveEn" value="1"${p.approved_en ? ' checked' : ''}><span>${L(lang, 'Title approved (EN)', 'Título aprobado (EN)')}</span></label>
          <label class="check"><input type="checkbox" name="approveEs" value="1"${p.approved_es ? ' checked' : ''}><span>${L(lang, 'Title approved (ES)', 'Título aprobado (ES)')}</span></label>
          <label class="check"><input type="checkbox" name="visible" value="1"${p.visible ? ' checked' : ''}><span>${L(lang, 'Visible', 'Visible')}</span></label>
          <button class="btn btn--ghost" type="submit">${L(lang, 'Save project', 'Guardar proyecto')}</button>
        </form></li>`).join('') || `<li class="muted">${L(lang, 'No projects yet.', 'Aún no hay proyectos.')}</li>`}</ul>
      <form method="post" action="/admin/gallery/projects" class="stack">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <input name="titleEn" maxlength="120" placeholder="${L(lang, 'Project title (EN)', 'Título del proyecto (EN)')}" required>
        <input name="titleEs" maxlength="120" placeholder="${L(lang, 'Project title (ES)', 'Título del proyecto (ES)')}" required>
        <select name="serviceId">${serviceOptions(lang, null)}</select>
        <button class="btn btn--ghost" type="submit">${L(lang, 'New project', 'Nuevo proyecto')}</button>
      </form>
    </section>
    <section class="card stack">
      <h2>${L(lang, 'Before / After pairs', 'Pares antes / después')}</h2>
      <p class="muted small">${L(lang, 'A pair needs one Before and one After photo from the same project and service.', 'Un par necesita una foto Antes y una Después del mismo proyecto y servicio.')}</p>
      <ul class="list">${pairs.map((p) => `<li class="item"><div class="item__link"><span>#${p.id}: ${p.before_id} → ${p.after_id}</span></div>
        <form method="post" action="/admin/gallery/pairs/${p.id}/delete" style="padding:0 18px 14px"><input type="hidden" name="csrf" value="${esc(csrf)}"><button class="btn btn--ghost" type="submit">${L(lang, 'Unpair', 'Deshacer par')}</button></form></li>`).join('') || `<li class="muted">${L(lang, 'No pairs yet.', 'Aún no hay pares.')}</li>`}</ul>
      <form method="post" action="/admin/gallery/pairs" class="stack">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label class="field"><span>${L(lang, 'Before photo', 'Foto antes')}</span><select name="before">${selectOpts(unpairedBefore.map((p) => ({ value: String(p.id), label: `#${p.id} ${p.display_name}` })), null)}</select></label>
        <label class="field"><span>${L(lang, 'After photo', 'Foto después')}</span><select name="after">${selectOpts(unpairedAfter.map((p) => ({ value: String(p.id), label: `#${p.id} ${p.display_name}` })), null)}</select></label>
        <button class="btn btn--primary" type="submit">${L(lang, 'Create pair', 'Crear par')}</button>
      </form>
    </section>
    <section class="stack">
      <h2>${L(lang, 'Photos', 'Fotos')}</h2>
      <ul class="list photo-grid">${photos.map((p) => {
        const live = state.publishable.has(p.id);
        const status = live ? L(lang, 'Published', 'Publicada') : p.deleted_at ? L(lang, 'Removed', 'Quitada') : p.review_status === 'approved' ? L(lang, 'Approved, not published', 'Aprobada, no publicada') : L(lang, 'Private', 'Privada');
        return `<li class="card item">
          <a class="item__link" href="/admin/gallery/photos/${p.id}">
            <img src="/admin/gallery/photos/${p.id}/file" alt="" loading="lazy" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#F1F3F5">
            <span class="item__top"><strong>#${p.id}</strong><span class="pill">${esc(KIND_LABEL[p.kind][lang])}</span></span>
            <span class="item__meta">${esc(status)}</span>
          </a>
          <div class="row" style="padding:0 14px 14px">
            <form method="post" action="/admin/gallery/photos/${p.id}/move"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="direction" value="up"><button class="btn btn--ghost" type="submit">↑</button></form>
            <form method="post" action="/admin/gallery/photos/${p.id}/move"><input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="direction" value="down"><button class="btn btn--ghost" type="submit">↓</button></form>
          </div>
        </li>`;
      }).join('') || `<li class="card muted">${L(lang, 'No photos uploaded yet.', 'Aún no se han subido fotos.')}</li>`}</ul>
    </section>`;
    return page(base, L(lang, 'Gallery', 'Galería'), body, flash, !!ctx.query.get('err'));
  }

  return null;
}

export { createPair, deletePair, PHOTO_KINDS };
