// Boot orchestrator — Supabase edition (Stage 3). Same exported ACTION SURFACE as the old
// boot.js (so the Sprint 2–3 screens/components are reused unchanged), but the data source is
// Supabase (supabase-data.js) instead of the SQLite-WASM worker. No OPFS, no durable store, no
// multi-tab leader election — Postgres is the single source of truth and arbitrates writes
// (LWW by actualizado_en). Auth: the single user signs in with the PUBLISHABLE key.
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import { flyOpen, flyBack, flyClearOrigin } from './motion.js';
import * as data from './db/supabase-data.js';
import {
  phase,
  dbStatus,
  busy,
  logEvent,
  role,
  auth,
  archiveEntries,
  archiveFilters,
  filterOpts,
  detail,
  showToast,
  colecciones,
  coleccionSel
} from './stores.js';

let started = false;

// ── Boot + auth ─────────────────────────────────────────────────────────────
export async function boot() {
  if (!browser || started) return;
  started = true;
  phase.set('init');
  busy.set('Conectando con Supabase…');
  // React to sign-in/out for the lifetime of the tab. INITIAL_SESSION lo gestiona el arranque de
  // abajo (con el user fresco); aquí solo SIGNED_IN/OUT, USER_UPDATED, TOKEN_REFRESHED (donde el
  // session.user ya viene fresco) — evita pisar el user fresco con el del JWT cacheado.
  data.onAuthChange((session, event) => { if (event !== 'INITIAL_SESSION') applySession(session, event); });
  const session = await data.getSession();
  // La sesión RESTAURADA trae el user_metadata del JWT cacheado, que puede estar caducado (el nombre
  // pudo editarse en otra sesión/dispositivo). Traer el user FRESCO del servidor — FUERA del callback
  // de onAuthChange (allí provocaría deadlock del auth-lock). En SIGNED_IN/USER_UPDATED el session.user
  // ya viene fresco de la propia operación, así que solo hace falta en este arranque.
  let freshUser = session?.user ?? null;
  if (session) { try { freshUser = (await data.getFreshUser()) ?? freshUser; } catch { /* usa el del JWT */ } }
  await applySession(session, 'INITIAL', freshUser);
  busy.set(null);
}

async function applySession(session, event, freshUser) {
  auth.set({ session: session ?? null, user: freshUser ?? session?.user ?? null, ready: true });
  if (session) {
    role.set('leader'); // every authenticated tab can write (Postgres arbitrates)
    // USER_UPDATED (p. ej. cambiar el nombre de display) NO debe recargar todo el archivo.
    if (event !== 'USER_UPDATED') await loadEverything();
  } else {
    role.set('init');
    phase.set('needs-login');
    archiveEntries.set([]);
    colecciones.set([]);
  }
}

async function loadEverything() {
  busy.set('Cargando tu archivo…');
  try {
    const st = await data.status();
    dbStatus.set(st);
    await Promise.all([refreshArchive(), refreshColecciones()]);
    phase.set('ready');
    logEvent('ok', `Archivo cargado desde Supabase: ${st.counts.obra} obras · ${st.counts.entrada} entradas.`);
  } catch (err) {
    phase.set('error');
    logEvent('error', `No se pudo cargar el archivo: ${err.message}`);
  } finally {
    busy.set(null);
  }
}

export async function signInAction(email, password) {
  busy.set('Entrando…');
  try {
    await data.signIn(email, password);
    return true; // onAuthChange drives the rest
  } catch (err) {
    logEvent('error', `No se pudo entrar: ${err.message}`);
    showToast(err.message, 'error');
    return false;
  } finally {
    busy.set(null);
  }
}

export async function signOutAction() {
  await data.signOut();
}

// Cambiar el nombre de display (user_metadata). Optimista: actualiza el auth store al momento; el
// evento USER_UPDATED confirma sin recargar el archivo. El nombre lo leen Home/Perfil vía displayName.
export async function setDisplayNameAction(name) {
  busy.set('Guardando el nombre…');
  try {
    const user = await data.setDisplayName(name);
    auth.update((a) => ({ ...a, user }));
    logEvent('ok', `Nombre de display: "${user?.user_metadata?.display_name || '(vacío)'}".`);
    showToast('Nombre actualizado');
    return true;
  } catch (err) {
    logEvent('error', `No se pudo guardar el nombre: ${err.message}`);
    showToast('No se pudo guardar', 'error');
    return false;
  } finally {
    busy.set(null);
  }
}

// ── Export portable (anti-lock-in): descarga el export.json completo desde Supabase ──────────
export async function exportAction() {
  busy.set('Exportando el archivo…');
  try {
    const obj = await data.exportArchive();
    const json = JSON.stringify(obj);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocioshit.export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    logEvent('ok', `Export descargado: ${obj.obras.length} obras · ${obj.entradas.length} entradas (sin truncar).`);
    showToast(`Exportado: ${obj.entradas.length} entradas`);
    return obj;
  } catch (err) {
    logEvent('error', `No se pudo exportar: ${err.message}`);
    showToast('No se pudo exportar', 'error');
    throw err;
  } finally {
    busy.set(null);
  }
}

// ── Archive reads ────────────────────────────────────────────────────────────
export async function refreshArchive() {
  try {
    const filters = get(archiveFilters);
    const [entries, options] = await Promise.all([data.listEntries(filters), data.filterOptions()]);
    archiveEntries.set(entries);
    filterOpts.set(options);
  } catch (err) {
    logEvent('warn', `No se pudo cargar el archivo: ${err.message}`);
  }
}
export async function setFilters(patch) {
  archiveFilters.update((f) => ({ ...f, ...patch }));
  await refreshArchive();
}
// Tanda 3 · "carátula que vuela": si el caller pasa fromEl (la <img> tocada en Estantería/
// Galería), el detalle se abre con una View Transition desde esa carátula — los DATOS se
// piden ANTES de arrancar la transición (la página no se congela esperando la red). Sin
// fromEl (navegación interna, lista) se limpia el origen: cerrar no vuela a un sitio viejo.
export async function openEntryDetail(entradaId, { fromEl } = {}) {
  try {
    const d = await data.getEntry(entradaId);
    if (!d) return;
    const apply = async () => {
      detail.set({ kind: 'entrada', data: d });
      await tick(); // el cover destino debe estar en el DOM dentro de la transición
    };
    if (fromEl) await flyOpen(fromEl, apply);
    else {
      flyClearOrigin();
      await apply();
    }
  } catch (err) {
    logEvent('warn', `No se pudo abrir la entrada: ${err.message}`);
  }
}
export async function openObraDetail(obraId) {
  try {
    const d = await data.getObra(obraId);
    if (d) {
      flyClearOrigin();
      detail.set({ kind: 'obra', data: d });
    }
  } catch (err) {
    logEvent('warn', `No se pudo abrir la obra: ${err.message}`);
  }
}
export async function closeDetail() {
  await flyBack(async () => {
    detail.set(null);
    await tick();
  });
}

// Create-vs-link + datalist de géneros para el registro rápido (lecturas RLS-scoped).
export const lookupObra = (titulo, categoria, anio) => data.lookupObra(titulo, categoria, anio);
export const listGeneros = () => data.listGeneros();

// ── Writes (Postgres arbitrates; RPCs are atomic + RLS-scoped) ────────────────
export async function addEntryAction(payload) {
  busy.set('Registrando…');
  try {
    const res = await data.addEntry(payload);
    dbStatus.update((s) => ({ ...(s || {}), counts: res.counts }));
    await refreshArchive();
    logEvent('ok', `Registrada "${payload.obra?.titulo}" · ${res.obraCreated ? 'obra nueva' : 'obra existente'} · reconsumo ${res.numReconsumo}.`);
    showToast('Entrada registrada');
    // Carátula automática (Fase 3): SOLO en obras NUEVAS (las existentes sin carátula son curación
    // pendiente a propósito). Fire-and-forget: el alta nunca se bloquea ni falla por esto.
    if (res.obraCreated) {
      void autoAssignCover(res.obraId, payload.obra?.titulo, payload.obra?.categoria, payload.obra?.anio_obra);
    }
    return res;
  } catch (err) {
    logEvent('error', `No se pudo registrar: ${err.message}`);
    showToast('No se pudo registrar', 'error');
    throw err;
  } finally {
    busy.set(null);
  }
}

// ── Carátulas (Fase 3) ────────────────────────────────────────────────────────
// PATCH en memoria: todas las entradas de la obra reflejan la carátula nueva al instante
// (la Galería re-renderiza sin re-fetch ni pérdida de posición).
function patchImagen(obraId, url) {
  archiveEntries.update((list) => list.map((e) => (e.obra_id === obraId ? { ...e, imagen_url: url } : e)));
}

// Valida que una URL carga como imagen REAL (onerror + descarta placeholders 1×1) antes de
// guardarla. La usan la asignación automática y el campo "URL manual" del picker.
export function testImage(url) {
  return new Promise((resolve) => {
    const im = new Image();
    const t = setTimeout(() => resolve(false), 12000);
    im.onload = () => { clearTimeout(t); resolve(im.naturalWidth > 1 && im.naturalHeight > 1); };
    im.onerror = () => { clearTimeout(t); resolve(false); };
    im.src = url;
  });
}

// Alta nueva: primer candidato por título+año QUE CARGUE de verdad (una fuente puede devolver
// una URL muerta — p. ej. carátulas de Steam con rutas cambiadas); se prueban hasta 3 antes de
// rendirse. Sin resultado → NULL (fallback tipográfico).
async function autoAssignCover(obraId, titulo, categoria, anio) {
  try {
    const cands = await data.buscarCaratula({ titulo, categoria, anio });
    for (const cand of (cands || []).filter((c) => c?.url).slice(0, 3)) {
      if (!(await testImage(cand.url))) continue; // muerta/corrupta → siguiente candidato
      const res = await data.setImagen(obraId, cand.url);
      if (res?.ok) {
        patchImagen(obraId, cand.url);
        logEvent('ok', `Carátula asignada automáticamente (${cand.fuente}).`);
      }
      return;
    }
  } catch (err) {
    logEvent('warn', `Sin carátula automática: ${err.message}`); // nunca rompe el alta
  }
}

// Candidatos para el modal "Cambiar carátula" (reparación manual).
export const buscarCaratula = (args) => data.buscarCaratula(args);

// Fija/quita la carátula desde el modal y refresca el detalle abierto + la lista en memoria.
export async function setImagenAction(obraId, url, { entradaId } = {}) {
  busy.set(url ? 'Guardando carátula…' : 'Quitando carátula…');
  try {
    const res = await data.setImagen(obraId, url);
    if (!res?.ok) {
      showToast(res?.reason === 'url_invalida' ? 'La URL no es válida.' : 'No se pudo guardar', 'error');
      return res;
    }
    patchImagen(obraId, res.imagen_url ?? null);
    if (entradaId) await openEntryDetail(entradaId);
    else await openObraDetail(obraId);
    showToast(url ? 'Carátula actualizada' : 'Carátula quitada');
    return res;
  } catch (err) {
    logEvent('error', `No se pudo cambiar la carátula: ${err.message}`);
    showToast('No se pudo cambiar la carátula', 'error');
  } finally {
    busy.set(null);
  }
}

export async function deleteEntryAction(entradaId) {
  busy.set('Eliminando…');
  try {
    const res = await data.deleteEntry(entradaId);
    if (!res.deleted) {
      showToast('La entrada ya no existe.', 'error');
      return res;
    }
    dbStatus.update((s) => ({ ...(s || {}), counts: res.counts }));
    detail.set(null);
    await refreshArchive();
    logEvent('ok', `Entrada eliminada${res.obraDeleted ? ' (y su obra, sin más entradas)' : ''}.`);
    showToast(res.obraDeleted ? 'Entrada y obra eliminadas' : 'Entrada eliminada');
    return res;
  } catch (err) {
    logEvent('error', `No se pudo eliminar: ${err.message}`);
    showToast('No se pudo eliminar.', 'error');
    throw err;
  } finally {
    busy.set(null);
  }
}

export async function updateEntryAction(entradaId, fields) {
  busy.set('Guardando…');
  try {
    const res = await data.updateEntry(entradaId, fields);
    if (!res.updated) {
      showToast('La entrada ya no existe.', 'error');
      return res;
    }
    // Regla: fecha/duracion cambian agregados/pertenencia (año, tiempo) + num_reconsumo → rematerializar
    // + refresco completo (la fila puede reordenarse). valoracion/nota NO rematerializan (puntuar en
    // lote es instantáneo; las colecciones por nota media se refrescan con "Recalcular").
    if (res.fecha_changed || res.duracion_changed) {
      await data.rematerializeAll();
      await refreshColecciones();
      await refreshArchive();
    } else {
      // Solo nota/comentario → PATCH puntual de esa entrada en memoria (sin re-fetch): la lista no se
      // reconstruye ni pierde la posición de scroll → se puede puntuar en lote sin re-scrollear.
      archiveEntries.update((list) =>
        list.map((e) => (e.entrada_id === entradaId ? { ...e, valoracion: fields.valoracion ?? null } : e))
      );
    }
    await openEntryDetail(entradaId); // recarga el detalle con los valores nuevos
    logEvent('ok', 'Entrada actualizada.');
    showToast('Entrada actualizada');
    return res;
  } catch (err) {
    logEvent('error', `No se pudo actualizar: ${err.message}`);
    showToast('No se pudo actualizar', 'error');
    throw err;
  } finally {
    busy.set(null);
  }
}

// Momento canon (curación manual): marca/desmarca una entrada y recarga el detalle.
export async function setCanonAction(entradaId, on) {
  busy.set(on ? 'Marcando momento canon…' : 'Quitando…');
  try {
    await data.setCanon(entradaId, on);
    await openEntryDetail(entradaId); // recarga es_canon
    showToast(on ? 'Momento canon marcado' : 'Marca quitada');
  } catch (err) {
    logEvent('error', `No se pudo marcar el canon: ${err.message}`);
    showToast('No se pudo marcar', 'error');
  } finally {
    busy.set(null);
  }
}

// "En curso" (solo series): marca/desmarca obra.en_curso y recarga el detalle abierto + el Diario.
export async function setEnCursoAction(obraId, on, { entradaId } = {}) {
  busy.set(on ? 'Marcando en curso…' : 'Quitando…');
  try {
    const res = await data.setEnCurso(obraId, on);
    if (!res?.ok) {
      showToast(res?.reason === 'solo_series' ? 'Solo las series pueden estar "en curso".' : 'No se pudo marcar', 'error');
      return res;
    }
    if (entradaId) await openEntryDetail(entradaId); else await openObraDetail(obraId);
    await refreshArchive(); // actualiza badge + filtro
    showToast(on ? 'Marcada en curso' : 'Ya no está en curso');
    return res;
  } catch (err) {
    logEvent('error', `No se pudo marcar en curso: ${err.message}`);
    showToast('No se pudo marcar', 'error');
  } finally {
    busy.set(null);
  }
}

// ── Colecciones — READ (Stage 3 step 2). Write/materialize llega al cerrar Stage 3. ──────────
export async function refreshColecciones() {
  try {
    colecciones.set(await data.listColecciones());
  } catch (err) {
    logEvent('warn', `No se pudieron cargar colecciones: ${err.message}`);
  }
}
export async function openColeccion(id) {
  try {
    const d = await data.getColeccion(id);
    if (d) coleccionSel.set(d);
  } catch (err) {
    logEvent('warn', `No se pudo abrir la colección: ${err.message}`);
  }
}
export function closeColeccion() {
  coleccionSel.set(null);
}

// Materialización en runtime: el compilador conservado corre en el navegador; su SQL se ejecuta
// server-side vía RPC SECURITY INVOKER (RLS). Recalcular / Nueva / R1 funcionan contra Postgres.
export async function rematerializeColeccionesAction() {
  busy.set('Recalculando colecciones…');
  try {
    const res = await data.rematerializeAll();
    await refreshColecciones();
    logEvent('ok', `Colecciones recalculadas: ${res.collections} colecciones, ${res.members} membresías.`);
    showToast('Colecciones actualizadas');
  } catch (err) {
    logEvent('error', `No se pudo recalcular: ${err.message}`);
    showToast('No se pudo recalcular', 'error');
  } finally {
    busy.set(null);
  }
}
export async function createColeccionAction(def) {
  busy.set('Creando colección…');
  try {
    const id = await data.createColeccion(def);
    await refreshColecciones();
    showToast('Colección creada');
    return id;
  } catch (err) {
    logEvent('error', `No se pudo crear la colección: ${err.message}`);
    showToast('No se pudo crear', 'error');
    throw err;
  } finally {
    busy.set(null);
  }
}
export async function deleteColeccionAction(id) {
  try {
    await data.deleteColeccion(id);
    coleccionSel.set(null);
    await refreshColecciones();
    showToast('Colección eliminada');
  } catch (err) {
    logEvent('error', `No se pudo eliminar la colección: ${err.message}`);
    showToast('No se pudo eliminar', 'error');
  }
}
export async function applyR1Action() {
  busy.set('Derivando etiquetas (R1)…');
  try {
    const r = await data.applyR1();
    logEvent('ok', `R1: ${r.tags} etiquetas, ${r.links} vínculos.`);
    showToast(r.tags ? `R1: ${r.tags} etiquetas derivadas` : 'R1: sin campos derivables (idioma/país vacíos)');
  } catch (err) {
    logEvent('error', `R1 falló: ${err.message}`);
    showToast('R1 falló', 'error');
  } finally {
    busy.set(null);
  }
}

// ── Test hooks (Playwright). Gated behind ?test=1. ───────────────────────────
export function __installTestHooks() {
  if (typeof window === 'undefined') return;
  let testMode = false;
  try {
    testMode = new URLSearchParams(window.location.search).get('test') === '1';
  } catch {
    /* ignore */
  }
  if (!testMode) return;
  window.__ocio = {
    signIn: (e, p) => signInAction(e, p),
    signOut: () => signOutAction(),
    setDisplayName: (n) => setDisplayNameAction(n),
    status: () => data.status(),
    listEntries: (f) => data.listEntries(f || {}),
    addEntry: (p) => addEntryAction(p),
    deleteEntry: (id) => deleteEntryAction(id),
    updateEntry: (id, f) => updateEntryAction(id, f),
    getEntry: (id) => data.getEntry(id),
    openDetail: (id) => openEntryDetail(id),
    listColecciones: () => data.listColecciones(),
    getColeccion: (id) => data.getColeccion(id),
    getPhase: () => get(phase),
    getCounts: () => get(dbStatus)?.counts,
    getArchiveCount: () => get(archiveEntries).length,
    exportArchive: () => data.exportArchive(),
    buscarCaratula: (a) => data.buscarCaratula(a),
    setImagen: (obraId, url, opts) => setImagenAction(obraId, url, opts || {}),
    getObra: (id) => data.getObra(id)
  };
}
