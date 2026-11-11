# Bridiant Facility Group — Website & Admin Architecture

**Revision 3 — owner clarifications added in §19 (authoritative where they conflict with earlier text). Implementation NOT approved. No application code written, no deployment, no paid service or plan activated, no integration connected, no Google Drive or credentials created, nothing pushed or published.**

> **Security risk notice:** the existing public estimate application (`index.html.html`) exposes internal pricing logic and rate data to anyone who views its source. Until its exposure is addressed, it must not be used as a public tool. See §19.7.

Tagline: *The Standard, Quietly Kept.*

---

## 0. Owner decisions incorporated

| # | Decision | Where it is applied |
|---|---|---|
| 1 | English **and** Spanish; visible language switcher; all customer-facing content, forms, confirmations, documents, and emails bilingual | §2, §3, §8, §9 |
| 2 | Welcome Center is a customer resource hub: welcome presentation, FAQs, service information, welcome packet, documents. Some resources available immediately after estimate submission; the complete packet after estimate approval | §5 |
| 3 | Official palette: Navy `#071A2B`, White `#FFFFFF`, Subtle Gray `#F1F3F5`. Navy tints and opacity allowed for backgrounds, borders, and details. No gold, beige, green, red, purple, orange, yellow, pink, or brown. Navy stays dominant | §1 |
| 4 | Merge useful estimate-app functionality into the private admin. Do not carry over browser-based pricing or the outdated design. All rates, credits, discounts, and pricing rules stay server-side | §7, §14 |
| 5 | Free services first. No paid subscription or plan activated without presenting cost, limits, and reason for approval. Free-tier limits documented | §13, §17 |

Additional requirements also incorporated: one shared brand identity across public site and admin; mobile-first and iPhone-first; every customer-facing business content item editable in the admin, including service descriptions, included/excluded tasks, form questions and options, pricing, discounts, credits, photos, documents, FAQs, and estimate turnaround settings; no internal pricing, admin notes, other customers' data, or private settings visible to the public; the estimate request is **not** a booking or payment; **real company photos only**; simple, professional customer journey.

### 0.1 Answers to the six pre-implementation questions

| Question | Short answer | Detail |
|---|---|---|
| 1. Reusable existing features | Concepts and some data definitions: service/property/size fields, the pricing *formula structure*, the estimate field set, export formats, dashboard counts, PWA manifest and icons | §14.1 |
| 2. Features to rebuild | Pricing calculation (browser-side), client database (localStorage), PIN lock, dark-mode theme, hard-coded colors and copy, browser-side PDF generation with pricing, share-by-SMS/WhatsApp/email-from-browser, service worker caching of data | §14.2 |
| 3. Exact free stack and limits | Astro, React + Vite, Supabase Free, Cloudflare Pages Free, Cloudflare Access/Turnstile/Web Analytics Free, Resend Free, GitHub Free, Google Drive (owner's 15 GB), age and rclone (open source). Limits in §13 | §13 |
| 4. Bilingual management | Each translatable field stores EN and ES; publish is blocked until both locales are complete or the owner explicitly enables English fallback for that item | §2 |
| 5. Private pricing engine security | Pricing lives in a non-exposed database schema, is calculated only on the server for the owner, is never sent to any public or customer-facing response, and every view and change is audited and MFA-gated | §7 |
| 6. Backups without a paid plan | Nightly encrypted database dump and incremental storage copy to the owner's Google Drive, with a monthly restore drill. RPO about 24 hours. Limits stated | §12 |

---

## 1. Brand identity (shared by public site and admin)

### 1.1 Palette (only these)

| Token | Value | Use |
|---|---|---|
| `--navy` | `#071A2B` | Primary: headers, primary buttons, headings, footer, key text |
| `--navy-70` … `--navy-08` | Navy at 70%, 40%, 20%, 8% opacity on white/gray | Borders, dividers, subtle backgrounds, disabled states, hover states |
| `--white` | `#FFFFFF` | Page background, text on navy, cards |
| `--gray` | `#F1F3F5` | Alternate section background, input backgrounds, quiet panels |

Rules:
- **Navy is dominant.** The default page is white or gray with navy type, navy headers and footer, and navy primary buttons. Gray is for alternating sections and panels, not for large decorative blocks.
- No other hue is defined in code. A lint rule rejects any hex value outside the approved set and its navy tints.
- Uploaded real photos are the only non-palette color on the site (they are the company's own images).
- Error, success, and warning states use **navy only**: an icon (✕, ✓, !), bold text, and a border weight change. No red, green, or amber.
- Focus ring: 3 px navy with a 2 px white offset, visible on white, gray, and navy.
- Contrast: navy on white ≈ 16:1; navy on gray ≈ 14:1; white on navy ≈ 16:1. All text meets WCAG AA.

### 1.2 Shared identity

- One set of design tokens in `/packages/ui` used by both apps.
- Same logo lockup, typography, button styles, and spacing in the public site and the admin. The admin uses the navy header and the same wordmark.
- Typography: one system-font stack (San Francisco on iPhone, avoiding extra font downloads) with a clear scale. Body at 17 px on mobile to match iOS reading size. No custom web fonts at launch (keeps the page light and free of third-party requests).
- Icons: a single outline icon set bundled locally (no CDN).

### 1.3 iPhone-first details

- Design at 390 × 844 (iPhone 14/15) first; test at 375 × 667 (small iPhone SE).
- Input fields use font-size ≥ 16 px so Safari does not zoom on focus.
- Respect `env(safe-area-inset-*)` for notch and home indicator; use `100dvh` for full-height screens.
- Correct `inputmode` and `autocomplete` on every field (`tel`, `email`, `postal-code`, `street-address`, `given-name`).
- Photo capture uses `<input type="file" accept="image/*">`, which opens the iOS photo library or camera. HEIC photos are converted to JPEG on the device.
- Sticky bottom bar: Call and Request an Estimate, with safe-area padding.
- Add-to-Home-Screen: web app manifest and Apple touch icons (reusing the existing icon set after review).
- Test matrix: Playwright WebKit with iPhone device profiles (free, runs in CI). Real-device checks by the owner on their iPhone before launch (no cost).

---

## 2. Bilingual content (English and Spanish)

### 2.1 Language behavior

- Routes are prefixed: `/en/...` and `/es/...`. The root `/` redirects to the language from the browser (`Accept-Language`) on first visit, then respects the visitor's manual choice (stored in a cookie-free `localStorage` preference).
- **Visible language switcher** in the header on every page, labeled "EN | ES" (each language name written in its own language: "English" / "Español"). On mobile it is also at the top of the menu.
- Each page has `<html lang>`, `hreflang` links for both languages, and translated meta titles and descriptions.
- Switching language keeps the user on the equivalent page (same entity slug mapping, with per-locale slugs where the owner chooses).
- Estimate form language: the form is shown in the visitor's current language and stores that locale with the submission. Confirmation text, customer emails, and attached documents follow that locale.

### 2.2 How bilingual content is stored and managed

Every translatable field is stored as a pair, not as two separate records:

```
title: { en: "Office Cleaning", es: "Limpieza de oficinas" }
```

Implementation: `jsonb` columns with `{en, es}` keys on translatable fields, or a `content_translations` table keyed by entity, field, and locale. Decision for implementation: **`jsonb {en, es}` on the entity** (simpler queries, one row per entity, validated by schema). Status is tracked per locale.

Rules:

1. **Both-locale publish gate.** An item (service, page, article, form question, email template, document) cannot be published until both English and Spanish are filled, unless the owner has explicitly chosen "show English if Spanish is missing" for that item. The admin shows a "ES missing" or "EN missing" badge in lists.
2. **Per-locale status:** `draft`, `ready`, `published` for each locale. Publishing one locale does not publish the other silently.
3. **Side-by-side editor:** English on the left, Spanish on the right (stacked on phones), with a "copy from English" action that inserts the English text as a starting point for translation, clearly marked as untranslated until edited.
4. **No automatic machine translation at launch.** Automatic translation of pricing, legal, and service terms is risky; the owner or a fluent reviewer writes or approves the Spanish. A translation assistant can be added later only with approval (it may have free-tier limits).
5. **Interface strings** (buttons, error messages, form helper text, confirmation sentences) live in `site_strings` with `en` and `es` columns, seeded with both languages. A CI check fails if any user-facing text is hard-coded in a component.
6. **Documents:** each document has an EN file and an ES file, versioned separately (§10.2).
7. **Photos:** alt text and captions are per locale. Filenames are not translated.
8. **Spanish quality:** I will draft the seed Spanish for every interface string and the starter pages for your review. Anything legal, pricing-related, or contract-like must be reviewed by a fluent speaker before publish. This review is an owner action listed in §18.

### 2.3 Submissions in two languages

- Form answers are stored exactly as the customer typed them. The admin shows the original text. There is no automatic translation of customer text.
- The owner's alert email is sent in the owner's preferred language (default English), regardless of the customer's locale.

---

## 3. Website architecture

### 3.1 Sitemap (per locale; EN shown, ES mirrors with translated slugs)

```
/en/                         Home
/en/about                    About Us
/en/our-work                 Our Work (real project photos)
/en/our-work/:slug           Project (optional, Phase 4)
/en/services                 Our Services (index)
/en/services/:slug           Service detail: description, included, not included, CTA
/en/cleaning-standards       Cleaning Standards (checklists, documents)
/en/request-estimate         Request an Estimate (multi-step form)
/en/request-estimate/thanks  Confirmation: reference, turnaround, resources now available
/en/welcome                  Welcome Center (resource hub)
/en/welcome/:slug            FAQ, article, or information page
/en/welcome/packet/:token    Client welcome packet (private, tokenized; after approval)
/en/privacy, /en/terms       Legal pages (editable text, reviewed)
/en/404                      Not found
```

Spanish paths mirror these with Spanish slugs (for example, `/es/servicios/:slug`, `/es/solicitar-estimado`).

Header and footer navigation, labels, order, and visibility are all owner-editable per locale.

### 3.2 Rendering

- Public pages are statically prerendered for both locales at build time from **published** content only.
- Only the estimate form, the mobile menu, and the language switcher ship JavaScript. Target: under 100 KB of JavaScript on content pages.
- No third-party trackers, embeds, chat widgets, or Google Maps iframes at launch. Analytics: Cloudflare Web Analytics (cookieless). The address is shown as text with a link to the maps app.
- A tokenized packet page (`/welcome/packet/:token`) is `noindex` and not in the sitemap. It is generated on demand, not prerendered (see §5.3).

### 3.3 Repository layout

```
/apps/public        static site (Astro, i18n routing)
/apps/admin         admin SPA (React + Vite)
/functions          Supabase Edge Functions (intake, email, publish hook, pricing worksheet, signed URLs, packet tokens)
/supabase           migrations, RLS policies, seed content (EN + ES), pgTAP tests
/packages/schemas   zod schemas shared by public, admin, and functions
/packages/ui        design tokens (palette lock), shared components
/packages/i18n      locale helpers, both-locale publish validation
/docs               this document, runbooks, ADRs
/scripts            backup, restore-drill, scan scripts
```

---

## 4. Customer journey (simple and professional)

### 4.1 Journey map

| Step | Customer goal | Screen | What the site does |
|---|---|---|---|
| 1. Arrive | "Who are you, and do you serve me?" | Home (language chosen automatically or by switcher) | Clear promise and tagline, one primary button "Request an Estimate", tap-to-call, service-area line |
| 2. Choose a service | "Do you clean what I need?" | Services → service detail | What's included, what's not included, who it's for, a button that pre-selects the service in the form |
| 3. Build confidence | "Are you careful and consistent?" | Cleaning Standards, Our Work, About | Standards checklist, real project photos with captions, company story |
| 4. Get answers | "What happens next?" | Welcome Center | FAQs and "What to expect" explain the estimate process. No prices are shown (see §7.6 on how pricing is communicated) |
| 5. Request an estimate | "Give me a quote." | Multi-step form (§6.3) | One question per screen on phones; progress saved on the device; no login |
| 6. Confirmation | "Did it go through? What now?" | Thanks page | Reference number, turnaround time (owner-set text), call button, **immediately available resources** (§5.2) |
| 7. Follow-up | "When do I hear back?" | Email + owner phone/email | Acknowledgment email with the same resources link; owner contacts the customer outside the site |
| 8. Approval and packet | "I'm ready to go ahead." | Owner marks estimate approved; customer receives the packet link | The complete welcome packet is unlocked (§5.3) |

Estimate requests are **not bookings and not payments**. The confirmation says so plainly: "We have received your request. We will review it and contact you within [owner's turnaround]. This is not a booking."

### 4.2 Estimate form (default content; every question editable)

Default steps (EN and ES text provided at seed time):

1. Service(s) — pre-selected when the visitor came from a service page
2. Property type — office, medical/clinical, retail, residential, industrial, other
3. Approximate size — owner-defined bands, plus "not sure"
4. Location — address or ZIP; checked against the owner's service area; out-of-area shows the owner's message
5. Frequency — one-time, weekly, monthly, custom (owner-defined options)
6. Scope — included tasks shown as checkboxes (owner-defined list); visitor notes what is extra
7. Access and details — owner-defined prompts (for example, pets, alarm system, who will provide access)
8. Photos (optional) — up to the owner's limit (default 6), 10 MB each
9. Timing — preferred start window, flexible toggle
10. Contact — name, phone, email, preferred contact method, best time to call
11. Review, consent (versioned text, both locales), submit

Form rules: validation messages in the visitor's language; no price fields and no price displayed; required fields marked in text; large tap targets (≥ 44 px); Back never loses data.

---

## 5. Welcome Center (customer resource hub)

### 5.1 Contents

| Resource type | Examples | Editable |
|---|---|---|
| Welcome presentation | Short illustrated slides or a page-based walkthrough: who we are, how we work, what to expect | Yes (sections, images, text in both locales) |
| FAQs | Questions and answers, grouped by category | Yes |
| Service information | Service sheets: what's included, what's excluded, frequency notes, preparation tips | Yes (linked from Services) |
| Cleaning standards | Checklists and standards documents | Yes |
| Welcome packet | Our welcome guide, service expectations, site access and key/alarm procedures, emergency contacts (owner-set), service agreement template | Yes (documents in both languages) |
| Documents | Forms, guides, policies (PDF) | Yes (versioned, both languages) |

### 5.2 Access tiers

| Tier | Who can see it | When |
|---|---|---|
| **Public** | Anyone | Always |
| **After request** | Anyone with the confirmation page or the acknowledgment email | Immediately after estimate submission |
| **After approval (packet)** | Customers whose estimate the owner marks **approved** | Once the owner approves; link sent by the owner from the admin |

"After request" resources are shown on the confirmation page and linked in the acknowledgment email. They are **general** items only (welcome presentation, FAQs, service sheets, standards). They contain no customer-specific information.

### 5.3 How the post-approval packet works (no customer accounts)

1. When the owner marks an estimate **approved** in the admin, the admin offers "Send welcome packet" (owner confirms).
2. The system creates a **packet token**: 256 random bits, shown to the owner once as a link, and stored only as a hash. Expiry is set by the owner (default 60 days). Tokens can be revoked from the admin.
3. The link is sent to the customer's email in their chosen language, from the owner's approved template. It is also copyable by the owner for phone or text delivery.
4. The packet page validates the token, shows the packet (documents and customer-specific instructions the owner entered), and logs the view (count and time, no personal details).
5. Packet content that is customer-specific (for example, site access steps) is written by the owner in the admin, stored with the submission, and visible only through the token.

Security notes:
- The token is the only credential. It is long, hashed at rest, rate-limited, revocable, and `noindex`.
- Anyone who has the email can open the link, so the packet contains no payment, banking, or account data and no more personal data than the owner decides to include.
- Packet pages are not cached by the CDN or the service worker.

### 5.4 Owner controls

Each resource has: title (EN/ES), summary, category, access tier, visible on/off, sort order, and publish status. Resource files are managed in the Documents library (§10.2).

---

## 6. Admin panel

### 6.1 Navigation

```
Dashboard                 new requests, approved estimates awaiting packet, drafts to publish, storage use
Requests                  inbox: New · Reviewing · Estimate in progress · Estimate sent · Approved · Won · Lost · Archived
  └ detail                answers (original language), photos, notes, status history, send follow-up, send packet,
                          export (owner only)
Publish Center            drafts for both locales, preview, publish, version history, rollback
Services                  list → editor: name, slug, summary, description, included tasks, excluded tasks,
                          image, related FAQs, frequency notes, pre-select on form, sort, visible, status
Our Work                  project list → editor: title, category, city, description, real photos, before/after,
                          permission confirmed, featured, sort, visible
Cleaning Standards        sections, checklist items, related documents
Welcome Center            presentation sections, FAQs, articles, packet template, access tiers, visibility
Pages & Navigation        page sections (add/reorder/hide), header and footer items, labels per locale
Media Library             real photos: upload, alt text (EN/ES), caption, focal point, tags, usage list, safe delete
Documents                 PDF library: EN and ES files, versions, access tier, visibility
Estimate Form             steps, questions (type, label, help, required, options, show-if), consent text, limits
Pricing & Estimating      OWNER ONLY, MFA step-up: rates, service pricing, discounts, credits, tax, minimums,
                          add-ons, frequency multipliers, worksheet, rate version history (§7)
Email                     templates EN/ES, recipients, on/off per event, send log (no addresses shown in full)
Business Settings         identity, contact, hours, service area, turnaround settings, languages, SEO, legal,
                          maintenance mode, storage use
Team & Roles              OWNER ONLY: invite, role change, revoke, MFA status
Audit Log                 OWNER ONLY: read-only history of changes, views of pricing, exports, publishes
```

### 6.2 What the owner controls (complete list)

Every item below is editable in the admin, in both languages where it is customer-facing:

- **Services:** names, descriptions, what's included and excluded (lists), frequencies offered, photos, FAQs linked, visibility, order
- **Form:** every question, its type, options and option order, help text, required or optional, conditional display, photo limit, size band labels, consent text, thank-you text
- **Pricing (private):** base rates, size bands, frequency multipliers, minimum charges, add-on prices, travel fee, tax rate, discount rules (percent or fixed, with conditions), credit rules, and the rate-version history
- **Photos:** upload, replace, caption, alt text, order, which page uses them
- **Documents:** upload, versioning, EN and ES files, access tier, visibility
- **FAQs and articles:** all text, categories, order, publication
- **Estimate turnaround:** the number and unit (business days or hours) shown to customers, the wording for each locale, and the holiday and weekend note
- **Business settings:** name, phone, email, address, hours, service area (ZIP list or radius), social links, emergency or after-hours line if any, legal footer, notification recipients

### 6.3 Draft → preview → publish

- Every editable item has a draft and a published version per locale. Autosave writes drafts every few seconds.
- **Preview** shows the whole site in both languages from a private, expiring, `noindex` link. Previews never show private pricing.
- **Publish** runs validation first: both-locale gate (§2.2), alt text on every photo, valid links, required fields, palette check. It then records a version (who, when, what) and triggers the static rebuild (about 1–3 minutes on Cloudflare Pages).
- **Rollback** restores an earlier version to a draft, then publish. Old photos and documents are kept at least 30 days so rollbacks work.

### 6.4 Requests workflow

- **Statuses (internal):** New → Reviewing → Estimate in progress → Estimate sent → Approved → Won / Lost / Archived. Each change is timestamped and logged.
- **Notes:** internal only, never sent to the customer.
- **Attachments and photos:** viewed through signed URLs that expire after 5 minutes.
- **Follow-up emails:** sent from templates (EN/ES) or typed by the owner. Pricing is never included automatically.
- **Export:** CSV or XLSX of filtered rows, owner only, logged.
- **Retention:** owner-set archive and delete windows (proposed defaults: archive after 12 months; delete spam after 30 days).

### 6.5 Editor UX

- Plain-language help on every field; required items marked in text.
- Rich text limited to headings, bold, italic, lists, and links. Pasting from Word strips formatting.
- Links validated; external links open safely.
- Phone-friendly lists and forms; long text editing is comfortable on a laptop, and the admin says so without blocking phone use.

---

## 7. Private pricing engine (security design)

This answers requirement 5. Pricing is treated as the most sensitive data in the system.

### 7.1 Where pricing lives

- A dedicated Postgres schema `private` holds all rates, rules, discounts, credits, and worksheets.
- The `private` schema is **not** in the API's exposed schemas, and no role except a server-side function owner has any privilege on it. `anon` and `authenticated` roles have `REVOKE ALL`.
- Pricing rules are never included in any public build, public API response, email, log, error message, or cache.

### 7.2 Where pricing is calculated

- Calculation runs only on the server, inside an Edge Function `pricing-worksheet`. The browser sends the owner's chosen inputs (service, size band, frequency, add-ons); the server looks up the current rules and returns the result to the owner.
- The browser never receives the rate table, the formulas, multipliers, or discount/credit rules, only the resulting line items the owner chooses to show in the worksheet.
- The public site and the public form never calculate or display a price. The form collects answers only.
- The estimate-app functions `computeSmartPrice` and `estimateTotalFromState` are **not** ported to the browser. Their formula *structure* is re-expressed as server-side rules (§14.1).

### 7.3 Who can see it

- Owner role only, enforced in Postgres (a `SECURITY DEFINER` function checks `app_metadata.role = 'owner'` **and** `aal2`, meaning MFA was used in the current session).
- Editors and reviewers cannot read or write pricing. Their requests screen shows the estimate status only.

### 7.4 Step-up authentication and sessions

- Opening Pricing requires a fresh MFA check (re-authentication within 10 minutes).
- Pricing pages send `Cache-Control: no-store`. No service worker caches admin data.
- Idle timeout for the admin: 30 minutes; absolute session: 12 hours.

### 7.5 Changes, versions, and audit

- Each rate, discount, credit, and rule is versioned. A change creates a new version with `changed_by`, `changed_at`, a note, and the diff.
- Each worksheet records the **rule version IDs** used, so an old estimate can be explained later even after rates change.
- Every view of the Pricing module and every export writes an audit entry (who, when, which object, not the values).
- The audit log is append-only; no role can update or delete entries.

### 7.6 Discounts, credits, and customer-facing output

- The owner defines discount and credit rules (for example: percentage off for recurring service, fixed credit for referral). These are **internal rules**; the customer does not see the rule names or thresholds.
- The owner's worksheet produces a PDF for the customer that shows only the final line items and totals the owner selects. Rates, multipliers, credit logic, margins, and internal notes are never in that PDF.
- The PDF is rendered on the server (pdf-lib, open source) and watermarked "Estimate" with the reference and date. Each generation is logged.
- The owner sends the PDF by their own email or phone process. The site does not send prices.

### 7.7 Testing and automated protection

| Check | How | Fails the build if |
|---|---|---|
| Schema isolation | pgTAP test runs queries as `anon`, `authenticated`, editor, reviewer, and owner-without-MFA | Any non-owner role can select or modify `private.*` |
| Public payload scan | Build scans all public HTML/JS/JSON for rate keys, multiplier names, and `private` schema names | Any match |
| Network check | Playwright loads every public page in EN and ES, records all responses, and searches for pricing terms and numbers in price format | Any pricing content found |
| Email check | Template render tests with sample data | Any pricing variable in an email template |
| Log check | Automated search of function logs in tests | Pricing values in logs |

### 7.8 Accepted residual risk

The owner's own browser displays pricing after MFA. That is necessary for the owner to work. Mitigations are MFA, short sessions, no caching, audit, and the owner's device security. A stolen unlocked device is the main residual risk; the owner should enable the device's own lock.

---

## 8. Database structure

PostgreSQL (Supabase). UUID primary keys, `snake_case`, `created_at` and `updated_at` on every table, soft delete (`deleted_at`) where restore matters. Translatable fields are `jsonb` objects `{"en": "...", "es": "..."}`; status per locale is stored alongside.

### 8.1 Content (public when published)

| Table | Key columns | Notes |
|---|---|---|
| `site_settings` | `key` pk, `draft jsonb`, `published jsonb` | Business identity, contact, hours, service area, turnaround settings, SEO defaults, maintenance flag |
| `site_strings` | `key` pk, `en`, `es`, `en_status`, `es_status`, `context` | Every interface string, seeded in both languages |
| `pages` | `id`, `slug jsonb` (per locale), `title jsonb`, `meta jsonb`, `draft_sections jsonb`, `published_sections jsonb`, `status jsonb`, `visible`, `sort_order` | Sections typed and validated by schema |
| `nav_items` | `id`, `location`, `label jsonb`, `target jsonb`, `sort_order`, `visible` | |
| `services` | `id`, `slug jsonb`, `name jsonb`, `summary jsonb`, `description jsonb`, `included jsonb[]`, `excluded jsonb[]`, `frequencies text[]`, `image_ids uuid[]`, `faq_ids uuid[]`, `preselect_key`, `sort_order`, `visible`, `status jsonb` | Included and excluded lists are bilingual |
| `projects` | `id`, `slug jsonb`, `title jsonb`, `category`, `city`, `description jsonb`, `before_image_id`, `after_image_id`, `permission_confirmed bool`, `featured`, `published_at`, `sort_order`, `status jsonb` | Publishing requires `permission_confirmed = true` |
| `standards` | `id`, `title jsonb`, `body jsonb`, `items jsonb`, `sort_order`, `status jsonb` | |
| `articles` | `id`, `slug jsonb`, `category`, `title jsonb`, `body jsonb`, `access_tier` (public / after_request), `sort_order`, `status jsonb` | FAQs and information pages |
| `resource_items` | `id`, `kind` (presentation / packet_template / guide), `title jsonb`, `summary jsonb`, `access_tier`, `sort_order`, `status jsonb` | Welcome Center items |
| `documents` | `id`, `title jsonb`, `description jsonb`, `access_tier`, `visible`, `status jsonb` | One document, separate files per locale |
| `document_versions` | `id`, `document_id`, `locale`, `storage_path`, `bytes`, `sha256`, `version_no`, `uploaded_by`, `created_at` | Public bucket; kept for rollback |
| `media_assets` | `id`, `storage_path`, `mime`, `width`, `height`, `bytes`, `alt jsonb`, `caption jsonb`, `focal_x`, `focal_y`, `source` (company_photo only), `ownership_confirmed bool`, `tags text[]`, `deleted_at` | `ownership_confirmed` required before publish |
| `media_usages` | `asset_id`, `entity_type`, `entity_id` | Blocks deletion of images in use |
| `content_versions` | `entity_type`, `entity_id`, `version_no`, `snapshot jsonb`, `published_by`, `published_at`, `note` | Version history and rollback |

### 8.2 Estimate form (definition public; responses private)

| Table | Key columns | Notes |
|---|---|---|
| `form_definitions` | `id`, `name`, `version`, `enabled`, `photo_limit`, `turnaround jsonb` | One active form |
| `form_steps` | `id`, `form_id`, `title jsonb`, `sort_order` | |
| `form_fields` | `id`, `step_id`, `key` (stable), `type`, `label jsonb`, `help jsonb`, `required`, `validation jsonb`, `show_if jsonb`, `sort_order`, `version` | `key` never changes; old submissions stay readable |
| `form_field_options` | `id`, `field_id`, `value`, `label jsonb`, `sort_order`, `visible` | |
| `consent_texts` | `id`, `text jsonb`, `version`, `active_from` | Stored per submission |

Only the published form version is returned to the public. There is no price field of any kind in the form schema (enforced by a check constraint on field keys).

### 8.3 Requests (private)

| Table | Key columns | Notes |
|---|---|---|
| `submissions` | `id`, `reference` (short, human), `status`, `locale`, `form_version`, `consent_version`, `contact_name`, `contact_email`, `contact_phone`, `services text[]`, `location_text`, `out_of_area bool`, `answers jsonb`, `source_page`, `spam_score`, `idempotency_key` unique, `ip_hash`, `approved_at`, `archived_at`, `created_at` | No raw IP stored |
| `submission_files` | `id`, `submission_id`, `storage_path` (private bucket), `mime`, `bytes`, `sha256` | Signed URLs only |
| `submission_notes` | `id`, `submission_id`, `body`, `author_id`, `created_at` | Internal |
| `submission_events` | `id`, `submission_id`, `type`, `from_value`, `to_value`, `actor_id`, `created_at` | Status and send history |
| `packet_tokens` | `id`, `submission_id`, `token_hash`, `expires_at`, `revoked_at`, `view_count`, `last_viewed_at` | §5.3 |
| `packet_items` | `id`, `submission_id`, `title`, `body`, `document_ids uuid[]`, `locale` | Owner-written, customer-specific packet content |

### 8.4 Pricing (private schema)

| Table | Key columns | Notes |
|---|---|---|
| `private.rate_rules` | `id`, `key`, `kind` (base, band, multiplier, addon, minimum, travel, tax, discount, credit), `value numeric`, `unit`, `conditions jsonb`, `status`, `version` | Owner-only |
| `private.rate_versions` | `id`, `rule_id`, `snapshot jsonb`, `changed_by`, `changed_at`, `note` | Append-only |
| `private.worksheets` | `id`, `submission_id`, `rule_version_ids uuid[]`, `inputs jsonb`, `line_items jsonb`, `totals jsonb`, `created_by`, `created_at` | Owner-only |
| `private.worksheet_exports` | `id`, `worksheet_id`, `kind`, `created_at` | Every PDF generation |

### 8.5 Email

| Table | Key columns | Notes |
|---|---|---|
| `email_templates` | `key` pk, `subject jsonb`, `body_html jsonb`, `body_text jsonb`, `variables` (allow-list), `enabled`, `status jsonb` | EN and ES |
| `email_recipients` | `id`, `event`, `address`, `active` | Owner alerts |
| `email_log` | `id`, `template_key`, `locale`, `to_hash`, `status`, `provider_id`, `error`, `created_at` | Addresses hashed; 90-day retention |

### 8.6 Access and audit

| Table | Key columns | Notes |
|---|---|---|
| `admin_roles` | `user_id` pk, `role` (owner, editor, reviewer), `active`, `created_at` | Mirrored into JWT `app_metadata` by a server-side hook |
| `audit_log` | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `diff jsonb` (no pricing values), `ip_hash`, `created_at` | Append-only: no update or delete grants for anyone |

Enums (`submission_status`, `section_type`, `field_type`, `role`, `access_tier`, `locale`) are database types, so invalid values are rejected in the database.

---

## 9. Email notifications (bilingual)

| Event | Recipient | Locale | Contains pricing? |
|---|---|---|---|
| Request received | Customer | Customer's locale | **No**: reference, owner's turnaround text, phone, links to "after request" resources |
| Request received | Owner recipients | Owner's preferred language | **No**: reference, name, service, location, time, link to admin |
| Out-of-area request | Owner | Owner's language | **No** (flag and link only) |
| Follow-up | Customer | Customer's locale | Only if the owner types it |
| Estimate approved, packet ready | Customer | Customer's locale | **No**: packet link only |
| System error | Owner (technical) | English | **No**: error code and reference only |

Rules:
- Templates are stored per locale with a variable allow-list, checked when saved and when sent.
- Free-text answers from the form are never placed in customer or owner emails; they remain in the admin.
- Sending domain: a subdomain (for example, `mail.<domain>`) with SPF, DKIM, and DMARC, so emails reach the inbox.
- Each send is logged (hashed address) and retried up to three times.
- Free-tier limit: 3,000 emails per month and 100 per day (§13). A monthly send counter in the admin warns at 80%.

---

## 10. Photos, documents, and the "real photos only" rule

### 10.1 Photos

- **Real company photos only.** The system accepts only photos the owner uploads. There is no stock library, no AI image generation, no placeholder photos, and no fictional portfolio images anywhere in the code, seed data, or demos.
- Empty image slots show nothing or the navy brand block with the logo. Pages do not show fake images while content is missing; the admin warns the owner which slots are empty.
- Each photo requires an `ownership_confirmed` checkbox ("This photo was taken by Bridiant or we have permission to use it") before it can be published. People in photos require written permission to be shown (the owner confirms this in the same checkbox text).
- Project photos require `permission_confirmed` on the project (client named or not, and client's permission).
- Limits: JPEG, PNG, WebP, HEIC (converted). 10 MB per upload; resized to 2400 px long edge in the browser; EXIF and GPS removed; responsive sizes 480, 768, 1200, 2000 px.
- Storage on free tier: 1 GB total (§13). Resizing keeps about 300–500 KB per photo, so roughly 2,000 photos fit. The admin shows storage use.

### 10.2 Documents

- PDF only, 20 MB limit, validated by magic bytes, page-count limit (default 50).
- Separate EN and ES files; each file versioned. Previous versions are kept for rollback and to avoid broken links.
- Access tier per document (public, after request, after approval via packet).

### 10.3 Estimate photos (private)

- Accepted: JPEG, PNG, WebP, HEIC. 10 MB each; owner-set count (default 6).
- Private bucket; no public URL; signed URLs expire after 5 minutes.
- Metadata stripped on upload.
- No malware scanner on the free tier. Mitigation: type allow-list by magic bytes, no executables or archives, size limits, images rendered only inside the admin's image viewer. Accepted residual risk; revisit if a scanner becomes affordable.

---

## 11. Security and access control

### 11.1 Layers

| Layer | Control |
|---|---|
| Edge | Cloudflare DNS, HTTPS only, HSTS, Cloudflare WAF managed rules and rate-limiting rules on the form, login, and packet endpoints (free-plan rules, limits in §13) |
| Admin entry | Cloudflare Access (free plan, one-time PIN or identity login) in front of `admin.<domain>` |
| Authentication | Supabase Auth: email and password (minimum 12 characters), TOTP multi-factor **required** for every admin role, recovery codes at setup |
| Authorization | Role-based access enforced by Postgres Row Level Security and `SECURITY DEFINER` functions, not only by the UI |
| Application | Shared zod schemas in the browser, functions, and database constraints; output escaping; rich text sanitized with an allow-list (DOMPurify) |
| Secrets | Service-role key and API keys only in function environment variables and GitHub Actions secrets; never in browser code, the repo, or logs |
| Headers | Strict Content Security Policy (no inline scripts, no third-party origins), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restricting unused features |
| Audit | Append-only audit log of changes, publishes, role changes, exports, pricing views, token creation |
| Supply chain | Lockfiles, Dependabot alerts and updates, secret scanning in GitHub |

### 11.2 Roles

| Role | Can | Cannot |
|---|---|---|
| Owner | Everything, including Pricing (MFA step-up), Team & Roles, Audit Log, exports, deletion, packet links | — |
| Editor | Content, Welcome Center, media, documents, form questions, email templates, publish | Pricing, requests' notes, roles, audit, exports |
| Reviewer | View and update requests, notes, status, send follow-ups | Content, pricing, roles, settings, exports |
| Public (anonymous) | Read published content in either locale; submit the form through the intake function; open a packet link with a valid token | Drafts, requests, files, settings, pricing, logs, other customers' data |

### 11.3 Row Level Security summary

| Table group | Public | Editor | Reviewer | Owner |
|---|---|---|---|---|
| Published content (pages, services, projects, articles, resource items, documents metadata) | Read published rows (both locales) | Read and write drafts; publish | Read | Full |
| `site_settings` (public keys) | Read published | Write non-legal keys | — | Full |
| Form definitions | Read published | Write | — | Full |
| `submissions`, `submission_files`, notes, events | None (insert only through the intake function) | None | Read; update status and notes | Full |
| `packet_tokens`, `packet_items` | Via token-checked function only | None | Create packet items (no token creation) | Full |
| `email_templates`, `email_recipients` | None | Write | None | Full |
| `email_log` | None | None | Read | Read |
| `private.*` (pricing) | **None** | **None** | **None** | Owner with MFA only |
| `audit_log` | None | None | None | Read only, no one can update or delete |
| `admin_roles` | None | None | None | Full |

Enforced rules:
- Anonymous users never receive `INSERT` on `submissions` (prevents direct spam writes with the public key).
- RLS is enabled on every table in an exposed schema; a test fails if any table lacks RLS.
- Roles come from server-set `app_metadata`, never from `user_metadata`.
- Storage policies mirror the table policies. The private bucket has no public policy.

### 11.4 Abuse, spam, and privacy

- Cloudflare Turnstile (free), honeypot field, rate limits by hashed IP, maximum submission size (20 KB text), spam scoring with auto-archive.
- Privacy notice, terms, and consent text are editable and versioned in both languages. Consent version is stored with each submission.
- Data requests (view, correct, delete): searchable in the admin; deletion removes files too and writes an audit entry.
- No cookies on the public site at launch, so no cookie banner is needed for analytics. Re-check if any non-essential cookie is added.
- No personal data in logs. IP addresses stored only as salted hashes.

### 11.5 Admin hardening

- `noindex, nofollow` and `X-Robots-Tag` on the admin domain; not linked from the public site.
- Login throttling; lockout after repeated failures; new-device sign-in alerts to the owner.
- Idle timeout 30 minutes; absolute session 12 hours; step-up MFA for Pricing, role changes, exports, and deletions.
- Confirmation dialogs with audit entries for destructive actions.

### 11.6 What customers must never see

- Rates, multipliers, discounts, credits, margins, pricing formulas, or price ranges
- Other customers' data, request statuses, notes, or assignments
- Admin email addresses, roles, team information, audit entries, IP hashes, draft content, unpublished pages
- Error details, stack traces, environment names, internal URLs, source maps (disabled in production)

Automated checks in §7.7 and §11.3 enforce this.

---

## 12. Backups without a paid subscription (requirement 6)

### 12.1 Why this is needed

Supabase's free plan **does not include automated backups** (per third-party summaries and Supabase's pricing comparison; see §13 for sources). Without action, a database loss or accidental deletion could mean losing all requests, content versions, and pricing history.

### 12.2 Design (free)

| Item | Method | Free service | Frequency | Keep |
|---|---|---|---|---|
| Database | `pg_dump` (custom format, schema and data) run by a scheduled GitHub Actions workflow, connecting with a read-only backup role | GitHub Actions (free for private repos within the monthly minute allowance) | Daily at a fixed time | 30 daily + 12 monthly |
| Encryption | Dump encrypted with `age` (open source) using a public key committed to the repo; the **private key is kept only by the owner** (offline, plus a second copy in a password manager) | — | Every dump | — |
| Destination | Encrypted file uploaded with `rclone` to a dedicated folder in the **owner's Google Drive** (15 GB free) | Google Drive, owner account | Daily | Pruned by the script to the retention above |
| Storage files (photos, documents) | `rclone copy` (incremental; files are immutable with random IDs, so only new files transfer) | Same | Daily | Storage files are never deleted by the backup job |
| Code and configuration | Git history on GitHub | GitHub Free | Every commit | Full |
| Restore drill | Restore the latest encrypted dump into a local PostgreSQL (Docker, free) and check row counts and sample records | Local machine | Monthly, owner-scheduled; logged | — |

Recovery objectives on the free plan:
- **RPO (data you could lose):** up to about 24 hours (time since last nightly dump).
- **RTO (time to restore):** several hours, mostly manual.

### 12.3 Limitations of the free design (stated plainly)

1. **No point-in-time recovery.** Daily dumps only; changes made after the last dump can be lost.
2. **Manual restore.** Restoring to a new Supabase project requires the owner or developer to run the documented steps.
3. **Egress limit.** Downloading storage files for the backup counts against Supabase's free egress allowance (§13). Incremental copies keep this small, but a full copy of a large storage bucket could exceed it. The job reports transfer size and stops if it nears the limit.
4. **Google Drive quota** is shared with the owner's other files. The job reports usage.
5. **Scheduled workflows can be disabled** by GitHub after a long period without repository activity. The monthly restore drill includes a check that the last backup is recent. Alerts go to the owner by email through the GitHub notification settings.
6. **Key custody.** If the `age` private key is lost, backups cannot be decrypted. The owner keeps two copies, and the key is never stored in the repo or in GitHub secrets.
7. **Encryption only protects backups at rest.** Access to the Google account is protected by the owner's account security (two-step verification required).

### 12.4 Paid upgrade path (not activated; requires approval)

Supabase Pro adds daily backups and removes the inactivity pause. Cost and reasons are in §17.

---

## 13. Exact free stack and free-tier limitations

Limits below come from published pricing summaries checked during this revision. Each must be confirmed on the vendor's pricing page before implementation, because limits change. Items marked **(verify)** conflict between sources or come from third-party summaries only.

| Need | Service and version policy | Free allowance (as checked) | Key limitations | Launch risk |
|---|---|---|---|---|
| Public site | **Astro** (current stable major, pinned in lockfile) + Tailwind CSS | Open source | None meaningful | Low |
| Admin | **React + Vite**, TanStack Query, react-hook-form + zod, Tiptap (restricted editor), DOMPurify | Open source | None meaningful | Low |
| Hosting | **Cloudflare Pages** (Free) for public and admin projects | Up to 500 builds per month; 1 concurrent build; builds time out after 20 minutes; up to 20,000 files per site (verify); up to 100 custom domains per project | Build queue is one at a time; a long build delays publish | Low |
| Database, auth, storage, functions | **Supabase Free** | 2 active projects; 500 MB database per project; 1 GB file storage; 5 GB egress (verify; one source lists 10 GB); 50,000 monthly active users; Edge Functions included within free quota | **Projects pause after 1 week of inactivity** (data kept; restore from the dashboard). **No automated backups** (§12). Limited storage. Egress also used by backup downloads | **High** |
| Edge security and admin entry | **Cloudflare Access** (Zero Trust Free), **Turnstile** (Free), WAF rules (Free), DNS | Access free for up to 50 users (verify); Turnstile free with unlimited use in its managed mode (per Cloudflare GA announcement); Web Analytics free | Access free plan has feature limits compared with paid Zero Trust (verify on the pricing page). WAF custom rules count is limited on the free plan (verify) | Low |
| Email | **Resend** (Free) | 3,000 emails per month; 100 per day; one domain (one source says three) (verify) | Daily cap of 100 is the constraint for busy days. Over-limit behavior: sending may pause on the free plan (one source; verify). Deliverability depends on DNS setup | **Medium** |
| Source control, CI, scheduled backups | **GitHub** (Free) and GitHub Actions | Private repos get a monthly Actions minute allowance and limited Actions storage (verify current figures) | Scheduled workflows can be disabled after inactivity; minutes can run out | Medium |
| Backup storage | **Google Drive** (owner's existing account) | 15 GB shared with other Google services | Shared quota; owner must manage | Low |
| Encryption and sync | **age**, **rclone** | Open source | Owner must keep the private key | Medium (process) |
| Testing | Vitest, Playwright (WebKit for iPhone profiles), axe-core, Lighthouse CI | Open source | Tests run in CI minutes | Low |
| Errors | **Sentry** Developer plan (free) **or** no monitoring at launch | Free plan event limit (verify) | Adds a third-party script to the admin only if approved | Low |
| Images | Browser-side resize and HEIC conversion (open-source libraries) | None needed | Large photos take longer on older phones | Low |
| PDFs | **pdf-lib** on the server | Open source | Simple layouts only | Low |
| Spreadsheet export | **SheetJS** community edition (open source) | Open source | Limited features (no styling) | Low |
| Domain | Owner's existing domain | Not free (~$15/year typical) | Requires owner purchase or existing domain; owner action | Owner action |

Verification notes: Supabase, Resend, and Cloudflare figures are from third-party summaries and cross-checked against Cloudflare's official Pages limits page. Sources are listed in the chat response accompanying this revision. Official pricing pages must be checked before purchase or activation.

### 13.1 What the free plan does not provide, and when that matters

- Automated backups (§12).
- Projects that stay awake permanently. An unused admin for seven days pauses the database. **While paused, the estimate form cannot save requests.** The form shows the owner's phone number and an email link as a fallback, and the failure is logged on the device only.
- Phone or SMS notifications (email only).
- Multi-region or high-availability hosting.
- Guaranteed support response times.

---

## 14. Existing application: reuse versus rebuild (requirement 1 and 2)

The estimate app (`index.html.html`, about 2,870 lines, a single file) was reviewed for its functions, sections, and external scripts. Its features are listed in §14.3.

### 14.1 Safe to reuse (as concepts, data definitions, or ported logic after review)

| Feature | What is reused | How it changes |
|---|---|---|
| Estimate sections (company, client, service, property, property details, areas, add-ons, schedule, access, notes, terms) | The field set and grouping become default form steps (§4.2) and admin request fields | Rebuilt as the form-builder schema, bilingual, server-validated |
| Service and property types | Categories and labels | Moved into the Services editor, bilingual |
| Pricing **structure** (base, area or size bands, add-ons, frequency, minimum, tax, discount) | The formula *shape* | Re-expressed as server-side rate rules in `private` (§7). Values are re-entered by the owner, not copied from the page |
| Discount and tax inputs | Concept of percent or fixed discounts and a tax rate | Owner-only rules with versions |
| Estimate numbering and duplicate-estimate | Concept | Reference numbers and worksheet duplication on the server |
| Export to CSV and Excel (SheetJS) | Export formats | Owner-only, server-side, logged |
| PDF output | Document layout ideas (header, client block, line items, totals, terms, signature area) | Re-rendered on the server (pdf-lib), with a customer version that omits internal lines (§7.6) |
| Dashboard | Counts and recent items | Rebuilt as the admin dashboard (§6.1) |
| Logo upload | Concept of a company logo | Owner-managed brand asset (SVG or PNG) |
| Manifest and icon set | `manifest.json`, `icons/` | Reused after review; names and colors updated to the approved palette |
| Autosave | Concept | Draft autosave in the admin (server-backed); customer form progress saved on device only |
| Share summary | Concept | Owner's follow-up templates, no browser-side pricing |

### 14.2 Must be rebuilt (do not reuse)

| Feature in current app | Why not reused | Replacement |
|---|---|---|
| `computeSmartPrice`, `estimateTotalFromState`, pricing in browser JS | Pricing is visible to anyone who opens the page; security requirement | Server-side pricing engine (§7) |
| Client database in `localStorage` | Not shared, not backed up, lost when site data is cleared | Server-side client records in the admin with the backup plan (§12) |
| PIN lock with local PIN storage and biometric unlock | PIN is stored in the browser; not a real access control | Supabase Auth with TOTP MFA and session timeouts (§11) |
| Client-side PDF with pricing (jsPDF, html2canvas) | Pricing rendered in the browser; large scripts from CDN | Server-side pdf-lib PDF; no third-party CDN scripts |
| Share via SMS, WhatsApp, and browser share with prefilled totals | Can expose pricing outside the admin; uncontrolled | Owner-sent messages from templates without prices |
| Dark mode toggle and `data-theme` palette | Outside approved palette | Single brand palette (§1) |
| Hard-coded colors (`#d4a017`, `#7a2e2e`, `#ff8a80`, `#4a3b78`, `#0f5c4c`) and the off-brand navy `#0B1F3A` | Violates palette | Design tokens (§1) |
| Hard-coded Spanish UI text only | Not bilingual management | `site_strings` in EN and ES (§2) |
| Service-worker caching of app data | Risk of stale or cached private data | Service worker caches only public site shell; admin never caches data |
| Signature pad for the client (drawn and uploaded signatures) | Customer signing is not part of the approved journey (estimate is approved outside the site) | Deferred. If needed later, owner-only signature image on the PDF, with approval first |
| `index.html.html` as a public file | Public exposure of all logic and rates | Retired after migration (§14.4) |
| `vercel.json.txt.txt` (Vercel config) | Vercel Hobby is non-commercial by terms; not used | Cloudflare Pages |
| Google Fonts and external CDN scripts | Third-party requests; unnecessary for launch | Local system fonts and bundled code |

### 14.3 Feature inventory checked (for the record)

Sections (13): company, client, service description, property, property details, areas, add-ons, schedule, pricing, access, notes, terms, signatures. Also: estimate numbering, estimate history, client database with favorites, duplicates and deletion, autosave, preview, print, PDF/Excel/CSV export, share (email, SMS, WhatsApp, browser share), signature pad (draw and upload), logo upload, currency formatting, tax and discount inputs, PIN lock and biometric unlock, dark mode, PWA install, settings overlay.

### 14.4 Migration of existing estimates (Phase 4, optional, approved first)

- Existing estimates live only in each browser. Migration is possible only from a browser that has them: the owner exports them (CSV or JSON from the old app, using its existing export) and imports them into the admin.
- Imported estimates are marked "imported" and do not include the old pricing logic.
- Before migration, the owner confirms the list of estimates to import. Personal data is limited to what is needed.
- Retire the public copy of `index.html.html` immediately, regardless of migration timing.

---

## 15. Technical risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | Pricing exposure (current app ships rates to the browser) | High / High | Remove the public copy now; server-side pricing; automated leak scans (§7.7) |
| 2 | Supabase free project pauses after 7 days of no use; form cannot save requests while paused | High / High | Accepted on free plan only with the fallback phone and email shown on the form; owner logs in weekly; Pro upgrade trigger in §17 |
| 3 | No automated database backups on free plan | High / Critical | Nightly encrypted dumps to Google Drive, monthly restore drill (§12); Pro upgrade trigger |
| 4 | Backups fail silently (GitHub schedule disabled, token expires) | Medium / High | Monthly restore drill; last-backup check; owner email alerts |
| 5 | Lost encryption key | Low / Critical | Two owner-held copies; documented key procedure; test restore |
| 6 | Admin account takeover | Medium / Critical | Cloudflare Access + TOTP MFA + lockouts + recovery codes + new-device alerts |
| 7 | Spam floods the request inbox | High / Medium | Turnstile, honeypot, rate limits, spam scoring, auto-delete |
| 8 | Resend daily cap (100/day) exceeded during a busy day | Low / Medium | Monthly and daily counter; overflow notice in admin; owner checks the inbox daily; Pro trigger if needed |
| 9 | Email in spam | Medium / High | Sending subdomain, SPF/DKIM/DMARC, test before launch |
| 10 | Bilingual content incomplete or poor Spanish | Medium / High | Both-locale publish gate; owner or fluent reviewer approves Spanish; no auto-translation for legal or pricing |
| 11 | Packet link forwarded to someone else | Medium / Medium | Expiring, revocable tokens; contains no payment data; owner controls contents |
| 12 | Photos without permission or non-company images | Medium / High | Real-photo-only rule; ownership and permission checkboxes required before publish |
| 13 | Oversized or malicious uploads | Medium / Medium | Magic-byte checks, size limits, metadata stripping; no malware scanner (accepted, documented) |
| 14 | Free storage (1 GB) fills with photos | Medium / Medium | Resizing; storage meter; owner-managed photo retention |
| 15 | Egress limit exceeded by backup downloads | Low / Medium | Incremental copies; job stops near limit; alert |
| 16 | Build queue delay (one concurrent build) during many edits | Low / Low | Publish batches changes; status shown in admin |
| 17 | iPhone-specific layout or input issues (zoom, safe area, dynamic viewport) | Medium / Medium | iPhone-sized design baseline; input font size ≥16 px; WebKit tests; owner test on own iPhone before launch |
| 18 | Off-palette colors creep in | Low / Medium | Token lock, lint rule, palette check at publish |
| 19 | Scope creep into booking, payments, or customer accounts | Medium / Medium | Out of scope; stated on confirmation page; any change needs approval |
| 20 | Vendor lock-in | Low / Medium | Standard Postgres; exportable data; dumps off-platform; content as JSON |
| 21 | Legal exposure (privacy, consent, retention) | Medium / High | Editable, versioned, bilingual notices; owner reviews with counsel |
| 22 | Free-tier terms change | Medium / Medium | Verify before each phase; upgrade triggers documented |

---

## 16. Phased plan (proposed; nothing starts before approval)

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Confirm | Owner review of this revision; answers to §18; owner collects real photos and business facts; owner decides on domain and Spanish reviewer | Written approval |
| 1. Public site (EN and ES) | Pages, language switcher, palette and tokens, section library, real-photo slots, iPhone baseline, seed content (EN and ES drafts for owner review), performance and accessibility baseline | Lighthouse mobile budgets met; axe clean; WebKit iPhone tests pass; pricing-leak scan passes |
| 2. Content admin | Auth + MFA, roles, editors for pages, services, work, standards, Welcome Center, media, documents; both-locale publish gate; draft → preview → publish; version history and rollback | RLS tests pass; publish rebuilds both locales; rollback verified |
| 3. Request form, inbox, emails | Form builder, bilingual multi-step form, intake function, Turnstile, uploads, requests inbox, statuses, notes, bilingual emails, packet tokens, Welcome Center tiers | End-to-end test at 390 px in EN and ES; spam tests; email content checks; fallback phone shown while paused |
| 4. Pricing engine and worksheet | `private` schema, rate rules and versions, owner-only worksheet, server-side PDF, discounts and credits, audit | Schema isolation tests pass; leak scans pass; worksheet used on a real estimate; optional legacy-estimate import (if approved) |
| 5. Backups, hardening, launch | Backup workflow, encryption, Google Drive upload, restore drill, runbooks, DNS and email authentication, privacy notice review, owner iPhone test | Restore drill passes; backup alert tested; go-live checklist signed by owner |

---

## 17. Paid options: not activated (approval required)

No paid service is subscribed or activated. Each option below must be approved separately after review of its cost and limits.

| Option | Cost (vendor list price, verify before purchase) | What it adds | Why you might approve | Limitation remaining |
|---|---|---|---|---|
| Supabase Pro | About $25 per month per organization (verify) | Daily backups, removes inactivity pause, higher storage and egress | Removes the two highest-risk free-tier issues (pauses and backups) | Still needs a restore test |
| Resend paid plan | Pro about $20 per month for 50,000 emails (verify) | Higher sending volume, no daily cap | Only if the free daily cap is repeatedly hit | Email deliverability still depends on DNS |
| Cloudflare Zero Trust paid seats | Per-user price beyond the free allowance (verify) | More users or advanced access features | Only if more than 50 people need admin access | Not needed for owner-only launch |
| Domain | About $15 per year (verify) | Required for email authentication and the admin subdomain | Needed unless the owner already has a domain | Owner purchase |
| Malware scanning for uploads | Varies by provider (none chosen) | Scans uploaded files | Only if uploads grow or risk rises | Adds integration work |

Recommendation: start on the free plan as requested, accept the risks in §15 items 2–4, and approve Supabase Pro before go-live if the owner cannot accept a 7-day pause or a 24-hour data-loss window.

---

## 18. Decisions and inputs needed before implementation (superseded by §20)

1. **Confirm the revised Welcome Center tiers** in §5.2 and the packet process in §5.3.
2. **Spanish review:** who will review Spanish text (owner, or a fluent reviewer)? Pricing, legal, and contract wording needs a fluent reviewer.
3. **Real photos:** the owner collects company photos (before and after, team at work, equipment, finished spaces) with permission for any people shown. Site launches with empty slots until photos are provided.
4. **Subtle tints:** confirm navy at reduced opacity is acceptable for borders and backgrounds (per your decision 3 this is allowed; confirming the navy-only states in §1.1).
5. **Turnaround text:** the wording and unit for estimate turnaround in EN and ES (for example, "within 2 business days").
6. **Service area:** ZIP list or radius, and the out-of-area message.
7. **Included and excluded tasks** for each service, and form questions to start with (I will draft defaults in both languages for review).
8. **Business facts:** license and insurance statements (if any), years in business, hours, phone, email, address, and any after-hours line.
9. **Domain:** existing domain name, or permission to propose one. Domain purchase is an owner action.
10. **Notification recipients** and the owner's preferred language for alerts.
11. **Backup key custody:** confirm the owner will keep the `age` private key in two places and has a Google account with two-step verification.
12. **Estimate app:** confirm the public copy is removed now, and whether a legacy-estimate migration is wanted (§14.4).
13. **Retention:** submission archive and delete windows (proposed: 12 months and 30 days for spam).
14. **Staff:** number of admin users and their roles at launch.
15. **Approval of the free stack** in §13, and approval that paid options in §17 remain unactivated until you approve each one.

---

## 19. Revision 3 clarifications (authoritative)

These clarifications supersede conflicting text in Revisions 1 and 2. Nothing in this section authorizes implementation, deployment, paid service activation, integration, or publishing.

### 19.1 Source materials and no invented content

Rules:

- **R1 — No invented business content.** The system and seed data contain no company information, service descriptions, included or excluded tasks, policies, prices, rates, discounts, credits, form answers, FAQs, welcome-packet text, testimonials, licenses, or insurance statements that the owner has not supplied and approved. Each such field is seeded as a placeholder, for example `[OWNER TO PROVIDE: service description, Office Cleaning, EN]`.
- **R2 — Placeholders never publish.** The publish gate rejects any content containing a placeholder marker. Public build scans also fail the build if a placeholder marker reaches public output.
- **R3 — Owner-supplied means pending until approved.** Material from the owner enters as "owner-supplied, pending approval." Each item needs its own explicit approval (no bulk approval of a whole section). The approval records approver, time, and source file reference in the audit log.
- **R4 — Replacing published content needs approval.** Changing already-published text, a photo in an existing slot, or a document file creates a pending change with a before-and-after view. Nothing auto-publishes, and no owner-provided content replaces published content without that approval.
- **R5 — The system drafts nothing for publication.** If an assistant proposes wording (for example, Spanish text or FAQ wording for review), it is stored as "draft — not approved," cannot be published, and is presented as a proposal the owner can accept, edit, or reject item by item.
- **R6 — Business facts come only from approved values.** Phone, email, address, hours, service area, turnaround text, legal name, and any license or insurance statement stay as placeholders until supplied and approved.
- **R7 — Pricing is empty at launch.** The system ships with zero rate rules. No quote calculation can be made until the owner enters rates and approves a rate version. Discounts and credits likewise start empty.

Missing items are listed in the checklist (§20.2).

### 19.2 Google Drive backups: complete process

#### A. Components and responsibilities

| Component | Role | Who controls it |
|---|---|---|
| GitHub Actions workflow `backup.yml` | Runs the nightly job on the default branch only | Repo owner |
| Read-only Postgres role `backup_reader` | Can read data for the dump; cannot write or delete | Owner creates it in Supabase |
| `age` key pair | Encrypts dumps; public key in repo, private key with owner only | Owner generates it on own computer |
| rclone with Google token (scope `drive.file`) | Uploads to one Drive folder; can only see files it created | Owner authorizes in own Google account |
| Google Drive folder "Bridiant Backups" | Stores encrypted dumps, manifests, storage copies | Owner's Google account (2-Step Verification on) |
| Restore workstation | Owner's computer with Docker and PostgreSQL for drills and restores | Owner |

#### B. One-time setup (only after approval; the owner performs each step)

1. Owner generates the `age` key pair on their own computer. The public key is committed to `backup/age-recipient.txt`. The private key is never sent to chat, the repo, GitHub, Drive, or any AI environment.
2. Owner enables 2-Step Verification on the Google account and creates the Drive folder.
3. Owner creates the `backup_reader` role in Supabase with read-only access to the `public`, `auth`, and `storage` schemas. Its password is generated randomly (32+ characters) and saved only as GitHub secret `SUPABASE_BACKUP_URL`.
4. Owner configures rclone on their own computer and saves the resulting config as GitHub secret `RCLONE_CONFIG_BRIDIANT`.
5. Owner performs a manual test run and a manual restore drill (§19.2 D) before the schedule is enabled.

#### C. Nightly run (steps in order)

1. Checkout the default branch only, with third-party actions pinned to full commit hashes.
2. Install pinned versions of PostgreSQL client tools, `age`, and `rclone`.
3. Dump: `pg_dump --format=custom --no-owner` for schemas `public`, `auth`, and `storage` (object metadata). Supabase internal schemas are excluded.
4. Validate: the file is non-empty, `pg_restore --list` succeeds, and per-table row counts are recorded. Failure stops the run.
5. Encrypt with `age` to the public recipient key. The plaintext dump is deleted immediately.
6. Hash the encrypted file (SHA-256) and write a manifest: timestamp, workflow run ID, byte size, hash, and row counts. The manifest contains no personal data.
7. Upload as `db-YYYY-MM-DD.dump.age.partial`. Verify size and hash with `rclone check`, rename to the final name, then upload the manifest last. Files ending in `.partial` are ignored by restore and pruning.
8. Storage copy: `rclone copy` (never `sync`, so nothing is deleted from Drive) of new objects only. Objects are immutable with random IDs. A transfer cap (set below the free egress allowance, §13) stops the copy before the limit.
9. Retention, run only after a verified upload: keep the last 30 daily dumps and the first dump of each month for 12 months. Deletion uses an explicit file list.
10. Write `last-success.txt` with the timestamp and run ID.
11. Failures exit non-zero. Secrets are never printed (`set +x`, masked values).

#### D. Restore procedures

**Drill (monthly, on the owner's computer; no production change):**
1. Download the latest `.dump.age` file and its manifest. Verify the SHA-256 hash against the manifest.
2. Decrypt with the private key (`age -d -i <key file>`).
3. Restore into a local PostgreSQL container with `pg_restore`.
4. Compare row counts with the manifest and check the latest submission date is recent.
5. Record the result in the owner's drill log. Delete the local decrypted copy.

**Recovery to a new Supabase project (only when needed):**
1. Create a new Supabase project. The free plan allows two active projects (verify current limit).
2. Apply the schema from the repo migrations.
3. Restore data from the decrypted dump with `pg_restore --data-only`, including the `auth` schema (users and MFA factors) and `storage` metadata.
4. Re-upload storage objects from Drive to matching paths with rclone.
5. Update environment variables, redeploy the public and admin sites and functions, and verify end to end.
6. Create a new `backup_reader` role and new GitHub secrets. Re-run the backup job.
7. Expected recovery time: several hours, mostly manual. Expected data loss: up to the last successful nightly dump.

**Corrupted or unreadable backup:** use the previous day's dump. Retention keeps 30 days.

### 19.2 E. Credential protection

| Credential | Protection | If exposed or lost |
|---|---|---|
| `age` private key | Owner-only. Two offline copies: password manager and a printed copy in a secure location. Never in repo, GitHub, Drive, chat, or AI environments | Lost: existing backups cannot be decrypted, so keep two copies. Exposed: generate a new key pair, use it for new backups, and keep the old private key until its backups expire |
| `age` public key | Committed to the repo (not secret) | Not applicable |
| `SUPABASE_BACKUP_URL` (GitHub secret) | Read-only role, unique password, rotated every 90 days and on suspicion. GitHub secrets are write-only and are not shown in logs | Revoke the role password in Supabase; create a new one; update the secret |
| `RCLONE_CONFIG_BRIDIANT` (GitHub secret) | `drive.file` scope limits access to files the app created. Revocable under Google Account → Security → Third-party access | Owner revokes the grant in Google, which stops backups visibly (§19.2 F) |
| Google account | Owner's account with 2-Step Verification. Recovery codes stored offline | Owner recovers the account using Google's recovery process |
| Workflow file | Changes to the default branch need review (branch protection and code-owner review, if available on the owner's plan; verify) | A malicious change could read secrets during a run. Review every workflow change |

Additional controls: the workflow does not run for pull requests from forks, so secrets are not exposed to outside code. Backup contents include personal data and pricing, so the Drive folder is treated as sensitive. Google cannot read dumps encrypted with `age`.

Limitation: anyone who controls the GitHub repository's default branch can change the workflow. Branch protection and a second reviewer reduce that risk. This is a single-owner risk until staff access is added.

### 19.2 F. If GitHub Actions fails

| Cause | How it appears | Protection | Owner response |
|---|---|---|---|
| Workflow error (bad change, tool version) | Failed run | Partial files ignored; prior backups untouched; retention runs only after success | Read the run log; fix; re-run manually |
| Supabase unreachable or paused | Dump step fails | Same as above | Restore the project in the Supabase dashboard; re-run |
| Drive token revoked or expired | Upload step fails | Same as above | Re-authorize rclone; update secret; re-run |
| Drive quota full | Upload fails | Retention pruning helps; storage copy stops at cap | Free space in Drive or accept fewer storage copies; re-run |
| Free Actions minutes used up | Run does not start | Previous backups intact | Wait for monthly reset, or run the manual backup procedure below |
| Scheduled workflows disabled by GitHub after inactivity | No run appears | No new backups | Re-enable the workflow; run manually |
| GitHub outage | No run | No new backups | Wait; run manually if urgent |

**Detection.** Failed runs send GitHub notification email to the repo owner (verify notification settings). `last-success.txt` shows the most recent successful run. The owner checks the Drive folder weekly (calendar reminder recommended). The monthly drill confirms the newest file is recent. Worst-case detection gap if GitHub stops scheduling silently: about one month, which is why the weekly check is required.

**Manual backup procedure (when Actions cannot run):** on the owner's computer, run the same dump-encrypt-upload steps, with the same `age` public key and the same Drive folder. Record the manual run in the drill log. The manual procedure is written as a runbook in Phase 5 and is not created now.

**Effect on the data-loss window.** Every hour without a successful backup adds to the loss window. The owner is told the timestamp of the last successful backup at each drill.

### 19.3 Free-tier reliability

#### A. Principles

- **P1.** The site never shows "received" unless a durable store has acknowledged the write.
- **P2.** No submission is dropped silently. Each failure is visible to the customer, the owner, or both.
- **P3.** The customer can keep a copy of what they entered.
- **P4.** Free-tier limits are documented, monitored, and not accepted silently. The system is not production-ready while the gates in §19.3 F remain open.

#### B. Intake path

1. The public form posts to a **Cloudflare Worker** `intake` (Workers free plan; verify limits). The Worker validates the schema using the shared zod package, verifies Turnstile server-side, applies rate limits, and assigns an **idempotency key** generated in the browser.
2. **Primary write:** Worker → Supabase intake function → `submissions`. On success it returns the reference and the customer sees the received message.
3. **Fallback write** (if the primary fails or times out, about 5 seconds): the Worker writes the same payload to a **Cloudflare D1 table `intake_queue`** and returns a reference with the same received message. Photos are not accepted in fallback; the customer is told to send them later through the confirmation email or by phone.
4. **Owner alert:** each fallback write triggers an owner email containing the reference, the time, and a notice that the request is queued. The email contains no answers.
5. **Drain:** a scheduled Worker runs every 15 minutes and moves queued rows into Supabase. A row is deleted from D1 only after Supabase confirms the record with the same idempotency key. Rows older than 24 hours in the queue trigger an alert.
6. **Why D1 and not email as the fallback store:** the Resend free plan caps sending at 100 emails per day (§13). A full email fallback would fail on exactly the busy day it is needed, and it would spread personal data into mailboxes. Email is used only for notifications.
7. **Last resort** (Cloudflare or Worker outage): the form cannot submit. It shows the owner's phone and email (placeholders until supplied), offers "Save a copy" (a text file of the answers), and keeps the draft on the device for 7 days.

**Decision for owner:** D1 queue (recommended) or email-only fallback (accepts the daily cap and personal data in email). See §20.1 D2.

#### C. Detecting a paused or unavailable database

- **Client-side detection.** Any error, non-success response, or timeout from the intake sends the visitor to the "not received" state (§19.3 D). The form never treats an unknown result as success.
- **Worker health probe.** A scheduled Worker probe runs every 5 minutes and reads a non-sensitive health value from Supabase. It writes nothing. Three consecutive failures over about 15 minutes set `fallback_mode` (Workers KV or a D1 flag; verify limits) and email the owner: "Database unavailable. Requests are being queued."
- **Paused project.** A failing probe with the Supabase dashboard showing the project paused means the free plan's inactivity pause. The runbook: restore the project in the dashboard, confirm the probe passes, and let the drain run.
- **Not a keep-alive.** The probe is not a reliable way to prevent pausing. Whether it counts as activity is unverified. Pause prevention depends on owner use (weekly admin login) or on Supabase Pro (§20.1 D3).
- **Ambiguous timeouts.** If the response is lost after the database has stored the row, the retry with the same idempotency key returns the existing reference, so no duplicates are created.

#### D. Customer messages (all in the visitor's language)

| State | When | Message and actions |
|---|---|---|
| **Received** | Primary or fallback write confirmed | "Thank you. We received your request. Reference [ref]. We will contact you within [OWNER TO PROVIDE turnaround]." Shows the "after request" resources (§19.4) |
| **Not received** | Any failure before a durable write | "We could not send your request just now. Your answers are still saved on this device. Please try again in a few minutes, or call [OWNER TO PROVIDE phone] or email [OWNER TO PROVIDE email]." Buttons: Try again · Save a copy (text file) · Email us (a prefilled email without photos) |
| **Uncertain** | Timeout after sending | "We may already have your request. Please check your email for a confirmation. If you have not received one, call [phone]." Retry uses the same idempotency key, so it cannot create a duplicate |
| **Photos pending** | Received without photos (fallback) | "Your request is received. Please send photos by replying to your confirmation email or by calling us." |

No state shows a reference unless the write was confirmed.

#### E. Free-tier limitations and mitigation

| Limit | Effect on this design | Mitigation | Status |
|---|---|---|---|
| Supabase Free pauses after 1 week without use (verify) | Intake fails while paused; fallback queues | Probe, owner alert, weekly login, Pro option | Open (owner decision D3) |
| No automated Supabase backups on Free | Data loss possible | §19.2 backups | Open until first verified restore |
| Supabase Free storage 1 GB and egress limit (verify) | Limits photos and backup copies | Resizing, storage meter, capped copy | Open |
| Resend Free: 3,000 per month, 100 per day (verify) | Owner alerts and customer emails can be blocked on busy days | Alerts are not the only record (D1 queue); monthly counter; Pro option | Open |
| Cloudflare Workers, D1, KV free allowances (verify) | Fallback could fail under heavy use | Monitor usage; queue purged only after confirmation | Open |
| Cloudflare Pages: one concurrent build, 500 builds per month (verify) | Publishing can queue | Batch edits; status in admin | Accepted |
| Cloudflare Access free user limit, 50 users (verify) | Staff access limited | Owner-only launch | Accepted |
| GitHub Actions minutes and scheduled workflow disabling | Backups can stop | §19.2 F detection and manual procedure | Open |

#### F. Production readiness gates

The system is **not production-ready** until every gate is closed and recorded in the owner's approval:

1. Owner decides the intake fallback (D2) and the Supabase plan or written acceptance of the pause and backup risk (D3, D4).
2. A backup has been created, restored in the drill, and checked against the manifest.
3. The fallback path has been tested end to end: primary failure, queued write, owner alert, drain, and confirmation.
4. Customer states in §19.3 D have been tested on iPhone (Safari) and reviewed in both languages.
5. Email sending domain is verified (SPF, DKIM, DMARC) and a test email arrives.
6. Free-tier limits in §13 are re-verified on each vendor's pricing page.
7. Owner has reviewed and approved all content (no placeholders remain on public pages).
8. Legal pages reviewed by the owner or counsel.
9. Owner tested the site on their own iPhone.

### 19.4 Welcome Center (three access levels, placeholders, and link control)

#### A. Access levels (kept from Revision 2)

| Level | Name | Who can see it | How it is reached |
|---|---|---|---|
| 1 | Public | Anyone | Welcome Center index, navigation |
| 2 | After request | Anyone with the thanks page or the acknowledgment email | Unlisted general pages (`noindex`, not in the index or sitemap). They contain no customer-specific data |
| 3 | After approval (packet) | Only the customer whose estimate is approved, through a link the owner sends | Tokenized link (below) |

#### B. Placeholders (no document exists until the owner supplies and approves it)

| Resource | Level | Placeholder until supplied |
|---|---|---|
| Welcome presentation | 1 | `[OWNER TO PROVIDE: welcome presentation, EN and ES]` |
| FAQs | 1 | `[OWNER TO PROVIDE: question and answer pairs, EN and ES]` |
| Service information sheets (one per service) | 1 | `[OWNER TO PROVIDE: service sheet, <service>, EN and ES]` |
| Cleaning standards document | 1 | `[OWNER TO PROVIDE: standards document, EN and ES]` |
| "What to expect" page | 2 | `[OWNER TO PROVIDE: estimate process text, EN and ES]` |
| Welcome packet guide (PDF) | 3 | `[OWNER TO PROVIDE: welcome packet PDF, EN and ES]` |
| Service agreement template | 3 | `[OWNER TO PROVIDE: service agreement, EN and ES; legal review recommended]` |
| Site access and key procedure template | 3 | `[OWNER TO PROVIDE: access procedure template, EN and ES]` |
| Emergency and after-hours contacts | 3 | `[OWNER TO PROVIDE]` |

A document or page appears only after the owner approves that exact file (or text) and that language version. Approving English does not approve Spanish.

#### C. Packet link lifecycle

1. **Creation.** The owner opens an estimate marked Approved and selects "Create packet link." The system generates a 256-bit random token with a cryptographically secure generator, shows it once, and stores only its SHA-256 hash with the submission ID, scope, creator, creation time, and expiry.
2. **Expiry.** Default 60 days. The owner chooses 7 to 180 days. Expiry is checked on the server at each request, not in the browser.
3. **Delivery.** By the owner's approved email template in the customer's language, or copied by the owner for phone or text. The token never appears in logs, analytics, or notifications.
4. **Transport.** The link uses a URL fragment: `/en/welcome/packet#t=<token>`. Browsers do not send fragments to servers, so the token stays out of server access logs and the Referer header. A small script reads the fragment and sends the token to the packet function in a request header.
5. **Validation.** The function hashes the token, finds the link, checks expiry, revocation, and that the submission is not archived. It returns only the approved packet content in the requested language, with `Cache-Control: no-store`. Each view records the link ID, time, and a view counter, with no personal data.
6. **Failure limits.** Failed attempts are limited per IP address and per link ID, with a temporary lockout after repeated failures.
7. **Revocation.** The owner can revoke one link, revoke all links for a submission, or revoke by rotation (creating a new link revokes the old one by default; the owner can keep both). Links are revoked automatically when a submission is archived, rejected, or deleted. Deletion removes tokens and packet items.
8. **Loss or forwarding.** A lost link is replaced by a new one, and the old one is revoked. A forwarded link gives access to the packet, so the packet must contain only owner-approved, non-sensitive content. The policy prohibits payment or banking details in the packet; the system cannot enforce that content rule, so the owner confirms it when approving the packet.
9. **Backups.** Token hashes are backed up. Tokens themselves are not stored, so a backup cannot reveal a usable link.

#### D. Page controls

- Packet and "after request" pages are `noindex`, excluded from the sitemap, use no third-party scripts, and send `Referrer-Policy: no-referrer`.
- Level 2 pages can be unlisted or revoked by the owner at any time.

### 19.5 Pricing security: confirmation

**Confirmed:** under this design, all pricing rules, discounts, credits, and internal calculations remain private and server-side.

| Exposure channel | Control | Verification |
|---|---|---|
| Customer-facing JavaScript (public site, form) | No pricing code, rates, or rule names in public bundles | Build scan for rate and rule identifiers; fail on match |
| Public API (Supabase REST, GraphQL, Edge Functions) | `private` schema not exposed; GraphQL does not expose it; no public function returns pricing; owner functions check role and MFA level | pgTAP role tests; API probe as anonymous and editor |
| Public PDFs | None generated publicly. The owner's customer PDF shows only line items the owner selects. Rule names, rates, multipliers, and credit logic never appear | Render tests with a canary value; the canary must not appear |
| Emails | No pricing variable in any template allow-list; send-time check | Template tests |
| Logs and errors | Pricing values are never logged; the audit log records action and object ID only; generic public error messages | Log-search test in CI |
| Source files and repo | No rate values in source, seed, fixtures, or docs. Tests generate values at run time | Secret and pattern scan in CI |
| Browser cache and service worker | Admin pricing responses are `no-store`; service worker excludes admin | Header test |
| Backups | Pricing is in encrypted backups only | Key custody (§19.2 E) |
| Owner's admin browser | Pricing visible after MFA step-up | Accepted residual risk (§7.8) |
| Discounts and credits in the form | No field exists for them | Form schema check (no price keys) |

Owner decisions on discount lines: the owner chooses whether a discount appears as a line on the customer PDF. The rule that produced it never appears.

### 19.6 Bilingual content across the customer journey

| Surface | English | Spanish | Rule |
|---|---|---|---|
| Public pages, navigation, footer, legal | Owner-approved | Owner-approved | Publish requires both (or explicit owner-approved fallback per item) |
| Interface text (buttons, errors, form helpers, states) | Proposed for review | Proposed for review, marked "draft" until a reviewer approves | No UI string publishes without approval in both languages |
| Estimate form (questions, options, help) | Owner-approved | Owner-approved | Form cannot publish with a missing locale |
| Confirmation and "not received" messages | Approved | Approved | Same rules as interface text |
| Acknowledgment and follow-up emails | Approved template | Approved template | Sent in the customer's locale |
| Owner alert emails | Owner's language setting | — | Owner preference (D-admin-language) |
| Estimate PDF from the owner | Owner chooses per estimate | Owner chooses per estimate | Default follows the customer's locale |
| Documents | Separate EN file | Separate ES file | A language without an approved file is not shown; no silent fallback to the other language |
| Welcome packet | Approved content in customer's locale | Approved content | Packet shows only the approved language; if the approved language is not the customer's, the owner is warned before sending |
| Admin content editors | Both columns | Both columns | "Copy from English" creates an unapproved Spanish draft; it cannot be published |
| Admin interface | Language to be chosen by owner | Language to be chosen by owner | §20.1 D1 |

**Translation rules:**
- **No automatic translation.** The system does not call translation services, does not auto-fill translations, and does not publish translations.
- **Review record.** A named reviewer approves each Spanish item. The record stores reviewer, date, and item ID in the audit log.
- **Unapproved drafts are visible only in the admin.** They cannot be previewed as public content unless the owner opens a preview that is clearly marked "draft."
- **Reviewer required for legal, pricing, and contract wording.**

### 19.7 Implementation boundaries and the existing application

#### A. Boundaries (apply now and until the owner approves implementation)

- No application code.
- No deployment.
- No paid service, plan, or subscription.
- No connection to Google Drive, Supabase, Cloudflare, Resend, GitHub Actions secrets, or any other integration. No credentials created.
- No modification of the existing public application.
- No pushes and no publishing without owner approval. Commits remain local on branch `claude/bridiant-website-architecture-oophae` (`9a02731`, `2e4f3da`, plus the Revision 3 commit when made). The earlier stop-hook request to push is not being followed because of this instruction.
- Repository access: the earlier push attempts returned HTTP 403 (the Claude GitHub App has no access to the repo). That remains unresolved.

#### B. Security risk notice: existing public estimate application

- **File:** `index.html.html` (single-file estimate app, about 2,870 lines).
- **Risk:** its browser code contains the pricing logic (`computeSmartPrice`, `estimateTotalFromState`) and rate values. Anyone who opens the page source can read them.
- **Status:** the repo does not show whether this file is currently deployed publicly. **Owner must confirm.**
- **Owner action recommended now:** remove it from public hosting, or restrict it behind access control, until it is retired (§14.4). This document does not modify the file.
- **Until addressed:** the file must not be used as a public estimate tool, and no customer should be sent to it.

### 19.8 Revision 3 summary of commitments

- No invented content. Placeholders everywhere; publish blocked until the owner approves each item.
- Backups use free services, are encrypted, and are restore-tested. Limits and failure modes are stated.
- Intake never reports success without a durable write, and the customer always knows what happened.
- Welcome Center keeps three access levels, with placeholders and expiring, revocable, fragment-based packet links.
- Pricing stays private and server-side, with verification for each exposure channel.
- Spanish and English throughout, with no automatic or unapproved translation.
- Implementation, deployment, paid services, integrations, pushes, and publishing all wait for explicit approval.

---

## 20. Owner approval checklist

Nothing below is approved. Tick a box only after deciding. Each source item must be supplied and approved individually before it is used.

### 20.1 Decisions

| ID | Decision | Options | Recommendation | Owner answer |
|---|---|---|---|---|
| D1 | Admin interface language | English, Spanish, or both | English, with Spanish customer content | [ ] |
| D2 | Intake fallback store | Cloudflare D1 queue, or email-only | D1 queue | [ ] |
| D3 | Supabase plan | Free now with risk accepted, or Pro before go-live (about $25/month, verify) | Pro before go-live | [ ] |
| D4 | Written acceptance of free-tier pause and backup risk, if D3 stays free | Accept or decline | Decline unless the owner accepts in writing | [ ] |
| D5 | Backup schedule and retention | Daily; keep 30 daily and 12 monthly | As proposed | [ ] |
| D6 | Backup destination | Owner's Google Drive (15 GB free, shared with Google services) | As proposed | [ ] |
| D7 | Packet link expiry | Default 60 days; range 7–180 | As proposed | [ ] |
| D8 | Packet link delivery | Email template, copied by owner, or both | Both | [ ] |
| D9 | Welcome Center levels | Three levels as in §19.4 A | As proposed | [ ] |
| D10 | Estimate photo limit | Default 6, 10 MB each | As proposed | [ ] |
| D11 | Submission retention | Archive after 12 months; delete spam after 30 days | As proposed | [ ] |
| D12 | Turnaround unit | Business days or hours | Owner chooses | [ ] |
| D13 | Domain | Existing domain, or owner purchase of a new one | Owner chooses | [ ] |
| D14 | Admin subdomain | e.g. `admin.<domain>` | As proposed | [ ] |
| D15 | Staff admin users and roles | Owner only, or owner plus editors or reviewers | Owner only at launch | [ ] |
| D16 | Photo ownership and permission confirmation | Who confirms and how | Owner confirms each photo | [ ] |
| D17 | Legal review of privacy notice, terms, service agreement | Owner review, or counsel | Counsel recommended | [ ] |
| D18 | Spanish reviewer | Name and role | Fluent reviewer for legal, pricing, and contract text | [ ] |
| D19 | English fallback for any item | Allowed per item, or never | Never by default | [ ] |
| D20 | Legacy estimate migration | Yes, no, or later | Later, after review | [ ] |
| D21 | Public estimate app | Confirm whether `index.html.html` is deployed; remove from public hosting | Remove now | [ ] |
| D22 | Owner alert language | English or Spanish | Owner chooses | [ ] |
| D23 | Free stack approval (§13) | Approve, or amend | Approve after limits are re-verified | [ ] |
| D24 | Error monitoring (Sentry free plan) | Include, or not at launch | Not at launch | [ ] |
| D25 | Production-readiness gates (§19.3 F) | Accept as conditions for go-live | Accept | [ ] |
| D26 | Repository access | Restore GitHub App access, or confirm the repo should be handled another way | Owner action required | [ ] |

### 20.2 Source materials and business documents required (all currently missing)

No item below exists in the system yet. Each must be supplied, then approved individually.

| # | Item | Purpose | Format | Language | Status |
|---|---|---|---|---|---|
| S1 | Legal company name, trade name, logo | Brand and legal footer | SVG or PNG with transparent background | — | Missing |
| S2 | Company photos: exteriors, interiors before and after, equipment, finished spaces, team at work (with permission for any people shown) | Our Work, Services, About | JPEG, PNG, WebP, or HEIC; original files | Captions in EN and ES | Missing |
| S3 | Phone, email, address, hours | Contact and footer | Text | EN and ES where needed | Missing |
| S4 | Service area (ZIP list or radius) and out-of-area message | Form validation | Text or list | EN and ES | Missing |
| S5 | Years in business, license and insurance statements (only if true) | About and trust | Text plus license document if shown | EN and ES | Missing |
| S6 | Service descriptions per service: summary, description, included tasks, excluded tasks, frequencies | Services | Text | EN and ES | Missing |
| S7 | Cleaning standards: checklists and any standards document | Cleaning Standards | Text and PDF | EN and ES | Missing |
| S8 | Estimate form questions, options, required flags, help text, photo limit | Request an Estimate | Text list | EN and ES | Missing |
| S9 | Consent text and thank-you text | Form | Text | EN and ES | Missing |
| S10 | Turnaround setting: number, unit, weekend and holiday note | Confirmation, emails | Text | EN and ES | Missing |
| S11 | All pricing rules: base rates, size bands, frequency multipliers, add-ons, minimums, travel fee, tax | Private pricing engine | Owner-entered in admin, approved as a rate version | Internal (no translation) | Missing |
| S12 | Discount and credit rules, with conditions | Private pricing engine | Owner-entered in admin | Internal | Missing |
| S13 | FAQs: question and answer pairs | Welcome Center | Text | EN and ES | Missing |
| S14 | "What to expect" estimate process text | Welcome Center, Level 2 | Text | EN and ES | Missing |
| S15 | Welcome presentation (slides or pages) | Welcome Center | PDF, slides, or text plus images | EN and ES | Missing |
| S16 | Welcome packet guide | Level 3 packet | PDF | EN and ES | Missing |
| S17 | Service agreement template | Level 3 packet | PDF or text | EN and ES | Missing |
| S18 | Site access and key procedure template | Level 3 packet | Text or PDF | EN and ES | Missing |
| S19 | Emergency and after-hours contacts | Level 3 packet | Text | EN and ES | Missing |
| S20 | Privacy notice and terms | Legal pages, form consent | Text | EN and ES | Missing |
| S21 | Email template text: acknowledgment, follow-up, packet-ready, owner alert | Email | Text | EN and ES | Missing |
| S22 | Testimonials, only with written permission | Home or About | Quote and permission record | EN and ES | Missing (optional) |
| S23 | Existing estimate data to migrate (optional), and a list of which estimates to include | Legacy migration | Export from current app | — | Missing (optional) |
| S24 | Spanish reviewer's name and approval of review scope | Translation approval | Owner statement | — | Missing |
| S25 | Owner's preferred contact channel for alerts | Notifications | Text | — | Missing |
| S26 | Confirmation of current public exposure of `index.html.html` | Security | Owner statement | — | Missing |

### 20.3 Accounts and credentials the owner will create later (none created now)

| Account or credential | Created by | When | Notes |
|---|---|---|---|
| Google account (2-Step Verification) and Drive folder | Owner | After approval of backups (D6) | Never share the password or recovery codes in chat |
| `age` key pair | Owner, on own computer | Before first backup | Private key never leaves owner's control |
| Supabase project and `backup_reader` role | Owner | After approval of D3 | Plan choice first |
| Cloudflare account, Pages projects, Workers, D1, Access, Turnstile | Owner | After approval of §13 | Verify limits before activation |
| Resend account, sending domain, DNS records | Owner | After approval and domain (D13) | DNS changes made by owner |
| GitHub secrets (`SUPABASE_BACKUP_URL`, `RCLONE_CONFIG_BRIDIANT`) | Owner | After backup setup | Write-only in GitHub |
| GitHub App access for the repo (D26) | Owner or org admin | Now, if pushes are wanted | Required before any push |

### 20.4 Paid items (none activated; approval needed for each)

| Item | Approx. cost (verify) | See |
|---|---|---|
| Supabase Pro | About $25 per month | §17, D3 |
| Resend Pro | About $20 per month (if daily cap is hit) | §17 |
| Cloudflare Zero Trust paid seats | Only beyond the free user limit | §17 |
| Domain | About $15 per year | §17, D13 |
| Malware scanning for uploads | Varies; none chosen | §17 |

### 20.5 Phase approval

- [ ] I approve Phase 0 only (confirm decisions and supply source materials). Implementation remains blocked until I approve each later phase separately (§16).
- [ ] I approve Phase 1 (public site, EN and ES, placeholders only) on: ____________ (date).
- Phases 2 to 5 require their own approval after Phase 1 results are reviewed.

Owner signature or written approval: ____________________  Date: ____________

---

## 21. Summary

- One **brand system** (navy dominant, white and subtle gray, navy tints only) shared by a **bilingual public site** (EN and ES, visible switcher) and a **separate, MFA-protected admin**.
- **Simple customer journey:** arrive, learn, request an estimate, get confirmation with immediately available resources; after approval, a tokenized welcome packet.
- **Owner controls everything customer-facing** in both languages, including pricing, discounts, credits, and turnaround, with a both-locale publish gate and real-photo-only rule.
- **Pricing is server-side, owner-only, MFA-gated, versioned, audited, and automatically leak-tested.** The browser-based estimate pricing is retired.
- **Free-first stack** at $0 with documented limits: Supabase Free (pauses, no backups, 1 GB storage), Cloudflare free tiers, Resend Free (3,000 per month, 100 per day), GitHub Free, and Google Drive for encrypted backups (RPO about 24 hours).
- **No paid service or plan has been activated.** Paid options are listed in §17 for your approval.

**Awaiting your explicit approval of Revision 3 (§19) and the checklist (§20) before any implementation begins. Nothing has been pushed or published.**
