/// <reference types="@sveltejs/kit" />
// MODO OFFLINE (§11.64). Tres cachés:
//   1. SHELL (versionada por build): precache del app + estáticos, cache-first. Igual que siempre.
//   2. DATOS ('ocioshit-datos-v1', persiste entre versiones): lecturas de Supabase — GETs de
//      PostgREST (clave = URL: .range() de postgrest-js pagina por query params offset/limit,
//      así que la URL identifica la página) y RPCs de LECTURA allowlistadas (POST → clave
//      sintética GET con hash del body). Estrategia NETWORK-FIRST con fallback a caché MARCADA
//      con timestamp: online el comportamiento es BIT-A-BIT el de siempre (siempre red, la caché
//      solo se actualiza detrás) — un stale-while-revalidate literal rompería leer-tras-escribir
//      (registrar → el Diario mostraría la lista vieja); "abre con lo último visto, revalida al
//      volver la red" es exactamente esto. Sin red → se sirve lo último visto y se avisa a la
//      app (postMessage 'ocio:sin-red' con el timestamp → chip "Sin conexión · datos de …").
//   3. CARÁTULAS ('ocioshit-caratulas-v1'): cache-first de las imágenes remotas YA VISTAS
//      (TMDB/Steam/OpenLibrary/Google Books, respuestas opacas de los hotlinks). Las no
//      cacheadas fallan sin red → cae el fallback tipográfico existente (onerror).
// LÍMITES: DATOS tope 80 entradas · CARÁTULAS tope 500, expulsión FIFO (cache.keys() conserva
// el orden de inserción) — el almacenamiento no crece sin tope.
// Las ESCRITURAS (RPCs no listadas, auth, edge functions) NUNCA se interceptan ni cachean:
// sin red fallan y la app degrada con mensaje claro sin perder lo escrito.
import { build, files, prerendered, version } from '$service-worker';
import { SUPABASE_URL } from '$lib/db/supabase-config.js';

const CACHE = `ocioshit-cache-${version}`;
const DATA = 'ocioshit-datos-v1';
const IMG = 'ocioshit-caratulas-v1';
// `prerendered` INCLUIDO: el HTML del shell entra al PRECACHE de cada build. Sin él, el HTML solo
// vivía en runtime dentro de la caché VERSIONADA — que el activate del deploy siguiente borra —
// y el primer arranque offline tras CADA deploy moría con las cachés de datos intactas.
const ASSETS = [...build, ...files, ...prerendered];
const SUPA_HOST = new URL(SUPABASE_URL).hostname;

// apertura de caché a prueba de entornos sin Cache Storage utilizable (Safari privado, cuota):
// null → passthrough a red pura, NUNCA romper las lecturas online por un fallo de la caché
async function abrir(name) {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

// RPCs de SOLO LECTURA (espejo de functions.sql): las únicas POST que se cachean para offline
const RPC_LECTURA = new Set([
  'ocio_counts', 'ocio_filter_options', 'ocio_stats', 'ocio_hall', 'ocio_home',
  'ocio_wrapped_years', 'ocio_wrapped', 'ocio_progresion', 'ocio_timeline_macro',
  'ocio_timeline_year', 'ocio_constelacion', 'ocio_constelacion_light',
  'ocio_eval_sql', 'ocio_evaluate_logros'
]);

const esCaratula = (url) =>
  /(tmdb\.org|steamstatic\.com|openlibrary\.org|books\.google|googleusercontent\.com)/.test(url.hostname);

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

async function trim(name, max) {
  // caches.open CREA la caché si no existe → un trim tardío (put→then) RESUCITARÍA una caché
  // recién purgada por el signOut. Si ya no está, no hay nada que recortar.
  if (!(await caches.keys()).includes(name)) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function avisar(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of cs) c.postMessage(msg);
}

// NETWORK-FIRST con fallback a caché marcada. `key` = Request GET estable (la propia para GETs,
// sintética con hash del body para las RPCs POST). Conserva status/headers (content-range de
// PostgREST incluido) y añade x-ocio-cached-at. El aviso 'ocio:red' va en CADA éxito de red
// (idempotente en la app): un flag en memoria del SW se perdería con la terminación por
// inactividad (~30s) y el chip "sin conexión" quedaría clavado con la red ya viva.
async function lecturaConFallback(event, request, key) {
  const cache = await abrir(DATA);
  if (!cache) return fetch(request); // sin Cache Storage: red pura, nada se rompe
  try {
    const res = await fetch(request);
    if (res.ok) {
      const headers = new Headers(res.headers);
      headers.set('x-ocio-cached-at', String(Date.now()));
      const body = await res.clone().blob();
      event.waitUntil(
        cache
          .put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }))
          .then(() => trim(DATA, 80))
          .catch(() => {}) // cuota llena: el cacheo falla en silencio, la respuesta ya salió
      );
      event.waitUntil(avisar({ type: 'ocio:red' }));
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) {
      event.waitUntil(avisar({ type: 'ocio:sin-red', at: Number(hit.headers.get('x-ocio-cached-at')) || null }));
      return hit;
    }
    throw err;
  }
}

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
      Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== DATA && k !== IMG) // DATOS/CARÁTULAS sobreviven al build nuevo
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// PURGA al cerrar sesión (§11.64): las cachés de datos/carátulas llevan el corpus personal — en
// un navegador compartido el signOut debe vaciarlas. Lo envía boot-supabase en SIGNED_OUT.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ocio:purga') {
    event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(IMG)]).catch(() => {}));
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── SUPABASE: solo lecturas de /rest/v1 (auth/functions/realtime NUNCA se tocan) ──
  if (url.hostname === SUPA_HOST && url.pathname.startsWith('/rest/v1/')) {
    const esRpc = url.pathname.startsWith('/rest/v1/rpc/');
    if (request.method === 'GET' && !esRpc) {
      event.respondWith(lecturaConFallback(event, request, request));
      return;
    }
    if (request.method === 'POST' && esRpc) {
      const fn = url.pathname.split('/').pop();
      if (RPC_LECTURA.has(fn)) {
        event.respondWith(
          (async () => {
            const body = await request.clone().text();
            const key = new Request(`${url.origin}${url.pathname}?swrpc=${hash(body)}`, { method: 'GET' });
            return lecturaConFallback(event, request, key);
          })()
        );
      }
      return; // RPCs de escritura: la red manda, sin red fallan (degradación limpia en la app)
    }
    return;
  }

  if (request.method !== 'GET') return;

  // ── CARÁTULAS remotas: cache-first de las ya vistas (respuestas opacas de los hotlinks) ──
  if (url.origin !== self.location.origin) {
    if (request.destination === 'image' && esCaratula(url)) {
      event.respondWith(
        (async () => {
          const cache = await abrir(IMG);
          if (!cache) return fetch(request);
          const hit = await cache.match(request);
          if (hit) return hit;
          const res = await fetch(request);
          if (res && (res.ok || res.type === 'opaque')) {
            event.waitUntil(cache.put(request, res.clone()).then(() => trim(IMG, 500)).catch(() => {}));
          }
          return res;
        })()
      );
    }
    return;
  }

  // ── SHELL same-origin (igual que siempre): cache-first de los assets horneados ──
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          cache.put(request, res.clone());
        }
        return res;
      } catch (err) {
        // Fallback de navegación offline al shell — CONSCIENTE DE LA BASE: en GitHub Pages el
        // scope es /ocio-shit/ y un match('/') literal buscaba la raíz del dominio (nunca hit).
        // ignoreSearch: la navegación puede llevar query (p.ej. ?test=1) y el shell precacheado no.
        if (request.mode === 'navigate') {
          const scopePath = new URL(self.registration.scope).pathname;
          const shell =
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match(scopePath, { ignoreSearch: true })) ||
            (prerendered.length ? await cache.match(prerendered[0], { ignoreSearch: true }) : undefined);
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
