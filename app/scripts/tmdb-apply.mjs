// APLICACIÓN de la fase ALTA CONFIANZA del enriquecimiento TMDB de cine + homogeneización de
// géneros de Steam al español. Requiere --apply. Lee data/_tmdbtmp/ y ESCRIBE en Supabase.
// Tres partes en UNA transacción:
//   1) cine ALTA: ALTER etiqueta.origen +'tmdb'; añadir géneros TMDB (es, origen='tmdb') +
//      vínculos a las 2.618. NO toca anio_obra ni director ni entradas.
//   2) traducir géneros de Steam al español; FUSIONAR con los de cine cuando coincidan
//      (reusar la etiqueta de cine, re-apuntar vínculos), si no, renombrar.
//   3) eliminar 'free-to-play' y 'early-access' (no son géneros) + sus vínculos.
// Decisiones: fusionadas → origen='tmdb'; massively-multiplayer → 'multijugador-masivo'.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';
import { classify } from './lib/tmdb-match.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_tmdbtmp');
const DATA = resolve(here, '..', '..', 'data');
const SEARCH = resolve(TMP, 'search'), DETAIL = resolve(TMP, 'detail');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// mapa de traducción Steam(en) → español
const TRANSLATE = { action: 'accion', adventure: 'aventura', rpg: 'rol', strategy: 'estrategia', simulation: 'simulacion', sports: 'deportes', racing: 'carreras', 'massively-multiplayer': 'multijugador-masivo', casual: 'casual', indie: 'indie' };
const DELETE_GENRES = ['free-to-play', 'early-access'];

// ── cargar ALTA + sus géneros (desde el cache del fetch) ─────────────────────
const obras = readJson(resolve(TMP, '_obras.json'));
const altaGenres = [];
for (const o of obras) {
  const s = readJson(resolve(SEARCH, `${o.id}.json`));
  if (!s) continue;
  if (classify(o, s.cands).clase !== 'alta') continue;
  const d = readJson(resolve(DETAIL, `${o.id}.json`));
  if (d) altaGenres.push({ obraId: o.id, genres: [...new Set((d.genres || []).map(slug).filter(Boolean))] });
}
const filmSlugs = [...new Set(altaGenres.flatMap((a) => a.genres))];

const pg = await makePgClient();
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const one = async (s, p = []) => (await pg.query(s, p)).rows[0];
const n = async (s, p = []) => Number((await one(s, p)).n);
const collCounts = async () => Object.fromEntries((await rows(`select c.nombre, (select count(*) from obra_coleccion oc where oc.coleccion_id=c.id)::int n from coleccion c order by c.nombre`)).map((r) => [r.nombre, r.n]));

console.log(`\n══════ TMDB cine ALTA + homogeneización géneros — ${APPLY ? 'APPLY' : 'DRY (usa --apply)'} ══════\n`);
console.log(`ALTA con géneros: ${altaGenres.length} · géneros de cine distintos: ${filmSlugs.length}`);

// guard anti doble-apply
if (await n(`select count(*) n from etiqueta where origen='tmdb'`) > 0) { console.log('⛔ Ya hay etiquetas origen=tmdb. Parece aplicado. Abortando (no re-escribir/corromper backup).'); await pg.end(); process.exit(1); }
if (!APPLY) { console.log('DRY — usa --apply para escribir.\n'); await pg.end(); process.exit(0); }

// baseline
const base = { obras: await n('select count(*) n from obra'), entradas: await n('select count(*) n from entrada'), pelisConAnio: await n(`select count(*) n from obra where categoria='pelicula' and anio_obra is not null`), pelisConCreador: await n(`select count(*) n from obra where categoria='pelicula' and creador is not null`) };
const collBefore = await collCounts();
const ownerId = (await one('select id from auth.users limit 1')).id;

// backup
console.log('→ Backup pre-enrich…');
const KEYS = ['obras', 'entradas', 'personas', 'obra_creador', 'plataformas', 'etapas', 'etiquetas', 'colecciones', 'logros', 'titulos', 'momentos_canon', 'obra_etiqueta', 'entrada_etiqueta', 'obra_coleccion', 'entrada_acompanante', 'logros_desbloqueados', 'titulos_desbloqueados'];
const K2T = { obras: 'obra', entradas: 'entrada', personas: 'persona', obra_creador: 'obra_creador', plataformas: 'plataforma', etapas: 'etapa', etiquetas: 'etiqueta', colecciones: 'coleccion', logros: 'logro', titulos: 'titulo', momentos_canon: 'momento_canon', obra_etiqueta: 'obra_etiqueta', entrada_etiqueta: 'entrada_etiqueta', obra_coleccion: 'obra_coleccion', entrada_acompanante: 'entrada_acompanante', logros_desbloqueados: 'logro_desbloqueado', titulos_desbloqueados: 'titulo_desbloqueado' };
const snapshot = async (path) => { const dump = { schema_version: 2, exportado_en: null }; for (const k of KEYS) dump[k] = (await rows(`select * from ${K2T[k]}`)).map((r) => { const { owner_id, ...rest } = r; if ((K2T[k] === 'obra' || K2T[k] === 'entrada') && rest.metadata && typeof rest.metadata === 'object') rest.metadata = JSON.stringify(rest.metadata); return rest; }); writeFileSync(path, JSON.stringify(dump)); return dump; };
const bak = await snapshot(resolve(DATA, 'ocioshit.export.pre-tmdb.json'));
console.log(`  backup: data/ocioshit.export.pre-tmdb.json (${bak.obras.length} obras / ${bak.entradas.length} entradas)`);

console.log('→ Transacción (ALTER + géneros cine + traducir/fusionar Steam + borrar no-géneros)…');
await pg.query('begin');
try {
  // ── ALTER aditivo: etiqueta.origen +'tmdb' ──
  await pg.query(`alter table etiqueta drop constraint etiqueta_origen_check`);
  await pg.query(`alter table etiqueta add constraint etiqueta_origen_check check (origen in ('manual','ia','steam','tmdb'))`);

  // ── PARTE 1: géneros de cine (origen='tmdb') + vínculos ──
  const existTag = new Map((await rows(`select id, nombre from etiqueta where nombre = any($1)`, [filmSlugs])).map((r) => [r.nombre, r.id]));
  const newSlugs = filmSlugs.filter((s) => !existTag.has(s));
  const newIds = newSlugs.map(() => randomUUID());
  if (newSlugs.length) await pg.query(`insert into etiqueta (id, nombre, taxonomia, origen, owner_id) select a,b,'genero','tmdb',c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c)`, [newIds, newSlugs, newSlugs.map(() => ownerId)]);
  newSlugs.forEach((s, i) => existTag.set(s, newIds[i]));
  const links = altaGenres.flatMap((a) => a.genres.map((g) => ({ o: a.obraId, e: existTag.get(g) })));
  const cineIns = await pg.query(`insert into obra_etiqueta (obra_id, etiqueta_id, owner_id) select a,b,c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c) on conflict do nothing`, [links.map((l) => l.o), links.map((l) => l.e), links.map(() => ownerId)]);
  console.log(`  Parte 1: ${newSlugs.length} etiquetas de género cine creadas (origen=tmdb) · ${cineIns.rowCount} vínculos`);

  // ── PARTE 2: traducir/fusionar géneros de Steam ──
  let merged = 0, renamed = 0, repointed = 0;
  for (const g of await rows(`select id, nombre from etiqueta where origen='steam' and taxonomia='genero'`)) {
    if (DELETE_GENRES.includes(g.nombre)) continue; // parte 3
    const target = TRANSLATE[g.nombre];
    if (!target || target === g.nombre) continue;   // casual/indie: sin cambio
    const exist = await one(`select id from etiqueta where nombre=$1 and id<>$2`, [target, g.id]);
    if (exist) { // FUSIÓN: re-apuntar vínculos a la etiqueta existente (cine) y borrar la de juego
      const rp = await pg.query(`insert into obra_etiqueta (obra_id, etiqueta_id, owner_id) select obra_id,$1,owner_id from obra_etiqueta where etiqueta_id=$2 on conflict do nothing`, [exist.id, g.id]);
      await pg.query(`delete from obra_etiqueta where etiqueta_id=$1`, [g.id]);
      await pg.query(`delete from etiqueta where id=$1`, [g.id]);
      merged++; repointed += rp.rowCount;
    } else { // RENOMBRAR (género solo-de-juegos), origen se queda 'steam'
      await pg.query(`update etiqueta set nombre=$1 where id=$2`, [target, g.id]);
      renamed++;
    }
  }
  console.log(`  Parte 2: ${merged} fusionadas (${repointed} vínculos re-apuntados) · ${renamed} renombradas`);

  // ── PARTE 3: borrar no-géneros (free-to-play, early-access) ──
  let delLinks = 0, delTags = 0;
  for (const name of DELETE_GENRES) {
    const t = await one(`select id from etiqueta where nombre=$1`, [name]);
    if (!t) continue;
    delLinks += (await pg.query(`delete from obra_etiqueta where etiqueta_id=$1`, [t.id])).rowCount;
    await pg.query(`delete from etiqueta where id=$1`, [t.id]);
    delTags++;
  }
  console.log(`  Parte 3: ${delTags} etiquetas borradas · ${delLinks} vínculos borrados`);

  // ── rematerializar colecciones ──
  let rem = 0;
  for (const c of await rows(`select id, regla_json from coleccion where tipo='inteligente' and regla_json is not null`)) {
    const { sql, params } = compileCollectionRule(JSON.parse(c.regla_json), { idiomaBase: 'es' });
    const { text, values } = toPg({ sql, params });
    const ids = (await pg.query(text, values)).rows.map((r) => r.id);
    await pg.query('delete from obra_coleccion where coleccion_id=$1', [c.id]);
    if (ids.length) { await pg.query(`insert into obra_coleccion (obra_id, coleccion_id, owner_id) select a,$2,$3 from unnest($1::text[]) as t(a) on conflict do nothing`, [ids, c.id, ownerId]); rem += ids.length; }
  }
  await pg.query('commit');
  console.log(`  colecciones rematerializadas (${rem} membresías)`);
} catch (e) { await pg.query('rollback'); console.error('  ⛔ ROLLBACK:', e.message); await pg.end(); process.exit(1); }

// ── VERIFICACIÓN (re-consultando) ─────────────────────────────────────────────
console.log('\n— Verificación (re-consultado a Supabase) —');
let fail = 0;
const chk = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };

const cineLinks = await n(`select count(*) n from obra_etiqueta oe join obra o on o.id=oe.obra_id join etiqueta e on e.id=oe.etiqueta_id where o.categoria in ('pelicula','serie') and e.taxonomia='genero'`);
chk('vínculos de género en cine = 6962', cineLinks === 6962, `(${cineLinks})`);
const genTotal = await n(`select count(*) n from etiqueta where taxonomia='genero'`);
chk('etiquetas de género distintas = 27 (sin dup por idioma)', genTotal === 27, `(${genTotal})`);
const ingleses = await n(`select count(*) n from etiqueta where taxonomia='genero' and nombre in ('action','adventure','strategy','simulation','sports','racing','massively-multiplayer','rpg','free-to-play','early-access')`);
chk('0 etiquetas con slug inglés/eliminado (no "action" vs "accion")', ingleses === 0, `(${ingleses})`);
const ftpEa = await n(`select count(*) n from etiqueta where nombre in ('free-to-play','early-access')`);
chk('free-to-play / early-access eliminadas', ftpEa === 0, `(${ftpEa})`);
chk('año FA intacto (pelis con anio_obra == baseline)', await n(`select count(*) n from obra where categoria='pelicula' and anio_obra is not null`) === base.pelisConAnio);
chk('director FA intacto (pelis con creador == baseline)', await n(`select count(*) n from obra where categoria='pelicula' and creador is not null`) === base.pelisConCreador);
chk('entradas intactas (4079)', await n('select count(*) n from entrada') === base.entradas, `(${await n('select count(*) n from entrada')})`);
chk('obras intactas (4241)', await n('select count(*) n from obra') === base.obras, `(${await n('select count(*) n from obra')})`);
const fk = await one(`select (select count(*) from obra_etiqueta oe left join obra o on o.id=oe.obra_id where o.id is null)::int a, (select count(*) from obra_etiqueta oe left join etiqueta e on e.id=oe.etiqueta_id where e.id is null)::int b`);
chk('FK huérfanas obra_etiqueta = 0', fk.a + fk.b === 0, JSON.stringify(fk));
const cd = await one(`select count(*) filter (where clave_dedup is null)::int nulos, (count(*) - count(distinct clave_dedup))::int dups from obra`);
chk('clave_dedup sin colisiones (no tocamos año)', cd.nulos === 0 && cd.dups === 0, JSON.stringify(cd));

// listado de géneros finales
console.log('\n— Géneros finales (español, sin duplicados) —');
for (const r of await rows(`select e.nombre, e.origen, count(oe.*)::int n from etiqueta e left join obra_etiqueta oe on oe.etiqueta_id=e.id where e.taxonomia='genero' group by e.nombre, e.origen order by n desc`)) console.log(`  ${r.nombre.padEnd(22)} ${r.origen.padEnd(6)} ${r.n}`);

// delta colecciones
const collAfter = await collCounts();
console.log('\n— Delta de colecciones —');
let changed = 0;
for (const k of Object.keys(collAfter)) if (collAfter[k] !== (collBefore[k] ?? 0)) { changed++; const d = collAfter[k] - (collBefore[k] ?? 0); console.log(`  ${k}: ${collBefore[k] ?? 0} → ${collAfter[k]} (${d >= 0 ? '+' : ''}${d})`); }
if (!changed) console.log('  (ninguna colección cambió de conteo)');

// 2 pares en colisión potencial (NO tocados) — para revisión del usuario
console.log('\n— Pares en colisión potencial (NO tocados — revísalos por si son duplicados) —');
for (const r of await rows(`select id, titulo, anio_obra, fuente_externa from obra where lower(titulo) in ('monster','la máscara') and categoria='pelicula' order by titulo, anio_obra`)) console.log(`  "${r.titulo}" año=${r.anio_obra} id=${r.id} fa=${r.fuente_externa}`);

await snapshot(resolve(DATA, 'ocioshit.export.post-tmdb.json'));
console.log('\n  snapshot post: data/ocioshit.export.post-tmdb.json');
await pg.end();
console.log(`\n${fail === 0 ? '✅ Aplicado y verificado.' : '❌ ' + fail + ' fallo(s).'}\n`);
process.exit(fail === 0 ? 0 : 1);
