// Metric registry — resolves `metrica:MET_*` (estadisticas.md catalog) to a GLOBAL SQL
// scalar subexpression. Pure: returns { sql, params } so the compiler never interpolates
// user values. Each entry is a function (param) => { sql, params }.
//
// Scope note (respecting the sprint): the full MET_* catalog + the Shannon-entropy Índice
// de Diversidad + rachas + selectors are the V1-S5 recalibration. Here we implement the
// straightforward scalar metrics the grammar needs now (incl. everything LOG_DESPIERTO and
// the M6 group-by metrics use); the deferred ones throw a clear, honest error if referenced.

const CATEGORIAS = ['pelicula', 'serie', 'libro', 'videojuego', 'comic', 'ocio_libre'];

function plain(sql) {
  return () => ({ sql, params: [] });
}

// Sum of minutes -> hours, optionally restricted by clase_tiempo.
const horas = (whereClause) =>
  `(SELECT COALESCE(SUM(duracion_min), 0) / 60.0 FROM entrada${whereClause ? ' WHERE ' + whereClause : ''})`;

// Shannon-entropy diversity of ONE dimension, as a self-contained scalar subexpression
// (portable SQLite/node:sqlite ↔ PostgreSQL; both have ln()). Exactly the formula verified in
// the re-diagnóstico (estadisticas.md §4.2): D = 100·H/ln(k), H = −Σ pᵢ·ln(pᵢ), pᵢ = nᵢ/N,
// k = nº de valores distintos. `grouped` is a SELECT that yields one row per distinct value with
// its obra count `n`. 0 ó 1 grupo → 0. COALESCE porque un set vacío (país/idioma) da NULL.
const ent = (grouped) =>
  `COALESCE((SELECT CASE WHEN COUNT(*) > 1 THEN 100.0*(-SUM((d.n/tt.nn)*ln(d.n/tt.nn)))/ln(COUNT(*)*1.0) ELSE 0 END` +
  ` FROM (${grouped}) d CROSS JOIN (SELECT SUM(n) nn FROM (${grouped}) z) tt GROUP BY tt.nn), 0)`;
// Per-dimension grouped sets (modelo §6 / estadisticas.md §4.1). creador SIEMPRE sobre obra_creador
// (Persona), nunca el texto libre obra.creador. género = etiquetas taxonomia='genero'.
const G_DECADA = `SELECT COUNT(*)*1.0 n FROM obra WHERE decada IS NOT NULL GROUP BY decada`;
const G_GENERO =
  `SELECT COUNT(DISTINCT oe.obra_id)*1.0 n FROM obra_etiqueta oe JOIN etiqueta et ON et.id = oe.etiqueta_id` +
  ` WHERE et.taxonomia='genero' GROUP BY oe.etiqueta_id`;
const G_CREADOR = `SELECT COUNT(DISTINCT obra_id)*1.0 n FROM obra_creador GROUP BY persona_id`;
const G_PAIS = `SELECT COUNT(*)*1.0 n FROM obra WHERE pais_origen IS NOT NULL GROUP BY pais_origen`;
const G_IDIOMA = `SELECT COUNT(*)*1.0 n FROM obra WHERE idioma_original IS NOT NULL GROUP BY idioma_original`;

export const METRICS = {
  // --- tiempo ---
  MET_HORAS_TOTALES: plain(horas()),
  MET_HORAS_ELECTIVAS: plain(horas("clase_tiempo = 'electivo'")),
  MET_HORAS_HABITO: plain(horas("clase_tiempo = 'habito'")),
  MET_DURACION_MEDIA: plain('(SELECT AVG(duracion_min) FROM entrada)'),
  MET_PCT_HABITO: plain(
    "(SELECT CASE WHEN SUM(duracion_min) > 0 THEN 100.0 * SUM(CASE WHEN clase_tiempo='habito' THEN duracion_min ELSE 0 END) / SUM(duracion_min) ELSE 0 END FROM entrada)"
  ),

  // --- volumen ---
  MET_OBRAS_TOTALES: plain('(SELECT COUNT(*) FROM obra)'),
  MET_ENTRADAS_TOTALES: plain('(SELECT COUNT(*) FROM entrada)'),

  // --- calidad ---
  MET_NOTA_MEDIA: plain('(SELECT AVG(valoracion) FROM entrada)'),
  MET_IMPACTO_MEDIO: plain('(SELECT AVG(impacto_emocional) FROM entrada)'),
  MET_RECONSUMOS: plain('(SELECT COUNT(*) FROM entrada WHERE num_reconsumo > 0)'),

  // --- evolucion ---
  MET_TASA_FINALIZACION: plain(
    "(SELECT CASE WHEN (t + a) > 0 THEN 100.0 * t / (t + a) ELSE 0 END FROM (SELECT SUM(CASE WHEN estado='terminado' THEN 1 ELSE 0 END) t, SUM(CASE WHEN estado='abandonado' THEN 1 ELSE 0 END) a FROM entrada))"
  ),
  MET_RITMO_MENSUAL: plain(
    "(SELECT CASE WHEN m > 0 THEN 1.0 * c / m ELSE 0 END FROM (SELECT COUNT(*) c, COUNT(DISTINCT strftime('%Y-%m', fecha)) m FROM entrada WHERE fecha IS NOT NULL))"
  ),

  // --- diversidad (cuentas) ---
  MET_PAISES_DISTINTOS: plain('(SELECT COUNT(DISTINCT pais_origen) FROM obra WHERE pais_origen IS NOT NULL)'),
  MET_IDIOMAS_DISTINTOS: plain('(SELECT COUNT(DISTINCT idioma_original) FROM obra WHERE idioma_original IS NOT NULL)'),
  MET_DECADAS_DISTINTAS: plain('(SELECT COUNT(DISTINCT decada) FROM obra WHERE decada IS NOT NULL)'),
  MET_CREADORES_DISTINTOS: plain('(SELECT COUNT(DISTINCT persona_id) FROM obra_creador)'),
  MET_GENEROS_DISTINTOS: plain(
    "(SELECT COUNT(DISTINCT oe.etiqueta_id) FROM obra_etiqueta oe JOIN etiqueta et ON et.id = oe.etiqueta_id WHERE et.taxonomia='genero')"
  ),

  // --- diversidad (Índice de Shannon, estadisticas.md §4) ---
  // Sub-dimensiones por entropía normalizada. País/idioma quedan VACÍAS en el corpus (D-MET-02):
  // el escalar devuelve 0 honesto (no se inventan datos), no lanza error.
  MET_DIV_DECADA: plain(ent(G_DECADA)),
  MET_DIV_GENERO: plain(ent(G_GENERO)),
  MET_DIV_CREADOR: plain(ent(G_CREADOR)),
  MET_DIV_PAIS: plain(ent(G_PAIS)),
  MET_DIV_IDIOMA: plain(ent(G_IDIOMA)),
  // Índice = media de 3 dimensiones REALES (década·género·creador), NO de 5 (D-MET-03 en
  // CLAUDE.md §11.10 anula el /5 de estadisticas.md §4.3: país/idioma están deliberadamente
  // fuera, no son dimensiones que falten). = la MISMA fórmula y valor (82,92) que ocio_stats().
  MET_INDICE_DIVERSIDAD: plain(`((${ent(G_DECADA)} + ${ent(G_GENERO)} + ${ent(G_CREADOR)}) / 3.0)`),
  // % internacional = obras en idioma ≠ base. idioma_original vacío en el corpus (D-MET-02) → 0.
  MET_PCT_INTERNACIONAL: plain(
    "(SELECT CASE WHEN COUNT(*) > 0 THEN 100.0 * SUM(CASE WHEN idioma_original IS NOT NULL AND idioma_original <> 'es' THEN 1 ELSE 0 END) / COUNT(*) ELSE 0 END FROM obra)"
  ),

  // --- group-by con parámetro (M6): {metrica, param:{categoria}, op, valor} ---
  MET_TIEMPO_POR_CATEGORIA: (param) => {
    const cat = requireCategoria(param);
    return {
      sql: '(SELECT COALESCE(SUM(e.duracion_min), 0) / 60.0 FROM entrada e JOIN obra o ON o.id = e.obra_id WHERE o.categoria = ?)',
      params: [cat]
    };
  },
  MET_OBRAS_POR_CATEGORIA: (param) => {
    const cat = requireCategoria(param);
    return { sql: '(SELECT COUNT(*) FROM obra WHERE categoria = ?)', params: [cat] };
  },
  MET_NOTA_POR_CATEGORIA: (param) => {
    const cat = requireCategoria(param);
    return {
      sql: '(SELECT AVG(e.valoracion) FROM entrada e JOIN obra o ON o.id = e.obra_id WHERE o.categoria = ?)',
      params: [cat]
    };
  }
};

function requireCategoria(param) {
  const cat = param?.categoria;
  if (!CATEGORIAS.includes(cat)) {
    throw new Error(`Métrica group-by requiere param.categoria válida (M6); recibido: ${JSON.stringify(param)}`);
  }
  return cat;
}

// Metrics still deferred: streaks (rachas) need consecutive-day logic and the selector
// superlatives return (entidad,valor) pairs — both are the V1-S5 work, out of scope here.
// (The entropy Índice de Diversidad + sub-dimensiones YA están implementadas arriba.)
const DEFERRED = new Set([
  'MET_RACHA_ACTUAL',
  'MET_RACHA_MAXIMA',
  'MET_TOP_DECADA',
  'MET_TOP_OBRA',
  'MET_TOP_IMPACTO',
  'MET_TOP_CREADOR',
  'MET_MES_CUMBRE',
  'MET_SESION_MAX'
]);

/** Resolve a MET_* id (+ optional param) to a global scalar { sql, params }. */
export function metricScalar(id, param) {
  if (DEFERRED.has(id)) {
    throw new Error(`Métrica ${id} diferida a V1-S5 (recalibración del corpus); aún no disponible.`);
  }
  const fn = METRICS[id];
  if (!fn) throw new Error(`Métrica desconocida: ${id}`);
  return fn(param);
}

export const METRIC_IDS = Object.keys(METRICS);
