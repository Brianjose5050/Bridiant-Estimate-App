/**
 * Browser suite: a customer sends an estimate request, the owner reviews and approves a Welcome chapter,
 * and the customer sees only what is published. Run on a freshly reset database (the Welcome checks assume
 * that no chapter is published yet).
 *
 *   BRIDIANT_BASE_URL=http://127.0.0.1:8788 BRIDIANT_OWNER_TOTP=<secret> node e2e/customer-owner.mjs
 */
import { config, loadPlaywright, recorder, shotPath, code, jpegFixture, tempFile, PHONE } from './lib.mjs';

const cfg = config();
const { ok, finish } = recorder();
const { chromium } = loadPlaywright();
const base = cfg.base;
const browser = await chromium.launch({ ...(cfg.chromium ? { executablePath: cfg.chromium } : {}), args: ['--no-sandbox'] });
const errors = [];
try {
  // 1. Customer submits the request with a photo
  const customer = await browser.newContext(PHONE);
  const page = await customer.newPage();
  page.on('pageerror', (e) => errors.push('customer: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR/i.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(base + '/en/request-estimate/?service=deep-cleaning', { waitUntil: 'networkidle' });
  ok('form preselects the service from the link', await page.isChecked('input[name="services"][value="deep-cleaning"]'));
  ok('frequency question hidden for Deep Cleaning', !(await page.isVisible('[data-show-when="standard-cleaning"]')));
  await page.fill('input[name="name"]', 'E2E Customer');
  await page.fill('input[name="phone"]', '5550109999');
  await page.fill('input[name="email"]', 'e2e@example.invalid');
  await page.fill('input[name="zip"]', '90210');
  await page.fill('textarea[name="notes"]', 'E2E private note from the customer');
  await page.setInputFiles('input[name="photos"]', tempFile('kitchen.jpg', jpegFixture()));
  await page.check('input[name="consent"]');
  await page.click('[data-submit]');
  await page.waitForURL(/request-estimate\/thanks\/\?ref=BFG-/, { timeout: 15000 }).catch(() => {});
  const url = page.url();
  ok('confirmation only after the save: redirected to thanks with a reference', /thanks\/\?ref=BFG-[0-9A-Z]{6}/.test(url), url);
  const ref = (url.match(/ref=(BFG-[0-9A-Z]{6})/) || [])[1] || '';
  ok('reference is shown on the confirmation page', (await page.innerText('[data-reference]').catch(() => '')) === ref);
  await page.waitForTimeout(900);
  ok('Welcome invitation is shown with the button', await page.isVisible('.invite__cta'));
  const thanksShot = shotPath(cfg, 'customer-thanks.png');
  if (thanksShot) await page.screenshot({ path: thanksShot });

  // 2. Customer enters the Welcome Center before any approval
  await page.click('.invite__cta');
  await page.waitForURL(/\/en\/welcome\//);
  await page.waitForTimeout(700);
  ok('unapproved chapters are not shown to the customer', (await page.locator('.wc-chapter').count()) === 0);
  ok('customer sees the calm empty-state text', await page.isVisible('#wc-status'));

  // 3. Owner signs in with password and authenticator code
  const owner = await browser.newContext(PHONE);
  const o = await owner.newPage();
  o.on('pageerror', (e) => errors.push('owner: ' + e.message));
  await o.goto(base + '/admin/requests', { waitUntil: 'networkidle' });
  ok('anonymous visitor is sent to sign-in', o.url().includes('/admin/login'));
  await o.fill('input[name="username"]', 'owner');
  await o.fill('input[name="password"]', cfg.password);
  await o.fill('input[name="code"]', code(cfg.totp));
  await o.click('button[type="submit"]');
  await o.waitForURL(/\/admin\/requests/, { timeout: 10000 }).catch(() => {});
  ok('owner signs in with password and code', o.url().includes('/admin/requests'));
  ok('new request appears in the panel', (await o.innerText('body')).includes('E2E Customer'));
  ok('new request is marked as not yet opened', (await o.innerText('body')).includes('Not yet opened'));

  // 4. Search and filter
  await o.fill('input[name="q"]', 'E2E');
  await o.click('form[role="search"] button[type="submit"]');
  ok('search by name finds the request', (await o.innerText('body')).includes('E2E Customer'));
  await o.goto(base + '/admin/requests?status=completed', { waitUntil: 'networkidle' });
  ok('status filter hides requests that do not match', (await o.innerText('body')).includes('No requests match'));

  // 5. Open the request and check its data and private photo
  await o.goto(base + '/admin/requests', { waitUntil: 'networkidle' });
  await o.click('text=E2E Customer');
  await o.waitForLoadState('networkidle');
  const detail = await o.innerText('body');
  ok('detail shows contact, service, and the form answers', detail.includes('e2e@example.invalid') && detail.includes('Deep Cleaning') && detail.includes('E2E private note from the customer'));
  ok('detail shows the photo as a private link', (await o.locator('a[href*="/photos/"]').count()) === 1);
  const photoHref = await o.locator('a[href*="/photos/"]').first().getAttribute('href');
  const photo = await o.request.get(base + photoHref);
  ok('photo opens for the signed-in owner as an image', photo.status() === 200 && (photo.headers()['content-type'] || '') === 'image/jpeg', String(photo.status()));
  const anon = await browser.newContext();
  const anonPhoto = await anon.request.get(base + photoHref, { maxRedirects: 0 });
  await anon.close();
  ok('the same photo link is refused without a session', anonPhoto.status() === 303, String(anonPhoto.status()));

  // 6. Status change and a private note
  await o.selectOption('select[name="status"]', 'contacted');
  await o.click('form[action$="/status"] button[type="submit"]');
  await o.waitForLoadState('networkidle');
  ok('status changes to Contacted', (await o.innerText('body')).includes('Contacted'));
  await o.fill('textarea[name="body"]', 'INTERNAL E2E note: call after 5 pm');
  await o.click('form[action$="/notes"] button[type="submit"]');
  await o.waitForLoadState('networkidle');
  ok('internal note is saved and shown to the owner', (await o.innerText('body')).includes('INTERNAL E2E note'));
  ok('history records the status change', (await o.innerText('body')).includes('Status changed'));

  // 7. The note never reaches the public site or API
  const publicApi = await (await fetch(base + '/api/welcome?lang=en')).text();
  const publicHome = await (await fetch(base + '/en/')).text();
  ok('internal note is not in any public response', !publicApi.includes('INTERNAL') && !publicHome.includes('INTERNAL'));

  // 8. Owner approves and publishes one Welcome chapter (English only)
  await o.goto(base + '/admin/welcome', { waitUntil: 'networkidle' });
  await o.click('text=Welcome to Bridiant');
  await o.waitForLoadState('networkidle');
  await o.check('input[name="approvedEn"]');
  await o.check('input[name="published"]');
  await o.click('main form button[type="submit"]');
  await o.waitForLoadState('networkidle');
  ok('owner approves and publishes a chapter', (await o.innerText('body')).includes('Saved'));

  // 9. Customer sees only the published, approved English chapter
  await page.goto(base + '/en/welcome/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#chapter-1', { timeout: 10000 }).catch(() => {});
  ok('published English chapter is visible to the customer', await page.isVisible('#chapter-1'));
  ok('its heading is correct', (await page.innerText('#chapter-1 h2')).includes('Welcome to Bridiant'));
  ok('unpublished chapters stay hidden (only one chapter visible)', (await page.locator('.wc-chapter').count()) === 1);
  const bodyText = await page.innerText('body');
  ok('unpublished draft chapters are not shown', !bodyText.includes('Who We Are') && !bodyText.includes('What to Expect'));
  ok('Spanish is not shown in English-only approval', (await (await fetch(base + '/api/welcome?lang=es')).json()).items.length === 0);

  // 10. Spanish page respects approval
  await page.goto(base + '/es/welcome/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  ok('Spanish page loads and shows the empty-state text', (await page.locator('.wc-chapter').count()) === 0 && (await page.innerText('body')).includes('aprobados'));

  // 11. System page reports what is not configured
  await o.goto(base + '/admin/status', { waitUntil: 'networkidle' });
  ok('system page reports the owner alert address is not configured', (await o.innerText('body')).includes('Owner alert address'));

  ok('no JavaScript errors on customer or owner pages', errors.length === 0, errors.join(' | '));
} catch (error) {
  ok('suite ran to completion', false, error instanceof Error ? error.message : String(error));
} finally {
  await browser.close();
  finish();
}
