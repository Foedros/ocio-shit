// Fetch RESUMIBLE de carátulas OpenLibrary para libro/cómic (Fase 1 de imagen_url). NO escribe en
// Supabase: solo descarga a data/_imgtmp/openlibrary/ (gitignored). Matching FLOJO a propósito:
// búsqueda pública por título (sin API key), se toma el cover_i del primer resultado que tenga
// carátula. Los que no matcheen quedan sin poster_id (fallback tipográfico en el carrusel).
//
//   node scripts/img-openlibrary-fetch.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_imgtmp', 'openlibrary');
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 300; // uso público, sin key → throttle más suave que TMDB
const CONC = 3;
async function pool(items, n, worker) {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; await worker(items[idx], idx); } };
  await Promise.all(Array.from({ length: n }, run));
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, o) => { const t = p + '.tmp'; writeFileSync(t, JSON.stringify(o)); renameSync(t, p); };

async function olGet(params) {
  const u = new URL('https://openlibrary.org/search.json');
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('limit', '5');
  u.searchParams.set('fields', 'title,cover_i,first_publish_year');
  for (let attempt = 1; ; attempt++) {
    let r;
    try { r = await fetch(u, { headers: { 'User-Agent': 'OcioShit-personal-archive/1.0 (fde868686@gmail.com)' } }); }
    catch (e) { if (attempt > 5) throw e; await sleep(2000); continue; }
    if (r.status === 429) { await sleep(3000); continue; }
    if (!r.ok) { if (attempt > 5) throw new Error('http ' + r.status); await sleep(1500); continue; }
    return r.json();
  }
}

const OBRAS_FILE = resolve(TMP, '_obras.json');
let obras;
if (existsSync(OBRAS_FILE)) { obras = readJson(OBRAS_FILE); console.log(`obras desde cache: ${obras.length}`); }
else {
  const pg = await makePgClient();
  obras = (await pg.query(`select id, titulo, categoria from obra where categoria in ('libro','comic') order by categoria, titulo`)).rows;
  await pg.end();
  writeJson(OBRAS_FILE, obras);
  console.log(`obras desde Supabase: ${obras.length} (cacheadas)`);
}

const pend = obras.filter((o) => !existsSync(resolve(TMP, `${o.id}.json`)));
console.log(`carátulas: ${obras.length - pend.length} ya · ${pend.length} pendientes`);
let done = 0, matched = 0, unmatched = 0;
await pool(pend, CONC, async (o) => {
  const q = String(o.titulo).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let coverId = null, matchedTitle = null;
  if (q) {
    const res = await olGet({ title: q });
    const first = (res?.docs || []).find((d) => d.cover_i);
    if (first) { coverId = first.cover_i; matchedTitle = first.title; }
  }
  writeJson(resolve(TMP, `${o.id}.json`), { obra_id: o.id, titulo: o.titulo, categoria: o.categoria, query: q, cover_i: coverId, matched_title: matchedTitle });
  if (coverId) matched++; else unmatched++;
  if (++done % 100 === 0) console.log(`  …${done}/${pend.length}`);
  await sleep(GAP);
});

console.log(`\n══ Fetch carátulas OpenLibrary terminado ══`);
console.log(`  esta pasada: ${done} · con carátula: ${matched} · sin carátula: ${unmatched}`);
const stillPend = obras.filter((o) => !existsSync(resolve(TMP, `${o.id}.json`))).length;
console.log(stillPend ? `  pendientes: ${stillPend} → re-ejecuta para reanudar` : '  ✅ completo');
