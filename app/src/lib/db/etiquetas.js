// Etiquetas: manual + the deterministic LOCAL rules (etiquetas.md §5). No network, no LLM.
//   R1 — direct derivation from structured Obra fields (decada / idioma / pais). Deterministic.
//   R2 — map OFFICIAL genres from fuente_externa. The corpus's fuente_externa is
//        filmaffinity:slug / steam:id (no genre payload), so R2 is a no-op here until a
//        genre-bearing source exists. R3/R4 (LLM) are Sprint 9 — NOT here.
function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function slugify(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (ASCII slug, modelo §6)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function upsertEtiqueta(adapter, nombre, taxonomia, origen) {
  const existing = adapter.get('SELECT id FROM etiqueta WHERE nombre = ?', [nombre]);
  if (existing) return existing.id;
  const id = uuid();
  adapter.run('INSERT INTO etiqueta (id, nombre, taxonomia, origen) VALUES (?, ?, ?, ?)', [id, nombre, taxonomia, origen]);
  return id;
}

/** R1 — derive decada / idioma / pais tags from Obra columns and link them. Idempotent. */
export function applyR1(adapter) {
  adapter.exec('BEGIN IMMEDIATE');
  try {
    let tags = 0;
    let links = 0;
    const link = (etqId, whereCol, value) => {
      const before = adapter.get('SELECT COUNT(*) n FROM obra_etiqueta WHERE etiqueta_id = ?', [etqId]).n;
      adapter.run(
        `INSERT OR IGNORE INTO obra_etiqueta (obra_id, etiqueta_id) SELECT id, ? FROM obra WHERE ${whereCol} = ?`,
        [etqId, value]
      );
      links += adapter.get('SELECT COUNT(*) n FROM obra_etiqueta WHERE etiqueta_id = ?', [etqId]).n - before;
    };

    for (const { decada } of adapter.all('SELECT DISTINCT decada FROM obra WHERE decada IS NOT NULL')) {
      const id = upsertEtiqueta(adapter, `decada-${decada}s`, 'meta', 'ia');
      tags++;
      link(id, 'decada', decada);
    }
    for (const { idioma_original } of adapter.all('SELECT DISTINCT idioma_original FROM obra WHERE idioma_original IS NOT NULL')) {
      const id = upsertEtiqueta(adapter, `idioma-${slugify(idioma_original)}`, 'meta', 'ia');
      tags++;
      link(id, 'idioma_original', idioma_original);
    }
    for (const { pais_origen } of adapter.all('SELECT DISTINCT pais_origen FROM obra WHERE pais_origen IS NOT NULL')) {
      const id = upsertEtiqueta(adapter, `pais-${slugify(pais_origen)}`, 'meta', 'ia');
      tags++;
      link(id, 'pais_origen', pais_origen);
    }
    adapter.exec('COMMIT');
    return { tags, links, rule: 'R1' };
  } catch (err) {
    try {
      adapter.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** R2 — map official genres from an external source. No genre-bearing source in this corpus. */
export function applyR2() {
  return { tags: 0, links: 0, rule: 'R2', note: 'sin fuente de géneros externa en el corpus' };
}

// --- Manual tagging --------------------------------------------------------------------
const TAXONOMIAS = ['genero', 'tema', 'tono', 'tecnica', 'meta'];

export function createEtiquetaManual(adapter, { nombre, taxonomia = 'meta', color = null }) {
  const slug = slugify(nombre);
  if (!slug) throw new Error('La etiqueta necesita un nombre.');
  if (!TAXONOMIAS.includes(taxonomia)) throw new Error(`taxonomía inválida: ${taxonomia}`);
  const existing = adapter.get('SELECT id FROM etiqueta WHERE nombre = ?', [slug]);
  if (existing) return existing.id;
  const id = uuid();
  adapter.run('INSERT INTO etiqueta (id, nombre, taxonomia, origen, color) VALUES (?, ?, ?, ?, ?)', [id, slug, taxonomia, 'manual', color]);
  return id;
}

export function tagObra(adapter, obraId, etiquetaId) {
  adapter.run('INSERT OR IGNORE INTO obra_etiqueta (obra_id, etiqueta_id) VALUES (?, ?)', [obraId, etiquetaId]);
  return { ok: true };
}
export function untagObra(adapter, obraId, etiquetaId) {
  adapter.run('DELETE FROM obra_etiqueta WHERE obra_id = ? AND etiqueta_id = ?', [obraId, etiquetaId]);
  return { ok: true };
}

export function listEtiquetas(adapter) {
  return adapter.all(
    `SELECT e.id, e.nombre, e.taxonomia, e.origen,
            (SELECT COUNT(*) FROM obra_etiqueta oe WHERE oe.etiqueta_id = e.id) AS n_obras
     FROM etiqueta e ORDER BY n_obras DESC, e.nombre`
  );
}
