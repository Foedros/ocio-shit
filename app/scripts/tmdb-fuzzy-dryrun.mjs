// DRY-RUN fase 1 de DUDOSOS: los 408 "con año pero sin título exacto". Re-casado FUZZY (título
// difuso + año ±1) sobre los candidatos YA cacheados (sin re-buscar). Baja el detalle (géneros)
// de los ALTA-FUZZY para la muestra. NO escribe en Supabase.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classify, classifyFuzzy } from './lib/tmdb-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_tmdbtmp');
const SEARCH = resolve(TMP, 'search'), FZDET = resolve(TMP, 'fuzzydetail');
mkdirSync(FZDET, { recursive: true });
const KEY = (() => { for (const l of readFileSync(resolve(here, '..', '..', '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*TMDB_API_KEY\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } })();
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, o) => { const t = p + '.tmp'; writeFileSync(t, JSON.stringify(o)); renameSync(t, p); };
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pool(items, n, w) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await w(items[i++]); })); }
async function tmdb(path, params = {}) { const u = new URL('https://api.themoviedb.org/3' + path); u.searchParams.set('api_key', KEY); u.searchParams.set('language', 'es-ES'); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); for (let a = 1; ; a++) { const r = await fetch(u); if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000 + 500); continue; } if (!r.ok) { if (a > 4) return null; await sleep(1000); continue; } return r.json(); } }

const obras = readJson(resolve(TMP, '_obras.json'));

// ── targets = los 408 (dudoso con año, sin título exacto) ────────────────────
const targets = [];
for (const o of obras) {
  const s = readJson(resolve(SEARCH, `${o.id}.json`));
  if (!s) continue;
  const c = classify(o, s.cands);
  if (c.clase === 'dudoso' && c.motivo === 'sin_titulo_anio_exacto') targets.push({ o, cands: s.cands });
}

console.log('\n══════ DRY-RUN fuzzy — fase 1 dudosos (near-miss con año) — READ-ONLY ══════\n');
console.log(`near-miss objetivo (con año, sin título exacto): ${targets.length}`);

// ── fuzzy classify ───────────────────────────────────────────────────────────
const altaFz = [], sigue = [];
for (const t of targets) {
  const r = classifyFuzzy(t.o.titulo, t.o.anio_obra, t.cands);
  if (r.clase === 'alta_fuzzy') altaFz.push({ ...t, best: r.best, score: r.score });
  else sigue.push({ ...t, ...r });
}
console.log(`  → ALTA-FUZZY (pasarían a confianza): ${altaFz.length}`);
console.log(`  → SIGUE-DUDOSO (a tanda posterior): ${sigue.length}\n`);

// ── bajar detalle (géneros) de los ALTA-FUZZY (movie) para la muestra/aplicación ──
const pend = altaFz.filter((a) => !existsSync(resolve(FZDET, `${a.o.id}.json`)));
console.log(`Bajando géneros de ${pend.length} ALTA-FUZZY (resumible)…`);
let d = 0;
await pool(pend, 5, async (a) => {
  const det = await tmdb(`/movie/${a.best.id}`, { append_to_response: 'credits' });
  const genres = (det?.genres || []).map((g) => g.name);
  writeJson(resolve(FZDET, `${a.o.id}.json`), { tmdb_id: a.best.id, tmdb_title: a.best.t, tmdb_year: a.best.y, genres });
  if (++d % 100 === 0) console.log(`  …${d}/${pend.length}`);
  await sleep(120);
});

// ── muestra de 28 ALTA-FUZZY para validar el fuzzy ──────────────────────────
console.log('\n— MUESTRA ALTA-FUZZY (valida que el fuzzy NO casa mal) —');
console.log(`  ${'título FA'.padEnd(34)} ${'→ título TMDB'.padEnd(34)} año  sc   géneros`);
const sample = altaFz.slice(0, 28);
for (const a of sample) {
  const det = readJson(resolve(FZDET, `${a.o.id}.json`));
  const g = (det?.genres || []).map(slug).join(', ');
  console.log(`  ${String(a.o.titulo).slice(0, 33).padEnd(34)} ${String(a.best.t).slice(0, 33).padEnd(34)} ${String(a.o.anio_obra).padEnd(4)} ${a.score.toFixed(2)} ${g}`);
}

// ── un vistazo a SIGUE-DUDOSO (por qué no pasaron) ──────────────────────────
console.log('\n— Muestra SIGUE-DUDOSO (no alcanzan el umbral / ambiguos) —');
for (const s of sigue.slice(0, 8)) {
  console.log(`  "${s.o.titulo}" (${s.o.anio_obra}) sc=${s.score?.toFixed(2) ?? '—'}${s.segundo ? ` 2º=${s.segundo.toFixed(2)}` : ''} → mejor: ${s.best ? `"${s.best.t}" (${s.best.y})` : s.motivo}`);
}

// ── géneros que se añadirían + clave_dedup ──────────────────────────────────
const genreDist = {};
let links = 0;
for (const a of altaFz) { const det = readJson(resolve(FZDET, `${a.o.id}.json`)); for (const gn of (det?.genres || [])) { genreDist[slug(gn)] = (genreDist[slug(gn)] || 0) + 1; links++; } }
console.log(`\n— Si apruebas: ${altaFz.length} obras reciben géneros (origen='tmdb'), ${links} vínculos —`);
console.log('  ' + Object.entries(genreDist).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('\n— clave_dedup —');
console.log('  Solo se añaden GÉNEROS; NO se toca anio_obra/categoria → clave_dedup NO cambia → 0 colisiones posibles.');
console.log('\nFin DRY-RUN fuzzy (read-only — nada escrito en Supabase).\n');
