// DRY-RUN del enriquecimiento TMDB de CINE/SERIES. Lee data/_tmdbtmp/ + RE-CONSULTA Supabase.
// NO escribe nada. Separa ALTA CONFIANZA / DUDOSO / SIN MATCH y da: reparto, ejemplos de alta,
// muestra de dudosos con candidatos, check de clave_dedup con los años de alta, e impacto en
// diversidad. La clasificación usa lib/tmdb-match.mjs (la misma del fetch).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';
import { classify, norm } from './lib/tmdb-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_tmdbtmp');
const SEARCH = resolve(TMP, 'search'), DETAIL = resolve(TMP, 'detail');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const obras = readJson(resolve(TMP, '_obras.json'));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const dedup = (t, c, a) => `${String(t).toLowerCase()}|${c}|${a == null ? '' : String(a)}`;
const decadeOf = (y) => (y == null ? null : Math.floor(y / 10) * 10);

console.log('\n══════ DRY-RUN enriquecimiento TMDB (cine/series) — READ-ONLY ══════\n');
const haveSearch = readdirSync(SEARCH).filter((f) => f.endsWith('.json')).length;
console.log(`obras objetivo: ${obras.length} · búsquedas en cache: ${haveSearch}`);
if (haveSearch < obras.length) console.log(`⚠ faltan ${obras.length - haveSearch} búsquedas — el fetch no ha terminado. Cifras parciales.\n`); else console.log('');

// ── clasificar todo ──────────────────────────────────────────────────────────
const rows = obras.map((o) => {
  const s = readJson(resolve(SEARCH, `${o.id}.json`));
  const cl = s ? classify(o, s.cands) : { clase: 'sin_buscar', cands: [] };
  const det = cl.clase === 'alta' ? readJson(resolve(DETAIL, `${o.id}.json`)) : null;
  return { o, cands: s?.cands || [], ...cl, det };
});
const altas = rows.filter((r) => r.clase === 'alta');
const dudosos = rows.filter((r) => r.clase === 'dudoso');
const sinmatch = rows.filter((r) => r.clase === 'sin_match');

// ── (1) total a enriquecer ───────────────────────────────────────────────────
const porCat = (arr) => `peli ${arr.filter((r) => r.o.categoria === 'pelicula').length} · serie ${arr.filter((r) => r.o.categoria === 'serie').length}`;
console.log('— (1) Total cine/serie a enriquecer —');
console.log(`  ${obras.length}  (${porCat(rows)})\n`);

// ── (2) reparto ──────────────────────────────────────────────────────────────
const byMotivo = (m) => dudosos.filter((r) => r.motivo === m).length;
console.log('— (2) Reparto confianza —');
console.log(`  ALTA CONFIANZA : ${altas.length}  (${porCat(altas)})`);
console.log(`  DUDOSO         : ${dudosos.length}  (${porCat(dudosos)})`);
console.log(`     · sin año (regla: todas dudoso)      : ${byMotivo('sin_anio')}`);
console.log(`     · varios candidatos título+año        : ${byMotivo('varios_titulo_anio')}`);
console.log(`     · con año pero sin match título exacto : ${byMotivo('sin_titulo_anio_exacto')}`);
console.log(`  SIN MATCH      : ${sinmatch.length}  (${porCat(sinmatch)})\n`);

// ── (3) ejemplos de ALTA CONFIANZA ───────────────────────────────────────────
console.log('— (3) ALTA CONFIANZA — ejemplos (verifica que el año es el de estreno) —');
console.log(`  ${'título'.padEnd(34)} añoFA  añoTMDB  director / géneros`);
for (const r of altas.filter((r) => r.det).slice(0, 10)) {
  console.log(`  ${String(r.o.titulo).slice(0, 33).padEnd(34)} ${String(r.o.anio_obra).padEnd(6)} ${String(r.det.tmdb_year ?? '?').padEnd(8)} ${r.det.director ?? '—'}`);
  console.log(`     ${'géneros:'} ${(r.det.genres || []).join(', ') || '—'}`);
}
console.log('');

// ── (4) muestra de DUDOSOS con candidatos ────────────────────────────────────
console.log('— (4) DUDOSO — muestra con candidatos TMDB (para ver el tipo de ambigüedad) —');
const sampleDud = [];
for (const m of ['varios_titulo_anio', 'sin_titulo_anio_exacto', 'sin_anio']) {
  for (const r of dudosos.filter((r) => r.motivo === m).slice(0, 7)) sampleDud.push(r);
}
for (const r of sampleDud.slice(0, 20)) {
  console.log(`  [${r.o.categoria}] "${r.o.titulo}" (${r.o.anio_obra ?? 'sin año'}) · motivo=${r.motivo}`);
  for (const c of r.cands.slice(0, 4)) console.log(`      · ${c.t} [${c.ot}] (${c.y ?? '?'}) id=${c.id}`);
}
console.log('');

// ── (5) check clave_dedup con los años de ALTA ───────────────────────────────
const pg = await makePgClient();
const q = async (s, p = []) => (await pg.query(s, p)).rows;
const all = await q('select id, titulo, categoria, anio_obra, decada, creador from obra');
const altaYear = new Map(altas.filter((r) => r.det?.tmdb_year != null).map((r) => [r.o.id, r.det.tmdb_year]));
const post = new Map();
let cambiaAnio = 0;
for (const o of all) {
  let anio = o.anio_obra;
  if (altaYear.has(o.id)) { const ny = altaYear.get(o.id); if (ny !== o.anio_obra) cambiaAnio++; anio = ny; }
  const cd = dedup(o.titulo, o.categoria, anio);
  if (!post.has(cd)) post.set(cd, []);
  post.get(cd).push({ ...o, anio_post: anio });
}
const collisions = [...post.values()].filter((g) => g.length > 1);
console.log('— (5) clave_dedup con los años de ALTA CONFIANZA —');
console.log(`  obras de ALTA cuyo año cambiaría (TMDB ≠ FA, dentro de ±1): ${cambiaAnio}`);
console.log(`  COLISIONES de clave_dedup en el estado-post: ${collisions.length} ${collisions.length === 0 ? '✅' : '⛔ (estas se demoverían a DUDOSO)'}`);
for (const g of collisions) {
  console.log(`  ⚠ "${dedup(g[0].titulo, g[0].categoria, g[0].anio_post)}"`);
  for (const o of g) console.log(`      - ${o.id} "${o.titulo}" [${o.categoria}] añoFA=${o.anio_obra ?? 'NULL'} añoPost=${o.anio_post ?? 'NULL'}`);
}
console.log('');

// ── (6) impacto en diversidad ────────────────────────────────────────────────
const altaSinDecada = altas.filter((r) => all.find((o) => o.id === r.o.id)?.decada == null && r.det?.tmdb_year != null).length;
const genreDist = {};
for (const r of altas) for (const g of (r.det?.genres || [])) { const s = slug(g); genreDist[s] = (genreDist[s] || 0) + 1; }
const genreLinks = altas.reduce((s, r) => s + (r.det?.genres?.length || 0), 0);
const altaConCreadorFA = altas.filter((r) => all.find((o) => o.id === r.o.id)?.creador != null).length;
const altaDirectorNuevo = altas.filter((r) => all.find((o) => o.id === r.o.id)?.creador == null && r.det?.director).length;
console.log('— (6) Impacto en diversidad (solo ALTA CONFIANZA) —');
console.log(`  obras de ALTA que rellenarían década NUEVA: ${altaSinDecada}  (la mayoría ya tiene década por el año FA; el grueso de década nueva vendrá de las sin-año, que son DUDOSO)`);
console.log(`  géneros TMDB distintos (es-ES): ${Object.keys(genreDist).length}  ·  vínculos obra-género a crear: ${genreLinks}`);
console.log('    ' + Object.entries(genreDist).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`  director: ${altaConCreadorFA} de ALTA YA tienen creador (FA) · ${altaDirectorNuevo} recibirían director nuevo (no tenían)`);
console.log('');

// ── (7) scope ────────────────────────────────────────────────────────────────
console.log('— (7) Scope —');
console.log('  Solo cine/serie. NO toca videojuegos, NI entradas, NI país/idioma (aunque TMDB los tenga).');
console.log('  Aplica (tras tu OK) SOLO ALTA CONFIANZA: género (origen=tmdb) + director (si falta) + año confirmado.');
console.log('  DUDOSO y SIN MATCH: NO se escriben sin tu revisión.');
console.log('');

await pg.end();
console.log('Fin DRY-RUN (read-only — nada escrito en Supabase).\n');
