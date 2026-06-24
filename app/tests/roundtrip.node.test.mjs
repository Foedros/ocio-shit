// Test A — durability round-trip, in pure Node (node:sqlite), fast and deterministic.
//
// This is the cheapest layer of the durability guarantee: it proves the shared io.js
// import/export logic is LOSSLESS, which is exactly the code the browser uses to rebuild
// the DB from export.json after OPFS is lost. Flow:
//
//   export.json --import--> DB_A  (verify integrity + counts)
//   DB_A --export--> export_1
//   [ simulate OPFS loss: DB_A discarded ]
//   export_1 --import--> DB_B     (verify integrity + counts identical)
//   DB_B --export--> export_2
//   assert export_1 == export_2 semantically  (no data lost across a reconstruction)
//
// Data source: OCIO_EXPORT env var (point at the real archive locally), else the bundled
// synthetic fixture (so CI is self-contained without personal data).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createNodeAdapter } from './lib/adapter-node.mjs';
import {
  applySchema,
  importAll,
  exportAll,
  counts,
  integrityCheck,
  foreignKeyViolations,
  schemaVersion,
  EXPORT_ORDER,
  VERIFY_TABLES,
  TABLE_MANIFEST
} from '../src/lib/db/io.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

const KEY_TO_TABLE = Object.fromEntries(TABLE_MANIFEST.map((m) => [m.key, m.table]));

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// Stable, number-normalized canonical form of a table for semantic comparison.
function sortKeys(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => ((acc[k] = obj[k]), acc), {});
}
function canonTable(rows) {
  return (rows || []).map((r) => JSON.stringify(sortKeys(r))).sort();
}
function tablesEqual(a, b) {
  const ca = canonTable(a);
  const cb = canonTable(b);
  if (ca.length !== cb.length) return { equal: false, why: `len ${ca.length} != ${cb.length}` };
  for (let i = 0; i < ca.length; i++) {
    if (ca[i] !== cb[i]) return { equal: false, why: `row diff:\n    A=${ca[i]}\n    B=${cb[i]}` };
  }
  return { equal: true };
}

// Expected counts come from the source file itself, so this works for real or synthetic data.
const expected = {
  obra: source.obras?.length ?? 0,
  entrada: source.entradas?.length ?? 0,
  persona: source.personas?.length ?? 0,
  obra_creador: source.obra_creador?.length ?? 0
};

console.log(`\nOcio Shit — round-trip durability test`);
console.log(`data: ${dataPath}`);
console.log(`expected: obras=${expected.obra} entradas=${expected.entrada} personas=${expected.persona} obra_creador=${expected.obra_creador}\n`);

// --- DB_A: first import from export.json ----------------------------------------------
console.log('[1] import export.json -> DB_A');
const A = createNodeAdapter();
applySchema(A, schemaSql);
importAll(A, source);
const cA = counts(A);
const icA = integrityCheck(A);
check('DB_A schema_version == 2', schemaVersion(A) === 2);
check('DB_A integrity_check ok', icA.ok, `(${icA.detail})`);
check('DB_A foreign_key_check clean', foreignKeyViolations(A) === 0);
for (const t of VERIFY_TABLES) check(`DB_A count ${t} == ${expected[t]}`, cA[t] === expected[t], `(got ${cA[t]})`);
const export1 = exportAll(A, { exportadoEn: source.exportado_en });

// --- simulate OPFS loss: DB_A is gone; only export1 (the durable artifact) survives -----
console.log('\n[2] simulate OPFS loss -> reconstruct DB_B from the durable export');
A.close();
const B = createNodeAdapter();
applySchema(B, schemaSql);
importAll(B, export1);
const cB = counts(B);
const icB = integrityCheck(B);
check('DB_B integrity_check ok', icB.ok, `(${icB.detail})`);
check('DB_B foreign_key_check clean', foreignKeyViolations(B) === 0);
for (const t of VERIFY_TABLES) check(`DB_B count ${t} == ${expected[t]}`, cB[t] === expected[t], `(got ${cB[t]})`);

// --- lossless: re-export must equal the first export, table by table --------------------
console.log('\n[3] verify no data lost across the reconstruction');
const export2 = exportAll(B, { exportadoEn: source.exportado_en });
for (const key of EXPORT_ORDER) {
  const res = tablesEqual(export1[key], export2[key]);
  check(`table ${key} (${KEY_TO_TABLE[key]}) identical after rebuild`, res.equal, res.equal ? '' : res.why);
}

// --- also verify against the ORIGINAL source for the 4 populated tables ------------------
console.log('\n[4] verify DB_B matches the ORIGINAL source data');
for (const key of ['obras', 'entradas', 'personas', 'obra_creador']) {
  const res = tablesEqual(source[key], export2[key]);
  check(`source.${key} == reconstructed ${key}`, res.equal, res.equal ? '' : res.why);
}

B.close();

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
