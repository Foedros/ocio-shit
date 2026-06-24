// Verify the collection-WRITE path (the deferred debt) against Supabase via the real data module:
// create a smart collection (compiler runs in the browser → materialize RPC), rematerialize, R1.
// Re-queries Postgres for every claim. Confirms anon is blocked on the new RPCs.
import * as data from '../src/lib/db/supabase-data.js';
import { makePgClient, makePublishableClient, CONFIG } from './lib/supabase-env.mjs';

let fail = 0;
const ok = (label, cond, extra = '') => { if (!cond) fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };
const pg = await makePgClient();
const n = async (sql, p = []) => Number((await pg.query(sql, p)).rows[0].n);

console.log('\ncolecciones-write — compilador en runtime vía RPC SECURITY INVOKER\n');
await data.signIn(CONFIG.authEmail, CONFIG.authPassword);
await pg.query("delete from coleccion where nombre='__TEST_LIBROS__'"); // limpiar restos

// (1) Crear colección inteligente nueva → debe materializar (compilador → RPC)
const librosReal = await n("select count(*)::int n from obra where categoria='libro'");
const id = await data.createColeccion({
  nombre: '__TEST_LIBROS__', tipo: 'inteligente', descripcion: 'test',
  regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'libro' }] }
});
ok('createColeccion devuelve id', !!id);
const matCount = await n("select count(*)::int n from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='__TEST_LIBROS__'");
ok('materializada con nº real de libros', matCount === librosReal, `(${matCount} == ${librosReal})`);
const inList = (await data.listColecciones()).find((c) => c.nombre === '__TEST_LIBROS__');
ok('aparece en listColecciones con n_obras correcto', inList?.n_obras === librosReal, `(${inList?.n_obras})`);

// (2) Recalcular TODO → las membresías conservadas (Cómics sigue 31)
const res = await data.rematerializeAll();
ok('rematerializeAll recorre las inteligentes', res.collections >= 24, `(${res.collections} colecciones, ${res.members} membresías)`);
const comics = await n("select count(*)::int n from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Cómics'");
ok('Cómics sigue 31 tras recalcular', comics === 31, `(${comics})`);
const librosAfter = await n("select count(*)::int n from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='__TEST_LIBROS__'");
ok('__TEST_LIBROS__ idempotente tras recalcular', librosAfter === librosReal, `(${librosAfter})`);

// (3) R1 → crea etiquetas decada-* (idioma/pais vacíos en el corpus)
const r1 = await data.applyR1();
ok('applyR1 crea etiquetas decada-*', r1.tags > 0 && r1.links > 0, `(${r1.tags} tags, ${r1.links} links)`);
const decTagReal = await n("select count(distinct decada)::int n from obra where decada is not null");
const decTags = await n("select count(*)::int n from etiqueta where nombre like 'decada-%'");
ok('nº de etiquetas decada = nº de décadas distintas', decTags === decTagReal, `(${decTags} == ${decTagReal})`);
ok('applyR1 idempotente (2ª pasada 0 tags nuevos)', (await data.applyR1()).tags === 0);

// (4) anon NO puede crear/materializar
const anon = await makePublishableClient();
const c1 = await anon.rpc('ocio_create_collection', { p: { nombre: 'x', tipo: 'manual' } });
const c2 = await anon.rpc('ocio_materialize_collection', { p_coleccion_id: id, p_sql: 'SELECT DISTINCT o.id FROM obra o', p_params: [] });
ok('anon bloqueado en create + materialize', !!c1.error && !!c2.error, `(${c1.error?.code}/${c2.error?.code})`);

// (5) la RPC rechaza SQL que no sea el del compilador (defensa)
const bad = await data.supabase.rpc('ocio_materialize_collection', { p_coleccion_id: id, p_sql: 'DELETE FROM obra', p_params: [] });
ok('materialize rechaza SQL no-compilador (DELETE)', !!bad.error, `(${bad.error?.message?.slice(0, 40)})`);

// cleanup
await data.deleteColeccion(id);
ok('borrar colección de prueba', (await n("select count(*)::int n from coleccion where nombre='__TEST_LIBROS__'")) === 0);

await data.signOut();
await pg.end();
console.log(`\n${fail === 0 ? '✅ ALL PASS — colecciones-write funciona contra Postgres.' : '❌ ' + fail + ' FALLO(S).'}\n`);
process.exit(fail === 0 ? 0 : 1);
