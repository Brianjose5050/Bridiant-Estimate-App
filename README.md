# Bridiant Facility Group — Service Estimate App

A self-contained web app for building professional cleaning service
estimates: client-signature pads, smart pricing, a client database,
dashboard, PDF/Excel/CSV export, dark mode, and an installable PWA
shell — all in one project folder.

## Fastest way to run it: just double-click it

`bridiant-service-estimate.html` is fully self-contained. Double-click it
(or right-click → Open With → your browser) and the app runs completely —
estimates, signatures, saved history, dashboard, everything. No install,
no server, no build step.

The only thing that needs internet the first time you open it: three
small libraries loaded from a CDN (Google Fonts, SheetJS for Excel
export, and signature_pad). After that first load your browser caches
them normally.

**What does NOT work by double-clicking the file directly:**
- The "Install" button / add-to-home-screen behavior
- Full offline support via the service worker
- The `manifest.json` icons showing up as the browser tab icon

Those three specifically require the app to be served over `http://` or
`https://` (a browser security rule for service workers — it's not a bug
in this app). See "Run it as a local server" below to unlock those.

## Run it as a local server (unlocks full PWA install)

You need Python or Node installed (most computers already have one).
From inside this folder, run ONE of these:

```bash
# Python 3 (most Mac/Linux, and Windows if Python is installed)
python3 -m http.server 8080

# Node.js
npx serve -l 8080
```

Then open **http://localhost:8080/bridiant-service-estimate.html** in
Chrome or Edge. You'll now see the "Install" button appear in the app's
top bar, and it will keep working offline after the first load.

## Deploying it for real (so your team can install it on their phones)

Local hosting only works on your own computer. To let anyone install it
on their iPhone, Android, or install it as a desktop app, upload this
entire folder (keeping the same file/folder structure) to any static
web host with HTTPS — Netlify, Vercel, GitHub Pages, or your own hosting
account all work and most have free tiers.

Once it's live at a real URL:
- **Android / Windows / Mac (Chrome or Edge):** an "Install" button
  appears automatically in the app.
- **iPhone / iPad (Safari):** tap Share → "Add to Home Screen".

After you upload a newer version later, open `service-worker.js` and
bump the version string so returning visitors get the update instead of
a stale cached copy:

```js
const CACHE_VERSION = 'bridiant-v1';   // change to 'bridiant-v2', etc.
```

## Project structure

```
bridiant-service-estimate.html   The entire application (HTML/CSS/JS)
manifest.json                    PWA install metadata (name, icons, colors)
service-worker.js                Offline caching + auto-updates
icons/                           App icons & splash screens generated
                                  from your logo, in every size iOS/
                                  Android/Windows expect
```

## Data & storage

All estimates, saved clients, settings, and your PIN lock are stored
locally per-browser (not in this project folder, and not sent to any
server). Clearing your browser's site data for wherever you're hosting
this will clear that saved history — back up important estimates via
the Excel/CSV/PDF export buttons if you ever plan to do that.

## Beyond this project

Publishing to the App Store / Google Play / Microsoft Store, true native
Face ID/Touch ID, cloud sync across devices, multi-user roles, and
integrations like Stripe or QuickBooks all require a real backend and a
compiled native app — not something a static HTML project can do on its
own. That's a good next step for a **Claude Code** project once you're
ready to build it.
