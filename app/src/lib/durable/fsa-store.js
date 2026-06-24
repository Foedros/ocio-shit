// Durable store backed by the File System Access API: a real directory the user picks
// once. This is the DURABLE TRUTH (tecnico.md §1/§3.2) — the only layer that survives a
// browser/OPFS wipe. Writes are ATOMIC: the live file is never written in place.
//
// File names inside the chosen directory:
//   ocioshit.export.json       <- the durable truth
//   ocioshit.export.prev.json  <- previous generation (one-deep safety net)
//   ocioshit.export.json.tmp   <- scratch; fully written, then renamed into place
export const TARGET = 'ocioshit.export.json';
const PREV = 'ocioshit.export.prev.json';
const TMP = 'ocioshit.export.json.tmp';

const supportsMove =
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof FileSystemFileHandle.prototype.move === 'function';

export class FsaDurableStore {
  /** @param {FileSystemDirectoryHandle} dir */
  constructor(dir) {
    this.dir = dir;
    this.kind = 'fsa';
  }

  describe() {
    return this.dir?.name ?? '(carpeta)';
  }

  isAutomatic() {
    return true;
  }

  async hasPermission() {
    if (!this.dir) return false;
    return (await this.dir.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  /** Re-grant access (Chromium re-prompts after a reload). Needs a user gesture. */
  async ensurePermission() {
    if (!this.dir) throw new Error('sin carpeta durable');
    const opts = { mode: 'readwrite' };
    if ((await this.dir.queryPermission(opts)) === 'granted') return true;
    return (await this.dir.requestPermission(opts)) === 'granted';
  }

  async _readFile(name) {
    try {
      const h = await this.dir.getFileHandle(name);
      return await (await h.getFile()).text();
    } catch {
      return null;
    }
  }

  /** Read the durable export; falls back to prev/tmp if the live file is missing. */
  async readExport() {
    return (
      (await this._readFile(TARGET)) ??
      (await this._readFile(PREV)) ??
      (await this._readFile(TMP))
    );
  }

  /** Atomic write: fully write a temp file, rotate the old target to prev, rename temp in. */
  async writeExportAtomic(text) {
    if (!(await this.ensurePermission())) throw new Error('permiso denegado sobre la carpeta');

    // 1. Write the full payload to a temp file and commit it (close swaps atomically).
    const tmpH = await this.dir.getFileHandle(TMP, { create: true });
    const w = await tmpH.createWritable({ keepExistingData: false });
    await w.write(text);
    await w.close();

    if (supportsMove) {
      // 2. Rotate the current target to prev (atomic rename; replaces old prev).
      try {
        const curH = await this.dir.getFileHandle(TARGET);
        await curH.move(PREV);
      } catch {
        /* first write: no existing target */
      }
      // 3. Rename temp -> target (atomic). Retry through a remove if the dest lingers.
      try {
        await tmpH.move(TARGET);
      } catch {
        try {
          await this.dir.removeEntry(TARGET);
        } catch {
          /* ignore */
        }
        await tmpH.move(TARGET);
      }
    } else {
      // No move(): createWritable on the target is itself commit-on-close atomic.
      const tH = await this.dir.getFileHandle(TARGET, { create: true });
      const w2 = await tH.createWritable({ keepExistingData: false });
      await w2.write(text);
      await w2.close();
      try {
        await this.dir.removeEntry(TMP);
      } catch {
        /* ignore */
      }
    }
    return { at: Date.now() };
  }

  /** Last-modified time (ms) of the durable export, or null if none yet. */
  async getLastBackupTime() {
    for (const name of [TARGET, PREV]) {
      try {
        const h = await this.dir.getFileHandle(name);
        return (await h.getFile()).lastModified;
      } catch {
        /* try next */
      }
    }
    return null;
  }
}
