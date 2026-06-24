/// <reference types="@sveltejs/kit" />
// Offline shell for the PWA. Precaches the built app + static assets (including the SQLite
// wasm) so the archive is fully usable with no network. Data never touches the network — it
// lives in OPFS and on the user's disk — so this only governs the app shell.
import { build, files, version } from '$service-worker';

const CACHE = `ocioshit-cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
  // Resilient precache: one missing asset must not fail the whole install (offline shell).
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(ASSETS.map((a) => cache.add(a))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Cache-first for known build/static assets (immutable, hashed).
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          cache.put(request, res.clone());
        }
        return res;
      } catch (err) {
        // Offline navigation fallback to the app shell.
        if (request.mode === 'navigate') {
          const shell = await cache.match('/');
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
