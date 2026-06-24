// SQLite engine worker for Ocio Shit.
//
// Per tecnico.md §3.2: SQLite-WASM via the OO1 API over the OPFS-SAH-pool VFS (NOT the
// deprecated Worker1/Promiser wrappers — this is our own thin RPC over OO1). The SAH-pool
// VFS needs no COOP/COEP and requires a Worker (synchronous access handles live here).
//
// This worker treats OPFS as a VOLATILE working cache. It never owns the durable truth;
// it just opens/wipes/rebuilds the cache on command. The durable export.json lives on the
// real filesystem and is managed on the main thread.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { SCHEMA_SQL } from './schema-sql.js';
import { createOo1Adapter } from './adapter-oo1.js';
import {
  applySchema,
  importAll,
  exportAll,
  counts,
  integrityCheck,
  foreignKeyViolations,
  isInitialized
} from './io.js';

const POOL_NAME = 'ocioshit-opfs-pool';
const DB_FILENAME = '/ocioshit.sqlite3';

let sqlite3 = null;
let poolUtil = null; // OpfsSAHPool util (null when running in-memory)
let db = null;
let adapter = null;
let vfs = 'unknown'; // 'opfs-sahpool' | 'memory'

function openDb() {
  if (poolUtil) {
    db = new poolUtil.OpfsSAHPoolDb(DB_FILENAME);
    vfs = 'opfs-sahpool';
  } else {
    db = new sqlite3.oo1.DB(':memory:', 'c');
    vfs = 'memory';
  }
  db.exec('PRAGMA foreign_keys = ON');
  // WAL is unavailable on the OPFS VFS (tecnico.md §3.2). Rollback journal = TRUNCATE.
  if (poolUtil) {
    try {
      db.exec("PRAGMA journal_mode = TRUNCATE");
    } catch {
      /* in-memory ignores this */
    }
  }
  adapter = createOo1Adapter(db);
}

function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  db = null;
  adapter = null;
}

async function initEngine(wasmUrl) {
  sqlite3 = await sqlite3InitModule({
    locateFile: () => wasmUrl,
    print: () => {},
    printErr: (...a) => console.error('[sqlite]', ...a)
  });
  try {
    poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: POOL_NAME, clearOnInit: false });
  } catch (err) {
    // Safari < 17 / OPFS sync access unavailable -> degrade to in-memory engine.
    // Durability still holds: the truth is export.json on disk, not OPFS.
    poolUtil = null;
    console.warn('[worker] OPFS-SAH-pool unavailable, falling back to in-memory:', err);
  }
  openDb();
}

// Health of the OPFS cache. Wrapped so a corrupt/unreadable DB reports a failure
// (which the boot orchestrator treats as "reconstruct from durable export").
function status() {
  let initialized = false;
  let integ = { ok: false, detail: 'no schema' };
  let cnt = null;
  let fk = null;
  try {
    initialized = isInitialized(adapter);
    if (initialized) {
      integ = integrityCheck(adapter);
      cnt = counts(adapter);
      fk = foreignKeyViolations(adapter);
    }
  } catch (err) {
    initialized = false;
    integ = { ok: false, detail: 'read error: ' + (err?.message || String(err)) };
  }
  return { vfs, initialized, integrity: integ, counts: cnt, foreignKeyViolations: fk };
}

function verify() {
  return {
    integrity: integrityCheck(adapter),
    counts: counts(adapter),
    foreignKeyViolations: foreignKeyViolations(adapter)
  };
}

// Rebuild the OPFS cache from scratch out of a durable export.json string.
// Used for BOTH first seed and post-loss reconstruction.
async function rebuildFromExport(jsonString) {
  const data = JSON.parse(jsonString);
  // Counts straight from the durable source, so the caller can prove "no data lost"
  // (DB counts after import must equal the source array lengths).
  const sourceCounts = {
    obra: data.obras?.length ?? 0,
    entrada: data.entradas?.length ?? 0,
    persona: data.personas?.length ?? 0,
    obra_creador: data.obra_creador?.length ?? 0
  };
  closeDb();
  if (poolUtil) {
    try {
      poolUtil.unlink(DB_FILENAME);
    } catch {
      /* file may not exist yet */
    }
  }
  openDb();
  applySchema(adapter, SCHEMA_SQL);
  importAll(adapter, data);
  return { ...verify(), sourceCounts };
}

// Serialize the live DB to the canonical export.json string (the durable artifact).
function exportJson() {
  const obj = exportAll(adapter, { exportadoEn: new Date().toISOString() });
  return JSON.stringify(obj);
}

// TEST / MANUAL: simulate OPFS loss by deleting the cache DB file. The next status()
// reports initialized=false, driving the reconstruction path without a page reload.
async function simulateOpfsLoss() {
  closeDb();
  if (poolUtil) {
    try {
      poolUtil.unlink(DB_FILENAME);
    } catch {
      /* ignore */
    }
  }
  openDb();
  return status();
}

// TEST: release all SAH handles + unregister the VFS so the page can clear OPFS wholesale
// (Playwright wipes navigator.storage afterwards, then reloads).
async function releaseForWipe() {
  closeDb();
  if (poolUtil) {
    try {
      await poolUtil.removeVfs();
    } catch {
      /* ignore */
    }
  }
  poolUtil = null;
  return { released: true };
}

const HANDLERS = {
  init: ({ wasmUrl }) => initEngine(wasmUrl).then(status),
  status: () => status(),
  verify: () => verify(),
  exportJson: () => exportJson(),
  rebuildFromExport: ({ json }) => rebuildFromExport(json),
  simulateOpfsLoss: () => simulateOpfsLoss(),
  releaseForWipe: () => releaseForWipe()
};

self.onmessage = async (e) => {
  const { id, method, args } = e.data || {};
  const handler = HANDLERS[method];
  if (!handler) {
    self.postMessage({ id, ok: false, error: `unknown method: ${method}` });
    return;
  }
  try {
    const result = await handler(args || {});
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
