# Source materials manifest

This manifest lists every business source file for the residential website, where it is stored, and its status.

**Repository rule:** the GitHub repository is public. Source binaries (photos, PDFs, logos) are kept in these folders on the owner's working copy but are **excluded from git** (`.gitignore`). Only this manifest and `.gitkeep` placeholders are tracked. Moving source binaries into a private store is a decision for the owner (see §D-STORE below).

**Approval rule:** receiving a file does not approve it. Nothing here publishes until the owner approves each item (see `docs/IMPLEMENTATION_PLAN.md`).

## Folders

| Folder | Holds |
|---|---|
| `images/logo/` | Logo files |
| `images/gallery-unclassified/` | Owner-supplied photos not yet classified (Before, After, or Regular, project, and service assigned by the owner) |
| `images/services/` | Photos classified to a residential service after owner approval |
| `images/company/` | Company, team, and equipment photos after owner classification |
| `documents/en/` | English PDFs and checklist images |
| `documents/es/` | Spanish versions, approved by a named reviewer |
| `business/` | Text answers and approval statements |

## Received on this date (owner upload)

| Staged file | Original upload | Content (observed) | Status |
|---|---|---|---|
| `documents/en/included-standard-cleaning_EN.pdf` | Standard Include PDF | "Standard Reset" included-task checklist (kitchen, bathrooms, and other areas) | Received. Owner approval and Spanish version pending (S6) |
| `documents/en/included-deep-cleaning_EN.pdf` | Deep Included PDF | "Deep Reset" included-task checklist | Received. Owner approval and Spanish version pending (S6) |
| `documents/en/included-move-in-cleaning_EN.pdf` | In Included PDF | "Move-In Reset" included-task checklist. Filename "In" interpreted as Move-In (the document title says Move-In Reset) | Received. Owner approval and Spanish version pending (S6) |
| `documents/en/included-move-out-cleaning_EN_checklist-image.png` | Move-Out Checklist (image, not a PDF) | "Move-Out Checklist" with Accepted and RE-Work columns, plus a disclaimer that the company cannot guarantee a landlord's inspection results | Received as an image. **Needs your confirmation** that this is the approved Move-Out list and whether a PDF exists. The disclaimer needs approval (legal wording) before publishing |
| `images/logo/logo-screenshot_S1_provisional.jpg` | Logo (screenshot) | Circular mark with "B" letterform in navy on white. File metadata says "Screenshot" | Provisional. **Please send the original logo file** (SVG or transparent PNG) |
| `images/gallery-unclassified/photo-01` to `photo-10` | 10 photos (IDs in table below) | Technicians and home interiors. See table | Received. **Not classified, not approved.** Ownership and permission confirmation needed (see below) |

### Photo staging table (upload IDs)

| Staged file | Upload ID | Observed content (for identification only; not a classification) |
|---|---|---|
| photo-01-9b2b8462.jpg | 9b2b8462 | Wood-look floor and base, technician dusting under a cabinet with an extension duster. Technician partly visible |
| photo-02-ebd425d3.jpg | ebd425d3 | Toilet base, visible dust and debris |
| photo-03-6112ee91.jpg | 6112ee91 | Chrome two-handle faucet and sink, shampoo bottles nearby |
| photo-04-d75cd06f.jpg | d75cd06f | Toilet base and floor, close view with dust and debris |
| photo-05-2080b833.jpg | 2080b833 | Low view under a dark cabinet, floor and base |
| photo-06-e157e616.jpg | e157e616 | Technician wiping a glass cooktop. Face partly visible |
| photo-07-29c209a6.jpg | 29c209a6 | Low view under a dark cabinet with loose items and debris on the floor |
| photo-08-2353c69e.jpg | 2353c69e | Toilet base and bowl, close view |
| photo-09-174de4e6.jpg | 174de4e6 | Cabinet side panel below a granite counter |
| photo-10-036b7200.jpg | 036b7200 | Stainless or white sink faucet with visible residue and a drain |

The staging order follows the order the photos were received. The owner should confirm each mapping. Identifiable people require written permission before any photo is published (S2).

## Items still required

| ID | Item | Destination | Needed for | Status |
|---|---|---|---|---|
| S1 | Legal name, trade name, original logo file (SVG or transparent PNG) | `business/`, `images/logo/` | Phase 1 | Provisional logo received; original missing |
| S2 | Photo classification, project and service assignment, captions (EN and ES), ownership confirmation, and written permission for any identifiable people | Gallery (admin) | Phase 3 | Received (10 photos); classification missing |
| S3 | Phone, email, mailing address, hours | `business/` | Phase 1 | Missing |
| S4 | Residential service area (ZIP codes or radius) and out-of-area message | `business/` | Phase 4 | Missing |
| S5 | Years in business and license or insurance statements (only if true) | `business/` | Phase 1 | Missing |
| S6 | Per service: summary, included tasks, excluded tasks, frequencies. Included checklists received for Standard, Deep, Move-In, and Move-Out (image). Summaries, excluded tasks, frequencies, and Spanish versions missing | `business/`, `documents/` | Phase 1 | Partly received |
| S7 | Residential property types and size ranges for the request form | `business/` | Phase 4 | Missing |
| S8 | Estimate form questions, options, required flags, help text (EN and ES) | `business/` | Phase 4 | Missing |
| S9 | Consent text and thank-you text (EN and ES) | `business/` | Phase 4 | Missing |
| S10 | Estimate turnaround wording and unit (EN and ES) | `business/` | Phase 4 | Missing |
| S11 | Residential pricing rules (entered in the private admin, not as files) | Admin (private) | Phase 5 | Missing |
| S12 | Discounts and credits (entered in the private admin) | Admin (private) | Phase 5 | Missing |
| S13 | FAQs (EN and ES) | `business/` | Phase 1 | Missing |
| S14 | "What to expect" estimate process text (EN and ES) | `business/` | Phase 1 | Missing |
| S15 | Welcome presentation (EN and ES) | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S16 | Welcome packet guide PDF (EN and ES) | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S17 | Service agreement template (EN and ES; legal review recommended) | `documents/` | Phase 6 | Missing |
| S18 | Access and key procedure template (EN and ES) | `documents/` | Phase 6 | Missing |
| S19 | Emergency and after-hours contacts | `business/` | Phase 6 | Missing |
| S20 | Privacy notice and terms (EN and ES) | `documents/` | Phase 1 | Missing |
| S21 | Email text: acknowledgment, follow-up, packet-ready, owner alert (EN and ES) | `business/` | Phase 4 | Missing |
| S22 | Testimonials (optional, with written permission) | `business/` | Later | Missing (optional) |
| S23 | Spanish reviewer: name and scope of approval | `business/` | Before any Spanish is published | Missing |
| S24 | Preferred alert channel and language | `business/` | Phase 4 | Missing |
| S25 | Status of the existing Vercel deployment (see below) | `business/` | Now | Owner decision pending |

## Decisions the owner must make on source files

- **D-STORE:** where source binaries live. Options: a private store chosen with your approval (for example, a private Supabase Storage bucket after Phase 3), or the owner's working copy only. The repo must not hold them while it is public.
- **D-PERM:** written permission for any identifiable people in photos (technicians are visible in several photos).
- **D-MOVEOUT:** confirm the Move-Out checklist image is the approved list, and send the PDF if one exists.

## Open question: existing Vercel deployment

The existing estimate app at `https://bridiant-estimate-app.vercel.app` is a Vercel production deployment (commit `0c56265`, status `success`). Its code exposes internal pricing logic. Choose one action:

1. Remove the production deployment or unpublish the project.
2. Restrict access with Vercel password protection until retirement.
3. Keep it live (pricing exposure remains).

Nothing has been changed on Vercel.
