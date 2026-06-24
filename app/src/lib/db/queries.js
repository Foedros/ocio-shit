// Shared, engine-agnostic archive queries for Sprint 2 (registro rápido + listado + detalle).
// Same adapter contract as io.js, so it runs identically in the OO1 worker and in the
// node:sqlite tests — the alta/dedup/filter logic is proven where it is cheap.

export const CATEGORIAS = ['pelicula', 'serie', 'libro', 'videojuego', 'comic', 'ocio_libre'];
export const ESTADOS = ['pendiente', 'en_curso', 'terminado', 'abandonado'];

export const CATEGORIA_LABELS = {
  pelicula: 'Película',
  serie: 'Serie',
  libro: 'Libro',
  videojuego: 'Videojuego',
  comic: 'Cómic',
  ocio_libre: 'Ocio libre'
};
export const ORIGEN_LABELS = { sheets: 'Primera mano', steam: 'Steam', filmaffinity: 'FilmAffinity' };
export const FECHA_TIPO_LABELS = { fecha_visionado: 'Visionado', fecha_voto: 'Voto (aprox.)' };

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Deterministic-enough fallback (node test path always has crypto.randomUUID).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Quick add: create an Entrada, reusing the matching Obra (clave_dedup) or creating it.
 * First-hand registration => metadata origen='sheets', fecha_tipo='fecha_visionado'
 * (modelo-datos §6.4). num_reconsumo auto-numbers from the obra's existing entradas.
 * Wrapped in one transaction (atomic).
 * @returns {{obraId:string, entradaId:string, obraCreated:boolean, numReconsumo:number}}
 */
export function addEntry(adapter, { obra = {}, entrada = {} } = {}) {
  const titulo = String(obra.titulo ?? '').trim();
  if (!titulo) throw new Error('El título es obligatorio.');
  const categoria = obra.categoria;
  if (!CATEGORIAS.includes(categoria)) throw new Error(`Categoría inválida: ${categoria}`);
  const anio =
    obra.anio_obra != null && obra.anio_obra !== '' ? Math.trunc(Number(obra.anio_obra)) : null;
  const estado = ESTADOS.includes(entrada.estado) ? entrada.estado : 'terminado';
  const valoracion =
    entrada.valoracion != null && entrada.valoracion !== '' ? Number(entrada.valoracion) : null;
  if (valoracion != null && (valoracion < 0 || valoracion > 10)) {
    throw new Error('La valoración debe estar entre 0 y 10.');
  }
  const fecha = entrada.fecha ? String(entrada.fecha) : null;
  const nota = entrada.nota ? String(entrada.nota) : null;

  adapter.exec('BEGIN IMMEDIATE');
  try {
    let obraId;
    let obraCreated = false;
    // Match the DB's generated clave_dedup EXACTLY. Two portability traps handled here:
    //   - lower(): use SQLite's (ASCII-only); a JS toLowerCase() would diverge on accents.
    //   - the year: node:sqlite binds JS numbers as REAL ("2026.0"), OO1 as INTEGER ("2026").
    //     CAST(? AS INTEGER) yields "2026" on both, matching the generated column's affinity.
    const existing = adapter.get(
      "SELECT id FROM obra WHERE clave_dedup = lower(?) || '|' || ? || '|' || coalesce(CAST(? AS INTEGER), '')",
      [titulo, categoria, anio]
    );
    if (existing) {
      obraId = existing.id;
    } else {
      obraId = uuid();
      adapter.run(
        'INSERT INTO obra (id, titulo, categoria, anio_obra, decada) VALUES (?, ?, ?, ?, ?)',
        [obraId, titulo, categoria, anio, anio != null ? Math.floor(anio / 10) * 10 : null]
      );
      obraCreated = true;
    }

    // num_reconsumo = how many entradas the obra already has (0 = first time).
    const numReconsumo = adapter.get('SELECT COUNT(*) AS c FROM entrada WHERE obra_id = ?', [obraId]).c;
    const entradaId = uuid();
    const metadata = JSON.stringify({ origen: 'sheets', fecha_tipo: 'fecha_visionado' });
    adapter.run(
      `INSERT INTO entrada
         (id, obra_id, fecha, estado, nota, valoracion, clase_tiempo, num_reconsumo, metadata)
       VALUES (?, ?, ?, ?, ?, ?, 'electivo', ?, ?)`,
      [entradaId, obraId, fecha, estado, nota, valoracion, numReconsumo, metadata]
    );

    adapter.exec('COMMIT');
    return { obraId, entradaId, obraCreated, numReconsumo };
  } catch (err) {
    try {
      adapter.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

const SELECT_ENTRY =
  `SELECT e.id AS entrada_id, e.obra_id, o.titulo, o.categoria, e.fecha, e.estado,
          e.valoracion, e.num_reconsumo,
          json_extract(e.metadata, '$.origen')     AS origen,
          json_extract(e.metadata, '$.fecha_tipo') AS fecha_tipo
   FROM entrada e JOIN obra o ON o.id = e.obra_id`;

/** Filtered list of entradas (joined with their obra). Returns minimal display rows. */
export function listEntries(adapter, { categoria, origen, fecha_tipo, search, limit = 6000 } = {}) {
  const where = [];
  const params = [];
  if (categoria) {
    where.push('o.categoria = ?');
    params.push(categoria);
  }
  if (origen) {
    where.push("json_extract(e.metadata, '$.origen') = ?");
    params.push(origen);
  }
  if (fecha_tipo) {
    where.push("json_extract(e.metadata, '$.fecha_tipo') = ?");
    params.push(fecha_tipo);
  }
  if (search && search.trim()) {
    // lower() on BOTH sides (SQLite's ASCII-only lower) so JS/SQLite casing can't diverge.
    where.push('lower(o.titulo) LIKE lower(?)');
    params.push('%' + search.trim() + '%');
  }
  const sql =
    `${SELECT_ENTRY}\n` +
    (where.length ? `WHERE ${where.join(' AND ')}\n` : '') +
    'ORDER BY (e.fecha IS NULL), e.fecha DESC, o.titulo ASC\nLIMIT ?';
  return adapter.all(sql, [...params, limit]);
}

/** Filtered list of obras with their entrada count. */
export function listObras(adapter, { categoria, search, limit = 6000 } = {}) {
  const where = [];
  const params = [];
  if (categoria) {
    where.push('o.categoria = ?');
    params.push(categoria);
  }
  if (search && search.trim()) {
    where.push('lower(o.titulo) LIKE lower(?)');
    params.push('%' + search.trim() + '%');
  }
  const sql =
    `SELECT o.id AS obra_id, o.titulo, o.categoria, o.anio_obra,
            (SELECT COUNT(*) FROM entrada e WHERE e.obra_id = o.id) AS n_entradas
     FROM obra o\n` +
    (where.length ? `WHERE ${where.join(' AND ')}\n` : '') +
    'ORDER BY o.titulo ASC\nLIMIT ?';
  return adapter.all(sql, [...params, limit]);
}

/** Full detail of one entrada + its obra. */
export function getEntry(adapter, entradaId) {
  return adapter.get(`${SELECT_ENTRY}\nWHERE e.id = ?`, [entradaId]);
}

/** Full detail of one obra + its entradas. */
export function getObra(adapter, obraId) {
  const obra = adapter.get('SELECT * FROM obra WHERE id = ?', [obraId]);
  if (!obra) return null;
  const entradas = adapter.all(`${SELECT_ENTRY}\nWHERE e.obra_id = ? ORDER BY (e.fecha IS NULL), e.fecha DESC`, [
    obraId
  ]);
  return { obra, entradas };
}

/** Distinct values for the filter dropdowns. */
export function filterOptions(adapter) {
  const col = (rows, k) => rows.map((r) => r[k]).filter((v) => v != null);
  return {
    categorias: col(
      adapter.all('SELECT DISTINCT categoria FROM obra WHERE categoria IS NOT NULL ORDER BY categoria'),
      'categoria'
    ),
    origenes: col(
      adapter.all("SELECT DISTINCT json_extract(metadata,'$.origen') AS v FROM entrada ORDER BY v"),
      'v'
    ),
    fecha_tipos: col(
      adapter.all("SELECT DISTINCT json_extract(metadata,'$.fecha_tipo') AS v FROM entrada ORDER BY v"),
      'v'
    )
  };
}
