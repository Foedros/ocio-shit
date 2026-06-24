// Boot + recovery + multi-tab orchestrator — the brain of the app.
//
// Sprint 1 (durability): OPFS is a volatile cache; the durable truth is export.json on the
// user's real disk. On boot, if OPFS is empty/corrupt, reconstruct from the durable export.
//
// Sprint 2 (multi-tab): OPFS-SAH-pool is single-connection, so exactly ONE tab — the LEADER
// — opens the DB and may write. Followers are read-only and proxy reads to the leader over a
// BroadcastChannel. Leadership is a Web Lock; if the leader tab dies (even mid-write), a
// follower is promoted and SQLite rolls back any interrupted transaction on open.
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { createDbClient } from './db/client.js';
import { detectCapabilities } from './durable/capabilities.js';
import { loadPersistedStore, chooseDurableTarget, forgetDurableTarget } from './durable/store.js';
import { FsaDurableStore } from './durable/fsa-store.js';
import { createTabCoordinator } from './tabs.js';
import {
  phase,
  caps,
  dbStatus,
  durability,
  busy,
  logEvent,
  role,
  archiveEntries,
  archiveFilters,
  filterOpts,
  detail
} from './stores.js';

let db = null; // worker client (LEADER only)
let durableStore = null; // current durable backend (LEADER only)
let capabilities = null;
let coordinator = null; // multi-tab coordinator
let currentRole = 'init';
let dirty = false; // set by markDirty() when data changes
let lifecycleInstalled = false;

const VERIFY_KEYS = ['obra', 'entrada', 'persona', 'obra_creador'];

function hasData(counts) {
  return !!counts && Number(counts.obra) > 0;
}
function fmtCounts(c) {
  if (!c) return 'sin datos';
  return `${c.obra} obras · ${c.entrada} entradas · ${c.persona} personas · ${c.obra_creador} vínculos`;
}
function setDurabilityFromStore(store, needsPermission) {
  durability.update((d) => ({
    ...d,
    kind: store.kind,
    automatic: store.isAutomatic(),
    storeName: store.describe(),
    needsPermission: !!needsPermission
  }));
}
async function refreshLastBackup() {
  if (!durableStore) return;
  try {
    const at = await durableStore.getLastBackupTime();
    durability.update((d) => ({ ...d, lastBackupAt: at }));
  } catch {
    /* ignore */
  }
}
async function safeRead(store) {
  try {
    return await store.readExport();
  } catch (err) {
    logEvent('warn', `No se pudo leer el export durable: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Boot: set up multi-tab coordination, then become leader or follower.
// ---------------------------------------------------------------------------------------

export async function boot() {
  if (!browser) return;
  phase.set('init');
  busy.set('Coordinando pestañas…');

  capabilities = detectCapabilities();
  caps.set(capabilities);
  durability.update((d) => ({ ...d, mode: capabilities.mode, automatic: capabilities.mode === 'auto' }));
  logEvent('info', `Capacidades: ${capabilities.summary}`);
  if (!capabilities.isChromium) {
    logEvent('warn', 'Navegador no-Chromium: la durabilidad automática plena no está garantizada (MVP Chromium-only).');
  }

  installLifecycle();

  coordinator = createTabCoordinator({
    onBecomeLeader: () => becomeLeader(),
    onBecomeFollower: () => becomeFollower(),
    runQuery: (method, args) => runLeaderQuery(method, args),
    onChanged: (counts) => onLeaderChanged(counts)
  });
}

// Leader-side dispatcher: reads run directly against the DB. (Followers reach these via
// the coordinator's BroadcastChannel proxy.)
function runLeaderQuery(method, args) {
  switch (method) {
    case 'listEntries':
      return db.listEntries(args || {});
    case 'listObras':
      return db.listObras(args || {});
    case 'getEntry':
      return db.getEntry(args);
    case 'getObra':
      return db.getObra(args);
    case 'filterOptions':
      return db.filterOptions();
    case 'status':
      return db.status();
    default:
      throw new Error(`método no permitido: ${method}`);
  }
}

// Unified read API used by the UI. Works whether this tab is leader (direct) or follower
// (proxied to the leader). Writes are leader-only and go through addEntryAction.
const dataApi = {
  listEntries: (filters) => coordinator.query('listEntries', filters),
  listObras: (filters) => coordinator.query('listObras', filters),
  getEntry: (id) => coordinator.query('getEntry', id),
  getObra: (id) => coordinator.query('getObra', id),
  filterOptions: () => coordinator.query('filterOptions'),
  status: () => coordinator.query('status')
};

// ---------------------------------------------------------------------------------------
// LEADER: open the DB, run Sprint 1 durability/recovery, enable writes.
// ---------------------------------------------------------------------------------------

async function becomeLeader() {
  const promoted = currentRole === 'follower';
  busy.set('Iniciando motor SQLite…');

  // Open the DB BEFORE announcing leadership, so role==='leader' implies the DB is ready
  // (writes/seeds issued the instant we are leader can't race an uninitialized worker).
  db = createDbClient();
  let initStatus;
  try {
    initStatus = await db.init();
  } catch (err) {
    phase.set('error');
    busy.set(null);
    logEvent('error', `Fallo al iniciar el motor: ${err.message}`);
    return;
  }
  currentRole = 'leader';
  role.set('leader');
  logEvent(promoted ? 'warn' : 'ok', promoted
    ? 'La pestaña principal anterior cerró: ESTA pestaña toma el control (líder).'
    : 'Esta pestaña es la PRINCIPAL (líder): abre la BD y puede escribir.');
  dbStatus.set(initStatus);
  logEvent('info', `Motor listo (VFS: ${initStatus.vfs}).`);
  if (initStatus.vfs === 'memory') {
    logEvent('warn', 'OPFS no disponible: motor en memoria (datos no persisten entre recargas; durabilidad solo vía export).');
  }
  // Now the leader can answer follower reads.
  coordinator.markDbReady();

  // Remember a previously chosen durable folder (no prompt).
  try {
    const restored = await loadPersistedStore(capabilities);
    if (restored) {
      durableStore = restored.store;
      setDurabilityFromStore(restored.store, restored.needsPermission);
      logEvent('info', `Carpeta durable recordada: ${restored.store.describe()}${restored.needsPermission ? ' (requiere reautorizar)' : ''}.`);
      await refreshLastBackup();
    }
  } catch (err) {
    logEvent('warn', `No se pudo restaurar la carpeta durable: ${err.message}`);
  }

  // Decide: trust OPFS, or reconstruct from the durable export.
  if (initStatus.initialized && initStatus.integrity?.ok && hasData(initStatus.counts)) {
    phase.set('ready');
    logEvent('ok', `OPFS sano: ${fmtCounts(initStatus.counts)} · integridad ${initStatus.integrity.detail}.`);
  } else {
    const why = !initStatus.initialized ? 'vacío' : initStatus.integrity?.ok ? 'sin datos' : `corrupto (${initStatus.integrity?.detail})`;
    logEvent('warn', `OPFS ${why}. Buscando copia durable para reconstruir…`);
    await tryReconstruct();
  }
  // Only list once a schema exists (a fresh/needs-setup DB has no tables to query).
  if (['ready', 'reconstructed'].includes(get(phase))) await refreshArchive();
  busy.set(null);
}

// ---------------------------------------------------------------------------------------
// FOLLOWER: read-only. Never opens the DB; browses via the leader.
// ---------------------------------------------------------------------------------------

async function becomeFollower() {
  currentRole = 'follower';
  role.set('follower');
  phase.set('follower');
  busy.set(null);
  logEvent('warn', 'Otra pestaña tiene el archivo abierto. Esta pestaña es de SOLO LECTURA.');
  // Pull counts + archive from the leader (with one retry in case it is still booting).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const st = await dataApi.status();
      dbStatus.set(st);
      if (hasData(st.counts)) await refreshArchive();
      return;
    } catch (err) {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
      else logEvent('warn', `Sin datos de la pestaña principal: ${err.message}`);
    }
  }
}

// Follower receives a "data changed" broadcast from the leader.
async function onLeaderChanged(counts) {
  if (counts) dbStatus.update((s) => ({ ...(s || {}), counts }));
  await refreshArchive();
}

// ---------------------------------------------------------------------------------------
// Reconstruction (Sprint 1) — leader only.
// ---------------------------------------------------------------------------------------

async function tryReconstruct() {
  const d = get(durability);
  if (durableStore && !d.needsPermission) {
    const text = await safeRead(durableStore);
    if (text) {
      await reconstructFrom(text, 'durable');
      return;
    }
  }
  if (durableStore && d.needsPermission) {
    phase.set('needs-permission');
    logEvent('warn', 'Reautoriza el acceso a la carpeta durable para reconstruir la BD.');
    return;
  }
  phase.set('needs-setup');
  logEvent('warn', 'No hay copia durable. Elige una carpeta durable y carga tu export.json.');
}

async function reconstructFrom(text, sourceLabel) {
  busy.set('Reconstruyendo la BD desde el export durable…');
  try {
    const res = await db.rebuildFromExport(text);
    const st = await db.status();
    dbStatus.set(st);
    const countsOk = VERIFY_KEYS.every((k) => res.counts[k] === res.sourceCounts[k]);
    const ok = res.integrity?.ok && res.foreignKeyViolations === 0 && countsOk;
    if (ok) {
      phase.set(sourceLabel === 'durable' ? 'reconstructed' : 'ready');
      logEvent('ok', `Reconstruida desde ${sourceLabel}: ${fmtCounts(res.counts)} · integridad ${res.integrity.detail} · 0 violaciones FK.`);
      await refreshLastBackup();
    } else {
      phase.set('error');
      logEvent('error', `Reconstrucción INCONSISTENTE — counts=${JSON.stringify(res.counts)} esperado=${JSON.stringify(res.sourceCounts)} integridad=${res.integrity?.detail} fk=${res.foreignKeyViolations}`);
    }
  } catch (err) {
    phase.set('error');
    logEvent('error', `Fallo de reconstrucción: ${err.message}`);
  } finally {
    busy.set(null);
  }
}

// ---------------------------------------------------------------------------------------
// Archive read actions (UI). Available to both roles via dataApi.
// ---------------------------------------------------------------------------------------

export async function refreshArchive() {
  try {
    const filters = get(archiveFilters);
    const [entries, options] = await Promise.all([dataApi.listEntries(filters), dataApi.filterOptions()]);
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

export async function openEntryDetail(entradaId) {
  try {
    const data = await dataApi.getEntry(entradaId);
    if (data) detail.set({ kind: 'entrada', data });
  } catch (err) {
    logEvent('warn', `No se pudo abrir la entrada: ${err.message}`);
  }
}

export async function openObraDetail(obraId) {
  try {
    const data = await dataApi.getObra(obraId);
    if (data) detail.set({ kind: 'obra', data });
  } catch (err) {
    logEvent('warn', `No se pudo abrir la obra: ${err.message}`);
  }
}

export function closeDetail() {
  detail.set(null);
}

// ---------------------------------------------------------------------------------------
// Write action (LEADER only): alta rápida -> atomic insert -> durable flush -> notify tabs.
// ---------------------------------------------------------------------------------------

export async function addEntryAction(payload) {
  if (currentRole !== 'leader' || !db) {
    logEvent('warn', 'Solo la pestaña principal puede registrar. Cámbiate a ella.');
    throw new Error('solo lectura');
  }
  busy.set('Registrando…');
  try {
    const res = await db.addEntry(payload); // atomic transaction in the worker
    dbStatus.update((s) => ({ ...(s || {}), counts: res.counts }));
    markDirty();
    await backupNow(); // Sprint 1 durable write (atomic, .prev rotation, zero .tmp)
    coordinator.broadcastChanged(res.counts); // followers refresh
    await refreshArchive();
    logEvent('ok', `Registrada "${payload.obra?.titulo}" · ${res.obraCreated ? 'obra nueva' : 'obra existente'} · reconsumo ${res.numReconsumo}.`);
    return res;
  } catch (err) {
    logEvent('error', `No se pudo registrar: ${err.message}`);
    throw err;
  } finally {
    busy.set(null);
  }
}

// ---------------------------------------------------------------------------------------
// Durability actions (LEADER only — they touch the DB / durable store).
// ---------------------------------------------------------------------------------------

function requireLeader() {
  if (currentRole !== 'leader' || !db) {
    logEvent('warn', 'Esta acción solo está disponible en la pestaña principal.');
    return false;
  }
  return true;
}

/** User gesture: choose the durable directory (or test/manual target). */
export async function chooseDirectory() {
  if (!requireLeader()) return;
  try {
    const { store, needsPermission } = await chooseDurableTarget(capabilities);
    durableStore = store;
    setDurabilityFromStore(store, needsPermission);
    logEvent('ok', `Carpeta durable elegida: ${store.describe()}.`);
    await refreshLastBackup();

    const text = await safeRead(store);
    if (text) {
      logEvent('info', 'La carpeta ya contiene un export.json durable. Reconstruyendo desde él…');
      await reconstructFrom(text, 'durable');
      await refreshArchive();
      return;
    }
    const st = await db.status();
    if (st.initialized && hasData(st.counts)) {
      await backupNow();
      phase.set('ready');
    } else {
      phase.set('needs-seed');
      logEvent('warn', 'Carpeta vacía y OPFS sin datos: carga tu export.json para sembrar el archivo.');
    }
  } catch (err) {
    if (err?.name === 'AbortError') logEvent('info', 'Selección de carpeta cancelada.');
    else logEvent('error', `No se pudo elegir carpeta: ${err.message}`);
  }
}

/** User gesture: re-grant permission to a remembered folder, then reconstruct/backup. */
export async function regrantPermission() {
  if (!requireLeader() || !durableStore) return;
  try {
    const ok = await durableStore.ensurePermission();
    if (!ok) {
      logEvent('warn', 'Permiso no concedido.');
      return;
    }
    durability.update((d) => ({ ...d, needsPermission: false }));
    await refreshLastBackup();
    const st = await db.status();
    if (!(st.initialized && st.integrity?.ok && hasData(st.counts))) {
      await tryReconstruct();
      await refreshArchive();
    }
  } catch (err) {
    logEvent('error', `Fallo al reautorizar: ${err.message}`);
  }
}

/** User provides an export.json file (first seed, or manual-mode reconstruction). */
export async function seedFromFile(file) {
  const text = await file.text();
  return seedFromText(text);
}

/** Seed/reconstruct from raw export.json text (also the DOM-independent test entry point). */
export async function seedFromText(text) {
  if (!requireLeader()) return;
  try {
    busy.set('Cargando export.json…');
    if (durableStore && typeof durableStore.setPickedText === 'function') durableStore.setPickedText(text);
    await reconstructFrom(text, 'archivo');
    if (durableStore) {
      await backupNow();
    } else {
      logEvent('warn', 'Datos cargados en OPFS pero SIN carpeta durable: elige una carpeta para protegerlos.');
      phase.set('needs-setup');
    }
    await refreshArchive();
  } catch (err) {
    logEvent('error', `No se pudo cargar el archivo: ${err.message}`);
  } finally {
    busy.set(null);
  }
}

/** Write the durable export (the backup). Called after significant writes + manually. */
export async function backupNow() {
  if (!durableStore) {
    logEvent('warn', 'Sin carpeta durable: no se puede respaldar.');
    return;
  }
  busy.set('Escribiendo copia durable…');
  try {
    const json = await db.exportJson();
    const { at, method } = await durableStore.writeExportAtomic(json);
    dirty = false;
    durability.update((d) => ({ ...d, lastBackupAt: at }));
    const mb = (json.length / 1e6).toFixed(2);
    const how = method === 'rename' ? 'temp+rename atómico' : 'escritura atómica directa (copia)';
    logEvent('ok', `Backup durable escrito (${mb} MB · ${how}) en ${durableStore.describe()}.`);
  } catch (err) {
    logEvent('error', `Fallo al escribir backup durable: ${err.message}`);
  } finally {
    busy.set(null);
  }
}

/** Mark the DB dirty so the next flush writes a durable backup. */
export function markDirty() {
  dirty = true;
}

async function flushIfDirty(reason) {
  if (dirty && durableStore && currentRole === 'leader') {
    logEvent('info', `Flush durable (${reason}).`);
    await backupNow();
  }
}

/** TEST / MANUAL: wipe the OPFS cache, then reconstruct from durable — proves the column. */
export async function simulateOpfsLoss() {
  if (!requireLeader()) return;
  busy.set('Simulando pérdida de OPFS…');
  try {
    await db.simulateOpfsLoss();
    const st = await db.status();
    dbStatus.set(st);
    logEvent('warn', `OPFS vaciado a propósito (initialized=${st.initialized}). Reconstruyendo…`);
    await tryReconstruct();
    await refreshArchive();
  } catch (err) {
    logEvent('error', `Fallo simulando pérdida de OPFS: ${err.message}`);
  } finally {
    busy.set(null);
  }
}

function installLifecycle() {
  if (lifecycleInstalled || typeof document === 'undefined') return;
  lifecycleInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushIfDirty('visibilitychange');
  });
  window.addEventListener('pagehide', () => {
    flushIfDirty('pagehide');
  });
}

// Test hooks for Playwright. Gated behind an explicit test context (?test=1 or ?durable=idb)
// so the destructive helpers are NOT exposed in normal use.
export function __installTestHooks() {
  if (typeof window === 'undefined') return;
  let testMode = false;
  try {
    const p = new URLSearchParams(window.location.search);
    testMode = p.get('test') === '1' || ['idb', 'fsa-opfs'].includes(p.get('durable'));
  } catch {
    /* ignore */
  }
  if (!testMode) return;

  // Harness that runs the REAL FsaDurableStore against a real OPFS directory handle.
  window.__ocioFsa = {
    async run({ writes = 4, forceCopy = false } = {}) {
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry('fsa-test', { recursive: true });
      } catch {
        /* none */
      }
      const dir = await root.getDirectoryHandle('fsa-test', { create: true });
      const store = new FsaDurableStore(dir, { forceCopy });
      const list = async () => {
        const a = [];
        // eslint-disable-next-line no-restricted-syntax
        for await (const [n] of dir.entries()) a.push(n);
        return a.sort();
      };
      const steps = [];
      for (let i = 1; i <= writes; i++) {
        const r = await store.writeExportAtomic(JSON.stringify({ v: i }));
        steps.push({ i, method: r.method, files: await list() });
      }
      const readFile = async (n) => {
        try {
          return await (await (await dir.getFileHandle(n)).getFile()).text();
        } catch {
          return null;
        }
      };
      return {
        steps,
        finalFiles: await list(),
        target: await readFile('ocioshit.export.json'),
        prev: await readFile('ocioshit.export.prev.json'),
        viaReadExport: await store.readExport()
      };
    }
  };

  window.__ocio = {
    status: () => db.status(),
    exportJson: () => db.exportJson(),
    simulateOpfsLoss,
    backupNow,
    seedFromText: (text) => seedFromText(text),
    addEntry: (payload) => addEntryAction(payload),
    listEntries: (filters) => dataApi.listEntries(filters || {}),
    getDurability: () => get(durability),
    getPhase: () => get(phase),
    getRole: () => currentRole,
    isLeader: () => coordinator?.isLeader?.() ?? false,
    forgetDurableTarget,
    // List the FSA-over-OPFS durable folder (?durable=fsa-opfs) to assert it stays clean.
    listDurableFolder: async () => {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('durable-fsa');
        const names = [];
        // eslint-disable-next-line no-restricted-syntax
        for await (const [n] of dir.entries()) names.push(n);
        return names.sort();
      } catch {
        return [];
      }
    },
    // Crash-recovery hooks (leader only): arm an uncommitted write, then the test kills
    // this tab; another tab is promoted and must roll back cleanly.
    beginUncommitted: () => db.__beginUncommitted(),
    probe: () => db.__probe(),
    // Faithful "OPFS vanished" simulation for the durability test.
    wipeOpfsHard: async () => {
      const root = await navigator.storage.getDirectory();
      const before = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const [name] of root.entries()) before.push(name);
      try {
        await db.releaseForWipe();
      } catch (err) {
        console.warn('releaseForWipe failed (continuing):', err);
      }
      const removed = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const [name] of root.entries()) {
        try {
          await root.removeEntry(name, { recursive: true });
          removed.push(name);
        } catch (err) {
          console.warn('removeEntry failed for', name, err);
        }
      }
      const remaining = [];
      // eslint-disable-next-line no-restricted-syntax
      for await (const [name] of root.entries()) remaining.push(name);
      return { before, removed, remaining };
    }
  };
}
