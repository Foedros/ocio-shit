// DRY-RUN del enriquecimiento de metadatos de Steam (año de estreno + publisher + géneros).
// Lee data/_steamtmp/*.json (del fetch) y RE-CONSULTA Supabase. NO escribe nada.
// Responde a todo lo pedido: cobertura por campo, ejemplos (año estreno vs última jugada),
// check de clave_dedup con años REALES, impacto en diversidad (década/género), y scope.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_steamtmp');
const appids = JSON.parse(readFileSync(resolve(TMP, '_appids.json'), 'utf8'));

const yearOf = (rd) => {
  if (!rd || !rd.date) return null;
  const m = String(rd.date).match(/\b(19[7-9]\d|20[0-2]\d)\b/);
  return m ? Number(m[1]) : null;
};
const dedup = (titulo, categoria, anio) =>
  `${String(titulo).toLowerCase()}|${categoria}|${anio == null ? '' : String(anio)}`;
const decadeOf = (y) => (y == null ? null : Math.floor(y / 10) * 10);

// ── cargar lo bajado, por appid ──────────────────────────────────────────────
const meta = new Map(); // appid -> parsed fetch file
let filesPresent = 0;
for (const a of appids) {
  const f = resolve(TMP, `${a.appid}.json`);
  if (existsSync(f)) { try { meta.set(a.appid, JSON.parse(readFileSync(f, 'utf8'))); filesPresent++; } catch {} }
}
console.log(`\n══════ DRY-RUN enriquecimiento Steam (año estreno + publisher + géneros) — READ-ONLY ══════\n`);
console.log(`appids objetivo: ${appids.length} · ficheros descargados presentes: ${filesPresent}`);
if (filesPresent < appids.length) console.log(`⚠ faltan ${appids.length - filesPresent} ficheros — el fetch no ha terminado; re-ejecútalo. Cifras parciales.\n`);
else console.log('');

// ── derivar los 3 campos por obra ────────────────────────────────────────────
const derived = appids.map((a) => {
  const m = meta.get(a.appid);
  const success = m?.success === true;
  const year = success ? yearOf(m.release_date) : null;
  const publisher = success && Array.isArray(m.publishers) && m.publishers.length ? String(m.publishers[0]).trim() : null;
  const genres = success && Array.isArray(m.genres) ? m.genres.map((g) => g.description).filter(Boolean).slice(0, 3) : [];
  return { ...a, present: !!m, success, retired: m?.success === false, year, publisher, genres, releaseRaw: success ? m.release_date?.date ?? null : null };
});

// ── (1) cobertura ────────────────────────────────────────────────────────────
const nYear = derived.filter((d) => d.year != null).length;
const nPub = derived.filter((d) => d.publisher != null).length;
const nGen = derived.filter((d) => d.genres.length > 0).length;
const retired = derived.filter((d) => d.retired);
const successNoYear = derived.filter((d) => d.success && d.year == null);
const successNoPub = derived.filter((d) => d.success && d.publisher == null);
const successNoGen = derived.filter((d) => d.success && d.genres.length === 0);

console.log('— (1) Cobertura sobre las', appids.length, '—');
console.log(`  AÑO de estreno (release_date) : ${nYear}  ·  sin año: ${appids.length - nYear}`);
console.log(`  publisher                     : ${nPub}  ·  sin publisher: ${appids.length - nPub}`);
console.log(`  géneros (≥1)                  : ${nGen}  ·  sin géneros: ${appids.length - nGen}`);
console.log(`  appids RETIRADOS (success=false, 3 campos NULL): ${retired.length}`);
if (retired.length) console.log(`     ${retired.map((d) => `${d.appid}"${String(d.titulo).slice(0, 20)}"`).join('  ')}`);
if (successNoYear.length) {
  console.log(`  success=true PERO sin año parseable: ${successNoYear.length} (anio_obra queda NULL; NO se inventa)`);
  for (const d of successNoYear.slice(0, 12)) console.log(`     ${d.appid} "${String(d.titulo).slice(0, 28)}"  release="${d.releaseRaw ?? ''}"`);
}
if (successNoPub.length) console.log(`  success=true sin publisher: ${successNoPub.length}`);
if (successNoGen.length) console.log(`  success=true sin géneros: ${successNoGen.length}`);
console.log('');

// ── (2) ejemplos: AÑO DE ESTRENO vs AÑO DE ÚLTIMA JUGADA (re-consultando Supabase) ──
const pg = await makePgClient();
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const STEAM = "categoria='videojuego' and fuente_externa like 'steam:%'";

const obraMeta = new Map((await rows(
  `select replace(fuente_externa,'steam:','') appid, titulo,
          (metadata->>'ultima_vez_jugado') ultima, (metadata->>'playtime_total_min')::int pt
   from obra o where ${STEAM}`
)).map((r) => [r.appid, r]));

console.log('— (2) Ejemplos: AÑO DE ESTRENO (release_date) vs año de ÚLTIMA JUGADA (metadata) —');
console.log('  (los 8 con más horas jugadas, para títulos reconocibles)\n');
const byPlaytime = derived
  .filter((d) => d.year != null)
  .map((d) => ({ ...d, ult: obraMeta.get(d.appid)?.ultima ?? null, pt: obraMeta.get(d.appid)?.pt ?? 0 }))
  .sort((a, b) => b.pt - a.pt)
  .slice(0, 8);
console.log(`  ${'juego'.padEnd(30)} ${'appid'.padEnd(8)} estreno  últjugada  publisher`);
for (const d of byPlaytime) {
  const ultY = d.ult ? String(d.ult).slice(0, 4) : '—';
  console.log(`  ${String(d.titulo).slice(0, 29).padEnd(30)} ${d.appid.padEnd(8)} ${String(d.year).padEnd(8)} ${ultY.padEnd(10)} ${d.publisher ?? '—'}`);
  console.log(`     ${'géneros:'.padStart(0)} ${d.genres.join(', ') || '—'}   (release_date crudo: "${d.releaseRaw}")`);
}
console.log('');

// ── (3) check clave_dedup con AÑOS REALES ────────────────────────────────────
const all = await rows(`select id, titulo, categoria, anio_obra from obra`);
const yearByObra = new Map(derived.filter((d) => d.year != null).map((d) => [d.obraId, d.year]));
const post = new Map();
let changed = 0;
for (const o of all) {
  let anio = o.anio_obra;
  if (yearByObra.has(o.id)) { anio = yearByObra.get(o.id); changed++; }
  const cd = dedup(o.titulo, o.categoria, anio);
  if (!post.has(cd)) post.set(cd, []);
  post.get(cd).push({ ...o, anio_post: anio });
}
const collisions = [...post.values()].filter((g) => g.length > 1);
console.log('— (3) Check clave_dedup con los AÑOS REALES de estreno —');
console.log(`  obras a las que se asignaría año real: ${changed}`);
console.log(`  COLISIONES de clave_dedup en el estado-post: ${collisions.length} ${collisions.length === 0 ? '✅' : '⛔'}`);
for (const g of collisions) {
  console.log(`  ⚠ "${dedup(g[0].titulo, g[0].categoria, g[0].anio_post)}"`);
  for (const o of g) console.log(`      - ${o.id} "${o.titulo}" [${o.categoria}] post=${o.anio_post ?? 'NULL'}`);
}
console.log('');

// ── (4) impacto en diversidad ────────────────────────────────────────────────
const conDecadaNueva = derived.filter((d) => d.year != null).length; // todas las 446 tienen anio_obra NULL → decada NULL hoy
const decadeDist = {};
for (const d of derived) if (d.year != null) { const dec = decadeOf(d.year); decadeDist[dec] = (decadeDist[dec] || 0) + 1; }
const genreDist = {};
for (const d of derived) for (const g of d.genres) genreDist[g] = (genreDist[g] || 0) + 1;
const pubDist = {};
for (const d of derived) if (d.publisher) pubDist[d.publisher] = (pubDist[d.publisher] || 0) + 1;
const genreLinks = derived.reduce((s, d) => s + d.genres.length, 0);

// estado actual de decada en videojuegos de Steam (debe ser 0 con valor)
const decadaHoy = (await rows(`select count(*) filter (where decada is not null)::int condec, count(*)::int total from obra o where ${STEAM}`))[0];

console.log('— (4) Impacto en diversidad —');
console.log(`  decada en videojuegos Steam HOY: ${decadaHoy.condec}/${decadaHoy.total} con valor (resto NULL)`);
console.log(`  obras que pasarían decada NULL → década real: ${conDecadaNueva}`);
console.log(`  décadas distintas que aparecerían: ${Object.keys(decadeDist).length}`);
console.log('    ' + Object.entries(decadeDist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}s:${v}`).join('  '));
console.log(`  géneros distintos (campo genres de Steam): ${Object.keys(genreDist).length}  ·  vínculos obra-género a crear: ${genreLinks}`);
console.log('    ' + Object.entries(genreDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log(`  publishers distintos: ${Object.keys(pubDist).length}`);
console.log('    top: ' + Object.entries(pubDist).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('');

// ── (5) confirmación de scope ────────────────────────────────────────────────
const sheetsVJ = (await rows(`select count(*)::int n from obra where categoria='videojuego' and fuente_externa is null`))[0].n;
const steamConEntradaSheets = (await rows(`select count(*)::int n from obra o join entrada e on e.obra_id=o.id where ${STEAM} and e.metadata->>'origen'='sheets'`))[0].n;
console.log('— (5) Scope (qué se tocaría y qué NO) —');
console.log(`  SE TOCA solo: obra.anio_obra (+ decada y clave_dedup, que se RECALCULAN solas);`);
console.log(`               obra_creador (publisher, rol_credito='publisher'); etiquetas género origen='steam'.`);
console.log(`  NO se toca ninguna ENTRADA (las del Sheets/Steam quedan igual; valoracion/fecha intactas).`);
console.log(`  NO se tocan los ${sheetsVJ} videojuegos del Sheets (fuente_externa NULL, incl. LOL) — el filtro es steam:%.`);
console.log(`  Las ${steamConEntradaSheets} obras Steam con Entrada del Sheets: se enriquece su OBRA (correcto), su Entrada NO se toca.`);
console.log('');

await pg.end();
console.log('Fin DRY-RUN (read-only — nada escrito en Supabase).\n');
