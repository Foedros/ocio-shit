// Tanda 1 — the 25 starter collections (colecciones.md §6). Pure data: each `inteligente`
// carries a regla_json in the shared grammar; `ia` ones are placeholders (IA is Sprint 9).
// A builder so the year-relative and "favourite creator" rules resolve against real data.

export function buildTanda1({ year, favoritoPersonaId } = {}) {
  const y = year ?? 2026;
  const yStart = `${y}-01-01`;
  const yEnd = `${y}-12-31`;
  const INT = 'inteligente';

  const creadorFavorito = favoritoPersonaId
    ? { match: 'all', filtros: [{ campo: 'obra_creador', op: '=', valor: 'persona:' + favoritoPersonaId }] }
    : { match: 'all', filtros: [{ campo: 'obra_creador', op: '=', valor: 'persona:__none__' }] };

  return [
    { n: 1, key: 'el-canon', nombre: 'El Canon', tipo: INT, descripcion: 'Lo que define quién soy: obras con un momento canon destacado.',
      regla_json: { match: 'all', filtros: [{ campo: 'momento_canon', op: 'tiene', valor: 'destacado' }] } },
    { n: 2, key: 'obras-maestras', nombre: 'Obras maestras personales', tipo: INT, descripcion: 'Valoración media ≥ 9.',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.valoracion_media', op: '>=', valor: 9 }] } },
    { n: 3, key: 'lo-que-me-cambio', nombre: 'Lo que me cambió', tipo: INT, descripcion: 'Impacto emocional medio ≥ 9.',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.impacto_medio', op: '>=', valor: 9 }] } },
    { n: 4, key: 'revisitadas', nombre: 'Revisitadas', tipo: INT, descripcion: 'Obras que vuelvo a consumir.',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.num_reconsumos', op: '>', valor: 0 }] } },
    { n: 5, key: 'pendientes', nombre: 'Pendientes (backlog)', tipo: INT, descripcion: 'Por consumir.',
      regla_json: { match: 'all', filtros: [{ campo: 'entrada.estado', op: '=', valor: 'pendiente' }] } },
    { n: 6, key: 'abandonadas', nombre: 'Abandonadas', tipo: INT, descripcion: 'Lo que dejé a medias.',
      regla_json: { match: 'all', filtros: [{ campo: 'entrada.estado', op: '=', valor: 'abandonado' }] } },
    { n: 7, key: 'terminadas-anio', nombre: `Terminadas en ${y}`, tipo: INT, descripcion: 'Cerradas este año.',
      regla_json: { match: 'all', filtros: [{ campo: 'entrada.estado', op: '=', valor: 'terminado' }, { campo: 'agg.ultima_fecha', op: 'entre', valor: [yStart, yEnd] }] } },
    { n: 8, key: 'joyas-ocultas', nombre: 'Joyas ocultas', tipo: 'ia', descripcion: 'Nota alta y poco habladas. (IA — Sprint 9.)', semilla: 'nota alta + poca difusión' },
    { n: 9, key: 'decepciones', nombre: 'Decepciones', tipo: INT, descripcion: 'Valoración media ≤ 4.',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.valoracion_media', op: '<=', valor: 4 }] } },
    { n: 10, key: 'creador-favorito', nombre: 'Por mi creador favorito', tipo: INT, descripcion: 'Obras de la persona con más obras en el archivo.',
      regla_json: creadorFavorito },
    { n: 11, key: 'agujero-negro', nombre: 'El agujero negro: hábitos', tipo: INT, descripcion: 'Tiempo recurrente (LoL…).',
      regla_json: { match: 'all', filtros: [{ campo: 'entrada.clase_tiempo', op: '=', valor: 'habito' }] } },
    { n: 12, key: 'videojuegos-electivos', nombre: 'Videojuegos electivos', tipo: INT, descripcion: 'Juego elegido, no rutina.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'videojuego' }, { campo: 'entrada.clase_tiempo', op: '=', valor: 'electivo' }] } },
    { n: 13, key: 'cine-90', nombre: 'Cine de los 90', tipo: INT, descripcion: 'Películas de 1990–1999.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'pelicula' }, { campo: 'obra.decada', op: '=', valor: 1990 }] } },
    { n: 14, key: 'cine-contemporaneo', nombre: 'Cine contemporáneo', tipo: INT, descripcion: 'Películas de 2020 en adelante.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'pelicula' }, { campo: 'obra.decada', op: '>=', valor: 2020 }] } },
    { n: 15, key: 'series-terminadas', nombre: 'Series terminadas', tipo: INT, descripcion: 'Series que cerré.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'serie' }, { campo: 'entrada.estado', op: '=', valor: 'terminado' }] } },
    { n: 16, key: 'biblioteca-anio', nombre: `Biblioteca de ${y}`, tipo: INT, descripcion: 'Libros de este año.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'libro' }, { campo: 'agg.ultima_fecha', op: 'entre', valor: [yStart, yEnd] }] } },
    { n: 17, key: 'comics', nombre: 'Cómics', tipo: INT, descripcion: 'Todo el cómic.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'comic' }] } },
    { n: 18, key: 'experiencias', nombre: 'Experiencias (ocio libre)', tipo: INT, descripcion: 'Conciertos, museos, viajes…',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'ocio_libre' }] } },
    { n: 19, key: 'cine-internacional', nombre: 'Cine internacional', tipo: INT, descripcion: 'Películas en idioma distinto al base.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.categoria', op: '=', valor: 'pelicula' }, { campo: 'obra.idioma_original', op: '!=', valor: 'idioma_base' }] } },
    { n: 20, key: 'maratones', nombre: 'Maratones', tipo: INT, descripcion: '≥ 3 entradas de la obra en un mismo día.',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.max_entradas_por_dia', op: '>=', valor: 3 }] } },
    { n: 21, key: 'top-decada', nombre: 'Top por década', tipo: 'ia', descripcion: 'La mejor obra de cada década. (IA — Sprint 9.)', semilla: 'mejor obra por década' },
    { n: 22, key: 'comfort', nombre: 'Comfort', tipo: INT, descripcion: 'Etiquetadas como comfort.',
      regla_json: { match: 'all', filtros: [{ campo: 'etiqueta', op: 'tiene', valor: 'comfort' }] } },
    { n: 23, key: 'recomendadas', nombre: 'Recomendadas por otros', tipo: INT, descripcion: 'Etiqueta recomendado-por-*.',
      regla_json: { match: 'all', filtros: [{ campo: 'etiqueta', op: 'tiene', valor: 'recomendado-por-*' }] } },
    { n: 24, key: 'sagas', nombre: 'Sagas y universos', tipo: INT, descripcion: 'Obras con saga.',
      regla_json: { match: 'all', filtros: [{ campo: 'obra.saga', op: '!=', valor: null }] } },
    { n: 25, key: 'genesis-2023', nombre: 'Génesis 2023', tipo: INT, descripcion: 'Las primeras del archivo (2023).',
      regla_json: { match: 'all', filtros: [{ campo: 'agg.primera_fecha', op: 'entre', valor: ['2023-01-01', '2023-12-31'] }] } }
  ];
}

// Demo logro conditions (logros-rpg.md §5) — proof the SAME compiler serves logros/Wrapped.
export const DEMO_CONDICIONES = {
  LOG_DESPIERTO: {
    match: 'all',
    filtros: [
      { campo: 'metrica:MET_PCT_HABITO', op: '<', valor: 30 },
      { campo: 'metrica:MET_HORAS_ELECTIVAS', op: '>=', valor: 1000 }
    ]
  },
  LOG_EMOCIONADO: {
    match: 'all',
    filtros: [{ op: 'count_where', sobre: 'entrada', donde: [{ campo: 'entrada.impacto_emocional', op: '>=', valor: 9 }], comparar: { op: '>=', valor: 10 } }]
  },
  LOG_AUTOR_CABECERA: {
    match: 'all',
    filtros: [{ op: 'existe', sobre: 'obra_creador', agrupar_por: 'persona_id', comparar: { op: '>=', valor: 10 } }]
  },
  LOG_RITMO_FIRME: {
    match: 'all',
    filtros: [{ op: 'count_where', sobre: 'mes', donde: [{ campo: 'agg.num_entradas_mes', op: '>=', valor: 10 }], comparar: { op: '>=', valor: 6 } }]
  },
  LOG_DEVORADOR_SERIES: {
    match: 'all',
    filtros: [{ op: 'count_where', sobre: 'obra', donde: [{ campo: 'obra.categoria', op: '=', valor: 'serie' }, { campo: 'entrada.estado', op: '=', valor: 'terminado' }], comparar: { op: '>=', valor: 50 } }]
  },
  LOG_CINEFILO_500: {
    match: 'all',
    filtros: [{ campo: 'metrica:MET_TIEMPO_POR_CATEGORIA', param: { categoria: 'pelicula' }, op: '>=', valor: 500 }]
  }
};
