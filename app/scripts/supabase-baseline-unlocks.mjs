// BASELINE de desbloqueos (decisión "datar SOLO lo reconstruible"). Evalúa el catálogo con el
// compilador conservado; para cada logro/título DESBLOQUEADO escribe una fila en *_desbloqueado:
//   · fecha RECONSTRUIDA si el momento es un hito monótono sobre DATO ORIGINAL (fecha de entrada +
//     categoría/estado/valoración) — no inventado;
//   · fecha NULL si el umbral es un agregado NO monótono (índice de entropía, ratio de finalización,
//     horas) o depende de dimensiones RETRO-ENRIQUECIDAS (década/género/creador llegaron con FA/TMDB
//     en 2026 → no son un momento vivido). NULL = "cumplido, fecha no reconstruible".
// Idempotente (uno por definición). Aditivo (tablas vacías). Admin (clave local).
//   node scripts/supabase-baseline-unlocks.mjs
import { compileCondition } from '../src/lib/predicates/compiler.js';
import { ALL_RPG } from '../src/lib/predicates/logros-catalog.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient, CONFIG } from './lib/supabase-env.mjs';

const pg = await makePgClient();
const { rows: owner } = await pg.query('select id from auth.users where email = $1', [CONFIG.authEmail]);
if (!owner.length) throw new Error('No existe el usuario Auth; ejecuta supabase-setup primero.');
const ownerId = owner[0].id; // la conexión admin no tiene auth.uid(); owner_id explícito (como los seeds)
const one = async (sql) => (await pg.query(sql)).rows[0]?.f ?? null;

// Reconstrucción del momento (SOLO hitos monótonos sobre dato original). Ordena por fecha de la
// entrada que estableció la unidad N (obra/serie/obra-valorada) — la fecha del archivo, real.
const RECONSTRUCT = {
  LOG_PRIMER_PASO: () => one(`SELECT MIN(fecha) f FROM entrada WHERE fecha IS NOT NULL`),
  LOG_CENTENARIO: () => nthObra(100),
  LOG_QUINIENTAS: () => nthObra(500),
  LOG_CRITICO: () => nthRatedObra(50),
  TIT_CRITICO: () => nthRatedObra(200),
  LOG_DEVORADOR_SERIES: () => one(
    `SELECT f FROM (SELECT e.obra_id, MIN(e.fecha) f FROM entrada e JOIN obra o ON o.id=e.obra_id
       WHERE o.categoria='serie' AND e.estado='terminado' AND e.fecha IS NOT NULL GROUP BY e.obra_id) z
     ORDER BY f, obra_id OFFSET 49 LIMIT 1`),
  // Antigüedad: "N años de archivo" = primera entrada + N años (hito monótono sobre dato original).
  LOG_ANIVERSARIO: () => firstPlus(1),
  TIT_VETERANO: () => firstPlus(3),
  TIT_DECANO: () => firstPlus(5)
};
const firstPlus = (n) => one(
  `SELECT (MIN(fecha) + (interval '1 year') * ${n})::date f FROM entrada WHERE fecha IS NOT NULL`);
const nthObra = (n) => one(
  `SELECT f FROM (SELECT obra_id, MIN(fecha) f FROM entrada WHERE fecha IS NOT NULL GROUP BY obra_id) z
   ORDER BY f, obra_id OFFSET ${n - 1} LIMIT 1`);
const nthRatedObra = (n) => one(
  `SELECT f FROM (SELECT obra_id, MIN(fecha) f FROM entrada WHERE valoracion IS NOT NULL AND fecha IS NOT NULL GROUP BY obra_id) z
   ORDER BY f, obra_id OFFSET ${n - 1} LIMIT 1`);

// 1) ¿Qué está desbloqueado? (compilador conservado, como la app)
const unlocked = [];
for (const x of ALL_RPG) {
  if (!x.condicion_json) continue;
  const { text, values } = toPg(compileCondition(x.condicion_json));
  const ok = Number((await pg.query(text, values)).rows[0].ok) === 1;
  if (ok) unlocked.push(x);
}

// 2) Sembrar el ledger (idempotente, fecha reconstruida o NULL)
let nIns = 0;
const rows = [];
await pg.query('begin');
try {
  for (const x of unlocked) {
    const kind = x.id.startsWith('TIT_') ? 'titulo' : 'logro';
    const table = kind === 'logro' ? 'logro_desbloqueado' : 'titulo_desbloqueado';
    const col = kind === 'logro' ? 'logro_id' : 'titulo_id';
    const fecha = RECONSTRUCT[x.id] ? await RECONSTRUCT[x.id]() : null;
    const { rowCount } = await pg.query(
      `insert into ${table} (id, ${col}, fecha, owner_id)
         select gen_random_uuid()::text, $1, $2::date, $3
         where not exists (select 1 from ${table} where ${col} = $1)`,
      [x.id, fecha, ownerId]
    );
    if (rowCount) nIns++;
    rows.push({ id: x.id, kind, fecha, reconstruible: !!RECONSTRUCT[x.id] });
  }
  await pg.query('commit');
} catch (e) {
  await pg.query('rollback');
  throw e;
}

// 3) Re-consultar y mostrar
const ld = (await pg.query('select count(*)::int n, count(fecha)::int conf from logro_desbloqueado')).rows[0];
const td = (await pg.query('select count(*)::int n, count(fecha)::int conf from titulo_desbloqueado')).rows[0];
console.log(`\nBaseline de desbloqueos (insertados ${nIns}, idempotente):`);
console.log(`  logro_desbloqueado:  ${ld.n} filas (${ld.conf} con fecha reconstruida, ${ld.n - ld.conf} sin fecha)`);
console.log(`  titulo_desbloqueado: ${td.n} filas (${td.conf} con fecha, ${td.n - td.conf} sin fecha)\n`);
console.log('  CON FECHA reconstruida (hito monótono sobre dato original):');
for (const r of rows.filter((r) => r.fecha)) console.log(`    ${r.id.padEnd(22)} → ${r.fecha}`);
console.log('\n  SIN FECHA (agregado no monótono o dimensión retro-enriquecida → cumplido, fecha no reconstruible):');
for (const r of rows.filter((r) => !r.fecha)) console.log(`    ${r.id}`);
await pg.end();
