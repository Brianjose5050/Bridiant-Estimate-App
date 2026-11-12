/**
 * Browser suite: the owner uploads a photo, saves text without approving it (stays private), approves it,
 * and the public Our Work page shows it. Run on a freshly reset database.
 *
 *   BRIDIANT_BASE_URL=http://127.0.0.1:8788 BRIDIANT_OWNER_TOTP=<secret> node e2e/gallery-owner.mjs
 */
import { config, loadPlaywright, recorder, shotPath, code, jpegFixture, tempFile, PHONE } from './lib.mjs';

const cfg = config();
const { ok, finish } = recorder();
const { chromium } = loadPlaywright();
const base = cfg.base;
const browser = await chromium.launch({ ...(cfg.chromium ? { executablePath: cfg.chromium } : {}), args: ['--no-sandbox'] });
const errors = [];
try {
  const ctx = await browser.newContext(PHONE);
  const o = await ctx.newPage();
  o.on('pageerror', (e) => errors.push(e.message));
  await o.goto(base + '/admin/login', { waitUntil: 'networkidle' });
  await o.fill('input[name="username"]', 'owner');
  await o.fill('input[name="password"]', cfg.password);
  await o.fill('input[name="code"]', code(cfg.totp));
  await o.click('button[type="submit"]');
  await o.waitForURL(/admin\/requests/);

  await o.goto(base + '/admin/gallery', { waitUntil: 'networkidle' });
  ok('gallery page opens for the owner', (await o.innerText('body')).includes('Gallery'));
  await o.setInputFiles('input[type="file"][name="photos"]', tempFile('finished-kitchen.jpg', jpegFixture()));
  await o.click('form[action="/admin/gallery/upload"] button[type="submit"]');
  await o.waitForLoadState('networkidle');
  ok('upload is confirmed and the photo stays private', (await o.innerText('body')).includes('stay private until you approve'));
  const pub0 = await (await fetch(base + '/api/gallery?lang=en')).json();
  ok('uploaded photo is not public before approval', pub0.items.length === 0);

  // The newest photo is the one just uploaded; take its id from the panel link.
  const ids = [...new Set([...(await o.content()).matchAll(/\/admin\/gallery\/photos\/(\d+)"/g)].map((m) => Number(m[1])))];
  const photoId = Math.max(...ids);
  await o.goto(base + `/admin/gallery/photos/${photoId}`, { waitUntil: 'networkidle' });
  await o.selectOption('select[name="kind"]', 'regular');
  await o.check('input[name="ownershipConfirmed"]');
  await o.selectOption('select[name="peopleStatus"]', 'none_visible');
  await o.fill('input[name="captionEn"]', 'Finished kitchen');
  await o.fill('input[name="captionEs"]', 'Cocina terminada');
  await o.fill('input[name="altEn"]', 'Finished kitchen counter');
  await o.fill('input[name="altEs"]', 'Encimera de cocina terminada');
  await o.click('main form button[type="submit"]');
  await o.waitForLoadState('networkidle');
  const unapprovedPub = await (await fetch(base + '/api/gallery?lang=en')).json();
  ok('saving text without approval keeps the photo private', unapprovedPub.items.length === 0);

  await o.check('input[name="approveCaptionEn"]');
  await o.check('input[name="approveCaptionEs"]');
  await o.check('input[name="approveAltEn"]');
  await o.check('input[name="approveAltEs"]');
  await o.selectOption('select[name="reviewStatus"]', 'approved');
  await o.check('input[name="visible"]');
  await o.click('main form button[type="submit"]');
  await o.waitForLoadState('networkidle');
  ok('owner approves the saved text and sees the save confirmation', (await o.innerText('body')).includes('Saved'));
  const pub1 = await (await fetch(base + '/api/gallery?lang=en')).json();
  ok('approved and published photo appears on the public API', pub1.items.length === 1);
  const media = await fetch(base + pub1.items[0].photos[0].src);
  ok('published photo is served as an image', media.status === 200 && (media.headers.get('content-type') || '') === 'image/jpeg');

  const cust = await browser.newContext(PHONE);
  const c = await cust.newPage();
  c.on('pageerror', (e) => errors.push('customer ' + e.message));
  await c.goto(base + '/en/our-work/', { waitUntil: 'networkidle' });
  await c.waitForTimeout(900);
  ok('public Our Work page shows the published photo', (await c.locator('#gallery-live img').count()) === 1);
  await cust.close();

  for (const [path, file] of [['/admin/gallery', 'owner-gallery.png'], ['/admin/status', 'owner-status.png']]) {
    await o.goto(base + path, { waitUntil: 'networkidle' });
    const shot = shotPath(cfg, file);
    if (shot) await o.screenshot({ path: shot });
  }
  ok('no JavaScript errors', errors.length === 0, errors.join(' | '));
} catch (error) {
  ok('suite ran to completion', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  finish();
}
