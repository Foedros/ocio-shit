// Durable-store factory + directory-handle persistence.
//
// Chooses the right backend:
//   - test mode (?durable=idb)  -> IdbDurableStore   (E2E: survives reload, separate from OPFS)
//   - File System Access (auto) -> FsaDurableStore    (real disk, the production durable truth)
//   - otherwise (manual)        -> ManualDurableStore (download/upload; degraded, UI warns)
//
// The chosen directory handle is persisted in IndexedDB so the user picks the folder ONCE.
import { idbGet, idbSet, idbDelete } from './idb.js';
import { FsaDurableStore } from './fsa-store.js';
import { IdbDurableStore } from './idb-store.js';
import { ManualDurableStore } from './manual-store.js';

const HANDLE_KEY = 'durable-dir-handle';

// Test-only durable backends, selected with ?durable=<kind>:
//   idb       -> IndexedDB (survives reload independently of OPFS; durability E2E)
//   fsa-opfs  -> a real FsaDurableStore over an OPFS subdirectory (exercises the REAL
//                atomic-write code on real File System Access handles; alta-durability E2E)
function testDurableKind() {
  if (typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('durable');
    if (v === 'idb' || v === 'fsa-opfs') return v;
  } catch {
    /* ignore */
  }
  return window.__OCIO_TEST_DURABLE__ ?? null;
}

export function isTestDurableMode() {
  return testDurableKind() != null;
}

async function makeTestStore(kind) {
  if (kind === 'fsa-opfs') {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('durable-fsa', { create: true });
    return new FsaDurableStore(dir);
  }
  return new IdbDurableStore();
}

/**
 * Re-create the durable store from prior state, WITHOUT prompting the user.
 * Returns { store, needsPermission } or null if nothing persisted / first run.
 */
export async function loadPersistedStore(caps) {
  const kind = testDurableKind();
  if (kind) return { store: await makeTestStore(kind), needsPermission: false };

  if (caps.supportsFileSystemAccess) {
    const handle = await idbGet(HANDLE_KEY);
    if (!handle) return null;
    const store = new FsaDurableStore(handle);
    const granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
    return { store, needsPermission: !granted };
  }

  // Manual mode keeps no handle; nothing to restore until the user acts.
  return null;
}

/**
 * Interactive: let the user choose the durable target. Needs a user gesture.
 * Returns { store, needsPermission }.
 */
export async function chooseDurableTarget(caps) {
  const kind = testDurableKind();
  if (kind) return { store: await makeTestStore(kind), needsPermission: false };

  if (caps.supportsFileSystemAccess) {
    const handle = await window.showDirectoryPicker({
      id: 'ocioshit-durable',
      mode: 'readwrite',
      startIn: 'documents'
    });
    const granted = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
    if (granted) await idbSet(HANDLE_KEY, handle);
    return { store: new FsaDurableStore(handle), needsPermission: !granted };
  }

  return { store: new ManualDurableStore(), needsPermission: false };
}

export async function forgetDurableTarget() {
  await idbDelete(HANDLE_KEY);
}
