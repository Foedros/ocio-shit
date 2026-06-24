// Exercise the REAL browser data module (supabase-data.js) end-to-end against Supabase, signed
// in as the owner via the PUBLISHABLE key — the exact path the app uses. Re-queries Postgres
// (admin) for the write proofs. This is the data-layer half of Stage 3 step-2 evidence.
import * as data from '../src/lib/db/supabase-data.js';
import { makePgClient, CONFIG } from './lib/supabase-env.mjs';

let fail = 0;
const ok = (label, cond, extra = '') => { if (!cond) fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

const pg = await makePgClient();
console.log('\nsupabase-data.js — end-to-end (publishable + auth)\n');

await data.signIn(CONFIG.authEmail, CONFIG.authPassword);
console.log('  autenticado como', CONFIG.authEmail);

// counts / status
const st = await data.status();
ok('status counts 4242/3809/2169/4200',
  st.counts.obra === 4242 && st.counts.entrada === 3809 && st.counts.persona === 2169 && st.counts.obra_creador === 4200,
  JSON.stringify(st.counts));

// filter options
const fo = await data.filterOptions();
ok('filterOptions origenes = [filmaffinity, sheets]', JSON.stringify([...fo.origenes].sort()) === JSON.stringify(['filmaffinity', 'sheets']), JSON.stringify(fo.origenes));
ok('filterOptions fecha_tipos = [fecha_visionado, fecha_voto]', JSON.stringify([...fo.fecha_tipos].sort()) === JSON.stringify(['fecha_visionado', 'fecha_voto']));
ok('filterOptions categorias incluye comic', fo.categorias.includes('comic'));

// filtered lists vs Postgres truth
const comicReal = (await pg.query("select count(*)::int n from entrada e join obra o on o.id=e.obra_id where o.categoria='comic'")).rows[0].n;
const comicList = await data.listEntries({ categoria: 'comic' });
ok('listEntries categoria=comic = nº real', comicList.length === comicReal, `(${comicList.length} == ${comicReal})`);
ok('listEntries devuelve la forma plana (titulo/origen/fecha_tipo)', comicList[0] && 'titulo' in comicList[0] && 'origen' in comicList[0] && 'entrada_id' in comicList[0]);
const faReal = (await pg.query("select count(*)::int n from entrada where metadata->>'origen'='filmaffinity'")).rows[0].n;
const faList = await data.listEntries({ origen: 'filmaffinity', limit: 6000 });
ok('listEntries origen=filmaffinity = nº real', faList.length === faReal, `(${faList.length} == ${faReal})`);
const fvList = await data.listEntries({ fecha_tipo: 'fecha_visionado', limit: 6000 });
ok('listEntries fecha_tipo=fecha_visionado = 433', fvList.length === 433, `(${fvList.length})`);

// collections (read)
const cols = await data.listColecciones();
ok('listColecciones = 25', cols.length === 25);
const comics = cols.find((c) => c.nombre === 'Cómics');
ok('Cómics n_obras = 31', comics?.n_obras === 31, `(${comics?.n_obras})`);
const detail = await data.getColeccion(comics.id);
ok('getColeccion(Cómics) trae 31 obras con valoracion_media', detail.obras.length === 31 && 'valoracion_media' in detail.obras[0]);

// write: add → re-query PG → read back → delete → re-query PG
const before = (await pg.query('select count(*)::int n from entrada')).rows[0].n;
const added = await data.addEntry({
  obra: { titulo: '__VERIFY_DATA_OBRA__', categoria: 'libro', anio_obra: 2010 },
  entrada: { estado: 'terminado', valoracion: 7, fecha: '2026-06-24', duracion_min: 320 }
});
ok('addEntry devuelve ids + counts', !!added.entradaId && added.counts.entrada === before + 1, `(${before} -> ${added.counts.entrada})`);
const pgRow = (await pg.query("select e.valoracion, e.metadata->>'origen' origen, o.titulo, o.duracion_canonica_min from entrada e join obra o on o.id=e.obra_id where e.id=$1", [added.entradaId])).rows[0];
ok('re-consulta PG: la entrada existe con origen=sheets', pgRow && pgRow.origen === 'sheets' && pgRow.titulo === '__VERIFY_DATA_OBRA__');
ok('A-07: libro (fija) → duracion_canonica = 320', pgRow.duracion_canonica_min === 320, `(${pgRow.duracion_canonica_min})`);
const fetched = await data.getEntry(added.entradaId);
ok('getEntry devuelve la entrada nueva', fetched && fetched.entrada_id === added.entradaId && fetched.valoracion === 7);
const del = await data.deleteEntry(added.entradaId);
ok('deleteEntry borra entrada + obra huérfana', del.deleted && del.obraDeleted && del.counts.entrada === before);
const gonePg = (await pg.query('select count(*)::int n from entrada where id=$1', [added.entradaId])).rows[0].n;
ok('re-consulta PG: la entrada desapareció', gonePg === 0);

await data.signOut();
await pg.end();
console.log(`\n${fail === 0 ? '✅ ALL PASS — la capa de datos del navegador funciona contra Supabase.' : '❌ ' + fail + ' FALLO(S).'}\n`);
process.exit(fail === 0 ? 0 : 1);
