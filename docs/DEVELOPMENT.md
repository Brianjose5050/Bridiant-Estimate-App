# Development guide (Phase 0)

Status: local development only. No push, deployment, paid service, or external integration is active.

## Commands

| Command | Purpose |
|---|---|
| `npm install` | Install open-source dependencies from `package-lock.json` |
| `npm run typecheck` | TypeScript build of shared packages |
| `npm run check:palette` | Fails on any off-brand color in `packages/`, `apps/`, `content/` |
| `npm test` | Unit tests (Vitest) |
| `npm run check` | All of the above, in order |

## Layout (Phase 0)

```
packages/ui      brand palette (palette.ts) and design tokens (tokens.css); tests check they match
packages/i18n    locales (EN, ES), bilingual values, placeholders, publish gate, interface string catalog
content/seed     development seed: business settings as placeholders only; pricing empty by design
content/test     tests that the seed invents no business information
scripts          palette-check.mjs (repository color lint)
docs             ARCHITECTURE.md (Revision 3, authoritative), DEVELOPMENT.md (this file)
```

Apps (`apps/public`, `apps/admin`) are not created yet. They start in Phase 1 and Phase 3.

## Rules enforced in Phase 0

- **Palette:** `#071A2B`, `#FFFFFF`, `#F1F3F5`, and navy tints only. HSL is rejected. Named off-brand colors are rejected in style files.
- **Placeholders:** missing business information is written as `[OWNER TO PROVIDE: …]`. A placeholder cannot pass the publish gate, even if marked approved.
- **Publish gate:** a field publishes only when both English and Spanish are non-empty, non-placeholder, and explicitly approved. Spanish may fall back to English only when the owner sets `fallbackToEnglish` for that item and English is approved.
- **Pricing:** `content/seed/pricing-rules.json` is empty and marked private. It must never be copied into public output.
- **Interface strings:** every entry is `proposed` until the owner approves it. Spanish entries are drafts until a named reviewer approves them.

## Scope (owner decision, current)

- **Residential cleaning only.** Commercial, office, medical, retail, and industrial service types are out of scope. The request form offers residential property types only (to be supplied by the owner, S7).
- **Four services:** Standard Cleaning, Deep Cleaning, Move-In Cleaning, Move-Out Cleaning. Their English names come from the owner. Spanish names are proposals (draft) until a named reviewer approves them.
- **Seed:** `content/seed/services.json` holds the four services, with descriptions, included tasks, and add-ons transcribed from the owner's checklists (English) and drafted Spanish. All four stay hidden and pending approval.
- **Source files:** owner-supplied PDFs, images, and business text are organized as listed in `content/source/MANIFEST.md`. Nothing has been received yet.

## Not part of Phase 0

- The existing estimate app (`index.html.html`, `manifest.json`, `service-worker.js`, `icons/`, `vercel.json.txt.txt`, `README.md`) is untouched.
- No GitHub push, no Vercel or Cloudflare deployment, no Supabase project, no Google account, no Resend, no Turnstile.

## Public app (apps/public)

- Astro static site, English and Spanish under `/en/` and `/es/`.
- `npm run build:preview -w @bridiant/public`: review build. Pending content is shown and labelled "Preview · pending owner approval". Local preview photos are generated from `content/source` into `apps/public/public/preview-media` (git-ignored).
- `npm run build:production -w @bridiant/public`: approved content only. Removes preview media first, then runs `scripts/check-public-build.mjs`, which fails on any pricing identifier or unpublished marker.
- The public app must never import `packages/pricing`. The build check enforces this.
