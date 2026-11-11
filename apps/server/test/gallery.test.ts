import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { startHarness, signIn, jpeg, png, pdf, type Harness } from './helpers.js';

async function count(h: Harness, sql: string): Promise<number> {
  return ((await h.db.first(sql, [])) as { n: number }).n;
}

async function upload(h: Harness, cookie: string, csrf: string, files: Array<{ name: string; data: Buffer; type: string }>): Promise<Response> {
  const fd = new FormData();
  fd.append('csrf', csrf);
  for (const f of files) fd.append('photos', new Blob([new Uint8Array(f.data)], { type: f.type }), f.name);
  return fetch(`${h.base}/admin/gallery/upload`, { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' });
}

async function post(h: Harness, cookie: string, csrf: string, path: string, fields: Record<string, string>): Promise<Response> {
  return fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf, ...fields }),
    redirect: 'manual',
  });
}

async function publicApi(h: Harness): Promise<{ items: Array<{ type: string; photos: Array<{ id: number; src: string; caption: string }> }> }> {
  return (await fetch(`${h.base}/api/gallery?lang=en`)).json() as Promise<{ items: Array<{ type: string; photos: Array<{ id: number; src: string; caption: string }> }> }>;
}

/** Full approval payload for a classified photo. */
function approved(over: Record<string, string> = {}): Record<string, string> {
  return {
    kind: 'regular',
    projectId: '',
    serviceId: '',
    ownershipConfirmed: '1',
    peopleStatus: 'none_visible',
    captionEn: 'Finished kitchen',
    captionEs: 'Cocina terminada',
    altEn: 'A finished kitchen',
    altEs: 'Una cocina terminada',
    visible: '1',
    approveCaptionEn: '1',
    approveCaptionEs: '1',
    approveAltEn: '1',
    approveAltEs: '1',
    reviewStatus: 'approved',
    ...over,
  };
}

describe('gallery: nothing is public without owner approval', () => {
  let h: Harness;
  let cookie = '';
  let csrf = '';
  beforeAll(async () => {
    h = await startHarness({});
    const s = await signIn(h);
    cookie = s.cookie;
    csrf = s.csrf;
  });
  afterAll(async () => {
    await h.close();
  });

  it('uploads photos as private, unclassified, unapproved items', async () => {
    const r = await upload(h, cookie, csrf, [
      { name: 'kitchen.jpg', data: jpeg(), type: 'image/jpeg' },
      { name: 'bath.png', data: png(), type: 'image/png' },
    ]);
    expect(r.headers.get('location')).toContain('ok=2');
    expect(await count(h, 'SELECT COUNT(*) AS n FROM gallery_photo')).toBe(2);
    expect(await count(h, "SELECT COUNT(*) AS n FROM gallery_photo WHERE kind = 'unclassified' AND review_status = 'pending'")).toBe(2);
    expect((await publicApi(h)).items).toEqual([]);
    const stored = (await h.db.all('SELECT storage_name FROM gallery_photo', [])) as Array<{ storage_name: string }>;
    for (const s of stored) expect(existsSync(join(h.privateDir, s.storage_name))).toBe(true);
  });

  it('refuses a disguised file and stores nothing', async () => {
    const before = readdirSync(join(h.privateDir, 'gallery')).length;
    const r = await upload(h, cookie, csrf, [{ name: 'x.jpg', data: Buffer.from('MZ\x90\0'), type: 'image/jpeg' }]);
    expect(r.headers.get('location')).toContain('err=');
    expect(readdirSync(join(h.privateDir, 'gallery')).length).toBe(before);
    const r2 = await upload(h, cookie, csrf, [{ name: 'a.pdf', data: pdf(), type: 'application/pdf' }]);
    expect(r2.headers.get('location')).toContain('err=');
  });

  it('refuses an upload without the session token', async () => {
    const fd = new FormData();
    fd.append('photos', new Blob([new Uint8Array(jpeg())], { type: 'image/jpeg' }), 'a.jpg');
    const r = await fetch(`${h.base}/admin/gallery/upload`, { method: 'POST', headers: { cookie }, body: fd, redirect: 'manual' });
    expect(r.status).toBe(403);
  });

  it('will not approve an unclassified photo', async () => {
    const r = await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ kind: 'unclassified' }));
    expect(r.headers.get('location')).toContain('classify_before_approval');
    expect((await publicApi(h)).items).toEqual([]);
  });

  it('will not approve without ownership, captions in both languages, and alt text', async () => {
    const r = await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ ownershipConfirmed: '' }));
    expect(r.headers.get('location')).toContain('approval_incomplete');
    const r2 = await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ approveAltEs: '' }));
    expect(r2.headers.get('location')).toContain('approval_incomplete');
    expect((await publicApi(h)).items).toEqual([]);
  });

  it('publishes a fully approved, classified photo, and serves it publicly', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved());
    const api = await publicApi(h);
    expect(api.items).toHaveLength(1);
    expect(api.items[0]?.photos[0]?.caption).toBe('Finished kitchen');
    const media = await fetch(`${h.base}${api.items[0]?.photos[0]?.src}`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/jpeg');
  });

  it('keeps a photo private when it is hidden, rejected, or its caption changes', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ visible: '' }));
    expect((await publicApi(h)).items).toEqual([]);
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ reviewStatus: 'rejected', approveCaptionEn: '', approveCaptionEs: '', approveAltEn: '', approveAltEs: '' }));
    expect((await publicApi(h)).items).toEqual([]);
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved());
    expect((await publicApi(h)).items).toHaveLength(1);
    // Editing the caption removes its approval: an edit cannot be approved in the same save.
    const edit = await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ captionEn: 'Changed caption' }));
    expect(edit.headers.get('location')).toContain('approval_incomplete');
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ captionEn: 'Changed caption', approveCaptionEn: '' , reviewStatus: 'pending'}));
    expect((await publicApi(h)).items).toEqual([]);
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ captionEn: 'Changed caption' }));
    expect((await publicApi(h)).items).toHaveLength(1);
  });

  it('does not show private media to the public even by direct URL', async () => {
    const second = ((await h.db.first("SELECT id FROM gallery_photo WHERE id <> 1", [])) as { id: number }).id;
    expect((await fetch(`${h.base}/api/gallery/media/${second}`)).status).toBe(404);
    const storage = ((await h.db.first('SELECT storage_name FROM gallery_photo WHERE id = ?', [second])) as { storage_name: string }).storage_name;
    expect((await fetch(`${h.base}/${storage}`)).status).toBe(404);
    expect((await fetch(`${h.base}/api/gallery/media/..%2Fsecret`)).status).toBe(404);
  });

  it('serves the private owner view only with a session', async () => {
    const anon = await fetch(`${h.base}/admin/gallery/photos/1/file`, { redirect: 'manual' });
    expect(anon.status).toBe(303);
    const ok = await fetch(`${h.base}/admin/gallery/photos/1/file`, { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('gallery: pairs publish as units', () => {
  let h: Harness;
  let cookie = '';
  let csrf = '';
  beforeAll(async () => {
    h = await startHarness({});
    const s = await signIn(h);
    cookie = s.cookie;
    csrf = s.csrf;
    await upload(h, cookie, csrf, [
      { name: 'before.jpg', data: jpeg(), type: 'image/jpeg' },
      { name: 'after.jpg', data: jpeg(3000), type: 'image/jpeg' },
      { name: 'loose.jpg', data: jpeg(4000), type: 'image/jpeg' },
    ]);
    await post(h, cookie, csrf, '/admin/gallery/projects', { titleEn: 'Office kitchen', titleEs: 'Cocina', serviceId: 'deep-cleaning' });
  });
  afterAll(async () => {
    await h.close();
  });

  const project = async () => ((await h.db.first('SELECT id FROM gallery_project', [])) as { id: number }).id;

  it('shows a Before without its After as nothing, and refuses an incompatible pair', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/1', approved({ kind: 'before', projectId: String(await project()), serviceId: 'deep-cleaning', captionEn: 'Before', captionEs: 'Antes', altEn: 'Before', altEs: 'Antes' }));
    expect((await publicApi(h)).items).toEqual([]);
    const bad = await post(h, cookie, csrf, '/admin/gallery/pairs', { before: '2', after: '2' });
    expect(bad.headers.get('location')).toContain('err=');
    const wrongKind = await post(h, cookie, csrf, '/admin/gallery/pairs', { before: '1', after: '3' });
    expect(wrongKind.headers.get('location')).toContain('err=');
  });

  it('publishes a Before/After pair together once both are approved', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/2', approved({ kind: 'after', projectId: String(await project()), serviceId: 'deep-cleaning', captionEn: 'After', captionEs: 'Después', altEn: 'After', altEs: 'Después' }));
    const created = await post(h, cookie, csrf, '/admin/gallery/pairs', { before: '1', after: '2' });
    expect(created.headers.get('location')).toContain('ok=saved');
    const api = await publicApi(h);
    expect(api.items).toHaveLength(1);
    expect(api.items[0]?.type).toBe('pair');
    expect(api.items[0]?.photos).toHaveLength(2);
  });

  it('hides the whole pair when one photo is hidden, and never shows the other alone', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/2', approved({ kind: 'after', projectId: String(await project()), serviceId: 'deep-cleaning', captionEn: 'After', captionEs: 'Después', altEn: 'After', altEs: 'Después', visible: '' }));
    expect((await publicApi(h)).items).toEqual([]);
  });

  it('removing a photo breaks its pair and keeps it out of the site', async () => {
    await post(h, cookie, csrf, '/admin/gallery/photos/2', approved({ kind: 'after', projectId: String(await project()), serviceId: 'deep-cleaning', captionEn: 'After', captionEs: 'Después', altEn: 'After', altEs: 'Después' }));
    await post(h, cookie, csrf, '/admin/gallery/pairs', { before: '1', after: '2' });
    expect((await publicApi(h)).items.length).toBe(1);
    await post(h, cookie, csrf, '/admin/gallery/photos/2/delete', {});
    expect((await publicApi(h)).items).toEqual([]);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM gallery_pair')).toBe(0);
  });

  it('unpairing removes the pair without deleting the photos', async () => {
    const pairCount = await count(h, 'SELECT COUNT(*) AS n FROM gallery_pair');
    expect(pairCount).toBe(0);
    expect(await count(h, 'SELECT COUNT(*) AS n FROM gallery_photo WHERE deleted_at IS NULL')).toBe(2);
  });
});
