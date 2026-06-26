// Fetch RESUMIBLE de TMDB para enriquecer CINE/SERIES. NO escribe en Supabase: solo descarga
// a data/_tmdbtmp/ (gitignored). Dos pasadas, ambas resumibles:
//   Pasada 1 — /search/{movie,tv} por título (es-ES, query limpio) → candidatos (top 10).
//   Pasada 2 — clasifica (módulo compartido) y para ALTA CONFIANZA baja el detalle del
//             match (/movie/{id}+credits): géneros es-ES + director.
// Casa por título+año; la clasificación vive en lib/tmdb-match.mjs (misma que el dry-run).
//
// HISTÓRICO (2026-06-26): el enriquecimiento TMDB ya está aplicado y guardado en Supabase, y los
// metadatos nuevos se meten A MANO desde la app. La clave TMDB original fue REVOCADA. Este script
// (y los demás tmdb-*.mjs que llaman a la API) solo se conserva por trazabilidad: para REEJECUTARLO
// hay que GENERAR UNA CLAVE TMDB NUEVA y ponerla en .env como TMDB_API_KEY; si falta, sale con
// código 2 (no rompe nada más — ni el frontend ni los scripts activos dependen de esta clave).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';
import { cleanQuery, candidatesFrom, classify } from './lib/tmdb-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_tmdbtmp');
const SEARCH = resolve(TMP, 'search');
const DETAIL = resolve(TMP, 'detail');
for (const d of [TMP, SEARCH, DETAIL]) mkdirSync(d, { recursive: true });

const KEY = (() => { for (const l of readFileSync(resolve(here, '..', '..', '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*TMDB_API_KEY\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } })();
if (!KEY) { console.error('⛔ TMDB_API_KEY no está en .env'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 150; // ms entre peticiones POR worker
const CONC = 5;  // workers concurrentes (~11 req/s agregado; muy por debajo del límite TMDB)
async function pool(items, n, worker) {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: n }, run));
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, o) => { const t = p + '.tmp'; writeFileSync(t, JSON.stringify(o)); renameSync(t, p); };

async function tmdbGet(path, params) {
  const u = new URL('https://api.themoviedb.org/3' + path);
  u.searchParams.set('api_key', KEY);
  u.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    let r;
    try { r = await fetch(u); } catch (e) { if (attempt > 5) throw e; await sleep(2000); continue; }
    if (r.status === 429) { const w = (Number(r.headers.get('retry-after')) || 2) * 1000 + 500; await sleep(w); continue; }
    if (r.status === 404) return null;
    if (!r.ok) { if (attempt > 5) throw new Error('http ' + r.status); await sleep(1500); continue; }
    return r.json();
  }
}

// ── lista de obras (cacheada) ────────────────────────────────────────────────
const OBRAS_FILE = resolve(TMP, '_obras.json');
let obras;
if (existsSync(OBRAS_FILE)) { obras = readJson(OBRAS_FILE); console.log(`obras desde cache: ${obras.length}`); }
else {
  const pg = await makePgClient();
  obras = (await pg.query(`select id, titulo, anio_obra, categoria from obra where categoria in ('pelicula','serie') order by categoria, titulo`)).rows;
  await pg.end();
  writeJson(OBRAS_FILE, obras);
  console.log(`obras desde Supabase: ${obras.length} (cacheadas)`);
}

// ── PASADA 1 — búsqueda ──────────────────────────────────────────────────────
const pend1 = obras.filter((o) => !existsSync(resolve(SEARCH, `${o.id}.json`)));
console.log(`\nPASADA 1 (search): ${obras.length - pend1.length} ya · ${pend1.length} pendientes`);
let d1 = 0;
await pool(pend1, CONC, async (o) => {
  const isTv = o.categoria === 'serie';
  const q = cleanQuery(o.titulo, isTv);
  let cands = [];
  if (q) {
    const res = await tmdbGet(isTv ? '/search/tv' : '/search/movie', { query: q });
    cands = candidatesFrom(res?.results, isTv).slice(0, 10);
  }
  writeJson(resolve(SEARCH, `${o.id}.json`), { obra: o, query: q, isTv, cands });
  if (++d1 % 200 === 0) console.log(`  …search ${d1}/${pend1.length}`);
  await sleep(GAP);
});

// ── PASADA 2 — clasificar + detalle de ALTA CONFIANZA ────────────────────────
let alta = 0, dud = 0, sin = 0, d2 = 0;
const altas = [];
for (const o of obras) {
  const s = readJson(resolve(SEARCH, `${o.id}.json`));
  if (!s) continue;
  const c = classify(o, s.cands);
  if (c.clase === 'alta') { alta++; altas.push({ o, best: c.best }); }
  else if (c.clase === 'sin_match') sin++;
  else dud++;
}
const pend2 = altas.filter((a) => !existsSync(resolve(DETAIL, `${a.o.id}.json`)));
console.log(`\nClasificación: ALTA=${alta} · DUDOSO=${dud} · SIN MATCH=${sin}`);
console.log(`PASADA 2 (detalle de altas): ${altas.length - pend2.length} ya · ${pend2.length} pendientes`);
await pool(pend2, CONC, async ({ o, best }) => {
  // las altas son películas (las series son todas sin-año → dudoso); detalle de movie
  const det = await tmdbGet(`/movie/${best.id}`, { append_to_response: 'credits' });
  const genres = (det?.genres || []).map((g) => g.name);
  const director = (det?.credits?.crew || []).filter((c) => c.job === 'Director').map((c) => c.name)[0] || null;
  writeJson(resolve(DETAIL, `${o.id}.json`), { tmdb_id: best.id, tmdb_year: best.y, tmdb_title: best.t, genres, director });
  if (++d2 % 200 === 0) console.log(`  …detalle ${d2}/${pend2.length}`);
  await sleep(GAP);
});

console.log(`\n══ Fetch TMDB terminado ══`);
console.log(`  obras: ${obras.length} · search hechos: ${obras.length - obras.filter((o) => !existsSync(resolve(SEARCH, `${o.id}.json`))).length}`);
console.log(`  ALTA=${alta} (detalles ${altas.length - altas.filter((a) => !existsSync(resolve(DETAIL, `${a.o.id}.json`))).length}/${altas.length}) · DUDOSO=${dud} · SIN MATCH=${sin}`);
const missingS = obras.filter((o) => !existsSync(resolve(SEARCH, `${o.id}.json`))).length;
const missingD = altas.filter((a) => !existsSync(resolve(DETAIL, `${a.o.id}.json`))).length;
console.log(`  pendientes: search=${missingS} detalle=${missingD}${missingS + missingD ? ' → re-ejecuta para reanudar' : ' ✅'}`);
