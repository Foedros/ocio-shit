// Collections: CRUD + materialization via the shared predicate compiler. Pure, adapter-based
// (same contract as queries.js / io.js). A collection is a set of OBRAS (obra_coleccion).
import { compileCollectionRule } from '../predicates/compiler.js';
import { buildTanda1 } from '../predicates/tanda1.js';

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Backfill `decada` (a DERIVED field, modelo §6: floor(anio_obra/10)*10) where it is null
 * but `anio_obra` is present. The Fase 4 FA import set anio_obra without deriving decada, so
 * decade-based collections/metrics were empty. Deterministic + idempotent. @returns {updated}
 */
export function deriveDecadas(adapter) {
  const before = adapter.get('SELECT COUNT(*) n FROM obra WHERE decada IS NULL AND anio_obra IS NOT NULL').n;
  if (before > 0) {
    adapter.run('UPDATE obra SET decada = (anio_obra / 10) * 10 WHERE decada IS NULL AND anio_obra IS NOT NULL');
  }
  return { updated: before };
}

/** All collections with their materialized obra count. */
export function listColecciones(adapter) {
  return adapter.all(
    `SELECT c.id, c.nombre, c.descripcion, c.tipo, c.regla_json, c.portada_uri,
            (SELECT COUNT(*) FROM obra_coleccion oc WHERE oc.coleccion_id = c.id) AS n_obras
     FROM coleccion c
     ORDER BY (c.tipo = 'ia'), c.nombre`
  );
}

/** A collection + its obras (with a per-obra rating + entry count for display). */
export function getColeccion(adapter, coleccionId) {
  const c = adapter.get('SELECT * FROM coleccion WHERE id = ?', [coleccionId]);
  if (!c) return null;
  const obras = adapter.all(
    `SELECT o.id AS obra_id, o.titulo, o.categoria, o.anio_obra,
            (SELECT COUNT(*) FROM entrada e WHERE e.obra_id = o.id) AS n_entradas,
            (SELECT AVG(e.valoracion) FROM entrada e WHERE e.obra_id = o.id) AS valoracion_media
     FROM obra_coleccion oc JOIN obra o ON o.id = oc.obra_id
     WHERE oc.coleccion_id = ?
     ORDER BY valoracion_media DESC NULLS LAST, o.titulo ASC
     LIMIT 6000`,
    [coleccionId]
  );
  return { coleccion: c, obras };
}

export function createColeccion(adapter, { nombre, descripcion, tipo, regla_json }) {
  if (!nombre || !String(nombre).trim()) throw new Error('La colección necesita un nombre.');
  if (!['manual', 'inteligente', 'ia'].includes(tipo)) throw new Error(`tipo inválido: ${tipo}`);
  const id = uuid();
  adapter.run('INSERT INTO coleccion (id, nombre, descripcion, tipo, regla_json) VALUES (?, ?, ?, ?, ?)', [
    id,
    String(nombre).trim(),
    descripcion ?? null,
    tipo,
    regla_json ? JSON.stringify(regla_json) : null
  ]);
  return id;
}

export function deleteColeccion(adapter, coleccionId) {
  adapter.run('DELETE FROM coleccion WHERE id = ?', [coleccionId]); // cascades obra_coleccion
  return { deleted: true };
}

// Recompute membership of an inteligente collection (no own transaction — caller wraps).
function runMaterialize(adapter, coleccionId, rule, opts) {
  const { sql, params } = compileCollectionRule(rule, opts);
  const ids = adapter.all(sql, params).map((r) => r.id);
  adapter.run('DELETE FROM obra_coleccion WHERE coleccion_id = ?', [coleccionId]);
  if (ids.length) {
    adapter.runMany(
      'INSERT OR IGNORE INTO obra_coleccion (obra_id, coleccion_id) VALUES (?, ?)',
      ids.map((oid) => [oid, coleccionId])
    );
  }
  return ids.length;
}

/** Materialize one inteligente collection (own transaction). */
export function materializeColeccion(adapter, coleccionId, opts = {}) {
  const c = adapter.get('SELECT tipo, regla_json FROM coleccion WHERE id = ?', [coleccionId]);
  if (!c || c.tipo !== 'inteligente' || !c.regla_json) return { materialized: 0 };
  const rule = JSON.parse(c.regla_json);
  adapter.exec('BEGIN IMMEDIATE');
  try {
    const n = runMaterialize(adapter, coleccionId, rule, opts);
    adapter.exec('COMMIT');
    return { materialized: n };
  } catch (err) {
    try {
      adapter.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Seed the 25 Tanda 1 collections (idempotent by nombre) and materialize the inteligente
 * ones. One transaction. Resolves the favourite creator + current year from the live DB.
 */
export function seedTanda1(adapter, opts = {}) {
  const fav = adapter.get('SELECT persona_id FROM obra_creador GROUP BY persona_id ORDER BY COUNT(DISTINCT obra_id) DESC LIMIT 1');
  const year = opts.year ?? new Date().getFullYear();
  const defs = buildTanda1({ year, favoritoPersonaId: fav?.persona_id });
  const compileOpts = { idiomaBase: opts.idiomaBase ?? 'es' };

  adapter.exec('BEGIN IMMEDIATE');
  try {
    let created = 0;
    let materialized = 0;
    for (const d of defs) {
      const existing = adapter.get('SELECT id FROM coleccion WHERE nombre = ?', [d.nombre]);
      let id;
      if (existing) {
        id = existing.id;
        adapter.run('UPDATE coleccion SET descripcion = ?, tipo = ?, regla_json = ? WHERE id = ?', [
          d.descripcion ?? null,
          d.tipo,
          d.regla_json ? JSON.stringify(d.regla_json) : null,
          id
        ]);
      } else {
        id = uuid();
        adapter.run('INSERT INTO coleccion (id, nombre, descripcion, tipo, regla_json) VALUES (?, ?, ?, ?, ?)', [
          id,
          d.nombre,
          d.descripcion ?? null,
          d.tipo,
          d.regla_json ? JSON.stringify(d.regla_json) : null
        ]);
        created++;
      }
      if (d.tipo === 'inteligente') materialized += runMaterialize(adapter, id, d.regla_json, compileOpts);
    }
    adapter.exec('COMMIT');
    return { created, materialized, total: defs.length };
  } catch (err) {
    try {
      adapter.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** Re-materialize all inteligente collections (e.g. after data changes). One transaction. */
export function rematerializeAll(adapter, opts = {}) {
  const compileOpts = { idiomaBase: opts.idiomaBase ?? 'es' };
  const cols = adapter.all("SELECT id, regla_json FROM coleccion WHERE tipo = 'inteligente' AND regla_json IS NOT NULL");
  adapter.exec('BEGIN IMMEDIATE');
  try {
    let n = 0;
    for (const c of cols) n += runMaterialize(adapter, c.id, JSON.parse(c.regla_json), compileOpts);
    adapter.exec('COMMIT');
    return { collections: cols.length, members: n };
  } catch (err) {
    try {
      adapter.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}
