// Durable store backed by IndexedDB.
//
// PURPOSE: automated testing. IndexedDB survives a page reload INDEPENDENTLY of the
// OPFS-SAH-pool cache, so the E2E test can: seed a durable export here -> import to OPFS
// -> wipe OPFS -> reload -> reconstruct from here. It exercises the EXACT reconstruction
// code path; only the storage backend differs from production's real-disk FsaDurableStore.
//
// It is NOT offered as a real durability option in the UI: IndexedDB is browser storage
// and is wiped by the same events that wipe OPFS, so it would give false confidence.
import { idbGet, idbSet } from './idb.js';

const KEY = 'test-durable-export';
const KEY_AT = 'test-durable-export-at';

export class IdbDurableStore {
  constructor() {
    this.kind = 'idb';
  }
  describe() {
    return 'IndexedDB (modo test)';
  }
  isAutomatic() {
    return true;
  }
  async hasPermission() {
    return true;
  }
  async ensurePermission() {
    return true;
  }
  async readExport() {
    return (await idbGet(KEY)) ?? null;
  }
  async writeExportAtomic(text) {
    await idbSet(KEY, text);
    const at = Date.now();
    await idbSet(KEY_AT, at);
    return { at };
  }
  async getLastBackupTime() {
    return (await idbGet(KEY_AT)) ?? null;
  }
}
