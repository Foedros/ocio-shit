// Shared, engine-agnostic DB import/export for Ocio Shit.
//
// This is the single source of truth for how `export.json` (the DURABLE truth, per
// tecnico.md §3.2) maps to and from the SQLite schema. It is deliberately pure: it takes
// a tiny `adapter` and works identically against the OO1/OPFS-SAH-pool DB in the browser
// worker AND against node:sqlite in the CI round-trip test. One implementation, tested
// where it is cheap, run where it matters — so the reconstruction path can never silently
// diverge from what the test proves.
//
// Adapter contract (3 methods):
//   adapter.exec(sql)            -> run one or more statements, ignore results
//   adapter.all(sql)             -> Array<Object> rows for a SELECT/PRAGMA
//   adapter.runMany(sql, rows)   -> prepared INSERT executed once per row (rows: Array<Array>)

// key (export.json) -> table (SQLite). The ARRAY ORDER is the FK-safe insert order:
// parents before children, junctions/unlocks last.
export const TABLE_MANIFEST = [
  { key: 'personas', table: 'persona' },
  { key: 'plataformas', table: 'plataforma' },
  { key: 'etapas', table: 'etapa' },
  { key: 'obras', table: 'obra' },
  { key: 'entradas', table: 'entrada' },
  { key: 'etiquetas', table: 'etiqueta' },
  { key: 'colecciones', table: 'coleccion' },
  { key: 'logros', table: 'logro' },
  { key: 'titulos', table: 'titulo' },
  { key: 'obra_creador', table: 'obra_creador' },
  { key: 'obra_etiqueta', table: 'obra_etiqueta' },
  { key: 'entrada_etiqueta', table: 'entrada_etiqueta' },
  { key: 'obra_coleccion', table: 'obra_coleccion' },
  { key: 'entrada_acompanante', table: 'entrada_acompanante' },
  { key: 'momentos_canon', table: 'momento_canon' },
  { key: 'logros_desbloqueados', table: 'logro_desbloqueado' },
  { key: 'titulos_desbloqueados', table: 'titulo_desbloqueado' }
];

// Export key order = the familiar order produced by the Fase 4 migration.
export const EXPORT_ORDER = [
  'obras',
  'entradas',
  'personas',
  'obra_creador',
  'plataformas',
  'etapas',
  'etiquetas',
  'colecciones',
  'logros',
  'titulos',
  'momentos_canon',
  'obra_etiqueta',
  'entrada_etiqueta',
  'obra_coleccion',
  'entrada_acompanante',
  'logros_desbloqueados',
  'titulos_desbloqueados'
];

// The four populated tables that define "no data loss". Used by every verification.
export const VERIFY_TABLES = ['obra', 'entrada', 'persona', 'obra_creador'];

const KEY_TO_TABLE = Object.fromEntries(TABLE_MANIFEST.map((m) => [m.key, m.table]));

/** Apply the canonical DDL to a fresh DB. */
export function applySchema(adapter, schemaSql) {
  adapter.exec(schemaSql);
}

/** True once the core schema exists (used to decide "OPFS empty -> reconstruct"). */
export function isInitialized(adapter) {
  const rows = adapter.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='obra'"
  );
  return rows.length > 0;
}

// Columns we may INSERT into: everything except GENERATED columns. table_xinfo.hidden:
// 0 = ordinary (insertable), 1 = hidden, 2 = virtual generated, 3 = stored generated.
function insertableColumns(adapter, table) {
  const cols = adapter.all(`PRAGMA table_xinfo(${table})`);
  return cols.filter((c) => Number(c.hidden) === 0).map((c) => c.name);
}

/**
 * Import every table present in `data` into the DB, in FK-safe order, inside one
 * transaction (all-or-nothing). Generated columns are never written.
 */
export function importAll(adapter, data, { transaction = true } = {}) {
  if (transaction) adapter.exec('BEGIN');
  try {
    for (const { key, table } of TABLE_MANIFEST) {
      const rows = data[key];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const cols = insertableColumns(adapter, table);
      const sql =
        `INSERT INTO ${table} (${cols.join(', ')}) ` +
        `VALUES (${cols.map(() => '?').join(', ')})`;
      const paramRows = rows.map((r) =>
        cols.map((c) => (r[c] === undefined ? null : r[c]))
      );
      adapter.runMany(sql, paramRows);
    }
    if (transaction) adapter.exec('COMMIT');
  } catch (err) {
    if (transaction) {
      try {
        adapter.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/** Apply schema + import into a fresh, empty DB. */
export function loadFresh(adapter, schemaSql, data) {
  applySchema(adapter, schemaSql);
  importAll(adapter, data);
}

/** Serialize the whole DB to the canonical export.json shape. */
export function exportAll(adapter, { schemaVersion = 2, exportadoEn = null } = {}) {
  const out = { schema_version: schemaVersion, exportado_en: exportadoEn };
  for (const key of EXPORT_ORDER) {
    const table = KEY_TO_TABLE[key];
    out[key] = adapter.all(`SELECT * FROM ${table}`);
  }
  return out;
}

/** Row counts for every known table. */
export function counts(adapter) {
  const out = {};
  for (const { table } of TABLE_MANIFEST) {
    out[table] = adapter.all(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
  }
  return out;
}

/** PRAGMA integrity_check, normalized to { ok, detail }. */
export function integrityCheck(adapter) {
  const rows = adapter.all('PRAGMA integrity_check');
  const val = rows.length ? rows[0].integrity_check ?? Object.values(rows[0])[0] : '(empty)';
  return { ok: val === 'ok', detail: val };
}

/** PRAGMA foreign_key_check -> number of violations. */
export function foreignKeyViolations(adapter) {
  return adapter.all('PRAGMA foreign_key_check').length;
}

/** schema_version stored in meta. */
export function schemaVersion(adapter) {
  const rows = adapter.all("SELECT valor FROM meta WHERE clave='schema_version'");
  return rows.length ? Number(rows[0].valor) : null;
}
