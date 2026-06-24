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

export function isTestDurableMode() {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('durable') === 'idb') return true;
  } catch {
    /* ignore */
  }
  return window.__OCIO_TEST_DURABLE__ === 'idb';
}

/**
 * Re-create the durable store from prior state, WITHOUT prompting the user.
 * Returns { store, needsPermission } or null if nothing persisted / first run.
 */
export async function loadPersistedStore(caps) {
  if (isTestDurableMode()) return { store: new IdbDurableStore(), needsPermission: false };

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
  if (isTestDurableMode()) return { store: new IdbDurableStore(), needsPermission: false };

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
