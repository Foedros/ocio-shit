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
  deleteEntry,
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

// --- valoración 0 NO se descarta (review #4: 0 es un valor válido, no "vacío") ---
const r0 = addEntry(A, {
  obra: { titulo: 'Obra Valorada Cero ZZZ', categoria: 'pelicula', anio_obra: 2026 },
  entrada: { fecha: '2026-06-24', valoracion: 0 }
});
check('valoración 0 se guarda como 0 (no null)', getEntry(A, r0.entradaId).valoracion === 0);

// --- search escapa comodines LIKE (review #8): "%" literal no devuelve todo ---
const allCount = listEntries(A).length;
const pctCount = listEntries(A, { search: '%' }).length;
check('búsqueda "%" se escapa (no devuelve todo)', pctCount < allCount, `(${pctCount} de ${allCount})`);

// --- fecha (Entrada) vs año de obra (Obra) SEPARADOS + A-07 duración FIJA (película) ---
const f1 = addEntry(A, {
  obra: { titulo: 'Ape Out Peli ZZZ', categoria: 'pelicula', anio_obra: 2019 },
  entrada: { fecha: '2026-06-24', duracion_min: 128 }
});
const fo = getObra(A, f1.obraId).obra;
check('separación: obra.anio_obra=2019 (estreno), decada=2010', fo.anio_obra === 2019 && fo.decada === 2010);
check('separación: entrada.fecha=2026-06-24 (consumo), no toca el año', getEntry(A, f1.entradaId).fecha === '2026-06-24');
check('A-07 fija: obra.duracion_canonica_min=128', fo.duracion_canonica_min === 128);
check('A-07 fija: entrada.duracion_min=128', getEntry(A, f1.entradaId).duracion_min === 128);
const f2 = addEntry(A, {
  obra: { titulo: 'ape out peli zzz', categoria: 'pelicula', anio_obra: 2019 },
  entrada: { fecha: '2026-07-01' }
});
check('A-07 fija: re-consumo sin duración hereda la canónica (128)', getEntry(A, f2.entradaId).duracion_min === 128);

// --- A-07 duración VARIABLE (videojuego): solo por-entrada, canónica NULL ---
const v1 = addEntry(A, {
  obra: { titulo: 'Ape Out Juego ZZZ', categoria: 'videojuego', anio_obra: 2019 },
  entrada: { fecha: '2026-06-24', duracion_min: 300 }
});
const vo = getObra(A, v1.obraId).obra;
check('A-07 variable: obra.duracion_canonica_min=NULL', vo.duracion_canonica_min == null);
check('A-07 variable: entrada.duracion_min=300', getEntry(A, v1.entradaId).duracion_min === 300);

// --- BORRAR: entrada de una obra con varias entradas -> la obra se queda ---
const d1 = deleteEntry(A, f2.entradaId);
check('borrar (obra con +1 entrada): borrada=true, obra NO borrada', d1.deleted && d1.obraDeleted === false);
check('borrar: la entrada ya no está', getEntry(A, f2.entradaId) === null);
check('borrar: la obra sigue (le queda 1)', getObra(A, f1.obraId) !== null);

// --- BORRAR la última entrada de una obra -> la obra desaparece (sin huérfanas) ---
const delBefore = counts(A);
const d2 = deleteEntry(A, f1.entradaId);
check('borrar última entrada: obra borrada también', d2.deleted && d2.obraDeleted === true);
check('borrar última: la obra ya no existe', getObra(A, f1.obraId) === null);
const delAfter = counts(A);
check('borrar última: -1 obra y -1 entrada', delAfter.obra === delBefore.obra - 1 && delAfter.entrada === delBefore.entrada - 1, `(${delBefore.obra}/${delBefore.entrada} -> ${delAfter.obra}/${delAfter.entrada})`);
check('borrar: integridad ok, 0 FK', integrityCheck(A).ok && foreignKeyViolations(A) === 0);

// ════ METADATOS DE OBRA A MANO (creador / género / año) + create-vs-link ════
console.log('\n[metadatos a mano]');

// alta NUEVA con creador + géneros + año
const m1 = addEntry(A, {
  obra: { titulo: 'Peli Con Meta ZZZ', categoria: 'pelicula', anio_obra: 1999, creador: 'Lana Wachowski', generos: ['Acción', 'Ciencia Ficción'] },
  entrada: { fecha: '2026-06-26', valoracion: 9 }
});
const mo = getObra(A, m1.obraId).obra;
check('meta: obra.creador="Lana Wachowski" + decada 1990', mo.creador === 'Lana Wachowski' && mo.decada === 1990);
const mc = A.all('SELECT p.nombre, oc.rol_credito FROM obra_creador oc JOIN persona p ON p.id = oc.persona_id WHERE oc.obra_id = ?', [m1.obraId]);
check('meta: obra_creador rol=director (cine)', mc.length === 1 && mc[0].rol_credito === 'director' && mc[0].nombre === 'Lana Wachowski');
const mg = A.all("SELECT e.nombre FROM obra_etiqueta oe JOIN etiqueta e ON e.id = oe.etiqueta_id WHERE oe.obra_id = ? AND e.taxonomia = 'genero' ORDER BY e.nombre", [m1.obraId]);
check('meta: géneros slug normalizados (accion, ciencia-ficcion)', mg.map((x) => x.nombre).join(',') === 'accion,ciencia-ficcion');

// rol por categoría: videojuego→developer, libro→autor
const m2 = addEntry(A, { obra: { titulo: 'Juego Meta ZZZ', categoria: 'videojuego', creador: 'Team Cherry', generos: ['Aventura'] }, entrada: {} });
check('meta: rol developer (videojuego)', A.get('SELECT rol_credito r FROM obra_creador WHERE obra_id = ?', [m2.obraId]).r === 'developer');
const m3 = addEntry(A, { obra: { titulo: 'Libro Meta ZZZ', categoria: 'libro', creador: 'Brandon Sanderson' }, entrada: {} });
check('meta: rol autor (libro)', A.get('SELECT rol_credito r FROM obra_creador WHERE obra_id = ?', [m3.obraId]).r === 'autor');

// género REUSA la etiqueta existente por slug (no duplica)
const accionId = A.get("SELECT id FROM etiqueta WHERE nombre = 'accion'").id;
const m4 = addEntry(A, { obra: { titulo: 'Otra Accion ZZZ', categoria: 'pelicula', anio_obra: 2001, generos: ['acción'] }, entrada: {} });
check('meta: "acción" reusa la etiqueta accion (no duplica)',
  A.all("SELECT id FROM etiqueta WHERE nombre = 'accion'").length === 1 &&
    A.get('SELECT etiqueta_id e FROM obra_etiqueta WHERE obra_id = ?', [m4.obraId]).e === accionId);

// create-vs-link: misma obra (mismo año) con creador NUEVO → manual gana (reemplaza el vínculo)
const m5 = addEntry(A, { obra: { titulo: 'peli con meta zzz', categoria: 'pelicula', anio_obra: 1999, creador: 'Hermanas Wachowski' }, entrada: {} });
check('link: reusa la obra (no +obra)', m5.obraId === m1.obraId && m5.obraCreated === false);
const dirRows = A.all("SELECT p.nombre FROM obra_creador oc JOIN persona p ON p.id = oc.persona_id WHERE oc.obra_id = ? AND oc.rol_credito = 'director'", [m1.obraId]);
check('link: creador manual REEMPLAZA (1 director = nuevo nombre) + texto actualizado',
  dirRows.length === 1 && dirRows[0].nombre === 'Hermanas Wachowski' && getObra(A, m1.obraId).obra.creador === 'Hermanas Wachowski');

// género set NO vacío REEMPLAZA; vacío = NO-OP (no borra)
addEntry(A, { obra: { titulo: 'peli con meta zzz', categoria: 'pelicula', anio_obra: 1999, generos: ['Drama'] }, entrada: {} });
check('link: set de género no vacío REEMPLAZA (solo drama)',
  A.all("SELECT e.nombre FROM obra_etiqueta oe JOIN etiqueta e ON e.id = oe.etiqueta_id WHERE oe.obra_id = ? AND e.taxonomia = 'genero'", [m1.obraId]).map((x) => x.nombre).join(',') === 'drama');
addEntry(A, { obra: { titulo: 'peli con meta zzz', categoria: 'pelicula', anio_obra: 1999 }, entrada: { nota: 'reconsumo sin tocar meta' } });
check('no-op: reconsumo sin meta conserva género (drama) y creador',
  A.all("SELECT 1 FROM obra_etiqueta oe JOIN etiqueta e ON e.id = oe.etiqueta_id WHERE oe.obra_id = ? AND e.taxonomia = 'genero'", [m1.obraId]).length === 1 &&
    getObra(A, m1.obraId).obra.creador === 'Hermanas Wachowski');

// YEAR-FILL (create-vs-link): obra sin año + alta con año → reusa y rellena (no duplica)
const yfNew = addEntry(A, { obra: { titulo: 'Sin Anio ZZZ', categoria: 'pelicula' }, entrada: {} });
const obraCountPre = counts(A).obra;
const yf2 = addEntry(A, { obra: { titulo: 'Sin Anio ZZZ', categoria: 'pelicula', anio_obra: 2010 }, entrada: {} });
check('year-fill: reusa la obra sin año (no +obra)', yf2.obraId === yfNew.obraId && counts(A).obra === obraCountPre);
check('year-fill: rellena anio=2010 + decada=2010', getObra(A, yf2.obraId).obra.anio_obra === 2010 && getObra(A, yf2.obraId).obra.decada === 2010);

check('meta: integridad ok, 0 FK tras escrituras', integrityCheck(A).ok && foreignKeyViolations(A) === 0);

A.close();
console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
