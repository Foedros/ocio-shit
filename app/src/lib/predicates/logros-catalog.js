// Catálogo RPG — los 25 logros + 20 títulos + hitos de logros-rpg.md §6/§7/§8. Datos puros:
// la condicion_json va en la GRAMÁTICA COMPARTIDA (colecciones.md §3), la MISMA que evalúa el
// compilador para colecciones. NO hay segunda gramática. Este módulo es la ÚNICA fuente: el seed
// lo escribe en Supabase (tablas logro/titulo) y el runtime lo compila para evaluar en vivo.
//
// `condicion_json` presente → evaluable HOY con el compilador + métricas implementadas.
// `condicion_json: null` + `bloqueado_por` → honestamente NO evaluable aún (no se inventa dato):
//   · 'racha'        — días consecutivos; MET_RACHA_* diferida a V1-S5.
//   · 'antiguedad'   — años de archivo / continuidad; sin métrica catalogada (V1-S5).
//   · 'clase'        — clase principal deriva de EXP (subsistema de progresión, no construido).
//   · 'nivel'        — nivel deriva de EXP (idem).
//   · 'momentos'     — requiere registrar MomentoCanon (sistema de Momentos no construido; hoy 0).
//   · 'colecciones'  — conteo de colecciones: fuera del espacio obra/entrada de la gramática.
//   · 'campos_ricos' — "todos los campos ricos rellenos": sin definición formal.
//
// Notas de corpus (D-MET-02): país/idioma/impacto_emocional están VACÍOS → sus métricas dan 0;
// esos logros evalúan a BLOQUEADO honesto (no error), no a "no evaluable".

const M = (id, valor, param) =>
  param
    ? { match: 'all', filtros: [{ campo: 'metrica:' + id, param, op: '>=', valor }] }
    : { match: 'all', filtros: [{ campo: 'metrica:' + id, op: '>=', valor }] };

// ── 25 LOGROS (logros-rpg.md §6) ─────────────────────────────────────────────
export const LOGROS = [
  { id: 'LOG_MENTE_ABIERTA', nombre: 'Mente abierta', rareza: 'legendario', exp: 800, clase: 'diversidad',
    descripcion: 'Índice de Diversidad Cultural ≥ 70.', umbral: 'MET_INDICE_DIVERSIDAD ≥ 70',
    condicion_json: M('MET_INDICE_DIVERSIDAD', 70) },
  { id: 'LOG_QUINIENTAS', nombre: 'Quinientas', rareza: 'epico', exp: 600, clase: 'general',
    descripcion: '500 obras distintas en el archivo.', umbral: 'MET_OBRAS_TOTALES ≥ 500',
    condicion_json: M('MET_OBRAS_TOTALES', 500) },
  { id: 'LOG_MARATONIANO', nombre: 'Maratoniano', rareza: 'epico', exp: 500, clase: 'general',
    descripcion: '1.000 horas de ocio electivo (excluye hábito).', umbral: 'MET_HORAS_ELECTIVAS ≥ 1000',
    condicion_json: M('MET_HORAS_ELECTIVAS', 1000) },
  { id: 'LOG_TROTAMUNDOS', nombre: 'Trotamundos', rareza: 'epico', exp: 400, clase: 'diversidad',
    descripcion: 'Obras de 20 países distintos.', umbral: 'MET_PAISES_DISTINTOS ≥ 20',
    condicion_json: M('MET_PAISES_DISTINTOS', 20) },
  { id: 'LOG_DESPIERTO', nombre: 'Despierto', rareza: 'epico', exp: 400, clase: 'habito',
    descripcion: 'Menos del 30 % del tiempo en hábito, con ≥ 1.000 h electivas.',
    umbral: 'MET_PCT_HABITO < 30 ∧ MET_HORAS_ELECTIVAS ≥ 1000',
    condicion_json: { match: 'all', filtros: [
      { campo: 'metrica:MET_PCT_HABITO', op: '<', valor: 30 },
      { campo: 'metrica:MET_HORAS_ELECTIVAS', op: '>=', valor: 1000 } ] } },
  { id: 'LOG_CINEFILO_500', nombre: 'Cinéfilo de fondo', rareza: 'epico', exp: 400, clase: 'cine',
    descripcion: '500 horas de cine.', umbral: 'MET_TIEMPO_POR_CATEGORIA[pelicula] ≥ 500',
    condicion_json: M('MET_TIEMPO_POR_CATEGORIA', 500, { categoria: 'pelicula' }) },
  { id: 'LOG_POLIGLOTA', nombre: 'Políglota', rareza: 'epico', exp: 350, clase: 'diversidad',
    descripcion: 'Obras en 10 idiomas distintos.', umbral: 'MET_IDIOMAS_DISTINTOS ≥ 10',
    condicion_json: M('MET_IDIOMAS_DISTINTOS', 10) },
  { id: 'LOG_RELECTOR', nombre: 'Relector', rareza: 'raro', exp: 250, clase: 'general',
    descripcion: '25 re-consumos registrados.', umbral: 'MET_RECONSUMOS ≥ 25',
    condicion_json: M('MET_RECONSUMOS', 25) },
  { id: 'LOG_VIAJERO_TIEMPO', nombre: 'Viajero del tiempo', rareza: 'raro', exp: 250, clase: 'diversidad',
    descripcion: 'Obras de 6 décadas distintas.', umbral: 'MET_DECADAS_DISTINTAS ≥ 6',
    condicion_json: M('MET_DECADAS_DISTINTAS', 6) },
  { id: 'LOG_ENCICLOPEDIA', nombre: 'Enciclopedia de géneros', rareza: 'raro', exp: 250, clase: 'diversidad',
    descripcion: '20 géneros distintos.', umbral: 'MET_GENEROS_DISTINTOS ≥ 20',
    condicion_json: M('MET_GENEROS_DISTINTOS', 20) },
  { id: 'LOG_RATON_BIBLIOTECA', nombre: 'Ratón de biblioteca', rareza: 'raro', exp: 250, clase: 'libro',
    descripcion: '50 libros.', umbral: 'MET_OBRAS_POR_CATEGORIA[libro] ≥ 50',
    condicion_json: M('MET_OBRAS_POR_CATEGORIA', 50, { categoria: 'libro' }) },
  { id: 'LOG_EMOCIONADO', nombre: 'Hasta las lágrimas', rareza: 'raro', exp: 250, clase: 'general',
    descripcion: '10 entradas con impacto emocional ≥ 9.', umbral: '≥ 10 entradas impacto_emocional ≥ 9',
    condicion_json: { match: 'all', filtros: [
      { op: 'count_where', sobre: 'entrada', donde: [{ campo: 'entrada.impacto_emocional', op: '>=', valor: 9 }],
        comparar: { op: '>=', valor: 10 } } ] } },
  { id: 'LOG_CONSTANTE', nombre: 'Constante', rareza: 'raro', exp: 200, clase: 'habito',
    descripcion: 'Racha de 30 días seguidos con actividad.', umbral: 'MET_RACHA_MAXIMA ≥ 30',
    condicion_json: M('MET_RACHA_MAXIMA', 30) },
  { id: 'LOG_CENTENARIO', nombre: 'Centenario', rareza: 'raro', exp: 200, clase: 'general',
    descripcion: '100 obras distintas.', umbral: 'MET_OBRAS_TOTALES ≥ 100',
    condicion_json: M('MET_OBRAS_TOTALES', 100) },
  { id: 'LOG_TERMINADOR', nombre: 'Terminador', rareza: 'raro', exp: 200, clase: 'general',
    descripcion: 'Tasa de finalización ≥ 90 % con ≥ 50 obras.',
    umbral: 'MET_TASA_FINALIZACION ≥ 90 ∧ MET_OBRAS_TOTALES ≥ 50',
    condicion_json: { match: 'all', filtros: [
      { campo: 'metrica:MET_TASA_FINALIZACION', op: '>=', valor: 90 },
      { campo: 'metrica:MET_OBRAS_TOTALES', op: '>=', valor: 50 } ] } },
  { id: 'LOG_DEVORADOR_SERIES', nombre: 'Devorador de series', rareza: 'raro', exp: 200, clase: 'serie',
    descripcion: '50 series terminadas.', umbral: '≥ 50 series con estado=terminado',
    condicion_json: { match: 'all', filtros: [
      { op: 'count_where', sobre: 'obra',
        donde: [{ campo: 'obra.categoria', op: '=', valor: 'serie' }, { campo: 'entrada.estado', op: '=', valor: 'terminado' }],
        comparar: { op: '>=', valor: 50 } } ] } },
  { id: 'LOG_INTERNACIONAL', nombre: 'Sin fronteras', rareza: 'raro', exp: 200, clase: 'diversidad',
    descripcion: 'La mitad del archivo en idioma distinto al base.', umbral: 'MET_PCT_INTERNACIONAL ≥ 50',
    condicion_json: M('MET_PCT_INTERNACIONAL', 50) },
  { id: 'LOG_ANIVERSARIO', nombre: 'Un año contigo', rareza: 'raro', exp: 200, clase: 'general',
    descripcion: 'Un año de archivo con actividad continua.', umbral: 'MET_ANIOS_ARCHIVO ≥ 1',
    condicion_json: M('MET_ANIOS_ARCHIVO', 1) },
  { id: 'LOG_CANON_NACE', nombre: 'Nace el canon', rareza: 'raro', exp: 150, clase: 'general',
    descripcion: 'Tu primer MomentoCanon destacado.', umbral: 'MET_MOMENTOS_CANON_DESTACADOS ≥ 1',
    condicion_json: M('MET_MOMENTOS_CANON_DESTACADOS', 1) },
  { id: 'LOG_RITMO_FIRME', nombre: 'Ritmo firme', rareza: 'comun', exp: 150, clase: 'general',
    descripcion: '6 meses con ≥ 10 entradas cada uno.', umbral: 'MET_RITMO_MENSUAL ≥ 10 · 6 meses',
    condicion_json: { match: 'all', filtros: [
      { op: 'count_where', sobre: 'mes', donde: [{ campo: 'agg.num_entradas_mes', op: '>=', valor: 10 }],
        comparar: { op: '>=', valor: 6 } } ] } },
  { id: 'LOG_AUTOR_CABECERA', nombre: 'Autor de cabecera', rareza: 'comun', exp: 120, clase: 'general',
    descripcion: '10 obras del mismo creador.', umbral: '≥ 10 obras de un mismo obra_creador',
    condicion_json: { match: 'all', filtros: [
      { op: 'existe', sobre: 'obra_creador', agrupar_por: 'persona_id', comparar: { op: '>=', valor: 10 } } ] } },
  { id: 'LOG_EXPERIENCIAS', nombre: 'Fuera de casa', rareza: 'comun', exp: 120, clase: 'ocio',
    descripcion: '10 experiencias de ocio libre.', umbral: 'MET_OBRAS_POR_CATEGORIA[ocio_libre] ≥ 10',
    condicion_json: M('MET_OBRAS_POR_CATEGORIA', 10, { categoria: 'ocio_libre' }) },
  { id: 'LOG_COMIC_ADICTO', nombre: 'Devorador de viñetas', rareza: 'comun', exp: 120, clase: 'comic',
    descripcion: '50 cómics.', umbral: 'MET_OBRAS_POR_CATEGORIA[comic] ≥ 50',
    condicion_json: M('MET_OBRAS_POR_CATEGORIA', 50, { categoria: 'comic' }) },
  { id: 'LOG_CRITICO', nombre: 'Crítico exigente', rareza: 'comun', exp: 100, clase: 'general',
    descripcion: '50 obras con valoración puesta.', umbral: '≥ 50 obras valoradas',
    condicion_json: { match: 'all', filtros: [
      { op: 'count_where', sobre: 'obra', donde: [{ campo: 'entrada.valoracion', op: '!=', valor: null }],
        comparar: { op: '>=', valor: 50 } } ] } },
  { id: 'LOG_PRIMER_PASO', nombre: 'Primer paso', rareza: 'comun', exp: 50, clase: 'general',
    descripcion: 'Registra tu primera entrada.', umbral: 'MET_ENTRADAS_TOTALES ≥ 1',
    condicion_json: M('MET_ENTRADAS_TOTALES', 1) }
];

// ── 20 TÍTULOS (logros-rpg.md §7) — espejo exhibible, sin EXP ─────────────────
export const TITULOS = [
  { id: 'TIT_ALMA_INQUIETA', nombre: 'Alma inquieta', rareza: 'legendario',
    descripcion: 'Índice de Diversidad ≥ 80.', umbral: 'MET_INDICE_DIVERSIDAD ≥ 80',
    condicion_json: M('MET_INDICE_DIVERSIDAD', 80) },
  { id: 'TIT_CIUDADANO_MUNDO', nombre: 'Ciudadano del mundo', rareza: 'legendario',
    descripcion: 'Diversidad de países ≥ 80.', umbral: 'MET_DIV_PAIS ≥ 80',
    condicion_json: M('MET_DIV_PAIS', 80) },
  { id: 'TIT_INCOMBUSTIBLE', nombre: 'Incombustible', rareza: 'legendario',
    descripcion: 'Racha de 100 días.', umbral: 'MET_RACHA_MAXIMA ≥ 100',
    condicion_json: M('MET_RACHA_MAXIMA', 100) },
  { id: 'TIT_DECANO', nombre: 'Decano', rareza: 'legendario',
    descripcion: '5 años de archivo.', umbral: 'MET_ANIOS_ARCHIVO ≥ 5',
    condicion_json: M('MET_ANIOS_ARCHIVO', 5) },
  { id: 'TIT_CINEFILO', nombre: 'Cinéfilo', rareza: 'epico',
    descripcion: 'Tu clase principal es el cine.', umbral: 'clase principal (por obra) = cine',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'pelicula' }) },
  { id: 'TIT_DEVORALIBROS', nombre: 'Devoralibros', rareza: 'epico',
    descripcion: 'Tu clase principal es el libro.', umbral: 'clase principal (por obra) = libro',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'libro' }) },
  { id: 'TIT_GAMER', nombre: 'Gamer', rareza: 'epico',
    descripcion: 'Tu clase principal es el videojuego.', umbral: 'clase principal (por obra) = juego',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'videojuego' }) },
  { id: 'TIT_GUARDIAN_CANON', nombre: 'Guardián del canon', rareza: 'epico',
    descripcion: '25 MomentoCanon registrados.', umbral: 'MET_MOMENTOS_CANON ≥ 25',
    condicion_json: M('MET_MOMENTOS_CANON', 25) },
  { id: 'TIT_MAESTRO_TIEMPO', nombre: 'Maestro del tiempo', rareza: 'epico',
    descripcion: 'Obras de 8 décadas distintas.', umbral: 'MET_DECADAS_DISTINTAS ≥ 8',
    condicion_json: M('MET_DECADAS_DISTINTAS', 8) },
  { id: 'TIT_SABIO', nombre: 'Sabio', rareza: 'epico',
    descripcion: 'Alcanza el nivel 20.', umbral: 'MET_NIVEL ≥ 20',
    condicion_json: M('MET_NIVEL', 20) },
  { id: 'TIT_FINISHER', nombre: 'El que acaba lo que empieza', rareza: 'epico',
    descripcion: 'Tasa de finalización ≥ 95 % con ≥ 100 obras.',
    umbral: 'MET_TASA_FINALIZACION ≥ 95 ∧ MET_OBRAS_TOTALES ≥ 100',
    condicion_json: { match: 'all', filtros: [
      { campo: 'metrica:MET_TASA_FINALIZACION', op: '>=', valor: 95 },
      { campo: 'metrica:MET_OBRAS_TOTALES', op: '>=', valor: 100 } ] } },
  { id: 'TIT_POLIGLOTA', nombre: 'Políglota', rareza: 'epico',
    descripcion: 'Obras en 15 idiomas.', umbral: 'MET_IDIOMAS_DISTINTOS ≥ 15',
    condicion_json: M('MET_IDIOMAS_DISTINTOS', 15) },
  { id: 'TIT_VETERANO', nombre: 'Veterano', rareza: 'epico',
    descripcion: '3 años de archivo.', umbral: 'MET_ANIOS_ARCHIVO ≥ 3',
    condicion_json: M('MET_ANIOS_ARCHIVO', 3) },
  { id: 'TIT_SERIEADICTO', nombre: 'Serieadicto', rareza: 'raro',
    descripcion: 'Tu clase principal es la serie.', umbral: 'clase principal (por obra) = serie',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'serie' }) },
  { id: 'TIT_VINETISTA', nombre: 'Viñetista', rareza: 'raro',
    descripcion: 'Tu clase principal es el cómic.', umbral: 'clase principal (por obra) = cómic',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'comic' }) },
  { id: 'TIT_EXPLORADOR', nombre: 'Explorador', rareza: 'raro',
    descripcion: 'Tu clase principal es el ocio libre.', umbral: 'clase principal (por obra) = ocio libre',
    condicion_json: M('MET_ES_CLASE_PRINCIPAL', 1, { categoria: 'ocio_libre' }) },
  { id: 'TIT_CRITICO', nombre: 'Crítico', rareza: 'raro',
    descripcion: '200 obras valoradas.', umbral: '≥ 200 obras valoradas',
    condicion_json: { match: 'all', filtros: [
      { op: 'count_where', sobre: 'obra', donde: [{ campo: 'entrada.valoracion', op: '!=', valor: null }],
        comparar: { op: '>=', valor: 200 } } ] } },
  { id: 'TIT_ROMANTICO', nombre: 'Romántico', rareza: 'raro',
    descripcion: 'Impacto emocional medio ≥ 8 con ≥ 50 obras.',
    umbral: 'avg(impacto_emocional) ≥ 8 · ≥ 50 obras',
    condicion_json: { match: 'all', filtros: [
      { campo: 'metrica:MET_IMPACTO_MEDIO', op: '>=', valor: 8 },
      { op: 'count_where', sobre: 'entrada', donde: [{ campo: 'entrada.impacto_emocional', op: '!=', valor: null }],
        comparar: { op: '>=', valor: 50 } } ] } },
  { id: 'TIT_ARQUITECTO', nombre: 'Arquitecto del dato', rareza: 'raro',
    descripcion: '100 obras bien documentadas (año + género + tu nota).', umbral: 'MET_OBRAS_COMPLETAS ≥ 100',
    condicion_json: M('MET_OBRAS_COMPLETAS', 100) },
  { id: 'TIT_COLECCIONISTA', nombre: 'Coleccionista', rareza: 'raro',
    descripcion: '25 colecciones creadas.', umbral: 'MET_COLECCIONES_CREADAS ≥ 25',
    condicion_json: M('MET_COLECCIONES_CREADAS', 25) }
];

// ── Hitos (logros-rpg.md §8) — escaleras numéricas sobre una métrica ──────────
// Cada escalón es un umbral; el "nivel de hito" = nº de escalones superados. Solo escaleras cuya
// métrica está implementada (racha diferida → su escalera queda fuera por ahora).
export const HITOS = [
  { id: 'HITO_HORAS', nombre: 'Horas', metrica: 'MET_HORAS_TOTALES', escalones: [10, 50, 100, 500, 1000, 5000] },
  { id: 'HITO_OBRAS', nombre: 'Obras', metrica: 'MET_OBRAS_TOTALES', escalones: [10, 50, 100, 250, 500, 1000] },
  { id: 'HITO_DIVERSIDAD', nombre: 'Diversidad', metrica: 'MET_INDICE_DIVERSIDAD', escalones: [40, 55, 70, 85] },
  { id: 'HITO_PAISES', nombre: 'Países', metrica: 'MET_PAISES_DISTINTOS', escalones: [5, 10, 20, 40] },
  { id: 'HITO_CREADORES', nombre: 'Creadores', metrica: 'MET_CREADORES_DISTINTOS', escalones: [25, 50, 100, 250] }
];

export const ALL_RPG = [...LOGROS, ...TITULOS];

// Motivos legibles para los no-evaluables (para la UI y los informes).
export const MOTIVO = {
  racha: 'racha de días — métrica diferida (V1-S5)',
  antiguedad: 'antigüedad/continuidad del archivo — métrica no catalogada (V1-S5)',
  clase: 'clase principal — deriva de EXP (progresión no construida)',
  nivel: 'nivel — deriva de EXP (progresión no construida)',
  momentos: 'requiere registrar MomentoCanon (sistema de Momentos no construido)',
  colecciones: 'conteo de colecciones — fuera del espacio obra/entrada de la gramática',
  campos_ricos: '"campos ricos completos" — sin definición formal aún'
};
