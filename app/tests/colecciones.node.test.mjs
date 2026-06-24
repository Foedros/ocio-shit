// Test H — collections (seed Tanda 1 + materialize) and etiquetas R1/manual, on the real DB.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createNodeAdapter } from './lib/adapter-node.mjs';
import { applySchema, importAll, integrityCheck, foreignKeyViolations } from '../src/lib/db/io.js';
import {
  deriveDecadas,
  deriveReconsumos,
  seedTanda1,
  listColecciones,
  getColeccion,
  createColeccion,
  materializeColeccion,
  deleteColeccion,
  rematerializeAll
} from '../src/lib/db/colecciones.js';
import { applyR1, createEtiquetaManual, tagObra, listEtiquetas } from '../src/lib/db/etiquetas.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT ? resolve(process.env.OCIO_EXPORT) : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

const A = createNodeAdapter();
applySchema(A, schemaSql);
importAll(A, source);

let failures = 0;
const check = (label, cond, extra = '') => {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
const byName = (cols, n) => cols.find((c) => c.nombre.startsWith(n));

console.log(`\nOcio Shit — colecciones + etiquetas\ndata: ${dataPath}\n`);

// --- seed Tanda 1 ---
const seed = seedTanda1(A, { year: 2026 });
check('seedTanda1: crea 25 colecciones', seed.created === 25 && seed.total === 25, `(creadas ${seed.created})`);
const cols = listColecciones(A);
check('listColecciones devuelve 25', cols.length === 25);
check('El Canon = 0 obras (sin momentos_canon)', byName(cols, 'El Canon')?.n_obras === 0);
const comicReal = A.get("SELECT COUNT(*) n FROM obra WHERE categoria='comic'").n;
check('Cómics = nº real de cómics', byName(cols, 'Cómics')?.n_obras === comicReal, `(${byName(cols, 'Cómics')?.n_obras} == ${comicReal})`);

// --- getColeccion: a collection + its obras ---
const comics = byName(cols, 'Cómics');
const detail = getColeccion(A, comics.id);
check('getColeccion devuelve coleccion + obras', detail && detail.obras.length === comicReal);

// --- idempotencia: re-seed no duplica ---
const seed2 = seedTanda1(A, { year: 2026 });
check('seedTanda1 idempotente (0 nuevas en 2ª pasada)', seed2.created === 0 && listColecciones(A).length === 25);

// --- R1 etiquetas deterministas (deriva EXACTAMENTE de los campos no nulos presentes) ---
const r1 = applyR1(A);
const expectedTags = A.get(
  `SELECT (SELECT COUNT(DISTINCT decada) FROM obra WHERE decada IS NOT NULL)
        + (SELECT COUNT(DISTINCT idioma_original) FROM obra WHERE idioma_original IS NOT NULL)
        + (SELECT COUNT(DISTINCT pais_origen) FROM obra WHERE pais_origen IS NOT NULL) AS n`
).n;
check('R1 crea exactamente las etiquetas derivables de la BD', r1.tags === expectedTags, `(${r1.tags} == ${expectedTags}; corpus real tiene decada/idioma/pais vacíos)`);
check('R1 idempotente (2ª pasada no añade vínculos)', applyR1(A).links === 0);

// --- decada derivada (campo calculado §6): backfill + las colecciones de década se llenan ---
const anioSinDecada = A.get('SELECT COUNT(*) n FROM obra WHERE anio_obra IS NOT NULL AND decada IS NULL').n;
const der = deriveDecadas(A);
check('deriveDecadas rellena las que tenían anio sin decada', der.updated === anioSinDecada, `(${der.updated})`);
check('deriveDecadas idempotente (2ª pasada 0)', deriveDecadas(A).updated === 0);
rematerializeAll(A);
const expCine90 = A.get("SELECT COUNT(*) n FROM obra WHERE categoria='pelicula' AND decada=1990").n;
const cine90 = byName(listColecciones(A), 'Cine de los 90');
check('tras derivar, Cine de los 90 = nº real de pelis de los 90', cine90.n_obras === expCine90, `(${cine90.n_obras} == ${expCine90})`);

// --- deriveReconsumos: a bulk import that adds a 2ª consumption WITHOUT sequencing num_reconsumo
//     leaves es_reconsumo at 0; the derivation re-ranks it by date (§3.1) so Revisitadas includes it.
//     It also DEMOTES orphan flags (a 1-entrada obra can't be a reconsumo) — both directions. ---
const obraSolo = A.get(
  `SELECT e.obra_id FROM entrada e WHERE e.fecha IS NOT NULL AND e.num_reconsumo = 0
     AND (SELECT COUNT(*) FROM entrada e2 WHERE e2.obra_id = e.obra_id) = 1 LIMIT 1`
)?.obra_id;
check('hay una obra de 1 sola entrada con fecha (para la prueba)', !!obraSolo);
if (obraSolo) {
  const revIdAll = byName(listColecciones(A), 'Revisitadas').id;
  const isMember = (oid) => A.get('SELECT COUNT(*) n FROM obra_coleccion WHERE coleccion_id = ? AND obra_id = ?', [revIdAll, oid]).n > 0;
  check('la obra NO está en Revisitadas antes (1 sola entrada)', !isMember(obraSolo));
  const newId = 'test-reconsumo-' + obraSolo.slice(0, 8);
  A.run(
    `INSERT INTO entrada (id, obra_id, fecha, estado, num_reconsumo, metadata)
     VALUES (?, ?, '2099-01-01', 'terminado', 0, ?)`,
    [newId, obraSolo, JSON.stringify({ origen: 'sheets', fecha_tipo: 'fecha_visionado' })]
  );
  check('2º consumo importado sin secuenciar: es_reconsumo=0', A.get('SELECT es_reconsumo es FROM entrada WHERE id = ?', [newId]).es === 0);
  const recRes = deriveReconsumos(A);
  const recRow = A.get('SELECT num_reconsumo n, es_reconsumo es FROM entrada WHERE id = ?', [newId]);
  check('deriveReconsumos re-secuencia el 2º consumo (num_reconsumo=1, es_reconsumo=1)', recRes.updated >= 1 && recRow.n === 1 && recRow.es === 1, `(updated ${recRes.updated})`);
  check('el 1er consumo (más antiguo) sigue en 0', A.get('SELECT num_reconsumo n FROM entrada WHERE obra_id = ? AND id <> ?', [obraSolo, newId]).n === 0);
  check('deriveReconsumos idempotente (2ª pasada 0)', deriveReconsumos(A).updated === 0);
  rematerializeAll(A);
  check('tras re-secuenciar, esa obra YA está en Revisitadas', isMember(obraSolo));
}

// --- manual: etiqueta comfort + re-materializar la colección Comfort ---
const comfortTag = createEtiquetaManual(A, { nombre: 'comfort', taxonomia: 'meta' });
const twoObras = A.all('SELECT id FROM obra LIMIT 2').map((r) => r.id);
twoObras.forEach((oid) => tagObra(A, oid, comfortTag));
const comfortCol = byName(listColecciones(A), 'Comfort');
const mat = materializeColeccion(A, comfortCol.id);
check('Comfort se re-materializa con las 2 obras etiquetadas', mat.materialized === 2, `(${mat.materialized})`);

// --- crear colección manual + borrar ---
const manualId = createColeccion(A, { nombre: 'Mis favoritas', tipo: 'manual' });
check('crear colección manual', listColecciones(A).some((c) => c.id === manualId));
deleteColeccion(A, manualId);
check('borrar colección', !listColecciones(A).some((c) => c.id === manualId));

check('integridad ok tras escrituras de colecciones/etiquetas', integrityCheck(A).ok && foreignKeyViolations(A) === 0);

A.close();
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
