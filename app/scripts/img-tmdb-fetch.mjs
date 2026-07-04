// Fetch RESUMIBLE de pósters TMDB para cine/serie (Fase 1 de imagen_url). NO escribe en Supabase:
// solo descarga a data/_imgtmp/tmdb/ (gitignored), un fichero por obra. Búsqueda por título
// (+año si existe, vía el parámetro year/first_air_date_year de TMDB — ayuda a acertar sin
// implementar un clasificador propio) y se toma el poster_path del PRIMER resultado. Errores de
// matching aceptados (política de esta fase); no hay pasada de detalle ni clasificación estricta.
//
//   node scripts/img-tmdb-fetch.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';
import { cleanQuery } from './lib/tmdb-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_imgtmp', 'tmdb');
mkdirSync(TMP, { recursive: true });

const KEY = (() => { for (const l of readFileSync(resolve(here, '..', '..', '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*TMDB_API_KEY\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } })();
if (!KEY) { console.error('⛔ TMDB_API_KEY no está en .env'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 150;
const CONC = 5;
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

const pend = obras.filter((o) => !existsSync(resolve(TMP, `${o.id}.json`)));
console.log(`pósters: ${obras.length - pend.length} ya · ${pend.length} pendientes`);
let done = 0, matched = 0, unmatched = 0;
await pool(pend, CONC, async (o) => {
  const isTv = o.categoria === 'serie';
  const q = cleanQuery(o.titulo, isTv);
  let poster = null, matchedTitle = null, matchedYear = null, viaYear = false;
  if (q) {
    const yearParam = isTv ? { first_air_date_year: o.anio_obra } : { year: o.anio_obra };
    let res = o.anio_obra ? await tmdbGet(isTv ? '/search/tv' : '/search/movie', { query: q, ...yearParam }) : null;
    if (res?.results?.length) viaYear = true;
    if (!res?.results?.length) { await sleep(GAP); res = await tmdbGet(isTv ? '/search/tv' : '/search/movie', { query: q }); }
    const first = res?.results?.[0];
    if (first) {
      poster = first.poster_path || null;
      matchedTitle = isTv ? first.name : first.title;
      matchedYear = (isTv ? first.first_air_date : first.release_date)?.slice(0, 4) || null;
    }
  }
  writeJson(resolve(TMP, `${o.id}.json`), { obra_id: o.id, titulo: o.titulo, categoria: o.categoria, query: q, viaYear, poster_path: poster, matched_title: matchedTitle, matched_year: matchedYear });
  if (poster) matched++; else unmatched++;
  if (++done % 300 === 0) console.log(`  …${done}/${pend.length}`);
  await sleep(GAP);
});

console.log(`\n══ Fetch pósters TMDB terminado ══`);
console.log(`  esta pasada: ${done} · con póster: ${matched} · sin póster: ${unmatched}`);
const stillPend = obras.filter((o) => !existsSync(resolve(TMP, `${o.id}.json`))).length;
console.log(stillPend ? `  pendientes: ${stillPend} → re-ejecuta para reanudar` : '  ✅ completo');
