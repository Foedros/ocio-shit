// Sprint A — step 2 (MÁXIMO RIESGO): load export.json into Supabase ONCE, then VERIFY by
// RE-QUERYING Postgres (counts, FK integrity, derived + origen/fecha_tipo intact) — exactly as
// strict as Fase 4. The transform itself is already proven offline (tests/load-prep.node.test).
//
//   node scripts/supabase-load.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prepareLoad } from './lib/load-prep.mjs';
import { makePgClient, CONFIG, require_ } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, '..', '..', 'data', 'ocioshit.export.json');

const MAX_PARAMS = 60000; // Postgres hard limit is 65535 bind params per statement.

async function insertBatch(pg, { table, columns, rows }) {
  const perRow = columns.length;
  const rowsPerChunk = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  const colList = columns.join(', ');
  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    const chunk = rows.slice(i, i + rowsPerChunk);
    const values = [];
    const tuples = chunk.map((row, r) => {
      const ph = row.map((_, c) => `$${r * perRow + c + 1}`);
      values.push(...row);
      return `(${ph.join(', ')})`;
    });
    await pg.query(`insert into ${table} (${colList}) values ${tuples.join(', ')}`, values);
  }
}

async function main() {
  require_(['dbUrl', 'authEmail']);
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const pg = await makePgClient();
  console.log(`\nOcio Shit — carga inicial a Supabase\ndata: ${dataPath}\n`);

  // Resolve the single owner uid from Auth (created by setup).
  const { rows: u } = await pg.query('select id from auth.users where email = $1', [CONFIG.authEmail]);
  if (!u.length) throw new Error(`No existe el usuario Auth ${CONFIG.authEmail}. Ejecuta supabase-setup.mjs primero.`);
  const ownerId = u[0].id;
  console.log(`  owner uid: ${ownerId}`);

  const batches = prepareLoad(data, ownerId);

  // Clean reload (idempotent): clear the 4 populated tables, then insert in FK order in one txn.
  await pg.query('begin');
  try {
    await pg.query('truncate obra_creador, entrada, obra, persona restart identity cascade');
    for (const b of batches) {
      process.stdout.write(`  cargando ${b.table} (${b.count})… `);
      await insertBatch(pg, b);
      console.log('ok');
    }
    // System rows (with owner_id, since auth.uid() is null under the service connection).
    await pg.query("insert into meta (clave, valor, owner_id) values ('schema_version','2',$1) on conflict (clave) do update set valor=excluded.valor", [ownerId]);
    await pg.query('insert into perfil_usuario (id, owner_id) values (1,$1) on conflict (id) do nothing', [ownerId]);
    await pg.query('commit');
  } catch (e) {
    await pg.query('rollback');
    throw e;
  }

  // ── RE-QUERY VERIFICATION (no confiar en lo que el proceso cree haber escrito) ──
  console.log('\n  Verificación re-consultando Postgres:');
  let fail = 0;
  const q1 = async (sql, p = []) => (await pg.query(sql, p)).rows[0];
  const n = async (sql, p = []) => Number((await q1(sql, p)).n);
  const expect = (label, got, want) => {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (esperado ${want})`}`);
  };

  expect('obras', await n('select count(*) n from obra'), 4242);
  expect('entradas', await n('select count(*) n from entrada'), 3809);
  expect('personas', await n('select count(*) n from persona'), 2169);
  expect('obra_creador', await n('select count(*) n from obra_creador'), 4200);

  expect('FK entrada→obra rotas', await n('select count(*) n from entrada e left join obra o on o.id=e.obra_id where o.id is null'), 0);
  expect('FK obra_creador→obra rotas', await n('select count(*) n from obra_creador x left join obra o on o.id=x.obra_id where o.id is null'), 0);
  expect('FK obra_creador→persona rotas', await n('select count(*) n from obra_creador x left join persona p on p.id=x.persona_id where p.id is null'), 0);

  expect('clave_dedup NULL', await n('select count(*) n from obra where clave_dedup is null'), 0);
  expect('clave_dedup duplicados', await n('select count(*) n from (select clave_dedup from obra group by clave_dedup having count(*)>1) t'), 0);
  expect('es_reconsumo=1 (reconsumo backfilleado)', await n('select count(*) n from entrada where es_reconsumo=1'), 1);
  expect('es_reconsumo coherente con num_reconsumo', await n('select count(*) n from entrada where es_reconsumo <> (case when num_reconsumo>0 then 1 else 0 end)'), 0);

  // metadata jsonb intacto (NO doble-codificado): origen / fecha_tipo / fecha_voto_fa
  expect('origen=sheets', await n("select count(*) n from entrada where metadata->>'origen'='sheets'"), 447);
  expect('origen=filmaffinity', await n("select count(*) n from entrada where metadata->>'origen'='filmaffinity'"), 3362);
  expect('fecha_tipo=fecha_visionado', await n("select count(*) n from entrada where metadata->>'fecha_tipo'='fecha_visionado'"), 433);
  expect('fecha_tipo=fecha_voto', await n("select count(*) n from entrada where metadata->>'fecha_tipo'='fecha_voto'"), 3376);
  expect('metadata con fecha_voto_fa', await n("select count(*) n from entrada where jsonb_exists(metadata, 'fecha_voto_fa')"), 52);
  expect('obras con metadata (steam playtime)', await n('select count(*) n from obra where metadata is not null'), 447);

  // owner_id en todas las filas (RLS depende de ello)
  for (const t of ['obra', 'entrada', 'persona', 'obra_creador']) {
    expect(`${t}.owner_id = owner en todas`, await n(`select count(*) n from ${t} where owner_id <> $1`, [ownerId]), 0);
  }

  await pg.end();
  console.log(fail === 0 ? '\n✅ Carga verificada re-consultando Postgres. 0 fallos.\n' : `\n❌ ${fail} fallo(s) de verificación.\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ carga falló:', e.message, '\n');
  process.exit(1);
});
