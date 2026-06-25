// Browser data layer over Supabase (Stage 3). Replaces the SQLite-WASM worker as the app's
// data source. Uses ONLY the PUBLISHABLE key (PUBLIC_*, baked by prepare-assets) — the secret
// never reaches the client. RLS scopes every read/write to the authenticated owner.
//
// Reads: PostgREST query-builder, mapped to the SAME row shapes the UI already consumes (so the
// screens/components from Sprints 2–3 are untouched). Writes + aggregate reads: the SECURITY
// INVOKER RPCs in supabase/functions.sql (atomic dedup/num_reconsumo/A-07/cascade).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { compileCollectionRule } from '../predicates/compiler.js';
import { toPg } from './pg-dialect.js';
import { EXPORT_ORDER, TABLE_MANIFEST } from './io.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

// ── Auth (single user) ──────────────────────────────────────────────────────
export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}
export async function signOut() {
  await supabase.auth.signOut();
}
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_e, session) => cb(session));
}

// ── helpers ─────────────────────────────────────────────────────────────────
function fail(error, ctx) {
  if (error) throw new Error(`${ctx}: ${error.message}`);
}
// entrada (+embedded obra +jsonb metadata) -> the flat shape queries.js produced.
function mapEntry(r) {
  return {
    entrada_id: r.id,
    obra_id: r.obra_id,
    titulo: r.obra?.titulo ?? null,
    categoria: r.obra?.categoria ?? null,
    fecha: r.fecha,
    estado: r.estado,
    valoracion: r.valoracion,
    num_reconsumo: r.num_reconsumo,
    duracion_min: r.duracion_min,
    origen: r.metadata?.origen ?? null,
    fecha_tipo: r.metadata?.fecha_tipo ?? null
  };
}
const ENTRY_SELECT = 'id, obra_id, fecha, estado, valoracion, num_reconsumo, duracion_min, metadata, obra!inner(titulo, categoria)';

// PostgREST caps every response at `max-rows` (1000 on Supabase). Paginate with .range() so the
// archive can hold all ~3.8k entries. buildQuery() must return a FRESH builder each page (builders
// are one-shot) with a DETERMINISTIC order (incl. an id tiebreak) so pages don't overlap/skip.
async function fetchAll(buildQuery, { max = 100000, page = 1000 } = {}) {
  const out = [];
  for (let from = 0; from < max; from += page) {
    const to = Math.min(from + page, max) - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────
export async function listEntries({ categoria, origen, fecha_tipo, search, limit = 6000 } = {}) {
  const build = () => {
    let q = supabase.from('entrada').select(ENTRY_SELECT);
    if (categoria) q = q.eq('obra.categoria', categoria);
    if (origen) q = q.eq('metadata->>origen', origen);
    if (fecha_tipo) q = q.eq('metadata->>fecha_tipo', fecha_tipo);
    if (search && search.trim()) q = q.ilike('obra.titulo', `%${search.trim().replace(/[%_]/g, (c) => '\\' + c)}%`);
    return q.order('fecha', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
  };
  return (await fetchAll(build, { max: limit })).map(mapEntry);
}

export async function getEntry(entradaId) {
  const { data, error } = await supabase.from('entrada').select(ENTRY_SELECT).eq('id', entradaId).maybeSingle();
  fail(error, 'getEntry');
  return data ? mapEntry(data) : null;
}

export async function getObra(obraId) {
  const { data: obra, error: e1 } = await supabase.from('obra').select('*').eq('id', obraId).maybeSingle();
  fail(e1, 'getObra');
  if (!obra) return null;
  const { data: ents, error: e2 } = await supabase
    .from('entrada')
    .select(ENTRY_SELECT)
    .eq('obra_id', obraId)
    .order('fecha', { ascending: false, nullsFirst: false });
  fail(e2, 'getObra.entradas');
  return { obra, entradas: ents.map(mapEntry) };
}

export async function filterOptions() {
  const { data, error } = await supabase.rpc('ocio_filter_options');
  fail(error, 'filterOptions');
  return { categorias: data.categorias ?? [], origenes: data.origenes ?? [], fecha_tipos: data.fecha_tipos ?? [] };
}

export async function counts() {
  const { data, error } = await supabase.rpc('ocio_counts');
  fail(error, 'counts');
  return data;
}

export async function status() {
  const c = await counts();
  return { vfs: 'supabase', initialized: true, integrity: { ok: true }, counts: c, foreignKeyViolations: 0 };
}

// Estadísticas (pantalla 06): TODOS los agregados server-side en una sola RPC (SECURITY INVOKER,
// la misma entropía verificada del re-diagnóstico). Solo lectura. La pantalla la consume tal cual.
export async function stats() {
  const { data, error } = await supabase.rpc('ocio_stats');
  fail(error, 'stats');
  return data;
}

// Timeline (pantalla 04): macro = volumen+mezcla por AÑO DE ENTRADA (rápido, una RPC); el detalle
// de un año (sus entradas, para agrupar por mes + clúster de votos) se pide al seleccionarlo.
export async function timelineMacro() {
  const { data, error } = await supabase.rpc('ocio_timeline_macro');
  fail(error, 'timelineMacro');
  return data;
}
export async function timelineYear(year) {
  const { data, error } = await supabase.rpc('ocio_timeline_year', { p_year: year });
  fail(error, 'timelineYear');
  return data;
}

export async function listColecciones() {
  const { data, error } = await supabase
    .from('coleccion')
    .select('id, nombre, descripcion, tipo, regla_json, portada_uri, obra_coleccion(count)');
  fail(error, 'listColecciones');
  return data
    .map(({ obra_coleccion, ...c }) => ({ ...c, n_obras: obra_coleccion?.[0]?.count ?? 0 }))
    .sort((a, b) => (a.tipo === 'ia') - (b.tipo === 'ia') || a.nombre.localeCompare(b.nombre));
}

export async function getColeccion(coleccionId) {
  const { data: coleccion, error: e1 } = await supabase.from('coleccion').select('*').eq('id', coleccionId).maybeSingle();
  fail(e1, 'getColeccion');
  if (!coleccion) return null;
  const rows = await fetchAll(
    () =>
      supabase
        .from('obra_coleccion')
        .select('obra(id, titulo, categoria, anio_obra, entrada(valoracion))')
        .eq('coleccion_id', coleccionId)
        .order('obra_id', { ascending: true }),
    { max: 6000 }
  );
  const obras = rows
    .map((r) => r.obra)
    .filter(Boolean)
    .map((o) => {
      const vals = (o.entrada || []).map((e) => e.valoracion).filter((v) => v != null);
      return {
        obra_id: o.id,
        titulo: o.titulo,
        categoria: o.categoria,
        anio_obra: o.anio_obra,
        n_entradas: (o.entrada || []).length,
        valoracion_media: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      };
    })
    .sort((a, b) => (b.valoracion_media ?? -1) - (a.valoracion_media ?? -1) || a.titulo.localeCompare(b.titulo));
  return { coleccion, obras };
}

// ── Writes (atomic RPCs) ────────────────────────────────────────────────────
export async function addEntry(payload) {
  const { data, error } = await supabase.rpc('ocio_add_entry', { p: payload });
  fail(error, 'addEntry');
  return {
    obraId: data.obra_id,
    entradaId: data.entrada_id,
    obraCreated: data.obra_created,
    numReconsumo: data.num_reconsumo,
    counts: await counts()
  };
}

export async function deleteEntry(entradaId) {
  const { data, error } = await supabase.rpc('ocio_delete_entry', { p_entrada_id: entradaId });
  fail(error, 'deleteEntry');
  return { deleted: data.deleted, obraDeleted: data.obra_deleted, obraId: data.obra_id, counts: await counts() };
}

// Editar una entrada existente (valoracion/nota/fecha/duracion_min). Reemplazo total de los 4
// campos editables; la RPC mantiene fecha_tipo y re-deriva num_reconsumo de la obra.
export async function updateEntry(entradaId, { valoracion, nota, fecha, duracion_min }) {
  const { data, error } = await supabase.rpc('ocio_update_entry', {
    p_entrada_id: entradaId,
    p_valoracion: valoracion ?? null,
    p_nota: nota ?? null,
    p_fecha: fecha ?? null,
    p_duracion_min: duracion_min ?? null
  });
  fail(error, 'updateEntry');
  return data; // { updated, obra_id, fecha_changed, duracion_changed, valoracion_changed }
}

// ── Colecciones (escritura) — el compilador CONSERVADO corre en el navegador y su SQL se ejecuta
//    server-side vía RPC SECURITY INVOKER (RLS). materialize/crear/recalcular/R1. ──────────────
export async function materializeColeccion(coleccionId, regla) {
  const { sql, params } = compileCollectionRule(regla, { idiomaBase: 'es' });
  const { text, values } = toPg({ sql, params });
  const { data, error } = await supabase.rpc('ocio_materialize_collection', {
    p_coleccion_id: coleccionId,
    p_sql: text,
    p_params: values
  });
  fail(error, 'materializeColeccion');
  return data; // nº de obras
}

export async function createColeccion(def) {
  const { data, error } = await supabase.rpc('ocio_create_collection', { p: def });
  fail(error, 'createColeccion');
  const id = data.id;
  if (def.tipo === 'inteligente' && def.regla_json) await materializeColeccion(id, def.regla_json);
  return id;
}

export async function rematerializeAll() {
  const cols = (await listColecciones()).filter((c) => c.tipo === 'inteligente' && c.regla_json);
  let members = 0;
  for (const c of cols) members += await materializeColeccion(c.id, JSON.parse(c.regla_json));
  return { collections: cols.length, members };
}

export async function deleteColeccion(id) {
  const { error } = await supabase.from('coleccion').delete().eq('id', id);
  fail(error, 'deleteColeccion');
}

export async function applyR1() {
  const { data, error } = await supabase.rpc('ocio_apply_r1');
  fail(error, 'applyR1');
  return data;
}

// ── Export portable (anti-lock-in) — saca TODO el archivo desde Supabase al MISMO formato
//    export.json, PAGINADO (sin truncar a 1000). owner_id se quita (artefacto RLS); metadata
//    vuelve a string JSON (igual que el formato canónico → round-trip a SQLite/otro Postgres). ──
const KEY_TO_TABLE = Object.fromEntries(TABLE_MANIFEST.map((m) => [m.key, m.table]));
const META_TABLES = new Set(['obra', 'entrada']);
// Stable order per table (PK columns) so .range() pagination never skips/duplicates.
const ORDER_COLS = {
  obra: ['id'], entrada: ['id'], persona: ['id'], plataforma: ['id'], etapa: ['id'],
  etiqueta: ['id'], coleccion: ['id'], logro: ['id'], titulo: ['id'],
  momento_canon: ['id'], logro_desbloqueado: ['id'], titulo_desbloqueado: ['id'],
  obra_creador: ['obra_id', 'persona_id', 'rol_credito'],
  obra_etiqueta: ['obra_id', 'etiqueta_id'], entrada_etiqueta: ['entrada_id', 'etiqueta_id'],
  obra_coleccion: ['obra_id', 'coleccion_id'], entrada_acompanante: ['entrada_id', 'persona_id']
};

export async function exportArchive() {
  const out = { schema_version: 2, exportado_en: new Date().toISOString() };
  for (const key of EXPORT_ORDER) {
    const table = KEY_TO_TABLE[key];
    const cols = ORDER_COLS[table] || ['id'];
    const rows = await fetchAll(() => {
      let q = supabase.from(table).select('*');
      for (const c of cols) q = q.order(c, { ascending: true });
      return q;
    });
    out[key] = rows.map((r) => {
      const { owner_id, ...rest } = r;
      if (META_TABLES.has(table) && rest.metadata != null && typeof rest.metadata === 'object') {
        rest.metadata = JSON.stringify(rest.metadata);
      }
      return rest;
    });
  }
  return out;
}
