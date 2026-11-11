# Bridiant Facility Group — Website Architecture (Proposal)

Status: **DRAFT FOR OWNER APPROVAL. No implementation has started.**
Tagline: *The Standard, Quietly Kept.*
Palette (only): Navy `#071A2B` · White `#FFFFFF` · Subtle Gray `#F1F3F5`

---

## 0. Findings from the current repository

The repo currently holds a self-contained **Service Estimate app** (`index.html.html`, `manifest.json`, `service-worker.js`, `vercel.json.txt.txt`, `icons/`). It affects the plan in four ways:

1. **Pricing is in the browser.** The estimate app keeps its pricing logic and rates in client-side JavaScript. Anyone who opens the page source can read them. This must not carry over to the public website. Pricing moves to a server-side, owner-only module (Section 4.4). If this file is already deployed publicly, it should be taken down or access-restricted now.
2. **Off-brand colors.** The file uses `#d4a017` (gold), `#7a2e2e` and `#ff8a80` (red), `#4a3b78` (purple), `#0f5c4c` (green). Its navy is `#0B1F3A`, not the approved `#071A2B`. The new site and admin use only the three approved colors. Error states are shown with an icon and text in navy, not red (Section 9.4).
3. **Local-only data.** Estimates and clients live in each browser's `localStorage`. That data is not shared, not backed up, and is lost when site data is cleared. The new system stores all submissions server-side. A one-time import path for existing estimates is part of Phase 3.
4. **README drift.** The README refers to `bridiant-service-estimate.html`, but the file is `index.html.html`. The new project will use a clean structure.

Recommendation: the estimate app becomes the **Estimate Worksheet** module inside the admin panel (Phase 4). Its pricing rules are stored privately and used only by the owner.

---

## 1. Website architecture

### 1.1 System context

```
                    ┌──────────────────────────────┐
  Customers ───────▶│  PUBLIC SITE                 │  static, prerendered, CDN
  (phones, desktop) │  www.<domain>                │  no pricing, no admin data
                    └──────────────┬───────────────┘
                                   │ form submit (Turnstile token)
                                   ▼
                    ┌──────────────────────────────┐
                    │  INTAKE FUNCTION (server)    │  validate, rate-limit,
                    │  Supabase Edge Function      │  store, notify
                    └───────┬──────────────┬───────┘
                            │              │
                 ┌──────────▼───┐   ┌──────▼─────────┐     ┌─────────────────┐
                    │  DATABASE    │   │  FILE STORAGE  │     │  EMAIL (Resend) │
                    │  Postgres +  │   │  public: pub.  │     │  owner alerts,  │
                    │  RLS         │   │  private: subs │     │  customer ack.  │
                    └──────▲───────┘   └──────▲─────────┘     └─────────────────┘
                           │                  │
                    ┌──────┴──────────────────┴────────┐
  Owner / staff ───▶│  ADMIN PANEL                     │  separate app, separate
  (phone, laptop)   │  admin.<domain>                  │  subdomain, MFA, noindex
                    │  Cloudflare Access + Auth + RBAC │
                    └──────────────┬───────────────────┘
                                   │ "Publish" → deploy hook
                                   ▼
                    Rebuild public site (≈1–3 min) → CDN → live
```

Two deployables, one database:

| Deployable | Audience | Hosting | Contains |
|---|---|---|---|
| Public site | Everyone | Cloudflare Pages (static) | Only published content and public form |
| Admin panel | Owner and approved staff | Cloudflare Pages (separate project), behind Cloudflare Access | Editors, inbox, settings, private pricing |
| Server functions | Called by the two apps | Supabase Edge Functions | Intake, email sending, publish hook, file signing |

A separate admin deployable keeps admin code, admin dependencies, and admin-only data out of the public bundle. A compromise of the public site cannot reach admin code.

### 1.2 Public sitemap

```
/                         Home
/about                    About Us
/our-work                 Our Work (gallery index)
/our-work/:slug           Project detail (optional, Phase 4)
/services                 Our Services (index)
/services/:slug           Service detail  (e.g., /services/office-cleaning)
/cleaning-standards       Cleaning Standards
/request-estimate         Request an Estimate (multi-step form)
/request-estimate/thanks  Confirmation
/welcome                  Welcome Center (index)
/welcome/:slug            Article / FAQ / document page
/privacy, /terms          Legal pages (editable text)
/404                      Not found (editable text)
```

Navigation (header + footer) is configured in the admin panel: labels, order, visibility, and the "Request an Estimate" button text.

### 1.3 Rendering approach

- **Static prerendering.** Every public page is generated as HTML at build time. Pages load fast on mobile networks, need no database query per visit, and are resilient if the backend is down.
- **Content comes from the database at build time.** A build reads only published rows, so draft content and internal fields never reach the build.
- **One interactive island.** Only the estimate form and the mobile menu ship JavaScript. Other pages are near-zero JavaScript.
- **No third-party trackers or embeds** on launch (no Google Analytics, no Maps iframe, no chat widget). Use Cloudflare Web Analytics (cookieless, free) and a static address. This avoids a cookie banner and keeps the page light.

### 1.4 Repository layout (planned)

```
/apps
  /public        static site (Astro)
  /admin         admin SPA (React + Vite)
/functions       Supabase Edge Functions (intake, email, publish hook, signed URLs)
/supabase
  /migrations    schema, RLS policies, seed content
  /tests         RLS and access tests
/packages
  /schemas       shared validation (zod) used by public, admin, and functions
  /ui            shared components and design tokens (3 colors only)
/docs            this document, runbooks, ADRs
```

---

## 2. Customer journey: first visit to estimate submission

### 2.1 Journey map

| Step | Customer goal | Screen | What the site does | Success signal |
|---|---|---|---|---|
| 1. Arrive | "Is this a real, local, professional company?" | Home | Hero with tagline, one primary CTA ("Request an Estimate"), a tap-to-call button, service-area line | Scrolls past hero, taps a service or the CTA |
| 2. Evaluate services | "Do you clean what I need?" | Services → service detail | Each service has what's included, who it's for, and a CTA that pre-selects that service in the form | Opens a service detail or starts the form |
| 3. Build trust | "Are you careful and consistent?" | Cleaning Standards, Our Work, About | Standards checklist, before/after gallery, owner/team story, license and insurance statements (if owner provides them) | Stays on site, visits 2+ pages |
| 4. Answer questions | "What happens next? What will it cost?" | Welcome Center (FAQ, "what to expect", downloadable welcome packet) | Articles and PDFs answer pricing *process* questions ("how estimates work") without showing prices | Finds an answer, or goes to the form |
| 5. Request estimate | "Get me a quote." | Request an Estimate (see 2.2) | Guided, one-question-per-screen form on mobile; autosaves progress on the device | Reaches the review screen |
| 6. Submit | "Did it go through?" | Confirmation page | Shows reference number, the owner-configured response-time text, call button. **No prices, no internal statuses** | Sees confirmation; receives email |
| 7. Hear back | "When will I hear from you?" | Email (acknowledgment) + phone/email from owner | Acknowledgment email uses the owner's template; contains no pricing | Owner contacts customer |

### 2.2 Estimate form, screen by screen (default, all editable)

1. **Service** — choose one or more services (pre-filled if the customer came from a service page).
2. **Property type** — office, medical, retail, residential, industrial, other.
3. **Size** — approximate square footage (choice bands, owner-configured) or "not sure."
4. **Location** — address or ZIP; checked against the configured service area. Out-of-area shows the owner's message, not a dead end.
5. **Scope and frequency** — one-time, weekly, monthly, custom; owner-configured options.
6. **Access and details** — text area with owner-defined prompts (e.g., "Are there pets?", "Who will let the team in?").
7. **Photos (optional)** — up to N images (owner sets N, default 6), each ≤10 MB; HEIC converted to JPEG on the device.
8. **Timing** — preferred start date window, flexible toggle.
9. **Contact** — name, phone, email, preferred contact method, best time to call.
10. **Review and consent** — summary of answers, consent checkbox (text is owner-editable and versioned), submit button.

Rules for every step: large tap targets (≥44 px), correct mobile keyboards (`tel`, `email`, `numeric`), inline errors with an icon and text (never color alone), a progress indicator, "Back" never loses data, and the entire form works without JavaScript errors on older phones (graceful fallback message).

### 2.3 Failure and edge paths

| Situation | Behavior |
|---|---|
| Customer leaves mid-form | Progress is saved on the device for 7 days (per-viewer convenience only; the server is not told). Returning visitors see "Continue where you left off." |
| Network drops on submit | Client retries with the same idempotency key; the server returns the existing reference, so no duplicate submission. |
| Upload fails | Other answers are kept; the file row shows "retry" or "remove." |
| Spam bot | Honeypot field plus Cloudflare Turnstile (invisible for most users). Rejected submissions are logged with a count only. |
| Too many submissions from one source | Rate limit (for example, 5 per hour per hashed IP) with a plain message and the phone number. |
| Form disabled by owner | Form page shows the owner's "temporarily unavailable" text and the phone number. |
| Out-of-area location | Accepted but flagged "out of area" in the inbox, with the owner's configured message to the customer. |

### 2.4 After submission

- Intake function validates, stores the submission and any files, and sends two emails: the customer acknowledgment and the owner alert (Section 6).
- The owner alert contains **only** a summary (name, service, property type, location, reference number) and a link to the admin panel. Full answers and photos are viewed inside the admin panel, not in email, to limit personal data in inboxes.
- The owner reviews, prepares the estimate **outside this website** (using their own process), and then records the outcome in the admin panel. The website never generates or sends a quote.

---

## 3. Public site: how the pages are built

Each page is an ordered list of **sections**. A section is one of a fixed set of components. The owner chooses the section type and fills its fields; they cannot write arbitrary layout or HTML.

| Section type | Fields (all editable) | Used on |
|---|---|---|
| Hero | Eyebrow, headline, subhead, image, primary and secondary CTA (label, target), call button | Home, service pages |
| Rich text | Heading, body (restricted formatting: headings, bold, italic, lists, links) | About, Standards, legal |
| Image + text | Image, alt text, heading, body, alignment | About, Home |
| Feature grid | Up to 6 items: icon (from a fixed icon set), title, text | Home, Services |
| Checklist | Heading, items (text, optional group label) | Cleaning Standards |
| Stat row | Up to 4 items: number, label (for example, "years in service" — only if owner confirms) | Home, About |
| Gallery | Selected projects or images, captions | Our Work |
| FAQ accordion | Question and answer pairs | Welcome Center, Services |
| Document list | Links to published documents (Section 4.2) | Welcome Center, Standards |
| Testimonial | Quote, name or role (owner chooses initials-only option) — requires written permission | Home, About |
| CTA band | Heading, text, button label and target | Any page |
| Contact block | Phone, email, address, hours, service area — pulled from Business Settings | Footer, Contact areas |

Global elements (all editable in admin): logo, favicon, header navigation, footer text, legal links, SEO defaults, default page titles and descriptions, business name and contact details.

**"Every text is editable" — how it is enforced.** No customer-facing copy lives in code. All strings, including button labels, form helper text, and error messages, come from a `site_strings` table seeded with the current copy. A CI check fails the build if a text node or user-facing attribute is hard-coded in a component. Owners can change any string and see the change on the preview before publishing.

**Brand palette lock.** Colors are design tokens fixed to the three approved values. The admin has no color picker for the site, because an off-brand color cannot be introduced by accident. Uploaded photos are the only exception to the palette.

---

## 4. Admin panel architecture

### 4.1 Navigation

```
Dashboard              new submissions, unread count, drafts awaiting publish, last publish time
Submissions            inbox (New · Reviewing · Estimate in progress · Estimate sent · Won · Lost · Archived)
  └ detail             answers, photos, notes, status history, export (CSV/PDF), archive/delete
Publish Center         all drafts, preview link, publish, version history, rollback
Pages                  page list → section editor (add, reorder, hide, duplicate, delete)
Navigation             header/footer items, labels, order, visibility
Services               list → service editor (name, slug, summary, description, includes, image, order, visible)
Our Work               project list → editor (title, category, city, description, before/after images, featured, order)
Cleaning Standards     sections, checklist items, related documents
Welcome Center         articles/FAQs, categories, downloadable documents
Media Library          upload, alt text, focal point, tags, usage list, safe delete
Estimate Form          steps → questions editor (type, label, help, required, options, show-if rule, order)
Email                  templates (customer ack, owner alert, status follow-ups), recipients, on/off per event
Business Settings      identity, contact, hours, service area, response-time text, notifications, maintenance mode, SEO
Pricing (Owner only)   private rate rules and worksheet (Phase 4) — never in public payloads
Team & Roles           invite, role change, revoke, MFA status (Owner only)
Audit Log              who changed what and when (Owner only, read-only)
```

Admin is responsive. The owner can review submissions and approve publishes from a phone. Editing long text is better on a laptop, and the UI says so without blocking phone use.

### 4.2 Editing model: draft → preview → publish

Every editable entity stores two versions:

- **Draft** — what the owner is editing. Saved automatically every few seconds. Never visible to customers.
- **Published** — the snapshot used by the next build.

Workflow:

1. Owner edits fields; autosave writes the draft.
2. **Preview** opens a private preview of the whole site with the drafts (a signed, expiring link; `noindex`).
3. **Publish** copies drafts to published, records a version (who, when, what changed), and calls the deploy hook.
4. The public site rebuilds in about 1–3 minutes. Changes appear at the CDN; caches are purged by the build.
5. **Rollback** restores any earlier version as a new draft, then publish.

Publish is all-or-nothing across selected items, and it runs validation first (required alt text, valid links, no empty required fields, no off-brand color values). A failed check blocks publish and names the field.

Image and document replacements are safe: old files are retained for 30 days so a rollback still works.

### 4.3 Submissions workflow

- **Statuses (internal only):** New → Reviewing → Estimate in progress → Estimate sent → Won / Lost / Archived. Each change is timestamped and logged.
- **Notes:** internal notes per submission (never sent to the customer).
- **Assignment:** optional, for future staff (one owner at launch).
- **Attachments:** viewed through short-lived signed URLs (5 minutes), never through permanent public links.
- **Filters and search:** status, service, date range, out-of-area, spam-flagged, text search on name or phone.
- **Export:** CSV of filtered rows (owner only, logged in audit).
- **Retention:** owner-configured auto-archive and delete windows (default: archive after 12 months, delete spam after 30 days).

### 4.4 Private pricing module (owner only)

- Stores rate rules (labor rates, sq-ft bands, service frequency multipliers, minimum charges, add-ons, travel fee, tax). Lives in a private database schema (`private.*`) that no public role can read and no public API exposes.
- Used only by the Estimate Worksheet in the admin panel to produce a **PDF the owner sends by their own process**, so the customer gets a quote from the owner, not a live price calculator.
- Changes to rates are versioned and logged; the worksheet records which rate version was used.
- Pricing values are never included in: public pages, public API responses, build output, customer emails, owner alert emails, error messages, or logs. Automated tests enforce this (Section 9.6).

### 4.5 Editor UX rules

- Every field has a help line in plain language. Required items are marked by text, not color.
- Rich text is restricted to the allowed formats; pasting from Word strips styles.
- Images require alt text (or an explicit "decorative" checkbox) before publish.
- Links are validated; external links open with safe attributes automatically.
- Undo for the last 20 changes within a session; full history in the Publish Center.

---

## 5. Database structure

PostgreSQL (Supabase). Naming: `snake_case`, UUID primary keys, `created_at` / `updated_at` on every table, soft-delete (`deleted_at`) for content that can be restored.

### 5.1 Content (public-readable when published)

| Table | Key columns | Notes |
|---|---|---|
| `site_settings` | `key` (pk), `draft jsonb`, `published jsonb`, `updated_by` | Business identity, contact, hours, service area, response-time text, SEO defaults, maintenance flag |
| `site_strings` | `key` (pk), `draft_text`, `published_text`, `default_text`, `context` | Every customer-facing label and message; seeded with defaults |
| `pages` | `id`, `slug` (unique), `title`, `meta_title`, `meta_description`, `draft_sections jsonb`, `published_sections jsonb`, `visible`, `sort_order` | Sections stored as typed JSON, validated against section schemas |
| `nav_items` | `id`, `location` (header/footer), `label`, `target`, `sort_order`, `visible`, `draft/published` | |
| `services` | `id`, `slug` (unique), `name`, `summary`, `description`, `includes text[]`, `image_id`, `sort_order`, `status`, `draft/published` | |
| `projects` | `id`, `slug`, `title`, `category`, `city`, `description`, `before_image_id`, `after_image_id`, `featured`, `published_at`, `sort_order`, `status` | No customer names unless owner records written permission (`permission_confirmed` flag) |
| `standards` | `id`, `title`, `body`, `items jsonb`, `sort_order`, `status` | |
| `articles` | `id`, `slug`, `category`, `title`, `body`, `status`, `sort_order` | Welcome Center articles and FAQs |
| `documents` | `id`, `title`, `description`, `current_version_id`, `visible`, `status` | |
| `document_versions` | `id`, `document_id`, `file_path`, `file_size`, `sha256`, `uploaded_by`, `created_at` | Public bucket, versioned |
| `media_assets` | `id`, `storage_path`, `mime`, `width`, `height`, `bytes`, `alt_text`, `focal_x`, `focal_y`, `tags text[]`, `deleted_at` | Public bucket |
| `media_usages` | `asset_id`, `entity_type`, `entity_id` | Prevents deleting an image that is in use |
| `page_versions` (and similar per type) | `entity_id`, `version_no`, `snapshot jsonb`, `published_by`, `published_at`, `note` | Powers version history and rollback |

### 5.2 Estimate form (definition is public, responses are private)

| Table | Key columns | Notes |
|---|---|---|
| `form_definitions` | `id`, `name`, `enabled`, `version` | One active form at launch |
| `form_steps` | `id`, `form_id`, `title`, `sort_order` | |
| `form_fields` | `id`, `step_id`, `key` (stable identifier), `type`, `label`, `help_text`, `required`, `validation jsonb`, `show_if jsonb`, `sort_order`, `version` | Field `key` never changes, so old answers stay readable |
| `form_field_options` | `id`, `field_id`, `value`, `label`, `sort_order` | |
| `form_consents` | `id`, `text`, `version`, `active_from` | Consent text is versioned; each submission stores the version it accepted |

Only the published form version is returned to the public site. Fields marked internal are never returned.

### 5.3 Submissions (private)

| Table | Key columns | Notes |
|---|---|---|
| `submissions` | `id`, `reference` (short, human-readable), `status`, `form_version`, `consent_version`, `contact_name`, `contact_email`, `contact_phone`, `services text[]`, `location_text`, `out_of_area bool`, `answers jsonb`, `source_page`, `spam_score`, `idempotency_key` (unique), `ip_hash`, `archived_at`, `created_at` | Answers keyed by stable field `key`. `ip_hash` uses a salted hash; raw IPs are not stored |
| `submission_files` | `id`, `submission_id`, `storage_path` (private bucket), `mime`, `bytes`, `sha256`, `created_at` | Served by signed URL only |
| `submission_events` | `id`, `submission_id`, `type` (status_changed, note_added, email_sent, exported), `from_value`, `to_value`, `actor_id`, `created_at` | Status history |
| `submission_notes` | `id`, `submission_id`, `body`, `author_id`, `created_at` | Internal only |

### 5.4 Email

| Table | Key columns | Notes |
|---|---|---|
| `email_templates` | `key` (pk), `subject`, `body_html`, `body_text`, `variables` (allow-list), `enabled`, `draft/published` | Variables are checked against an allow-list at save and at send time |
| `email_recipients` | `id`, `event`, `address`, `active` | Owner alert recipients |
| `email_log` | `id`, `template_key`, `to_hash`, `status`, `provider_id`, `error`, `created_at` | Addresses stored as hashes plus domain for privacy; retention 90 days |

### 5.5 Access and audit (private)

| Table | Key columns | Notes |
|---|---|---|
| `admin_roles` | `user_id` (pk), `role` (owner, editor, reviewer), `mfa_required`, `active`, `created_at` | Source of truth for RBAC; mirrored into the JWT claim by a hook |
| `audit_log` | `id`, `actor_id`, `action`, `entity_type`, `entity_id`, `diff jsonb`, `ip_hash`, `created_at` | Append-only (no update or delete grants, even for owners) |
| `private.pricing_rules` | `id`, `key`, `value numeric`, `unit`, `draft/published`, `version` | Schema `private`, not exposed through the API |
| `private.pricing_versions` | `id`, `rule_id`, `snapshot`, `changed_by`, `changed_at` | |

Enums (`submission_status`, `section_type`, `field_type`, `role`) are database types, so invalid values are rejected at the database layer.

---

## 6. Email notifications

| Event | Recipient | Content | Contains pricing? |
|---|---|---|---|
| Estimate request received | Customer | Thank-you text (owner-editable), reference number, response-time text, phone number | **No** |
| Estimate request received | Owner recipients (configurable) | Reference, name, service, location, submitted time, link to admin | **No** |
| Out-of-area request | Owner recipients | Same as above, with an "out of area" flag | **No** |
| Status follow-up (optional, manual send from admin) | Customer | Owner-written message from a template, with the owner's signature | Only if the owner types it themselves |
| Failed intake or email error | Technical contact (owner) | Error code and reference only, no personal data | No |

Rules:
- Templates use an allow-list of variables. Customer-entered text is escaped, and the email body never includes free-text answers from the form (those stay in the admin).
- Each send is logged (without full addresses) and retried up to three times with backoff.
- Sending domain: a subdomain such as `mail.<domain>` with SPF, DKIM, and DMARC configured, so mail is not marked as spam.
- Customer emails include an unsubscribe-free transactional footer only; no marketing email is sent in this scope.

---

## 7. Image and file uploads

### 7.1 Images (site content)

- Accepted: JPEG, PNG, WebP, HEIC (converted). Max 10 MB per file on upload; the browser resizes to a maximum of 2400 px on the long edge and re-encodes to WebP/JPEG, removing EXIF/GPS metadata.
- Server check: file type is verified by its magic bytes, not the file extension. Files are renamed to random IDs.
- Delivery: responsive `srcset` at 480, 768, 1200, and 2000 px widths. Served from the public bucket through the CDN with long cache lifetimes and content-hashed URLs.
- Required metadata: alt text (or "decorative"), optional caption, focal point for cropping.

### 7.2 Documents (PDFs)

- Accepted: PDF only. Max 20 MB. Checked by magic bytes and page count limit (owner-configurable, default 50).
- Versioned: a new upload creates a new version; the previous version remains available for rollback and to avoid broken links.
- Published documents live in the public bucket with a checksum; unpublished ones are not listed or linked.

### 7.3 Estimate photos (private)

- Accepted: JPEG, PNG, WebP, HEIC. Max 10 MB each; up to the owner-set count (default 6) per submission.
- Stored in a **private** bucket. The customer never gets a URL back. The admin receives signed URLs that expire after 5 minutes.
- EXIF/GPS metadata is stripped on upload so private location data in photos is not kept.
- Limitation: no malware scanner is included in the free tier. Mitigation: type allow-list, no executable or archive types, size limits, and rendering only in an isolated image view. Revisit if the budget allows a scanning service.

### 7.4 Storage limits

Free-tier storage is limited (roughly 1 GB on Supabase Free). Plan for it: photos are resized and compressed, the owner is shown storage use in Business Settings, and the upgrade path is documented. Cloudflare R2 (10 GB free, no egress fees) is the fallback for media if storage grows.

---

## 8. Security and access-control plan

### 8.1 Defense in depth

| Layer | Control |
|---|---|
| Network / edge | Cloudflare DNS, HTTPS only, HSTS, WAF managed rules and rate limiting (free plan rules) on intake and login |
| Admin entry | Cloudflare Access (Zero Trust, free up to 50 users) in front of `admin.<domain>`: one-time PIN or identity-provider login before the admin app even loads |
| Authentication | Supabase Auth, email + password (min. 12 characters), TOTP multi-factor authentication **required** for all admin roles; recovery codes issued at setup |
| Authorization | Role-based access (RBAC) enforced in **Postgres Row Level Security**, not only in the UI |
| Application | Input validation with shared zod schemas at the browser, the function, and the database (constraints); output encoding; rich text sanitized with an allow-list (DOMPurify) |
| Secrets | Service-role key and API keys live only in function environment variables, never in browser code, the repo, or build logs |
| Data | Encryption at rest (provider default) and in transit (TLS); private buckets for personal data; signed URLs with short expiry |
| Audit | Append-only audit log for admin actions, role changes, exports, pricing edits, and publishes |
| Supply chain | Dependabot alerts and updates, lockfiles committed, CI secret scanning, no third-party scripts in admin |

### 8.2 Roles

| Role | Who | Can do | Cannot do |
|---|---|---|---|
| Owner | Business owner (one or two people) | Everything, including Team & Roles, Pricing, Audit Log, exports, deletion | — |
| Editor | Staff who manage web content | Edit and publish content, navigation, media, documents, email templates | Pricing, Team & Roles, Audit Log, Business Settings for legal and recipient fields, bulk export |
| Reviewer | Staff who handle inquiries | View and update submissions, notes, status, send status follow-up emails | Edit content, pricing, roles, settings |
| Public (anonymous) | Any visitor | Read **published** content only; submit the form through the intake function | Read drafts, submissions, files, settings, pricing, email logs |

No customer accounts exist (per requirements). Roles are assigned only by the owner and require MFA.

### 8.3 Row Level Security matrix (summary)

| Table group | Public | Editor | Reviewer | Owner |
|---|---|---|---|---|
| Published content (`pages`, `services`, `projects`, `articles`, `documents`, etc.) | SELECT published rows | Full CRUD on drafts; publish | SELECT only | Full |
| `site_settings` (public keys) | SELECT published | Update non-legal keys | — | Full |
| `form_*` definitions | SELECT published version | Edit | — | Full |
| `submissions`, `submission_files`, `submission_notes`, `submission_events` | **None** (insert only via intake function) | None | SELECT, UPDATE status and notes | Full, plus delete |
| `email_templates`, `email_recipients` | None | Edit templates | None | Full |
| `email_log` | None | None | SELECT | SELECT |
| `private.*` (pricing) | **None** | **None** | **None** | Full |
| `audit_log` | None | None | None | SELECT only (no update or delete for anyone) |
| `admin_roles` | None | None | None | Full |

Rules enforced in code and tests:
- Anonymous users never receive `INSERT` on `submissions`; the intake function does this with the service key after validation. This prevents direct spam writes via the public API key.
- RLS is enabled on every table in the exposed schema. A test fails if a table is created without RLS.
- Role comes from `app_metadata` set by the server (not `user_metadata`, which users can edit).
- Storage policies mirror the table policies. Private bucket has no public policy at all.

### 8.4 Admin hardening checklist

- `noindex, nofollow` meta and `X-Robots-Tag` on the admin domain; not linked from the public site.
- Strict Content Security Policy (no inline scripts, no third-party origins) on both apps.
- Session timeout (idle 30 minutes, absolute 12 hours); re-authentication for high-risk actions (pricing, role change, export, delete).
- Login throttling and lockout after repeated failures; alerts to the owner on new-device sign-in.
- Export and delete require confirmation and create an audit entry.
- No personal data in logs; IP addresses are salted-hashed.

### 8.5 Abuse and privacy

- Spam protection: Turnstile, honeypot field, rate limits, hashed-IP throttling, and a submission size cap (for example, 20 KB of text).
- Privacy notice and terms are editable pages; the form links to the privacy notice and records the consent version.
- Data subject requests (view, correct, delete a person's submission): supported from the admin by searching the reference or contact details. Deletion removes files too.
- Retention windows are owner-configurable (Section 4.3); defaults are stated in the privacy notice.
- Cookies: none on the public site at launch, so no cookie banner is required for analytics. Re-check if any non-essential cookie is added.

### 8.6 Backups, recovery, and incidents

- **Backups:** Supabase Pro includes daily backups with point-in-time recovery options. The free tier does not provide automated backups, so before launch the plan requires either Pro or a scheduled nightly export to a separate private location (GitHub Actions job writing an encrypted dump). This is a launch gate (Section 10).
- **Recovery targets:** restore the database within 4 hours; site content can be redeployed from the repo and the last database export.
- **Incident response:** rotate keys, revoke all sessions (one command), restore from backup, and notify affected customers if personal data was exposed, as required by applicable law. A short runbook is written in Phase 5.

### 8.7 What customers must never see

- Pricing rules, rates, multipliers, margins, or any calculated price range
- Submission data of other customers, internal notes, statuses, and assignments
- Admin email addresses, staff names beyond what the owner publishes, team roles
- Audit logs, IP hashes, error details, stack traces, draft content, unpublished pages
- Source maps in production (disabled), environment names, internal URLs

Automated check: the public build output is scanned for pricing keys, admin route names, and service-role patterns; the build fails if any match.

---

## 9. Technical design details

### 9.1 Mobile-first and performance

- Design at 360 px width first; desktop is an enhancement.
- Performance budget on public pages: Largest Contentful Paint under 2.5 s on a mid-range phone over 4G; under 100 KB of JavaScript on content pages; images lazy-loaded below the fold.
- Sticky bottom "Call" and "Request an Estimate" bar on phones (owner can turn it off).
- Respect `prefers-reduced-motion`; no autoplay video; no hover-only interaction.
- Offline: service worker caches the public site shell and last-published pages (keeps the existing PWA idea, with a correct cache version bump on each deploy).

### 9.2 Brand and color system

- Tokens: `--color-navy: #071A2B`, `--color-white: #FFFFFF`, `--color-gray: #F1F3F5`. No other hue is defined.
- Text on white: navy (contrast about 16:1). Text on gray: navy. White text on navy for buttons and header.
- Subtle variants (borders, dividers, disabled states) use navy at reduced opacity, which keeps the hue within the palette. **Decision needed:** confirm this is acceptable (Section 11).
- Focus outline: 3 px navy with a 2 px white offset (visible on both background colors).
- Status indicators in admin use text labels and icons with navy and gray only, not color coding.
- Uploaded photos are the only non-palette color on the site.

### 9.3 Accessibility

- WCAG 2.2 AA target: semantic headings, labels for every input, keyboard operation, visible focus, alt text required, reduced motion, sufficient contrast.
- Error messages use an icon, bold text, and an `aria-live` region. Color is never the only signal.

### 9.4 Errors and status without red

Because red is not allowed, error and warning states use: a navy icon (⚠ / ✕ / ✓ as SVG), bold text, a border weight change, and a short sentence describing the fix.

### 9.5 Search engine and content discovery

- Per-page title, description, Open Graph image (owner-set), canonical URL.
- Generated `sitemap.xml` and `robots.txt` (admin domain disallowed).
- LocalBusiness structured data built from Business Settings (name, address, phone, hours, service area).
- Service and project pages have unique URLs and descriptions editable in admin.

### 9.6 Testing strategy

| Test | Tool (free) | Purpose |
|---|---|---|
| Unit | Vitest | Validation schemas, section renderers, pricing isolation helpers |
| Access control | Supabase test harness (pgTAP or scripted REST calls as each role) | Confirms RLS matrix (Section 8.3) |
| Pricing leak | Build-time scan + Playwright check of public pages and network responses | No pricing keys or values in public output |
| End-to-end | Playwright (mobile viewport 360×800 and 390×844) | Full estimate journey, validation, uploads, confirmation |
| Accessibility | axe-core in Playwright | No AA violations on key pages |
| Performance | Lighthouse CI (mobile) | Budgets in Section 9.1 |
| Email | Resend test mode and a sandbox inbox | Template rendering, variable allow-list, no pricing in emails |
| Security | Dependabot, CodeQL (free on public repos; check private repo eligibility), manual review before launch | Known-vulnerable dependencies, code-level issues |

---

## 10. Recommended technology stack (free or low cost first)

| Need | Recommendation | Why | Cost at launch |
|---|---|---|---|
| Public site | **Astro** (static output, TypeScript) + Tailwind CSS | Static pages, minimal JS, excellent mobile performance, free and MIT licensed | $0 |
| Admin app | **React + Vite** SPA, TanStack Query, react-hook-form + zod, Tiptap (restricted rich text) | Mature, free, strong form tooling, easy to test | $0 |
| Shared validation | **zod** in `/packages/schemas` | One definition of truth for public, admin, and server | $0 |
| Database, auth, storage, functions | **Supabase** (Postgres, Auth with TOTP MFA, Storage, Row Level Security, Edge Functions) | Relational data suits submissions and versions; RLS enforces access in the database; standard Postgres avoids lock-in | $0 Free to start; **$25/month Pro recommended before launch** (no pausing after inactivity, daily backups, more storage) |
| Hosting, DNS, edge security | **Cloudflare** (Pages for both apps, DNS, WAF, Access, Turnstile, Web Analytics) | Free tiers cover this scale; Access protects admin before login; Turnstile is a free CAPTCHA alternative | $0 |
| Email | **Resend** | 3,000 emails/month and 100/day on free tier; simple API; good deliverability with proper DNS | $0 (paid only if volume grows) |
| Source control and CI | **GitHub** (existing repo) + GitHub Actions | Already in use; CI runs tests, builds, pricing-leak scan, and the nightly backup export | $0 within free minute allowances (verify for private repos) |
| Error monitoring | **Sentry** (free developer plan) | Catches front-end and function errors without logging personal data | $0 |
| Image processing | Browser-side resize (Canvas/`browser-image-compression`) + server-side type check; Cloudflare Images/Supabase transforms only if needed | Keeps cost at zero; resize quality is good enough for a cleaning company's gallery | $0 |
| Domain | Owner's existing domain (or a new one) | Required for email authentication and admin subdomain | ~$15/year |

**Hosting note:** Vercel Hobby (used in this repo's `vercel.json.txt`) is limited to non-commercial use under its terms, so it is not recommended for a business website. Cloudflare Pages allows commercial use on its free plan.

**Estimated monthly run cost:** $0 at minimum; about **$25–30/month** recommended (Supabase Pro plus domain amortized). Costs rise only if email exceeds 3,000 per month or storage grows beyond plan limits.

**Alternatives considered:**
- *WordPress (managed hosting):* easy editing, but plugin security patching is an ongoing burden and the editor allows arbitrary HTML, which weakens the brand lock. Rejected.
- *Firebase:* workable, but Postgres RLS gives clearer access rules for relational submissions and versions. Not chosen.
- *Next.js on Vercel:* strong, but Vercel's commercial-use terms on the free plan are the blocker above. Could revisit on a paid plan.

*Verify current free-tier limits and prices on each vendor's pricing page before committing; these change.*

---

## 11. Technical risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| 1 | **Pricing exposed to the public** (already happens in the current estimate app) | High / High | Pricing moved to private schema and owner-only module; automated build and network scans; take down the current public file if deployed |
| 2 | Admin account takeover | Medium / Critical | Cloudflare Access + TOTP MFA required + Auth lockouts + recovery codes + new-login alerts |
| 3 | Spam and bot submissions flood the inbox | High / Medium | Turnstile, honeypot, rate limits, spam scoring, retention auto-delete |
| 4 | Supabase Free project pauses after inactivity | High / High | Move to Pro before launch; keep-alive not used (not reliable) |
| 5 | No automated backups on free tier | Medium / Critical | Pro plan or nightly encrypted export (launch gate) |
| 6 | Publish latency (1–3 min rebuild) surprises the owner | Medium / Low | Preview before publish; status line during build; clear "live at" time; option to add incremental rebuild later |
| 7 | Build failure blocks publish | Low / High | Keep last good build live; failed builds alert the owner; validation blocks bad content before build |
| 8 | Email lands in spam | Medium / High | Dedicated sending subdomain, SPF/DKIM/DMARC, plain-text alternative, test before launch |
| 9 | Oversized or malicious uploads | Medium / Medium | Type checks by magic bytes, size limits, metadata stripping, isolated rendering; no malware scanner on free tier (accepted, documented) |
| 10 | Private personal data (photos, addresses) leaks | Low / High | Private bucket, signed URLs, no answers in email, RLS, no logs with PII |
| 11 | Form changes break old submissions | Medium / Medium | Stable field keys, form versioning, submissions store form version |
| 12 | "Everything editable" becomes a large, error-prone scope | High / Medium | Fixed section library; no free-form HTML; CI check for hard-coded copy; phased rollout |
| 13 | Owner breaks layout, contrast, or accessibility | Medium / Medium | Constrained blocks, validation (alt text, links, contrast checks on colors), preview, rollback |
| 14 | Brand palette too limited for accessible UI | Medium / Low | Navy tints via opacity for subtle elements; icons plus text for states; review contrast in Phase 1 |
| 15 | Vendor lock-in | Low / Medium | Standard Postgres, exportable data, dumps stored off-platform, content in JSON |
| 16 | Legal exposure (privacy, consent, retention) | Medium / High | Editable privacy notice and terms, consent versioning, retention settings, data request process; owner confirms wording with counsel |
| 17 | Testimonials or project photos used without permission | Medium / Medium | `permission_confirmed` flag required before a project or testimonial can be published |
| 18 | Estimate PDFs or rates shared by mistake | Low / High | Worksheet exports watermarked "Customer copy" or "Internal" and logged; pricing never in email |
| 19 | Scope drift into a customer portal or payments | Medium / Medium | Out of scope per requirements; no accounts, payments, or booking in any phase |
| 20 | Off-brand colors drift in over time | Low / Low | Token lock, no color picker, lint rule against non-palette hex values |

---

## 12. Phased plan (proposed; no build until approved)

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Decisions | Answer Section 13 questions; confirm domain, staff, plan | Written approval of this document |
| 1. Public site shell | Pages, navigation, palette, section library, seed content from current copy, responsive layout, performance and accessibility baseline | Lighthouse mobile budgets met; axe clean; content editable only in seed files |
| 2. Content admin | Auth + MFA, roles, Pages/Services/Work/Standards/Welcome/Media/Documents editors, draft → preview → publish, versions, rollback | RLS matrix tests pass; publish creates a live rebuild; rollback verified |
| 3. Estimate form + inbox | Form builder, multi-step form, intake function, Turnstile, uploads, submissions inbox, status workflow, notes, emails | End-to-end test on 360 px phone; spam tests pass; emails received with correct content |
| 4. Pricing worksheet and migration | Private pricing module, worksheet PDF, import of existing local estimates (optional) | Pricing-leak scans pass; worksheet used on a real estimate |
| 5. Hardening and launch | Backups verified by restore test, monitoring, runbooks, privacy notice reviewed, DNS and email authentication, load and abuse testing | Restore drill succeeds; go-live checklist signed off by owner |

---

## 13. Decisions needed from you

1. **Language:** English only, or English and Spanish? (The current estimate app is set to Spanish.)
2. **Welcome Center:** I have assumed it is a resource hub for customers (FAQs, "what to expect," a downloadable welcome packet, service agreement, and similar documents). Is that correct, or is it something else?
3. **Navy value:** confirm `#071A2B` (the brief) rather than `#0B1F3A` (the current app).
4. **Subtle tints:** may navy at reduced opacity be used for borders and subtle states, or must every element be one of the three exact colors?
5. **Estimate photos:** default of up to 6 photos per request, 10 MB each. Acceptable?
6. **Retention:** how long to keep submissions (proposed: archive after 12 months; delete spam after 30 days)?
7. **Staff access:** how many people need admin access at launch, and which roles?
8. **Business facts to publish:** license and insurance statements, years in business, service area, hours, testimonials (with written permission), and team photos. Which can be shown?
9. **Current estimate app:** retire it (recommended, after import), keep it as an internal tool, or merge it into the admin Worksheet (Phase 4)? Is it deployed publicly right now?
10. **Monthly budget:** approve about $25–30/month for Supabase Pro plus domain, or stay fully on free tiers and accept the backup and pausing risks?
11. **Admin domain:** a subdomain such as `admin.<your domain>` is recommended. Do you have a domain to use?

---

## 14. Summary

- A **static, mobile-first public site** with no pricing, no accounts, and no payments, built from a fixed section library and a brand palette locked to navy, white, and gray.
- A **separate admin panel** behind Cloudflare Access, with MFA, role-based access enforced in Postgres, a draft → preview → publish workflow, and an append-only audit log.
- A **server-side estimate intake** that validates, rate-limits, stores privately, and emails the owner and the customer without any pricing.
- **Pricing is private and owner-only**, separated at the schema level and checked automatically on every build.
- A **free-first stack** (Astro, React, Supabase, Cloudflare, Resend, GitHub, Sentry) at $0 to start, with a recommended $25–30/month before launch for backups and reliability.

No application code has been written. Please review Section 13 and approve (or amend) this plan before implementation begins.
