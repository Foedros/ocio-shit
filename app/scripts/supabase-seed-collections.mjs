// Seed + materialize the Tanda 1 collections into Supabase, server-side (admin connection).
// Reuses the CONSERVED predicate compiler (compileCollectionRule) + Tanda 1 definitions
// (buildTanda1) — only the upsert/materialize SQL is Postgres-native here. Idempotent by nombre.
//   node scripts/supabase-seed-collections.mjs
import { buildTanda1 } from '../src/lib/predicates/tanda1.js';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient, CONFIG } from './lib/supabase-env.mjs';

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c, i) => {
    // deterministic-ish without Math.random restrictions; uniqueness via index + char
    const r = (i * 7 + c.charCodeAt(0)) % 16;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const pg = await makePgClient();
const { rows: ownerRows } = await pg.query('select id from auth.users where email = $1', [CONFIG.authEmail]);
if (!ownerRows.length) throw new Error('No existe el usuario Auth; ejecuta supabase-setup primero.');
const ownerId = ownerRows[0].id;
const { rows: fav } = await pg.query(
  'select persona_id from obra_creador group by persona_id order by count(distinct obra_id) desc limit 1'
);
const defs = buildTanda1({ year: 2026, favoritoPersonaId: fav[0]?.persona_id });

let created = 0, members = 0;
await pg.query('begin');
try {
  for (const d of defs) {
    const { rows: ex } = await pg.query('select id from coleccion where nombre = $1', [d.nombre]);
    let id;
    const regla = d.regla_json ? JSON.stringify(d.regla_json) : null;
    if (ex.length) {
      id = ex[0].id;
      await pg.query('update coleccion set descripcion=$1, tipo=$2, regla_json=$3 where id=$4', [d.descripcion ?? null, d.tipo, regla, id]);
    } else {
      id = (globalThis.crypto?.randomUUID?.() ?? uuid());
      await pg.query('insert into coleccion (id, nombre, descripcion, tipo, regla_json, owner_id) values ($1,$2,$3,$4,$5,$6)',
        [id, d.nombre, d.descripcion ?? null, d.tipo, regla, ownerId]);
      created++;
    }
    if (d.tipo === 'inteligente') {
      const { sql, params } = compileCollectionRule(d.regla_json, { idiomaBase: 'es' });
      const { text, values } = toPg({ sql, params });
      const { rows: ids } = await pg.query(text, values);
      await pg.query('delete from obra_coleccion where coleccion_id = $1', [id]);
      if (ids.length) {
        // bulk insert (obra_id, coleccion_id, owner_id)
        const tuples = ids.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(',');
        const flat = ids.flatMap((r) => [r.id, id, ownerId]);
        await pg.query(`insert into obra_coleccion (obra_id, coleccion_id, owner_id) values ${tuples} on conflict do nothing`, flat);
        members += ids.length;
      }
    }
  }
  await pg.query('commit');
} catch (e) {
  await pg.query('rollback');
  throw e;
}

// Re-query proof
const { rows: tot } = await pg.query('select count(*)::int n from coleccion');
const { rows: comics } = await pg.query(
  "select (select count(*) from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Cómics')::int n"
);
const { rows: revis } = await pg.query(
  "select (select count(*) from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Revisitadas')::int n"
);
const { rows: cine90 } = await pg.query(
  "select (select count(*) from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Cine de los 90')::int n"
);
console.log(`Colecciones: ${tot[0].n} (creadas ${created}, membresías ${members})`);
console.log(`  Cómics=${comics[0].n} (esperado 31) · Revisitadas=${revis[0].n} (esperado 1) · Cine de los 90=${cine90[0].n} (esperado 697)`);
await pg.end();
