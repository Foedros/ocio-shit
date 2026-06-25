// APLICACIÓN del enriquecimiento de metadatos de Steam (año de estreno + developer + géneros).
// Lee data/_steamtmp/*.json (del fetch) y ESCRIBE en Supabase. Requiere --apply.
// Decisiones del usuario (2026-06-25): creador=DEVELOPER (rol_credito='developer');
// géneros=TODOS los de Steam, origen='steam'; decada explícita; ALTER aditivo a etiqueta.origen.
//
// Flujo: guard anti-doble-apply → backup pre-enrich → transacción (ALTER + anio/decada +
// developers→persona/obra_creador + géneros→etiqueta/obra_etiqueta + rematerializar) →
// verificación RE-CONSULTANDO Postgres → snapshot post.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_steamtmp');
const DATA = resolve(here, '..', '..', 'data');

// helpers de derivación (idénticos al dry-run)
const yearOf = (rd) => { if (!rd || !rd.date) return null; const m = String(rd.date).match(/\b(19[7-9]\d|20[0-2]\d)\b/); return m ? Number(m[1]) : null; };
const decadeOf = (y) => (y == null ? null : Math.floor(y / 10) * 10);
const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ── cargar fetch + derivar 3 campos por obra ─────────────────────────────────
const appids = JSON.parse(readFileSync(resolve(TMP, '_appids.json'), 'utf8'));
const derived = appids.map((a) => {
  const f = resolve(TMP, `${a.appid}.json`);
  const m = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  const success = m?.success === true;
  const year = success ? yearOf(m.release_date) : null;
  const developer = success && Array.isArray(m.developers) && m.developers.length ? String(m.developers[0]).trim() : null;
  const genres = success && Array.isArray(m.genres) ? m.genres.map((g) => g.description).filter(Boolean) : []; // TODOS, sin cap
  return { obraId: a.obraId, titulo: a.titulo, appid: a.appid, year, decada: decadeOf(year), developer, genres };
});

const pg = await makePgClient();
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const one = async (s, p = []) => (await pg.query(s, p)).rows[0];
const n = async (s, p = []) => Number((await one(s, p)).n);
const STEAM = "categoria='videojuego' and fuente_externa like 'steam:%'";
const collCounts = async () => Object.fromEntries((await rows(
  `select c.nombre, (select count(*) from obra_coleccion oc where oc.coleccion_id=c.id)::int n from coleccion c order by c.nombre`
)).map((r) => [r.nombre, r.n]));

console.log(`\n══════ Steam meta-enrich — ${APPLY ? 'APPLY' : 'DRY (usa --apply)'} ══════\n`);

// ── guard anti doble-apply (no corromper el backup pre-enrich) ───────────────
const yaDev = await n(`select count(*) n from obra_creador where rol_credito='developer'`);
if (yaDev > 0) { console.log(`⛔ Ya hay ${yaDev} vínculos rol_credito='developer'. Parece ya aplicado. Abortando para no re-escribir ni corromper backup.`); await pg.end(); process.exit(1); }

if (!APPLY) { console.log('DRY — usa steam-meta-dryrun.mjs para el detalle. Aquí solo --apply escribe.\n'); await pg.end(); process.exit(0); }

// ── baseline (para deltas) ───────────────────────────────────────────────────
const base = {
  obras: await n('select count(*) n from obra'), entradas: await n('select count(*) n from entrada'),
  personas: await n('select count(*) n from persona'), etiquetas: await n('select count(*) n from etiqueta')
};
const collBefore = await collCounts();
const ownerId = (await one('select id from auth.users limit 1')).id;

// ── backup pre-enrich ────────────────────────────────────────────────────────
console.log('→ Backup pre-enrich…');
const KEYS = ['obras','entradas','personas','obra_creador','plataformas','etapas','etiquetas','colecciones','logros','titulos','momentos_canon','obra_etiqueta','entrada_etiqueta','obra_coleccion','entrada_acompanante','logros_desbloqueados','titulos_desbloqueados'];
const K2T = { obras:'obra',entradas:'entrada',personas:'persona',obra_creador:'obra_creador',plataformas:'plataforma',etapas:'etapa',etiquetas:'etiqueta',colecciones:'coleccion',logros:'logro',titulos:'titulo',momentos_canon:'momento_canon',obra_etiqueta:'obra_etiqueta',entrada_etiqueta:'entrada_etiqueta',obra_coleccion:'obra_coleccion',entrada_acompanante:'entrada_acompanante',logros_desbloqueados:'logro_desbloqueado',titulos_desbloqueados:'titulo_desbloqueado' };
const snapshot = async (path) => {
  const dump = { schema_version: 2, exportado_en: null };
  for (const k of KEYS) dump[k] = (await rows(`select * from ${K2T[k]}`)).map((r) => { const { owner_id, ...rest } = r; if ((K2T[k]==='obra'||K2T[k]==='entrada') && rest.metadata && typeof rest.metadata==='object') rest.metadata = JSON.stringify(rest.metadata); return rest; });
  writeFileSync(path, JSON.stringify(dump));
  return dump;
};
const bak = await snapshot(resolve(DATA, 'ocioshit.export.pre-steam-meta.json'));
console.log(`  backup: data/ocioshit.export.pre-steam-meta.json (${bak.obras.length} obras / ${bak.entradas.length} entradas)`);

// ── transacción ──────────────────────────────────────────────────────────────
console.log('→ Transacción (ALTER + anio/decada + developers + géneros + rematerializar)…');
await pg.query('begin');
try {
  // (a) ALTER aditivo del CHECK de etiqueta.origen
  await pg.query(`alter table etiqueta drop constraint etiqueta_origen_check`);
  await pg.query(`alter table etiqueta add constraint etiqueta_origen_check check (origen in ('manual','ia','steam'))`);

  // (b) anio_obra + decada (solo las 436 con año real) — clave_dedup se recalcula sola
  const yA = derived.filter((d) => d.year != null);
  const updYear = await pg.query(
    `update obra o set anio_obra=t.anio, decada=t.dec from unnest($1::text[],$2::int[],$3::int[]) as t(id,anio,dec) where o.id=t.id`,
    [yA.map((d) => d.obraId), yA.map((d) => d.year), yA.map((d) => d.decada)]
  );

  // (c) developers → persona (dedup por nombre) + obra.creador (texto) + obra_creador('developer')
  const dA = derived.filter((d) => d.developer);
  const devNames = [...new Set(dA.map((d) => d.developer))];
  const existing = new Map((await rows(`select id, nombre from persona where nombre = any($1)`, [devNames])).map((r) => [r.nombre, r.id]));
  const newNames = devNames.filter((nm) => !existing.has(nm));
  const newIds = newNames.map(() => randomUUID());
  if (newNames.length) await pg.query(
    `insert into persona (id, nombre, rol, owner_id) select a,b,'creador',c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c)`,
    [newIds, newNames, newNames.map(() => ownerId)]
  );
  newNames.forEach((nm, i) => existing.set(nm, newIds[i]));
  // obra.creador (texto) = developer principal
  await pg.query(
    `update obra o set creador=t.cre from unnest($1::text[],$2::text[]) as t(id,cre) where o.id=t.id`,
    [dA.map((d) => d.obraId), dA.map((d) => d.developer)]
  );
  // obra_creador (obra, persona, 'developer')
  const ocIns = await pg.query(
    `insert into obra_creador (obra_id, persona_id, rol_credito, owner_id)
     select a,b,'developer',c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c) on conflict do nothing`,
    [dA.map((d) => d.obraId), dA.map((d) => existing.get(d.developer)), dA.map(() => ownerId)]
  );

  // (d) géneros → etiqueta (taxonomia='genero', origen='steam', dedup por nombre=slug) + obra_etiqueta
  const links = derived.flatMap((d) => d.genres.map((g) => ({ obraId: d.obraId, slug: slugify(g), label: g })));
  const slugSet = [...new Set(links.map((l) => l.slug))].filter(Boolean);
  const existTag = new Map((await rows(`select id, nombre from etiqueta where nombre = any($1)`, [slugSet])).map((r) => [r.nombre, r.id]));
  const newTags = slugSet.filter((s) => !existTag.has(s));
  const newTagIds = newTags.map(() => randomUUID());
  if (newTags.length) await pg.query(
    `insert into etiqueta (id, nombre, taxonomia, origen, owner_id) select a,b,'genero','steam',c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c)`,
    [newTagIds, newTags, newTags.map(() => ownerId)]
  );
  newTags.forEach((s, i) => existTag.set(s, newTagIds[i]));
  const oeIns = await pg.query(
    `insert into obra_etiqueta (obra_id, etiqueta_id, owner_id)
     select a,b,c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c) on conflict do nothing`,
    [links.map((l) => l.obraId), links.map((l) => existTag.get(l.slug)), links.map(() => ownerId)]
  );

  // (e) rematerializar colecciones inteligentes (compilador conservado → SQL → Postgres)
  let rem = 0;
  for (const c of await rows(`select id, regla_json from coleccion where tipo='inteligente' and regla_json is not null`)) {
    const { sql, params } = compileCollectionRule(JSON.parse(c.regla_json), { idiomaBase: 'es' });
    const { text, values } = toPg({ sql, params });
    const ids = (await pg.query(text, values)).rows.map((r) => r.id);
    await pg.query('delete from obra_coleccion where coleccion_id=$1', [c.id]);
    if (ids.length) {
      await pg.query(
        `insert into obra_coleccion (obra_id, coleccion_id, owner_id) select a,$2,$3 from unnest($1::text[]) as t(a) on conflict do nothing`,
        [ids, c.id, ownerId]
      );
      rem += ids.length;
    }
  }
  await pg.query('commit');
  console.log(`  anio/decada: ${updYear.rowCount} · personas nuevas: ${newNames.length} · obra_creador: ${ocIns.rowCount} · etiquetas género nuevas: ${newTags.length} · obra_etiqueta: ${oeIns.rowCount} · colecciones rematerializadas (${rem} membresías)`);
} catch (e) { await pg.query('rollback'); console.error('  ⛔ ROLLBACK:', e.message); await pg.end(); process.exit(1); }

// ── verificación RE-CONSULTANDO ──────────────────────────────────────────────
console.log('\n— Verificación (re-consultado a Supabase) —');
let fail = 0;
const chk = (l, c, ex = '') => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${ex ? '  ' + ex : ''}`); };

const conAnio = await n(`select count(*) n from obra o where ${STEAM} and anio_obra is not null`);
const conDecada = await n(`select count(*) n from obra o where ${STEAM} and decada is not null`);
chk('obras Steam con AÑO real = 436', conAnio === 436, `(${conAnio})`);
chk('obras Steam con DECADA = 436', conDecada === 436, `(${conDecada})`);
const devLinks = await n(`select count(*) n from obra_creador oc join obra o on o.id=oc.obra_id where ${STEAM} and oc.rol_credito='developer'`);
const devDist = await n(`select count(distinct oc.persona_id) n from obra_creador oc join obra o on o.id=oc.obra_id where ${STEAM} and oc.rol_credito='developer'`);
chk('vínculos obra_creador developer = 432', devLinks === 432, `(${devLinks})`);
console.log(`         developers distintos enlazados: ${devDist}`);
const genTags = await n(`select count(*) n from etiqueta where origen='steam' and taxonomia='genero'`);
const genLinks = await n(`select count(*) n from obra_etiqueta oe join etiqueta e on e.id=oe.etiqueta_id where e.origen='steam'`);
chk('etiquetas de género origen=steam (≥1)', genTags >= 1, `(${genTags} etiquetas)`);
console.log(`         vínculos obra-género: ${genLinks}`);

const sinAnio = await rows(`select titulo, fuente_externa from obra o where ${STEAM} and anio_obra is null order by titulo`);
chk('exactamente 10 obras Steam SIN año (no inventadas)', sinAnio.length === 10, `(${sinAnio.length})`);
for (const r of sinAnio) console.log(`         NULL: ${r.titulo}`);

// 30 del Sheets + entradas intactas
const sheetsDev = await n(`select count(*) n from obra_creador oc join obra o on o.id=oc.obra_id where o.categoria='videojuego' and o.fuente_externa is null and oc.rol_credito='developer'`);
const sheetsGen = await n(`select count(*) n from obra_etiqueta oe join obra o on o.id=oe.obra_id join etiqueta e on e.id=oe.etiqueta_id where o.categoria='videojuego' and o.fuente_externa is null and e.origen='steam'`);
chk('30 videojuegos Sheets sin developer ni género Steam', sheetsDev === 0 && sheetsGen === 0, `(dev=${sheetsDev} gen=${sheetsGen})`);
chk('entradas intactas (count == baseline)', await n('select count(*) n from entrada') === base.entradas, `(${await n('select count(*) n from entrada')} vs ${base.entradas})`);
chk('obras intactas (count == baseline)', await n('select count(*) n from obra') === base.obras);
// LOL intacto
chk('LOL intacto (habito, 129056, sin developer)', !!(await one(`select 1 from obra o join entrada e on e.obra_id=o.id where o.titulo='LOL' and e.clase_tiempo='habito' and e.duracion_min=129056 and not exists(select 1 from obra_creador oc where oc.obra_id=o.id)`)));

// FK 0
const fk = await one(`select
  (select count(*) from entrada e left join obra o on o.id=e.obra_id where o.id is null)::int e,
  (select count(*) from obra_creador oc left join obra o on o.id=oc.obra_id where o.id is null)::int oc1,
  (select count(*) from obra_creador oc left join persona p on p.id=oc.persona_id where p.id is null)::int oc2,
  (select count(*) from obra_etiqueta oe left join obra o on o.id=oe.obra_id where o.id is null)::int oe1,
  (select count(*) from obra_etiqueta oe left join etiqueta t on t.id=oe.etiqueta_id where t.id is null)::int oe2`);
chk('FK huérfanas = 0', fk.e + fk.oc1 + fk.oc2 + fk.oe1 + fk.oe2 === 0, JSON.stringify(fk));

// clave_dedup recalculada: sin NULL, sin duplicados (índice UNIQUE)
const cd = await one(`select count(*) filter (where clave_dedup is null)::int nulos, (count(*) - count(distinct clave_dedup))::int dups from obra`);
chk('clave_dedup recalculada: 0 NULL y 0 colisiones', cd.nulos === 0 && cd.dups === 0, JSON.stringify(cd));

// delta de colecciones
const collAfter = await collCounts();
console.log('\n— Delta de colecciones (rematerializadas) —');
let changed = 0;
for (const k of Object.keys(collAfter)) if (collAfter[k] !== (collBefore[k] ?? 0)) { changed++; const d = collAfter[k] - (collBefore[k] ?? 0); console.log(`  ${k}: ${collBefore[k] ?? 0} → ${collAfter[k]}  (${d >= 0 ? '+' : ''}${d})`); }
if (!changed) console.log('  (ninguna colección cambió de conteo)');

// snapshot post
await snapshot(resolve(DATA, 'ocioshit.export.post-steam-meta.json'));
console.log('\n  snapshot post: data/ocioshit.export.post-steam-meta.json');

await pg.end();
console.log(`\n${fail === 0 ? '✅ Aplicado y verificado.' : '❌ ' + fail + ' fallo(s).'}\n`);
process.exit(fail === 0 ? 0 : 1);
