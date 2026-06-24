// Test D — the Sprint 2 data layer (queries.js) in pure Node, proven against the real
// archive: alta (new obra+entrada, dedup onto existing obra, reconsumo numbering),
// filtered listing (categoria/origen/fecha_tipo/search), detail, and integrity after writes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createNodeAdapter } from './lib/adapter-node.mjs';
import { applySchema, importAll, integrityCheck, foreignKeyViolations, counts } from '../src/lib/db/io.js';
import {
  addEntry,
  listEntries,
  listObras,
  getEntry,
  getObra,
  filterOptions
} from '../src/lib/db/queries.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const A = createNodeAdapter();
applySchema(A, schemaSql);
importAll(A, source);

console.log('\nOcio Shit — Sprint 2 data layer (queries.js)\n');
console.log(`data: ${dataPath}`);

// --- filter options ---
const opts = filterOptions(A);
console.log(`[filters] categorias=${opts.categorias.join(',')} | origenes=${opts.origenes.join(',')} | fecha_tipos=${opts.fecha_tipos.join(',')}`);
check('filterOptions: categorias no vacío', opts.categorias.length > 0);
check('filterOptions: incluye origen sheets', opts.origenes.includes('sheets'));
check('filterOptions: incluye fecha_tipo fecha_visionado', opts.fecha_tipos.includes('fecha_visionado'));

// --- listing: total + filters are consistent ---
const all = listEntries(A);
const total = counts(A).entrada;
check('listEntries() devuelve todas las entradas', all.length === total, `(${all.length} vs ${total})`);

// filter by categoria
const cat = opts.categorias[0];
const byCat = listEntries(A, { categoria: cat });
const everyCat = byCat.every((r) => r.categoria === cat);
check(`filtro categoria=${cat} consistente`, everyCat && byCat.length > 0, `(${byCat.length} filas)`);

// filter by origen
const byOrigen = listEntries(A, { origen: 'sheets' });
check('filtro origen=sheets consistente', byOrigen.length > 0 && byOrigen.every((r) => r.origen === 'sheets'), `(${byOrigen.length})`);

// filter by fecha_tipo
const byVoto = listEntries(A, { fecha_tipo: 'fecha_voto' });
const byVis = listEntries(A, { fecha_tipo: 'fecha_visionado' });
check('filtro fecha_tipo separa visionado/voto', byVis.every((r) => r.fecha_tipo === 'fecha_visionado') && byVoto.every((r) => r.fecha_tipo === 'fecha_voto'));

// search
const term = all[0].titulo.slice(0, 4);
const bySearch = listEntries(A, { search: term });
check(`búsqueda "${term}" devuelve coincidencias`, bySearch.length > 0 && bySearch.every((r) => r.titulo.toLowerCase().includes(term.toLowerCase())));

// detail
const detail = getEntry(A, all[0].entrada_id);
check('getEntry devuelve la entrada', detail && detail.entrada_id === all[0].entrada_id);
const od = getObra(A, all[0].obra_id);
check('getObra devuelve obra + entradas', od && od.obra.id === all[0].obra_id && od.entradas.length >= 1);

// --- alta: nueva obra + entrada ---
const before = counts(A);
const r1 = addEntry(A, {
  obra: { titulo: 'Una Obra De Prueba ZZZ', categoria: 'pelicula', anio_obra: 2026 },
  entrada: { fecha: '2026-06-24', nota: 'alta de prueba', valoracion: 8 }
});
const after1 = counts(A);
check('alta nueva: +1 obra', after1.obra === before.obra + 1, `(${before.obra}->${after1.obra})`);
check('alta nueva: +1 entrada', after1.entrada === before.entrada + 1);
check('alta nueva: obraCreated=true, numReconsumo=0', r1.obraCreated === true && r1.numReconsumo === 0);
check('alta nueva: aparece en el listado (búsqueda)', listEntries(A, { search: 'prueba zzz' }).length === 1);
check('alta nueva: integridad ok', integrityCheck(A).ok && foreignKeyViolations(A) === 0);

// --- alta: misma obra distinta CAJA (dedup vía lower() de SQLite) -> +1 entrada, +0 obra ---
const r2 = addEntry(A, {
  obra: { titulo: 'una obra de prueba zzz', categoria: 'pelicula', anio_obra: 2026 },
  entrada: { fecha: '2026-06-25', nota: 'revisionado' }
});
const after2 = counts(A);
check('alta dedup: +0 obra', after2.obra === after1.obra, `(${after1.obra}->${after2.obra})`);
check('alta dedup: +1 entrada', after2.entrada === after1.entrada + 1);
check('alta dedup: misma obra reutilizada', r2.obraId === r1.obraId && r2.obraCreated === false);
check('alta dedup: numReconsumo=1', r2.numReconsumo === 1);
check('alta dedup: integridad ok tras escrituras', integrityCheck(A).ok && foreignKeyViolations(A) === 0);

A.close();
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
