# Implementation plan (residential website and owner admin)

**Status (local only; nothing deployed, published, pushed, or paid):** Phase 0 complete. Phase 1 public site built in preview and production modes. Pricing, intake, and gallery domain logic built with tests. Admin panel, database, and email delivery not built yet.
**Baseline:** Architecture Revision 3 (`docs/ARCHITECTURE.md` §19 and §20), plus the scope decisions below. Where they differ, the scope decisions here take precedence.

## 1. Scope decisions (current)

- Residential cleaning only. Commercial property types are out of scope.
- Four services: Standard Cleaning, Deep Cleaning, Move-In Cleaning, Move-Out Cleaning.
- English and Spanish throughout. Spanish is a draft until a named reviewer approves it.
- No invented content. Missing business information stays as `[OWNER TO PROVIDE: …]` placeholders. Nothing publishes until the owner approves it.
- No arbitrary count limits on photos or gallery items. The practical limit is storage on the chosen plan (free tier: 1 GB, see Architecture §13). The estimate-request photo limit is set by the owner. The default is no limit, with a per-file size cap.
- Brand palette: `#071A2B`, `#FFFFFF`, `#F1F3F5`, and navy tints only.
- Free services first. Nothing paid is activated without approval.

## 2. Photo gallery management (new requirement)

Status: **added to the plan. Not yet built.**

### 2.1 What the owner can do

| Capability | Behavior |
|---|---|
| Upload | Any number of photos, in batches. Accepts JPEG, PNG, WebP, HEIC (converted to JPEG on the device). Original files are kept privately; web versions are generated for display |
| Organize | Assign each photo to a **project** and a **service** (one of the four). Photos can be unassigned while pending |
| Classify | Each photo is **Before**, **After**, or **Regular** |
| Pair | Link one Before photo to one After photo as a pair. A photo belongs to at most one pair. Pairs share a project and a service. Both photos show together on the site |
| Reorder | Drag or use move-up and move-down controls to set order within a project, a service, or the whole gallery. Pairs move as a unit |
| Describe | Edit a caption and alt text in English and Spanish for each photo, and a short description for each pair |
| Hide | Hide or show a photo or pair at any time. Hiding is immediate on the next publish and reversible |
| Delete | Soft delete with a restore window (default 30 days). Permanent purge afterwards. Deleting a photo used in published content asks for confirmation and removes it from the next publish |
| Approve | Each photo has a review state: **pending review**, **approved**, or **rejected**. Only approved, visible photos publish. Approval is per item with an explicit confirmation. Bulk approval shows the count and requires confirmation |
| Confirm ownership | Each photo requires the owner's ownership or permission confirmation. Identifiable people require written permission on file (a checkbox plus a note of where the permission is kept) |

### 2.2 Publishing rules

1. A photo publishes only if: approved, visible, not deleted, ownership confirmed, both locale captions approved (or the owner's explicit fallback is set for that item), and, if people are identifiable, permission confirmed.
2. A pair publishes only if both photos publish. If one is hidden, rejected, or deleted, the pair is hidden as a whole and the other photo is shown as a regular item only if the owner chooses that. The system never fills the gap automatically.
3. Projects publish only with an approved title and description (both locales) and at least one approved visible item.
4. Nothing reaches the site before an explicit publish. Gallery edits are drafts until published.

### 2.3 Data model additions (Phase 3)

| Table | Key columns | Notes |
|---|---|---|
| `media_assets` | `id`, `private_path` (original), `web_path` (generated), `mime`, `width`, `height`, `bytes`, `sha256`, `upload_batch_id`, `created_at`, `deleted_at` | Originals never public. Web variants at several widths. EXIF and GPS stripped on public variants |
| `gallery_projects` | `id`, `title jsonb`, `description jsonb`, `service_id`, `status jsonb`, `visible`, `sort_order` | Project is owner-created; no default projects are invented |
| `gallery_items` | `id`, `asset_id`, `project_id` (nullable), `service_id` (nullable), `kind` (before, after, regular), `pair_id` (nullable), `caption jsonb`, `alt jsonb`, `review_status` (pending, approved, rejected), `ownership_confirmed`, `people_permission` (none_visible, on_file), `visible`, `sort_order`, `approved_by`, `approved_at`, `deleted_at` | `kind` enum enforced in the database |
| `gallery_pairs` | `id`, `before_item_id` (unique), `after_item_id` (unique), `project_id`, `service_id`, `description jsonb`, `sort_order`, `visible` | Constraint: before item must have kind before, after item kind after, both in the same project |

Access: owner and editor roles manage the gallery. Reviewers can view. Public access reads only published rows through the publish step (static build). Originals are never publicly reachable.

### 2.4 Admin screens (Phase 3)

- **Upload area:** drag-and-drop or photo picker (iPhone-friendly), multi-select, progress per file, duplicate detection by hash.
- **Library:** grid of all photos with filters for project, service, kind, review status, visibility, and "missing caption" or "missing ownership confirmation".
- **Project view:** ordered list of items and pairs. Drag to reorder. Pair and unpair controls.
- **Item editor:** kind, project, service, caption and alt (EN and ES), ownership and permission checkboxes, approve, reject, hide, delete.
- **Review queue:** pending items, one at a time on a phone, or in batches on a laptop.

### 2.5 Phase placement

- Gallery data model and admin screens: **Phase 3**, with the content admin.
- Gallery display on public pages (Our Work, Services): **Phase 1** (static layout using seed data, placeholders only). Real photos appear only after approval.
- Estimate-request photo uploads (private, owner-only): **Phase 4**, separate from the public gallery.

## 3. Phases and dependencies

| Phase | Scope | Depends on | Status |
|---|---|---|---|
| 0. Foundation | Workspace, palette tokens and lint, bilingual helpers, placeholder and publish gate, placeholder seed, source manifest | Approval B1 | **Complete (local, commit `66abd9a` and later)** |
| 1. Public site (EN and ES) | Pages for home, about, services (four), our work, standards, welcome center, legal, request form, thanks page, language switcher, iPhone-first layout. Preview and production modes | 0 | **Built locally.** Preview shows pending content; production shows only approved content (currently nothing is approved, so production builds only the 404 page and a redirect) |
| 2. Data and access | Local database schema, row-level security for owner, editor, reviewer, and public roles, private pricing schema, access tests | 0 | Not started |
| 3. Content admin and gallery | Owner login with MFA, editors, draft, preview, publish, rollback, full photo gallery admin screens (§2). Gallery publish rules and pairing logic are built and tested (packages/gallery) | 1, 2 | **Partly built:** gallery rules and public Before/After display only. Admin UI not built |
| 4. Request form and inbox | Conditional residential form, draft autosave on device, server validation and store contract (packages/intake, tested), honeypot, idempotency. Durable store, photo upload path, bilingual emails not built | 2, 3, D2 | **Partly built:** form UI and validation. No backend connected; the form reports "not sent" honestly |
| 5. Private pricing engine | Independent server-side engine (packages/pricing): owner-approved rate versions only, integer cents, owner-controlled customer lines, reconciliation check. No rates exist in the repo. Database storage and admin editor not built | 2, 4, owner rates (S11, S12) | **Engine built and tested.** Not connected to storage |
| 6. Welcome Center | Three access levels, per-file approval, expiring and revocable packet links | 3, 4, 5, S15 to S19 | Not started |
| 7. Backups | Encrypted nightly backup, storage copy, restore drill (tested locally first) | 2, Drive approval | Not started |
| 8. Hardening | Security tests, accessibility, performance, WebKit iPhone tests, leak scans, go-live checklist | 1 to 7 | Not started |
| 9. Deployment | Hosting, domain, email DNS, production backups | 8, paid approvals, D3 and domain | Not started. **Requires explicit approval** |

Dependencies in short: 0, then 1 and 2 in parallel, then 3, then 4 and 5, then 6, with 7 and 8 before 9.

## 4. Blocking decisions and inputs

| Item | Blocks | Needed by |
|---|---|---|
| Authorization to begin Phase 1 | Phase 1 | Now |
| Vercel deployment action (remove, restrict, or keep) | Security of the existing app | Now |
| Photo classification and captions for the 10 received photos | Phase 3 gallery content | Phase 3 |
| Ownership confirmation and written permission for identifiable people | Publishing any photo with people | Before any photo is approved |
| Original logo file | Final brand assets | Phase 1 polish |
| Service summaries, excluded tasks, frequencies (S6) | Service pages | Phase 1 content |
| Spanish reviewer (S23) | Any Spanish publish | Before first Spanish publish |
| Source storage location (D-STORE) | Where photos live after Phase 3 | Phase 3 |
| Remaining business information (S3 to S5) | Contact and footer content | Phase 1 content |
| Form and pricing inputs (S7 to S12) | Phases 4 and 5 | Those phases |

## 5. Not part of this plan (unless approved)

- Customer accounts, payments, online booking
- Paid services, paid plans, domain purchase
- Modifying or deleting the existing estimate app
- Pushing to GitHub (blocked by repository access, HTTP 403, and not yet authorized)
- Deploying or publishing

## 6. Build and verification (current)

- `npm run check`: typecheck, palette lint, 69 unit tests
- `npm run build:preview -w @bridiant/public`: local review build, pending content visible and labelled
- `npm run build:production -w @bridiant/public`: build with only approved content; fails if pricing identifiers or unpublished markers appear in output
- Browser checks run locally: no horizontal overflow at 390 px and 1280 px, no console errors, form conditional questions, draft restore, unavailable state
