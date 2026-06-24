// Offline proof of the MÁXIMO-RIESGO load transform against the REAL archive: generated cols
// excluded, metadata parsed to objects (not double-encoded strings), owner_id stamped, FK order
// correct, counts intact. Verifies the transform BEFORE any row hits the cloud. No DB needed.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { prepareLoad } from '../scripts/lib/load-prep.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, '..', '..', 'data', 'ocioshit.export.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const OWNER = '00000000-0000-4000-8000-000000000001';
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

console.log(`\nload-prep — transform real → Postgres batches\ndata: ${dataPath}\n`);

const batches = prepareLoad(data, OWNER);
const byTable = Object.fromEntries(batches.map((b) => [b.table, b]));
const idx = (t) => batches.findIndex((b) => b.table === t);

// counts intact
check('obra: 4242 filas', byTable.obra?.count === 4242, `(${byTable.obra?.count})`);
check('entrada: 3809 filas', byTable.entrada?.count === 3809, `(${byTable.entrada?.count})`);
check('persona: 2169 filas', byTable.persona?.count === 2169, `(${byTable.persona?.count})`);
check('obra_creador: 4200 filas', byTable.obra_creador?.count === 4200, `(${byTable.obra_creador?.count})`);
check('solo 4 tablas con datos', batches.length === 4, `(${batches.map((b) => b.table).join(',')})`);

// generated columns excluded
check('obra excluye clave_dedup (generada)', !byTable.obra.columns.includes('clave_dedup'));
check('entrada excluye es_reconsumo (generada)', !byTable.entrada.columns.includes('es_reconsumo'));

// owner_id stamped on every row
check('obra incluye owner_id', byTable.obra.columns.includes('owner_id'));
const ownerCol = byTable.entrada.columns.indexOf('owner_id');
check('todas las entradas con owner_id correcto', byTable.entrada.rows.every((r) => r[ownerCol] === OWNER));

// metadata parsed to OBJECT (not a JSON string) so it lands as jsonb, not double-encoded
const eMetaCol = byTable.entrada.columns.indexOf('metadata');
const metas = byTable.entrada.rows.map((r) => r[eMetaCol]);
check('entrada.metadata es objeto/null, nunca string', metas.every((m) => m === null || typeof m === 'object'));
const withOrigen = metas.filter((m) => m && m.origen);
check('metadata.origen accesible como objeto', withOrigen.length === 3809, `(${withOrigen.length})`);
const dist = withOrigen.reduce((a, m) => ((a[m.origen] = (a[m.origen] || 0) + 1), a), {});
check('origen dist sheets 447 / filmaffinity 3362', dist.sheets === 447 && dist.filmaffinity === 3362, JSON.stringify(dist));
const oMetaCol = byTable.obra.columns.indexOf('metadata');
const oMetas = byTable.obra.rows.map((r) => r[oMetaCol]);
check('obra.metadata (447 steam) es objeto/null', oMetas.every((m) => m === null || typeof m === 'object') && oMetas.filter(Boolean).length === 447, `(${oMetas.filter(Boolean).length})`);

// FK-safe order: persona & obra before entrada & obra_creador
check('orden FK: persona antes que obra_creador', idx('persona') < idx('obra_creador'));
check('orden FK: obra antes que entrada', idx('obra') < idx('entrada'));
check('orden FK: obra antes que obra_creador', idx('obra') < idx('obra_creador'));

// every row's column arity matches the column list
check('aridad fila == nº columnas (todas las tablas)', batches.every((b) => b.rows.every((r) => r.length === b.columns.length)));

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
