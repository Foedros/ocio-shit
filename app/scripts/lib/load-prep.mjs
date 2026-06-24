// PURE transformation for the Supabase initial load (the MÁXIMO RIESGO step). Takes the
// canonical export.json + the owner uid, returns FK-ordered insert batches ready for
// node-postgres — testable OFFLINE against the real archive so the transform is verified
// before a single row touches the cloud (dry-run mental, per the sprint brief).
//
// Rules (mirror io.js + tecnico.md §3.3/§3.5):
//   · FK-safe order = io.js TABLE_MANIFEST (parents before children).
//   · GENERATED columns are NEVER written (Postgres recomputes them): obra.clave_dedup,
//     entrada.es_reconsumo. Excluded here exactly as io.js excludes them via table_xinfo.
//   · metadata: stored as a JSON *string* in export.json → parsed to an OBJECT so node-postgres
//     serializes it to proper jsonb (passing the raw string would double-encode it and break
//     metadata->>'origen'). null stays null.
//   · owner_id stamped EXPLICITLY on every row (the load uses the secret key, where auth.uid()
//     is null, so the column DEFAULT can't apply — tecnico.md §3.2.sec note).

import { TABLE_MANIFEST } from '../../src/lib/db/io.js';

// Generated columns per table — present in export.json, must be excluded from INSERT.
const GENERATED = { obra: new Set(['clave_dedup']), entrada: new Set(['es_reconsumo']) };
// jsonb columns whose export value is a JSON string needing a parse to an object.
const JSONB = { obra: new Set(['metadata']), entrada: new Set(['metadata']) };

function parseMaybeJson(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v; // leave as-is; the load will surface a type error rather than silently corrupt
    }
  }
  return v; // already an object
}

/**
 * @param {object} data parsed export.json
 * @param {string} ownerId uuid of the single auth user
 * @returns {Array<{ table:string, columns:string[], rows:any[][], count:number }>} FK-ordered
 */
export function prepareLoad(data, ownerId) {
  if (!ownerId || typeof ownerId !== 'string') throw new Error('prepareLoad: ownerId (uuid) requerido');
  const batches = [];

  for (const { key, table } of TABLE_MANIFEST) {
    const rows = data[key];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const generated = GENERATED[table] || new Set();
    const jsonbCols = JSONB[table] || new Set();

    // Column set = union of all row keys minus generated, plus owner_id. Deterministic order.
    const colSet = new Set();
    for (const r of rows) for (const k of Object.keys(r)) if (!generated.has(k)) colSet.add(k);
    colSet.add('owner_id');
    const columns = [...colSet];

    const outRows = rows.map((r) =>
      columns.map((c) => {
        if (c === 'owner_id') return ownerId;
        const v = r[c];
        if (jsonbCols.has(c)) return parseMaybeJson(v);
        return v === undefined ? null : v;
      })
    );

    batches.push({ table, columns, rows: outRows, count: outRows.length });
  }

  return batches;
}
