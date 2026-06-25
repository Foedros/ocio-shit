// Carga el CATÁLOGO RPG (logros-catalog.js → tablas logro/titulo de Supabase). Idempotente por id
// (upsert). condicion_json se guarda como TEXT (igual que coleccion.regla_json); null en los no
// evaluables. NO toca estado de desbloqueo. Admin (clave local). Aditivo: las tablas están vacías.
//   node scripts/supabase-seed-logros.mjs
import { LOGROS, TITULOS } from '../src/lib/predicates/logros-catalog.js';
import { makePgClient, CONFIG } from './lib/supabase-env.mjs';

const pg = await makePgClient();
const { rows: owner } = await pg.query('select id from auth.users where email = $1', [CONFIG.authEmail]);
if (!owner.length) throw new Error('No existe el usuario Auth; ejecuta supabase-setup primero.');
const ownerId = owner[0].id;

const before = await pg.query('select (select count(*) from logro)::int l, (select count(*) from titulo)::int t');
let nL = 0, nT = 0;
await pg.query('begin');
try {
  for (const x of LOGROS) {
    const cj = x.condicion_json ? JSON.stringify(x.condicion_json) : null;
    await pg.query(
      `insert into logro (id, nombre, descripcion, clase, rareza, exp, condicion_json, owner_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set nombre=excluded.nombre, descripcion=excluded.descripcion,
         clase=excluded.clase, rareza=excluded.rareza, exp=excluded.exp, condicion_json=excluded.condicion_json`,
      [x.id, x.nombre, x.descripcion ?? null, x.clase ?? null, x.rareza ?? null, x.exp ?? 0, cj, ownerId]
    );
    nL++;
  }
  for (const x of TITULOS) {
    const cj = x.condicion_json ? JSON.stringify(x.condicion_json) : null;
    await pg.query(
      `insert into titulo (id, nombre, descripcion, rareza, condicion_json, owner_id)
         values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set nombre=excluded.nombre, descripcion=excluded.descripcion,
         rareza=excluded.rareza, condicion_json=excluded.condicion_json`,
      [x.id, x.nombre, x.descripcion ?? null, x.rareza ?? null, cj, ownerId]
    );
    nT++;
  }
  await pg.query('commit');
} catch (e) {
  await pg.query('rollback');
  throw e;
}

const after = await pg.query(
  `select (select count(*) from logro)::int l, (select count(*) from titulo)::int t,
          (select count(*) from logro where condicion_json is not null)::int le,
          (select count(*) from titulo where condicion_json is not null)::int te`
);
console.log(`\nCatálogo RPG cargado (upsert idempotente):`);
console.log(`  logro:  ${before.rows[0].l} → ${after.rows[0].l}  (procesados ${nL}, evaluables ${after.rows[0].le})`);
console.log(`  titulo: ${before.rows[0].t} → ${after.rows[0].t}  (procesados ${nT}, evaluables ${after.rows[0].te})`);
await pg.end();
