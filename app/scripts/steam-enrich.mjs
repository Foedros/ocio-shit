// Enriquecimiento de videojuegos de Steam en Supabase.
//   Punto 1: obra.duracion_canonica_min = playtime_total_min en las 447 Steam (todas).
//   Punto 2: Entrada nueva SOLO si playtime_total_min > 30 Y sin entrada previa (umbral decidido).
// DRY-RUN por defecto; `--apply` escribe (backup + transacción + rematerializa colecciones +
// re-verifica). TODAS las cifras se RE-CONSULTAN a Supabase. Reglas finales del usuario.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';

const APPLY = process.argv.includes('--apply');
const THRESHOLD = 30; // minutos: Entrada solo si playtime > 30
const here = dirname(fileURLToPath(import.meta.url));

const STEAM = "categoria='videojuego' and fuente_externa like 'steam:%'";
const HAS_ENTRY = "exists (select 1 from entrada e where e.obra_id = o.id)";
const PT = "(o.metadata->>'playtime_total_min')::numeric";

const pg = await makePgClient();
const one = async (s, p = []) => (await pg.query(s, p)).rows[0];
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const n = async (s, p = []) => Number((await one(s, p)).n);
const collCounts = async () => Object.fromEntries((await rows(
  `select c.nombre, (select count(*) from obra_coleccion oc where oc.coleccion_id=c.id)::int n from coleccion c order by c.nombre`
)).map((r) => [r.nombre, r.n]));

console.log(`\n══════ Steam enrichment — umbral > ${THRESHOLD} min — ${APPLY ? 'APPLY' : 'DRY-RUN'} (re-consultado) ══════\n`);

const base = await one(`select (select count(*) from obra)::int o, (select count(*) from entrada)::int e`);
const steamTotal = await n(`select count(*) n from obra o where ${STEAM}`);
const nuevas = await n(`select count(*) n from obra o where ${STEAM} and ${PT} > ${THRESHOLD} and not ${HAS_ENTRY}`);
const bajas = await n(`select count(*) n from obra o where ${STEAM} and ${PT} <= ${THRESHOLD} and not ${HAS_ENTRY}`);
const conEntrada = await n(`select count(*) n from obra o where ${STEAM} and ${HAS_ENTRY}`);

console.log(`Baseline: ${base.o} obras · ${base.e} entradas · ${steamTotal} obras Steam\n`);
console.log(`— Punto 1 · canónica = playtime en las ${steamTotal} obras Steam (todas) —`);
console.log(`— Punto 2 · Entradas nuevas (playtime > ${THRESHOLD} min Y sin entrada) —\n`);
console.log(`  Reparto de las ${steamTotal}:`);
console.log(`    > ${THRESHOLD} min, sin entrada → ENTRADA NUEVA : ${nuevas}`);
console.log(`    ≤ ${THRESHOLD} min, sin entrada → solo Obra     : ${bajas}`);
console.log(`    ya con Entrada (Sheets, regla 4) → no se tocan : ${conEntrada}`);
console.log(`    suma: ${nuevas} + ${bajas} + ${conEntrada} = ${nuevas + bajas + conEntrada} == ${steamTotal} ${nuevas + bajas + conEntrada === steamTotal ? '✅' : '❌'}`);
console.log(`    se crearían exactamente ${nuevas} Entradas ${nuevas === 271 ? '✅ (271 esperadas)' : '⚠️ (esperaba 271)'}`);

console.log(`\n  Campos de cada Entrada: fecha=ultima_vez_jugado · fecha_tipo='fecha_visionado' · duracion_min=playtime`);
console.log(`                          valoracion=NULL · estado='terminado' · clase_tiempo='electivo' · origen='steam'`);

console.log(`\n— Ejemplos de Entrada que se crearía (top por horas) —`);
for (const r of await rows(`select o.titulo, (o.metadata->>'ultima_vez_jugado')::date fecha, round((o.metadata->>'playtime_total_min')::numeric/60,1) horas, (o.metadata->>'playtime_total_min')::int min
  from obra o where ${STEAM} and ${PT} > ${THRESHOLD} and not ${HAS_ENTRY} order by ${PT} desc limit 5`)) {
  console.log(`  · ${String(r.titulo).slice(0,34).padEnd(35)} fecha=${r.fecha.toISOString().slice(0,10)}  ${r.horas} h (${r.min} min)`);
}

console.log(`\n— Regla 4/5 · intocables —`);
console.log(`  13 con Entrada del Sheets: su Entrada NO se toca (mi apply solo UPDATE obra.canonica + INSERT entradas para obras SIN entrada).`);
console.log(`  30 videojuegos Sheets (fuente_externa NULL, incl. LOL): 0 cambios. Obras NULL en el filtro steam:% = ${await n(`select count(*) n from obra where fuente_externa is null and fuente_externa like 'steam:%'`)} (debe ser 0).`);

console.log(`\n— Efecto esperado —`);
console.log(`  entradas: ${base.e} → ${base.e + nuevas}  (+${nuevas}) ${base.e + nuevas === 4080 ? '✅' : ''}`);
console.log(`  obras: ${base.o} (sin cambio)`);

if (!APPLY) {
  console.log(`\n⏸  DRY-RUN. Nada escrito. Ejecuta con --apply (tras OK) para aplicar.\n`);
  await pg.end();
  process.exit(0);
}

// ───────────────────────── APPLY (solo --apply, tras OK) ─────────────────────────
console.log(`\n→ Backup/export de Supabase antes de escribir…`);
const KEYS = ['obras','entradas','personas','obra_creador','plataformas','etapas','etiquetas','colecciones','logros','titulos','momentos_canon','obra_etiqueta','entrada_etiqueta','obra_coleccion','entrada_acompanante','logros_desbloqueados','titulos_desbloqueados'];
const K2T = { obras:'obra',entradas:'entrada',personas:'persona',obra_creador:'obra_creador',plataformas:'plataforma',etapas:'etapa',etiquetas:'etiqueta',colecciones:'coleccion',logros:'logro',titulos:'titulo',momentos_canon:'momento_canon',obra_etiqueta:'obra_etiqueta',entrada_etiqueta:'entrada_etiqueta',obra_coleccion:'obra_coleccion',entrada_acompanante:'entrada_acompanante',logros_desbloqueados:'logro_desbloqueado',titulos_desbloqueados:'titulo_desbloqueado' };
const dump = { schema_version: 2, exportado_en: null };
for (const k of KEYS) dump[k] = (await rows(`select * from ${K2T[k]}`)).map((r) => { const { owner_id, ...rest } = r; if ((K2T[k]==='obra'||K2T[k]==='entrada') && rest.metadata && typeof rest.metadata==='object') rest.metadata = JSON.stringify(rest.metadata); return rest; });
const bakPath = resolve(here, '..', '..', 'data', 'ocioshit.export.pre-steam.json');
writeFileSync(bakPath, JSON.stringify(dump));
console.log(`  backup: ${bakPath} (${dump.obras.length} obras / ${dump.entradas.length} entradas)`);

const ownerId = (await one(`select id from auth.users limit 1`)).id;
const collBefore = await collCounts();

console.log(`→ Escribiendo en una transacción (canónica + entradas + rematerializar colecciones)…`);
await pg.query('begin');
try {
  const upd = await pg.query(`update obra o set duracion_canonica_min = (metadata->>'playtime_total_min')::int where ${STEAM}`);
  const ins = await pg.query(`insert into entrada (id, obra_id, fecha, estado, duracion_min, clase_tiempo, num_reconsumo, metadata, owner_id)
    select gen_random_uuid()::text, o.id, (o.metadata->>'ultima_vez_jugado')::date, 'terminado',
           (o.metadata->>'playtime_total_min')::int, 'electivo', 0,
           jsonb_build_object('origen','steam','fecha_tipo','fecha_visionado'), o.owner_id
    from obra o where ${STEAM} and ${PT} > ${THRESHOLD} and not ${HAS_ENTRY}`);
  // rematerializar colecciones inteligentes (las nuevas entradas cambian agregados de obra)
  let rem = 0;
  for (const c of await rows(`select id, regla_json from coleccion where tipo='inteligente' and regla_json is not null`)) {
    const { sql, params } = compileCollectionRule(JSON.parse(c.regla_json), { idiomaBase: 'es' });
    const { text, values } = toPg({ sql, params });
    const ids = (await pg.query(text, values)).rows.map((r) => r.id);
    await pg.query('delete from obra_coleccion where coleccion_id=$1', [c.id]);
    if (ids.length) {
      const tuples = ids.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',');
      await pg.query(`insert into obra_coleccion (obra_id, coleccion_id, owner_id) values ${tuples} on conflict do nothing`, ids.flatMap((id) => [id, c.id, ownerId]));
      rem += ids.length;
    }
  }
  await pg.query('commit');
  console.log(`  canónica en ${upd.rowCount} obras · ${ins.rowCount} entradas nuevas · colecciones rematerializadas (${rem} membresías)`);
} catch (e) { await pg.query('rollback'); throw e; }

// ── verificación post (re-consultando) ──
console.log(`\n— Verificación post-apply (re-consultado a Supabase) —`);
let fail = 0;
const chk = (l, c, ex='') => { if (!c) fail++; console.log(`  ${c?'PASS':'FAIL'}  ${l}${ex?'  '+ex:''}`); };
chk('entradas = 4.080', await n('select count(*) n from entrada') === base.e + nuevas, `(${await n('select count(*) n from entrada')})`);
chk('canónica en las 447 Steam', await n(`select count(*) n from obra o where ${STEAM} and duracion_canonica_min is not null`) === steamTotal);
chk('entradas Steam (origen=steam) = nuevas', await n(`select count(*) n from entrada where metadata->>'origen'='steam'`) === nuevas);
chk('FK 0', (await rows('select * from pg_catalog.pg_constraint')).length >= 0 && (await pg.query(`
  select (select count(*) from entrada e left join obra o on o.id=e.obra_id where o.id is null)::int n`)).rows[0].n === 0);
chk('las 13 del Sheets: Entrada con origen=sheets intacta', await n(`select count(*) n from obra o join entrada e on e.obra_id=o.id where ${STEAM} and e.metadata->>'origen'='sheets'`) === conEntrada);
chk('30 videojuegos Sheets sin tocar (0 con origen=steam)', await n(`select count(*) n from obra o join entrada e on e.obra_id=o.id where o.categoria='videojuego' and o.fuente_externa is null and e.metadata->>'origen'='steam'`) === 0);
chk('LOL intacto (duracion_min 129056, canonica NULL)', !!(await one(`select 1 ok from obra o join entrada e on e.obra_id=o.id where o.titulo='LOL' and e.clase_tiempo='habito' and e.duracion_min=129056 and o.duracion_canonica_min is null`)));

const collAfter = await collCounts();
console.log(`\n— Delta de conteos en colecciones (rematerializadas) —`);
let changed = 0;
for (const k of Object.keys(collAfter)) if (collAfter[k] !== (collBefore[k] ?? 0)) { changed++; console.log(`  ${k}: ${collBefore[k] ?? 0} → ${collAfter[k]}  (${collAfter[k] - (collBefore[k] ?? 0) >= 0 ? '+' : ''}${collAfter[k] - (collBefore[k] ?? 0)})`); }
if (!changed) console.log('  (ninguna colección cambió de conteo)');

await pg.end();
console.log(`\n${fail === 0 ? '✅ Aplicado y verificado.' : '❌ ' + fail + ' fallo(s) — revisa.'}\n`);
process.exit(fail === 0 ? 0 : 1);
