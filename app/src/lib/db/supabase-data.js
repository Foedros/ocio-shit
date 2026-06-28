// Browser data layer over Supabase (Stage 3). Replaces the SQLite-WASM worker as the app's
// data source. Uses ONLY the PUBLISHABLE key (PUBLIC_*, baked by prepare-assets) — the secret
// never reaches the client. RLS scopes every read/write to the authenticated owner.
//
// Reads: PostgREST query-builder, mapped to the SAME row shapes the UI already consumes (so the
// screens/components from Sprints 2–3 are untouched). Writes + aggregate reads: the SECURITY
// INVOKER RPCs in supabase/functions.sql (atomic dedup/num_reconsumo/A-07/cascade).
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { compileCollectionRule, compileCondition, compileMeasure, progressRatio } from '../predicates/compiler.js';
import { ALL_RPG, MOTIVO } from '../predicates/logros-catalog.js';
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
// El user_metadata vive en el JWT de la sesión, que puede estar CADUCADO (un cambio out-of-band —
// p. ej. el nombre editado en otra sesión/dispositivo— no se refleja hasta que el token se refresca).
// getUser() lo trae FRESCO del servidor. Se usa al arrancar para que el nombre mostrado sea el actual.
export async function getFreshUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => cb(session, event));
}
// Nombre de display: se guarda en user_metadata (Auth), editable por el propio usuario con la clave
// publishable (updateUser sobre su propia sesión; no toca seguridad). Devuelve el user actualizado.
export async function setDisplayName(name) {
  const display_name = (name ?? '').trim();
  const { data, error } = await supabase.auth.updateUser({ data: { display_name } });
  if (error) throw new Error(error.message);
  return data.user;
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
    en_curso: !!r.obra?.en_curso, // serie en curso (nota provisional) — indicador, no afecta métricas
    origen: r.metadata?.origen ?? null,
    fecha_tipo: r.metadata?.fecha_tipo ?? null
  };
}
const ENTRY_SELECT = 'id, obra_id, fecha, estado, valoracion, num_reconsumo, duracion_min, metadata, obra!inner(titulo, categoria, en_curso)';

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
export async function listEntries({ categoria, origen, fecha_tipo, search, en_curso, limit = 6000 } = {}) {
  const build = () => {
    let q = supabase.from('entrada').select(ENTRY_SELECT);
    if (categoria) q = q.eq('obra.categoria', categoria);
    if (origen) q = q.eq('metadata->>origen', origen);
    if (fecha_tipo) q = q.eq('metadata->>fecha_tipo', fecha_tipo);
    if (en_curso) q = q.eq('obra.en_curso', true); // solo series que tengo a medias (para retomarlas)
    if (search && search.trim()) q = q.ilike('obra.titulo', `%${search.trim().replace(/[%_]/g, (c) => '\\' + c)}%`);
    return q.order('fecha', { ascending: false, nullsFirst: false }).order('id', { ascending: true });
  };
  return (await fetchAll(build, { max: limit })).map(mapEntry);
}

export async function getEntry(entradaId) {
  const { data, error } = await supabase.from('entrada').select(ENTRY_SELECT).eq('id', entradaId).maybeSingle();
  fail(error, 'getEntry');
  if (!data) return null;
  const m = mapEntry(data);
  const { data: canon } = await supabase.from('momento_canon').select('id').eq('entrada_id', entradaId).maybeSingle();
  m.es_canon = !!canon; // marca de momento canon (curación manual)
  return m;
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
  const { data: gens } = await supabase.from('obra_etiqueta').select('etiqueta(nombre, taxonomia)').eq('obra_id', obraId);
  const generos = (gens || []).map((g) => g.etiqueta).filter((e) => e && e.taxonomia === 'genero').map((e) => e.nombre);
  return { obra, entradas: ents.map(mapEntry), generos };
}

// Create-vs-link: detecta si ya existe una obra de este título+categoría (identidad = clave_dedup,
// que incluye el año). Devuelve sus metadatos para PRE-RELLENAR el form (confirmar/corregir, no a
// ciegas). Si hay año, casa por año exacto; si no, casa solo cuando hay UNA candidata (si hay varias
// de años distintos → ambiguo, el form pedirá el año). Lectura RLS-scoped (sin RPC nueva).
export async function lookupObra(titulo, categoria, anio) {
  const t = String(titulo || '').trim();
  if (!t || !categoria) return { exists: false };
  const esc = t.replace(/[\\%_]/g, (m) => '\\' + m); // ilike: escapa comodines % _ \
  const { data, error } = await supabase
    .from('obra')
    .select('id, titulo, anio_obra, creador, categoria')
    .eq('categoria', categoria)
    .ilike('titulo', esc)
    .limit(12);
  fail(error, 'lookupObra');
  const rows = data || [];
  const y = anio != null && anio !== '' ? Math.trunc(Number(anio)) : null;
  let match = null;
  if (y != null) match = rows.find((r) => r.anio_obra === y) || null;
  else if (rows.length === 1) match = rows[0];
  if (!match) return { exists: false, multiple: y == null && rows.length > 1 };
  const [{ data: gens }, { count }] = await Promise.all([
    supabase.from('obra_etiqueta').select('etiqueta(nombre, taxonomia)').eq('obra_id', match.id),
    supabase.from('entrada').select('id', { count: 'exact', head: true }).eq('obra_id', match.id)
  ]);
  const generos = (gens || []).map((g) => g.etiqueta).filter((e) => e && e.taxonomia === 'genero').map((e) => e.nombre);
  return { exists: true, obraId: match.id, titulo: match.titulo, anio_obra: match.anio_obra, creador: match.creador, generos, n_entradas: count ?? 0 };
}

// Slugs de género existentes (taxonomía 'genero') para el datalist del registro — el usuario elige
// de la taxonomía canónica (en español) en vez de inventar variantes.
export async function listGeneros() {
  const { data, error } = await supabase.from('etiqueta').select('nombre').eq('taxonomia', 'genero').order('nombre');
  fail(error, 'listGeneros');
  return (data || []).map((e) => e.nombre);
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

// Hall of Fame (03) + Hall of Shame (09): el panteón y su reverso en UNA RPC (Fame=top, Shame=bottom
// por nota_obra). Solo lectura, server-side. La pantalla la consume tal cual; se mueve al puntuar.
export async function hall() {
  const { data, error } = await supabase.rpc('ocio_hall');
  fail(error, 'hall');
  return data;
}

// Home/Dashboard (01): el aterrizaje en 1 round-trip. ocio_home REUTILIZA ocio_progresion/hall/stats
// por dentro → los números de Home son los mismos que Perfil/Hall/Estadísticas (coherencia). Solo lectura.
export async function home() {
  const { data, error } = await supabase.rpc('ocio_home');
  fail(error, 'home');
  return data;
}

// Wrapped (05): lista de años (antesala + sellados) y el anuario de un año sellado. Eje = fecha de
// entrada; el sellado se deriva de la fecha (año < actual). Solo lectura.
export async function wrappedYears() {
  const { data, error } = await supabase.rpc('ocio_wrapped_years');
  fail(error, 'wrappedYears');
  return data;
}
export async function wrapped(year) {
  const { data, error } = await supabase.rpc('ocio_wrapped', { p_year: year });
  fail(error, 'wrapped');
  return data;
}

// Progresión RPG (Perfil): EXP, Nivel, Clase (doble lente obra/horas), antigüedad, racha, momentos
// canon (auto + manual). Todo derivado de datos reales, server-side. Solo lectura.
export async function progresion() {
  const { data, error } = await supabase.rpc('ocio_progresion');
  fail(error, 'progresion');
  return data;
}
// Marca/desmarca una entrada como momento canon (curación manual). RPC INVOKER de escritura.
export async function setCanon(entradaId, on, { titulo, porQue } = {}) {
  const { data, error } = await supabase.rpc('ocio_set_canon', {
    p_entrada_id: entradaId, p_on: on, p_titulo: titulo ?? null, p_por_que: porQue ?? null
  });
  fail(error, 'setCanon');
  return data;
}
// Marca/desmarca una SERIE como "en curso" (nota provisional). RPC INVOKER; solo aplica a series.
export async function setEnCurso(obraId, on) {
  const { data, error } = await supabase.rpc('ocio_set_en_curso', { p_obra_id: obraId, p_on: on });
  fail(error, 'setEnCurso');
  return data; // { ok, en_curso?, reason? }
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

// Logros (sistema RPG): evalúa TODO el catálogo EN VIVO con el compilador CONSERVADO. Por cada
// logro/título evaluable: compila condicion_json → booleano (desbloqueado) + medidas de progreso,
// las traduce a Postgres (toPg, sin tocar el compilador) y manda el lote a ocio_evaluate_logros
// (SECURITY INVOKER, solo lectura). El progreso (valor/umbral) se combina aquí. Los no-evaluables
// se marcan honestamente con su motivo, sin inventar estado. Dinámico: se reevalúa al leer.
// Lee el ledger de desbloqueos (logro_desbloqueado/titulo_desbloqueado) → mapa id → {registrado, fecha}.
// fecha puede ser NULL (cumplido, momento no reconstruible). La VERDAD de "desbloqueado ahora" es la
// evaluación en vivo; el ledger solo aporta CUÁNDO (y que ya se registró, para no re-sellar).
async function readUnlockLedger() {
  const [l, t] = await Promise.all([
    supabase.from('logro_desbloqueado').select('logro_id, fecha'),
    supabase.from('titulo_desbloqueado').select('titulo_id, fecha')
  ]);
  fail(l.error, 'readUnlockLedger.logro');
  fail(t.error, 'readUnlockLedger.titulo');
  const map = {};
  for (const r of l.data || []) map[r.logro_id] = { registrado: true, fecha: r.fecha ?? null };
  for (const r of t.data || []) map[r.titulo_id] = { registrado: true, fecha: r.fecha ?? null };
  return map;
}

export async function evaluateLogros() {
  const ledger = await readUnlockLedger();
  const evaluables = ALL_RPG.filter((x) => x.condicion_json);
  const built = evaluables.map((x) => {
    const meas = compileMeasure(x.condicion_json); // {measures:[{sql,params,target,op}], combine}
    const bool = toPg(compileCondition(x.condicion_json));
    const measures = meas.measures.map((m) => {
      const p = toPg({ sql: m.sql, params: m.params });
      return { sql: p.text, params: p.values };
    });
    return { x, meta: meas, item: { id: x.id, bool: { sql: bool.text, params: bool.values }, measures } };
  });

  const { data, error } = await supabase.rpc('ocio_evaluate_logros', { p_items: built.map((b) => b.item) });
  fail(error, 'evaluateLogros');
  const byId = Object.fromEntries((data || []).map((r) => [r.id, r]));

  const view = (x) => ({
    id: x.id, nombre: x.nombre, tipo: x.tipo ?? (x.id.startsWith('TIT_') ? 'titulo' : 'logro'),
    rareza: x.rareza, exp: x.exp ?? null, clase: x.clase ?? null,
    descripcion: x.descripcion, umbral: x.umbral
  });

  return ALL_RPG.map((x) => {
    const led = ledger[x.id] || { registrado: false, fecha: null };
    if (!x.condicion_json) {
      return { ...view(x), evaluable: false, desbloqueado: false, progreso: null,
               bloqueado_por: x.bloqueado_por, motivo: MOTIVO[x.bloqueado_por],
               registrado: led.registrado, fecha_desbloqueo: led.fecha };
    }
    const b = built.find((q) => q.x.id === x.id);
    const r = byId[x.id];
    const vals = r?.valores ?? [];
    const ratios = b.meta.measures.map((m, i) => progressRatio(vals[i], m.target, m.op)).filter((n) => n != null);
    let progreso = null;
    if (ratios.length) progreso = b.meta.combine === 'max' ? Math.max(...ratios) : Math.min(...ratios);
    const desbloqueado = r?.ok === 1 || r?.ok === '1' || r?.ok === true;
    if (desbloqueado) progreso = 1;
    return { ...view(x), evaluable: true, desbloqueado, progreso,
             valores: vals, umbrales: b.meta.measures.map((m) => m.target),
             registrado: led.registrado, fecha_desbloqueo: led.fecha };
  });
}

// Perfil (pantalla 08): título equipado. Lectura RLS-scoped; escritura por RPC INVOKER validada.
export async function getProfile() {
  const { data, error } = await supabase.from('perfil_usuario').select('titulo_activo_id').maybeSingle();
  fail(error, 'getProfile');
  return data || { titulo_activo_id: null };
}
export async function setTituloActivo(tituloId) {
  const { data, error } = await supabase.rpc('ocio_set_titulo_activo', { p_titulo_id: tituloId ?? null });
  fail(error, 'setTituloActivo');
  return data; // { titulo_activo_id }
}

// Registrar un desbloqueo (idempotente). Going-forward: el día real es HOY (el momento es genuino).
export async function recordUnlock(kind, defId, fecha = null) {
  const { data, error } = await supabase.rpc('ocio_record_unlock', { p_kind: kind, p_def_id: defId, p_fecha: fecha });
  fail(error, 'recordUnlock');
  return data; // { recorded, kind, id }
}

// Sella en el ledger los desbloqueos NUEVOS (desbloqueados ahora pero aún SIN registro) con la
// fecha de HOY — el momento real cuando ocurren durante el uso. Los ya registrados (incl. el
// baseline histórico, con fecha reconstruida o NULL) se respetan (la RPC es idempotente). Lo llama
// la pantalla tras una evaluación; devuelve cuántos selló.
export async function syncUnlocks(evaluated, hoy = new Date().toISOString().slice(0, 10)) {
  const nuevos = (evaluated || []).filter((e) => e.desbloqueado && !e.registrado);
  let recorded = 0;
  for (const e of nuevos) {
    const res = await recordUnlock(e.tipo === 'titulo' ? 'titulo' : 'logro', e.id, hoy);
    if (res?.recorded) recorded++;
  }
  return { recorded, nuevos: nuevos.length };
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
