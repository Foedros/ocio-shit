// Maintenance audit (`npm run test:audit`): integrity of the DERIVED fields the model §6
// marks as such (`decada`, `nivel`, `es_reconsumo`, `clave_dedup`) over a real export.
// Re-runnable after ANY future import to catch un-derived fields (the kind of Fase-4 debt
// the FA bulk import left behind). NOT in CI (needs the gitignored archive); point it at a
// file with OCIO_EXPORT=… if not at data/ocioshit.export.json.
//
// Loads the export through the SAME io.js the app/worker use, so what we measure is exactly
// what the reconstruction path would hold. Read-only; prints counts. Data-free (no titles).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createNodeAdapter } from './lib/adapter-node.mjs';
import { applySchema, importAll, integrityCheck, foreignKeyViolations, counts } from '../src/lib/db/io.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, '..', '..', 'data', 'ocioshit.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

const A = createNodeAdapter();
applySchema(A, schemaSql);
importAll(A, source);

const n = (sql, p = []) => A.get(sql, p).n;
const line = (label, val, note = '') => console.log(`  ${String(val).padStart(6)}  ${label}${note ? '   — ' + note : ''}`);
const H = (t) => console.log(`\n=== ${t} ===`);

console.log(`\nAuditoría de derivados (§6) — datos reales\ndata: ${dataPath}`);
const c = counts(A);
console.log(`corpus: ${c.obra} obras · ${c.entrada} entradas · ${c.persona} personas · ${c.obra_creador} vínculos\n`);
console.log(`integrity_check: ${integrityCheck(A).detail} · FK violations: ${foreignKeyViolations(A)}`);

let problemas = 0;
const flag = (cond, n) => { if (cond) problemas += n; };

// ---------------------------------------------------------------- decada (obra, derivado)
H('decada  (floor(anio_obra/10)*10)');
const obrasConAnio = n('SELECT COUNT(*) n FROM obra WHERE anio_obra IS NOT NULL');
const decadaNull = n('SELECT COUNT(*) n FROM obra WHERE anio_obra IS NOT NULL AND decada IS NULL');
const decadaWrong = n("SELECT COUNT(*) n FROM obra WHERE anio_obra IS NOT NULL AND decada IS NOT NULL AND decada <> (anio_obra/10)*10");
const decadaSinAnio = n('SELECT COUNT(*) n FROM obra WHERE anio_obra IS NULL AND decada IS NOT NULL');
line('obras con anio_obra', obrasConAnio);
line('SIN CALCULAR  (anio presente, decada NULL)', decadaNull, decadaNull ? 'backfilleable' : 'ok');
line('MAL CALCULADO (decada != floor(anio/10)*10)', decadaWrong, decadaWrong ? 'REVISAR' : 'ok');
line('decada sin anio (no derivable, sospechoso)', decadaSinAnio);
flag(decadaNull > 0 || decadaWrong > 0 || decadaSinAnio > 0, decadaNull + decadaWrong + decadaSinAnio);

// ---------------------------------------------------------------- clave_dedup (obra, GENERATED STORED)
H('clave_dedup  (GENERATED STORED, UNIQUE)');
const dedupNull = n('SELECT COUNT(*) n FROM obra WHERE clave_dedup IS NULL');
const dedupWrong = n("SELECT COUNT(*) n FROM obra WHERE clave_dedup <> lower(titulo) || '|' || categoria || '|' || coalesce(anio_obra,'')");
const dedupDup = n('SELECT COUNT(*) n FROM (SELECT clave_dedup FROM obra GROUP BY clave_dedup HAVING COUNT(*) > 1)');
line('clave_dedup NULL', dedupNull, dedupNull ? 'IMPOSIBLE (generated)' : 'ok');
line('clave_dedup != fórmula', dedupWrong, dedupWrong ? 'REVISAR' : 'ok');
line('valores duplicados (grupos)', dedupDup, dedupDup ? 'REVISAR (UNIQUE)' : 'ok');
flag(dedupNull > 0 || dedupWrong > 0 || dedupDup > 0, dedupNull + dedupWrong + dedupDup);

// ---------------------------------------------------------------- es_reconsumo (entrada, GENERATED VIRTUAL) + num_reconsumo
H('es_reconsumo  (GENERATED VIRTUAL = num_reconsumo > 0)  + num_reconsumo');
const esReconWrong = n('SELECT COUNT(*) n FROM entrada WHERE es_reconsumo <> (CASE WHEN num_reconsumo > 0 THEN 1 ELSE 0 END)');
line('es_reconsumo != (num_reconsumo>0)', esReconWrong, esReconWrong ? 'IMPOSIBLE (generated)' : 'ok');
const reconTotal = n('SELECT COUNT(*) n FROM entrada WHERE num_reconsumo > 0');
const numNull = n('SELECT COUNT(*) n FROM entrada WHERE num_reconsumo IS NULL');
const numNeg = n('SELECT COUNT(*) n FROM entrada WHERE num_reconsumo < 0');
line('entradas marcadas reconsumo (num>0)', reconTotal);
line('num_reconsumo NULL', numNull, numNull ? 'REVISAR (NOT NULL DEFAULT 0)' : 'ok');
line('num_reconsumo negativo', numNeg, numNeg ? 'REVISAR' : 'ok');

// Substantive FA-import check: for an obra with K entradas, the re-consumption ordinals
// should be the set {0,1,…,K-1}. A bulk import that creates many entries per obra but leaves
// num_reconsumo flat at 0 would NOT flag genuine reconsumos. Quantify the anomaly space.
const obrasMulti = n('SELECT COUNT(*) n FROM (SELECT obra_id FROM entrada GROUP BY obra_id HAVING COUNT(*) > 1)');
const obrasMultiPlanas = n(
  'SELECT COUNT(*) n FROM (SELECT obra_id FROM entrada GROUP BY obra_id HAVING COUNT(*) > 1 AND MAX(num_reconsumo) = 0)'
);
const obrasMultiDupOrdinal = n(
  `SELECT COUNT(*) n FROM (
     SELECT obra_id FROM entrada GROUP BY obra_id HAVING COUNT(*) > 1
        AND COUNT(DISTINCT num_reconsumo) <> COUNT(*)
   )`
);
const obrasMultiGap = n(
  `SELECT COUNT(*) n FROM (
     SELECT obra_id FROM entrada GROUP BY obra_id HAVING COUNT(*) > 1
        AND MAX(num_reconsumo) <> COUNT(*) - 1
   )`
);
const reconOrfano = n(
  `SELECT COUNT(*) n FROM entrada e WHERE num_reconsumo > 0
     AND (SELECT COUNT(*) FROM entrada e2 WHERE e2.obra_id = e.obra_id) = 1`
);
line('obras con >1 entrada (multi-consumo)', obrasMulti);
line('  · todas sus entradas num_reconsumo=0 (NO flaggea reconsumo)', obrasMultiPlanas, obrasMultiPlanas ? 'candidato deuda FA' : 'ok');
line('  · ordinales duplicados entre sus entradas', obrasMultiDupOrdinal, obrasMultiDupOrdinal ? 'secuencia rota' : 'ok');
line('  · MAX(num) != nº entradas-1 (hueco/desfase)', obrasMultiGap, obrasMultiGap ? 'revisar' : 'ok');
line('reconsumos huérfanos (num>0 con obra de 1 sola entrada)', reconOrfano, reconOrfano ? 'REVISAR' : 'ok');
flag(esReconWrong > 0 || numNull > 0 || numNeg > 0 || reconOrfano > 0, esReconWrong + numNull + numNeg + reconOrfano);

// ---------------------------------------------------------------- nivel (perfil_usuario, derivado)
H('nivel  (perfil_usuario, derivado de exp_total)');
const perfil = A.get('SELECT exp_total, nivel FROM perfil_usuario WHERE id = 1');
const enExport = Array.isArray(source.perfil_usuario) ? source.perfil_usuario.length : 0;
line('exp_total', perfil?.exp_total ?? '(sin fila)');
line('nivel', perfil?.nivel ?? '(sin fila)', (perfil?.exp_total === 0 && perfil?.nivel === 1) ? 'coherente (sin logros aún)' : 'REVISAR fórmula');
line('perfil_usuario en export.json', enExport, enExport === 0 ? 'no exportado (se siembra por defecto al crear schema)' : '');
flag(perfil && perfil.exp_total === 0 && perfil.nivel !== 1, 1);

// ---------------------------------------------------------------- A-07 (NO es §6, nota informativa)
H('A-07 (informativo, NO es derivado §6): duracion fija vs duracion_min');
const FIJA = "('pelicula','libro','comic')";
const fijaCanonNull = n(`SELECT COUNT(*) n FROM obra WHERE categoria IN ${FIJA} AND duracion_canonica_min IS NULL`);
const fijaIncoherente = n(
  `SELECT COUNT(*) n FROM entrada e JOIN obra o ON o.id = e.obra_id
     WHERE o.categoria IN ${FIJA} AND o.duracion_canonica_min IS NOT NULL
       AND e.duracion_min IS NOT NULL AND e.duracion_min <> o.duracion_canonica_min`
);
line('obras fijas con duracion_canonica NULL', fijaCanonNull, 'dato ausente (FA no trae duración) — no es derivado');
line('entradas fijas con duracion_min != canonica', fijaIncoherente, fijaIncoherente ? 'revisar A-07' : 'ok');

H('RESUMEN');
console.log(problemas === 0
  ? '  ✅ Todos los derivados §6 correctos en el artefacto real. Nada que backfillear.'
  : `  ⚠️  ${problemas} fila(s) con derivado §6 sin/mal calcular — backfill determinista requerido.`);
A.close();
process.exit(0);
