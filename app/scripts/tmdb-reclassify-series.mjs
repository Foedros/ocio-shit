// Reclasifica 2 obras mal catalogadas como película → serie, y corrige sus géneros (tenían los
// de la PELÍCULA equivocada del lote ALTA anterior). Requiere --apply. Director/año FA intactos
// (ya son los correctos de la serie). Backup + transacción + verificación re-consultada.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';
import { norm, cleanQuery } from './lib/tmdb-match.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '..', '..', 'data');
const KEY = (() => { for (const l of readFileSync(resolve(here, '..', '..', '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*TMDB_API_KEY\s*=\s*(.*)\s*$/); if (m) return m[1].replace(/^["']|["']$/g, ''); } })();
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// géneros combinados de TMDB-TV → taxonomía unificada (mismos que cine)
const TV_SPLIT = { 'Action & Adventure': ['Acción', 'Aventura'], 'Sci-Fi & Fantasy': ['Ciencia ficción', 'Fantasía'], 'War & Politics': ['Bélica'] };
const tvGenreSlugs = (genres) => [...new Set((genres || []).flatMap((g) => (TV_SPLIT[g.name] || [g.name]).map(slug)).filter(Boolean))];

async function tmdb(path, params) { const u = new URL('https://api.themoviedb.org/3' + path); u.searchParams.set('api_key', KEY); u.searchParams.set('language', 'es-ES'); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); return (await fetch(u)).json(); }

const TARGETS = ['filmaffinity:monster-2004', 'filmaffinity:la-mascara-1995'];

const pg = await makePgClient();
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const one = async (s, p = []) => (await pg.query(s, p)).rows[0];
const n = async (s, p = []) => Number((await one(s, p)).n);
const collCounts = async () => Object.fromEntries((await rows(`select c.nombre, (select count(*) from obra_coleccion oc where oc.coleccion_id=c.id)::int n from coleccion c order by c.nombre`)).map((r) => [r.nombre, r.n]));

console.log(`\n══════ Reclasificar 2 series (pelicula→serie) — ${APPLY ? 'APPLY' : 'DRY'} ══════\n`);

// resolver match TV confiable + detalle para cada target
const plan = [];
for (const fa of TARGETS) {
  const o = await one(`select id, titulo, anio_obra, categoria, creador from obra where fuente_externa=$1`, [fa]);
  if (!o) { console.log(`⛔ no existe ${fa}`); continue; }
  const r = await tmdb('/search/tv', { query: cleanQuery(o.titulo, true), first_air_date_year: o.anio_obra });
  const cand = (r.results || []).map((c) => ({ id: c.id, t: c.name, ot: c.original_name, y: c.first_air_date ? Number(c.first_air_date.slice(0, 4)) : null }))
    .find((c) => (norm(c.t) === norm(o.titulo) || norm(c.ot) === norm(o.titulo)) && c.y != null && Math.abs(c.y - o.anio_obra) <= 1);
  let genres = [];
  if (cand) { const d = await tmdb(`/tv/${cand.id}`, { append_to_response: 'credits' }); genres = tvGenreSlugs(d.genres); }
  plan.push({ o, fa, cand, genres });
  console.log(`${fa}: cat actual=${o.categoria} año=${o.anio_obra} creador="${o.creador}"`);
  console.log(`   TMDB-tv match: ${cand ? `"${cand.t}" (${cand.y}) id=${cand.id} ✓ confiable` : '⚠ sin match confiable → solo reclasifica, sin géneros nuevos'}`);
  console.log(`   géneros de serie a poner: ${genres.join(', ') || '(ninguno)'}`);
}

if (!APPLY) { console.log('\nDRY — usa --apply.\n'); await pg.end(); process.exit(0); }

// baseline + backup
const base = { obras: await n('select count(*) n from obra'), entradas: await n('select count(*) n from entrada'), pelis: await n(`select count(*) n from obra where categoria='pelicula'`), series: await n(`select count(*) n from obra where categoria='serie'`) };
const collBefore = await collCounts();
const ownerId = (await one('select id from auth.users limit 1')).id;
const KEYS = ['obras', 'entradas', 'personas', 'obra_creador', 'plataformas', 'etapas', 'etiquetas', 'colecciones', 'logros', 'titulos', 'momentos_canon', 'obra_etiqueta', 'entrada_etiqueta', 'obra_coleccion', 'entrada_acompanante', 'logros_desbloqueados', 'titulos_desbloqueados'];
const K2T = { obras: 'obra', entradas: 'entrada', personas: 'persona', obra_creador: 'obra_creador', plataformas: 'plataforma', etapas: 'etapa', etiquetas: 'etiqueta', colecciones: 'coleccion', logros: 'logro', titulos: 'titulo', momentos_canon: 'momento_canon', obra_etiqueta: 'obra_etiqueta', entrada_etiqueta: 'entrada_etiqueta', obra_coleccion: 'obra_coleccion', entrada_acompanante: 'entrada_acompanante', logros_desbloqueados: 'logro_desbloqueado', titulos_desbloqueados: 'titulo_desbloqueado' };
const dump = { schema_version: 2, exportado_en: null };
for (const k of KEYS) dump[k] = (await rows(`select * from ${K2T[k]}`)).map((r) => { const { owner_id, ...rest } = r; if ((K2T[k] === 'obra' || K2T[k] === 'entrada') && rest.metadata && typeof rest.metadata === 'object') rest.metadata = JSON.stringify(rest.metadata); return rest; });
writeFileSync(resolve(DATA, 'ocioshit.export.pre-reclassify.json'), JSON.stringify(dump));
console.log(`\n→ backup: data/ocioshit.export.pre-reclassify.json`);

console.log('→ Transacción…');
await pg.query('begin');
try {
  for (const { o, genres } of plan) {
    await pg.query(`update obra set categoria='serie' where id=$1`, [o.id]); // clave_dedup recalcula
    // quitar los géneros (de la peli equivocada)
    await pg.query(`delete from obra_etiqueta where obra_id=$1 and etiqueta_id in (select id from etiqueta where taxonomia='genero')`, [o.id]);
    // poner los géneros de la serie (reusar etiqueta por nombre; crear si faltara)
    for (const g of genres) {
      let t = await one(`select id from etiqueta where nombre=$1`, [g]);
      if (!t) { const id = randomUUID(); await pg.query(`insert into etiqueta (id,nombre,taxonomia,origen,owner_id) values ($1,$2,'genero','tmdb',$3)`, [id, g, ownerId]); t = { id }; }
      await pg.query(`insert into obra_etiqueta (obra_id,etiqueta_id,owner_id) values ($1,$2,$3) on conflict do nothing`, [o.id, t.id, ownerId]);
    }
  }
  // rematerializar (el cambio de categoria puede afectar colecciones de cine)
  let rem = 0;
  for (const c of await rows(`select id, regla_json from coleccion where tipo='inteligente' and regla_json is not null`)) {
    const { sql, params } = compileCollectionRule(JSON.parse(c.regla_json), { idiomaBase: 'es' });
    const { text, values } = toPg({ sql, params });
    const ids = (await pg.query(text, values)).rows.map((r) => r.id);
    await pg.query('delete from obra_coleccion where coleccion_id=$1', [c.id]);
    if (ids.length) { await pg.query(`insert into obra_coleccion (obra_id, coleccion_id, owner_id) select a,$2,$3 from unnest($1::text[]) as t(a) on conflict do nothing`, [ids, c.id, ownerId]); rem += ids.length; }
  }
  await pg.query('commit');
  console.log(`  reclasificadas 2 · colecciones rematerializadas (${rem})`);
} catch (e) { await pg.query('rollback'); console.error('  ⛔ ROLLBACK:', e.message); await pg.end(); process.exit(1); }

// verificación
console.log('\n— Verificación (re-consultado) —');
let fail = 0; const chk = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };
for (const { fa } of plan) {
  const o = await one(`select id, titulo, categoria, anio_obra, creador, clave_dedup from obra where fuente_externa=$1`, [fa]);
  const gens = (await rows(`select e.nombre from obra_etiqueta oe join etiqueta e on e.id=oe.etiqueta_id where oe.obra_id=$1 and e.taxonomia='genero' order by e.nombre`, [o.id])).map((r) => r.nombre);
  chk(`${fa}: categoria=serie`, o.categoria === 'serie', `(cat=${o.categoria} clave_dedup=${o.clave_dedup})`);
  console.log(`        año=${o.anio_obra} (intacto) · creador="${o.creador}" (intacto) · géneros=[${gens.join(', ')}]`);
}
chk('pelicula −2 / serie +2', await n(`select count(*) n from obra where categoria='pelicula'`) === base.pelis - 2 && await n(`select count(*) n from obra where categoria='serie'`) === base.series + 2);
chk('clave_dedup 0 NULL / 0 colisiones', (await one(`select count(*) filter (where clave_dedup is null)::int a, (count(*)-count(distinct clave_dedup))::int b from obra`)).a === 0 && (await one(`select (count(*)-count(distinct clave_dedup))::int b from obra`)).b === 0);
chk('entradas intactas', await n('select count(*) n from entrada') === base.entradas);
chk('obras intactas', await n('select count(*) n from obra') === base.obras);
chk('FK obra_etiqueta = 0', (await n(`select count(*) n from obra_etiqueta oe left join obra o on o.id=oe.obra_id where o.id is null`)) === 0);
const collAfter = await collCounts();
console.log('\n— Delta colecciones —');
let ch = 0; for (const k of Object.keys(collAfter)) if (collAfter[k] !== (collBefore[k] ?? 0)) { ch++; console.log(`  ${k}: ${collBefore[k] ?? 0} → ${collAfter[k]} (${collAfter[k] - (collBefore[k] ?? 0)})`); }
if (!ch) console.log('  (ninguna cambió)');
await pg.end();
console.log(`\n${fail === 0 ? '✅ Reclasificadas y verificadas.' : '❌ ' + fail + ' fallo(s).'}\n`);
process.exit(fail === 0 ? 0 : 1);
