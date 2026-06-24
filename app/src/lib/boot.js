// Boot + recovery orchestrator — the brain of the durability column.
//
// On startup it decides between two worlds (tecnico.md §3.2):
//   - OPFS cache is healthy (schema + data + integrity ok) -> use it.
//   - OPFS is empty/corrupt (the EXPECTED failure mode)     -> reconstruct from the durable
//     export.json on the user's real disk. No data is lost because the truth was never in OPFS.
//
// It also wires the auto-export: any "significant write" (Sprint 2+) marks the DB dirty and a
// durable backup is flushed after writes and on visibilitychange/pagehide.
import { browser } from '$app/environment';
import { get } from 'svelte/store';
import { createDbClient } from './db/client.js';
import { detectCapabilities } from './durable/capabilities.js';
import { loadPersistedStore, chooseDurableTarget, forgetDurableTarget } from './durable/store.js';
import { FsaDurableStore } from './durable/fsa-store.js';
import { phase, caps, dbStatus, durability, busy, logEvent } from './stores.js';

let db = null; // worker client
let durableStore = null; // current durable backend
let capabilities = null;
let dirty = false; // set by markDirty() when data changes (Sprint 2+)
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
// Public actions (called from the UI; most require a user gesture)
// ---------------------------------------------------------------------------------------

export async function boot() {
  if (!browser) return;
  phase.set('init');
  busy.set('Iniciando motor SQLite…');

  capabilities = detectCapabilities();
  caps.set(capabilities);
  durability.update((d) => ({ ...d, mode: capabilities.mode, automatic: capabilities.mode === 'auto' }));
  logEvent('info', `Capacidades: ${capabilities.summary}`);
  if (!capabilities.isChromium) {
    logEvent('warn', 'Navegador no-Chromium: la durabilidad automática plena no está garantizada (MVP Chromium-only).');
  }

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
  dbStatus.set(initStatus);
  logEvent('info', `Motor listo (VFS: ${initStatus.vfs}).`);
  if (initStatus.vfs === 'memory') {
    logEvent('warn', 'OPFS no disponible: motor en memoria (datos no persisten entre recargas; durabilidad solo vía export).');
  }

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

  installLifecycle();

  // Decide: trust OPFS, or reconstruct.
  if (initStatus.initialized && initStatus.integrity?.ok && hasData(initStatus.counts)) {
    phase.set('ready');
    logEvent('ok', `OPFS sano: ${fmtCounts(initStatus.counts)} · integridad ${initStatus.integrity.detail}.`);
  } else {
    const why = !initStatus.initialized ? 'vacío' : initStatus.integrity?.ok ? 'sin datos' : `corrupto (${initStatus.integrity?.detail})`;
    logEvent('warn', `OPFS ${why}. Buscando copia durable para reconstruir…`);
    await tryReconstruct();
  }
  busy.set(null);
}

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
  // First run / nothing durable yet.
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

/** User gesture: choose the durable directory (or test/manual target). */
export async function chooseDirectory() {
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
      return;
    }
    // Empty folder: if OPFS already holds data, write the first durable backup; else need a seed.
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
  if (!durableStore) return;
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
    }
  } catch (err) {
    logEvent('error', `Fallo al reautorizar: ${err.message}`);
  }
}

/** User provides an export.json file (first seed, or manual-mode reconstruction). */
export async function seedFromFile(file) {
  try {
    busy.set('Leyendo export.json…');
    const text = await file.text();
    if (durableStore && typeof durableStore.setPickedText === 'function') durableStore.setPickedText(text);
    await reconstructFrom(text, 'archivo');
    if (durableStore) {
      await backupNow();
    } else {
      logEvent('warn', 'Datos cargados en OPFS pero SIN carpeta durable: elige una carpeta para protegerlos.');
      phase.set('needs-setup');
    }
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

/** Mark the DB dirty so the next flush writes a durable backup (Sprint 2 writes call this). */
export function markDirty() {
  dirty = true;
}

async function flushIfDirty(reason) {
  if (dirty && durableStore) {
    logEvent('info', `Flush durable (${reason}).`);
    await backupNow();
  }
}

/** TEST / MANUAL: wipe the OPFS cache, then reconstruct from durable — proves the column. */
export async function simulateOpfsLoss() {
  busy.set('Simulando pérdida de OPFS…');
  try {
    await db.simulateOpfsLoss();
    const st = await db.status();
    dbStatus.set(st);
    logEvent('warn', `OPFS vaciado a propósito (initialized=${st.initialized}). Reconstruyendo…`);
    await tryReconstruct();
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
    // Best-effort: async FSA writes may not finish on unload, but visibilitychange usually
    // fires earlier while the page can still do async work.
    flushIfDirty('pagehide');
  });
}

// Test hooks for Playwright. Gated behind an explicit test context (?test=1 or ?durable=idb)
// so the destructive helpers (wipeOpfsHard, simulateOpfsLoss) are NOT exposed in normal use.
export function __installTestHooks() {
  if (typeof window === 'undefined') return;
  let testMode = false;
  try {
    const p = new URLSearchParams(window.location.search);
    testMode = p.get('test') === '1' || p.get('durable') === 'idb';
  } catch {
    /* ignore */
  }
  if (!testMode) return;

  // Harness that runs the REAL FsaDurableStore against a real OPFS directory handle (OPFS
  // handles are genuine FileSystemDirectoryHandle, with the same createWritable/move/remove
  // as a user-picked folder). This is the automated regression for the orphan-.tmp bug.
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
    getDurability: () => get(durability),
    getPhase: () => get(phase),
    forgetDurableTarget,
    // Faithful "OPFS vanished" simulation: release the SAH handles, then delete EVERY
    // OPFS entry from the page context. The durable copy (real disk / IndexedDB in tests)
    // is untouched, so the subsequent reload must reconstruct with zero loss.
    wipeOpfsHard: async () => {
      const root = await navigator.storage.getDirectory();
      // List BEFORE releasing — removeVfs() cleans up the SAH-pool dir itself, so we record
      // what OPFS held while the worker still has it open.
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
