# Source materials manifest

This file lists every business source file the owner must supply, where each file belongs in the project, and its current status. **No item below has been received.** Nothing in the project uses an invented substitute.

Rules:

- Place each received file in the folder shown below. Do not rename files you receive; put the item ID in the file name, for example `S2-photo-standard-cleaning-01.jpg`.
- Only files the owner has approved may be moved into a public content folder. Until then they stay here.
- Photos must be real company photos. Anyone shown in a photo needs written permission.
- Documents need separate English and Spanish files, placed in `documents/en/` and `documents/es/`.

## Folders

| Folder | Holds |
|---|---|
| `content/source/images/logo/` | Logo files |
| `content/source/images/services/` | Real photos for each residential service |
| `content/source/images/company/` | Real photos of the company, team, equipment, and finished homes |
| `content/source/documents/en/` | English PDFs (welcome packet, FAQs, service sheets, legal) |
| `content/source/documents/es/` | Spanish PDFs (same set, approved by a reviewer) |
| `content/source/business/` | Text answers and approval statements (see the checklist below) |

## Items required

| ID | Item | Destination | Needed for | Status |
|---|---|---|---|---|
| S1 | Legal company name, trade name, logo (SVG or transparent PNG) | `business/`, `images/logo/` | Phase 1 (footer, header) | Missing |
| S2 | Real residential photos: each of the four services, finished homes, equipment (with written permission for anyone shown) | `images/services/`, `images/company/` | Phase 1 (only after approval) | Missing |
| S3 | Phone, email, mailing address, hours | `business/` | Phase 1 (contact, footer) | Missing |
| S4 | Residential service area (ZIP codes or radius) and out-of-area message | `business/` | Phase 4 (form validation) | Missing |
| S5 | Years in business and license/insurance statements (only if true, with supporting document) | `business/`, `documents/en/` and `documents/es/` | Phase 1 | Missing |
| S6 | For each of the four services: summary, included tasks, excluded tasks, frequencies offered, English and Spanish | `business/` | Phase 1 (service pages) | Missing |
| S7 | Residential property types and size options for the request form (for example, house, apartment, townhouse, other, and size ranges) | `business/` | Phase 4 | Missing |
| S8 | Estimate form questions, options, required flags, help text, English and Spanish | `business/` | Phase 4 | Missing |
| S9 | Consent text and thank-you text, English and Spanish | `business/` | Phase 4 | Missing |
| S10 | Estimate turnaround wording and unit, English and Spanish | `business/` | Phase 4 | Missing |
| S11 | Residential pricing rules: base rates, size bands, frequency multipliers, add-ons, minimums, travel fee, tax. Entered by the owner in the admin, not as files | Admin (private) | Phase 5 | Missing |
| S12 | Discounts and credits with conditions. Entered by the owner in the admin | Admin (private) | Phase 5 | Missing |
| S13 | FAQs (question and answer pairs, English and Spanish) | `business/` | Phase 1 (Welcome Center) | Missing |
| S14 | "What to expect" estimate process text, English and Spanish | `business/` | Phase 1 | Missing |
| S15 | Welcome presentation (slides or pages), English and Spanish | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S16 | Welcome packet guide (PDF), English and Spanish | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S17 | Service agreement template (PDF or text), English and Spanish; legal review recommended | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S18 | Access and key procedure template, English and Spanish | `documents/en/`, `documents/es/` | Phase 6 | Missing |
| S19 | Emergency and after-hours contacts | `business/` | Phase 6 | Missing |
| S20 | Privacy notice and terms, English and Spanish | `documents/en/`, `documents/es/` | Phase 1 (legal pages) | Missing |
| S21 | Email text: acknowledgment, follow-up, packet-ready, owner alert, English and Spanish | `business/` | Phase 4 | Missing |
| S22 | Testimonials (optional, only with written permission) | `business/` | Later | Missing (optional) |
| S23 | Spanish reviewer: name and scope of approval | `business/` | Before any Spanish is published | Missing |
| S24 | Owner's preferred alert channel and language | `business/` | Phase 4 | Missing |
| S25 | Confirmation of the existing Vercel deployment status (see the open question below) | `business/` | Now | Missing |

## Open question for the owner (not a source file)

The existing estimate app at `https://bridiant-estimate-app.vercel.app` (Vercel production, commit `0c56265`) may still be publicly reachable and exposes internal pricing in its code. Authorize one action:

1. Remove the Vercel production deployment, or unpublish the project.
2. Restrict access with Vercel password protection until retirement.
3. Keep it live as it is (pricing exposure remains).

Nothing has been changed on Vercel.
