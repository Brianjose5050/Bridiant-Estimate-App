/*
  Bridiant Facility Group — Service Worker
  Provides offline support and automatic updates for the Estimate app.

  HOW TO USE:
  1. Place this file, manifest.json, and the /icons folder in the SAME folder
     as bridiant-service-estimate.html on your web server.
  2. Bump CACHE_VERSION any time you upload a new version of the app so
     visitors automatically get the update instead of a stale cached copy.
*/

const CACHE_VERSION = 'bridiant-v1';
const CORE_ASSETS = [
  './bridiant-service-estimate.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: pre-cache the core app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old cache versions so updates roll out automatically
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for the app page (so updates are picked up quickly),
// falling back to cache when offline. Cache-first for static assets (icons).
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const isAppShell = req.mode === 'navigate' || req.url.endsWith('.html');

  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./bridiant-service-estimate.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return res;
      }).catch(() => cached);
    })
  );
});
