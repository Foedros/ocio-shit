// Verifica la EDICIÓN de entradas contra Supabase (vía el módulo real supabase-data + RPC):
//  (a) valoracion de un juego de Steam NULL→nº persiste; (b) editar fecha en obra con varias
//  entradas re-deriva num_reconsumo; (c) editar dispara rematerialización (cambia pertenencia);
//  (e) la edición se ve desde otra "sesión/dispositivo". Re-consulta Postgres para todo. Limpia.
import * as data from '../src/lib/db/supabase-data.js';
import { makePgClient, makePublishableClient, CONFIG } from './lib/supabase-env.mjs';

let fail = 0;
const ok = (l, c, x='') => { if (!c) fail++; console.log(`  ${c?'PASS':'FAIL'}  ${l}${x?'  '+x:''}`); };
const pg = await makePgClient();
const q1 = async (s,p=[]) => (await pg.query(s,p)).rows[0];

console.log('\nEdición de entradas — end-to-end contra Supabase\n');
await data.signIn(CONFIG.authEmail, CONFIG.authPassword);

// ── (a) valoracion de un juego de Steam: NULL → 9 → persiste; revertir a NULL ──
const steam = await q1(`select e.id, o.titulo from entrada e join obra o on o.id=e.obra_id
  where e.metadata->>'origen'='steam' and e.valoracion is null order by (o.metadata->>'playtime_total_min')::numeric desc limit 1`);
await data.updateEntry(steam.id, { valoracion: 9, nota: null, fecha: (await q1('select fecha::text f from entrada where id=$1',[steam.id])).f, duracion_min: (await q1('select duracion_min d from entrada where id=$1',[steam.id])).d });
ok(`(a) valoracion de "${steam.titulo}" NULL→9 persiste en PG`, Number((await q1('select valoracion v from entrada where id=$1',[steam.id])).v) === 9);

// ── (c) tras editar a 9 y rematerializar, la obra entra en "Obras maestras personales" (val_media≥9) ──
await data.rematerializeAll();
const obraId = (await q1('select obra_id o from entrada where id=$1',[steam.id])).o;
ok('(c) editar+rematerializar → la obra entra en "Obras maestras" (val≥9)',
  (await q1(`select count(*)::int n from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Obras maestras personales' and oc.obra_id=$1`,[obraId])).n === 1);

// ── (e) otra "sesión/dispositivo": un cliente nuevo autenticado ve la edición ──
const otro = await makePublishableClient();
await otro.auth.signInWithPassword({ email: CONFIG.authEmail, password: CONFIG.authPassword });
const visto = (await otro.from('entrada').select('valoracion').eq('id', steam.id).single()).data;
ok('(e) la edición se ve desde otra sesión (otro dispositivo)', Number(visto.valoracion) === 9, `(val=${visto.valoracion})`);
await otro.auth.signOut();

// revertir (a)/(c): valoracion a NULL + rematerializar
await data.updateEntry(steam.id, { valoracion: null, nota: null, fecha: (await q1('select fecha::text f from entrada where id=$1',[steam.id])).f, duracion_min: (await q1('select duracion_min d from entrada where id=$1',[steam.id])).d });
await data.rematerializeAll();
ok('   revertido: valoracion NULL + fuera de Obras maestras',
  (await q1('select valoracion v from entrada where id=$1',[steam.id])).v === null &&
  (await q1(`select count(*)::int n from obra_coleccion oc join coleccion c on c.id=oc.coleccion_id where c.nombre='Obras maestras personales' and oc.obra_id=$1`,[obraId])).n === 0);

// ── (b) obra con 2 entradas: editar la fecha de la 2ª a ANTES de la 1ª → re-deriva num_reconsumo ──
const a1 = await data.addEntry({ obra: { titulo: '__EDIT_RECON_TEST__', categoria: 'pelicula', anio_obra: 2020 }, entrada: { fecha: '2020-06-01', estado: 'terminado' } });
const a2 = await data.addEntry({ obra: { titulo: '__EDIT_RECON_TEST__', categoria: 'pelicula', anio_obra: 2020 }, entrada: { fecha: '2020-12-01', estado: 'terminado' } });
ok('(b.0) 2 entradas en la misma obra: num_reconsumo 0 y 1',
  Number((await q1('select num_reconsumo n from entrada where id=$1',[a1.entradaId])).n) === 0 &&
  Number((await q1('select num_reconsumo n from entrada where id=$1',[a2.entradaId])).n) === 1);
// editar la fecha de la 2ª (2020-12-01) a 2020-01-01 (antes de la 1ª) → debe pasar a num_reconsumo 0
await data.updateEntry(a2.entradaId, { valoracion: null, nota: null, fecha: '2020-01-01', duracion_min: null });
const n1 = Number((await q1('select num_reconsumo n from entrada where id=$1',[a1.entradaId])).n);
const n2 = Number((await q1('select num_reconsumo n, es_reconsumo e from entrada where id=$1',[a2.entradaId])).n);
const e1 = Number((await q1('select es_reconsumo e from entrada where id=$1',[a1.entradaId])).e);
const e2 = Number((await q1('select es_reconsumo e from entrada where id=$1',[a2.entradaId])).e);
ok('(b) tras adelantar la fecha de la 2ª: ella pasa a num_reconsumo=0, la 1ª a 1', n2 === 0 && n1 === 1, `(2ª=${n2}, 1ª=${n1})`);
ok('(b) es_reconsumo coherente (la 2ª=0, la 1ª=1)', e2 === 0 && e1 === 1, `(es: 2ª=${e2}, 1ª=${e1})`);
// limpieza
await data.deleteEntry(a1.entradaId);
await data.deleteEntry(a2.entradaId);
ok('   limpieza: obra de prueba borrada', (await q1(`select count(*)::int n from obra where titulo='__EDIT_RECON_TEST__'`)).n === 0);

await data.signOut();
await pg.end();
console.log(`\n${fail === 0 ? '✅ ALL PASS — edición funciona contra Supabase.' : '❌ ' + fail + ' FALLO(S).'}\n`);
process.exit(fail === 0 ? 0 : 1);
