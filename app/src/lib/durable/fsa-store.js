// Durable store backed by the File System Access API: a real directory the user picks
// once. This is the DURABLE TRUTH (tecnico.md §1/§3.2) — the only layer that survives a
// browser/OPFS wipe. Writes are ATOMIC: the live file is never written in place.
//
// ROOT CAUSE FIXED (2026-06-24): the previous version promoted the temp file with
// FileSystemFileHandle.move() (rename). move() works on OPFS but is UNRELIABLE on the real
// local filesystem in Chromium (notably Windows): the calls threw, the catches swallowed
// them, and the folder was left with an orphan .tmp and no .prev rotation. Because OPFS and
// the in-memory mock both honour move(), every automated test passed while real disk broke.
//
// Durability cannot hinge on move(). Strategy now:
//   - Rotate .prev by COPY (read current target, write prev) — no move().
//   - Write the target with createWritable(), which ALREADY performs an atomic internal
//     temp(.crswap)+rename and commits only on close() — the OS-blessed atomic write.
//   - Keep move() only as an opportunistic fast path with an automatic copy fallback; once
//     it fails on a given filesystem, never try it again.
//   - GUARANTEE no orphan .tmp via a finally that always removes it.
//
// File names inside the chosen directory (steady state = exactly the first two):
//   ocioshit.export.json       <- the durable truth
//   ocioshit.export.prev.json  <- previous generation (one-deep safety net)
//   ocioshit.export.json.tmp   <- scratch (fast path only); never left behind
export const TARGET = 'ocioshit.export.json';
const PREV = 'ocioshit.export.prev.json';
const TMP = 'ocioshit.export.json.tmp';

const supportsMove =
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof FileSystemFileHandle.prototype.move === 'function';

export class FsaDurableStore {
  /**
   * @param {FileSystemDirectoryHandle} dir
   * @param {{ forceCopy?: boolean }} [opts] forceCopy simulates a filesystem whose move()
   *   is unreliable (used by tests to exercise the production fallback path deterministically).
   */
  constructor(dir, { forceCopy = false } = {}) {
    this.dir = dir;
    this.kind = 'fsa';
    this._forceCopy = forceCopy;
    this._moveBroken = false; // once move() fails on this folder, stop trying it
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

  // Atomic at the filesystem level: createWritable() writes to an internal swap file and
  // only renames it over `name` on close(). A crash mid-write leaves `name` untouched.
  async _writeFile(name, text) {
    const h = await this.dir.getFileHandle(name, { create: true });
    const w = await h.createWritable({ keepExistingData: false });
    await w.write(text);
    await w.close();
    return h;
  }

  /** Read the durable export; falls back to prev/tmp if the live file is missing. */
  async readExport() {
    return (
      (await this._readFile(TARGET)) ??
      (await this._readFile(PREV)) ??
      (await this._readFile(TMP))
    );
  }

  /**
   * Atomic durable write with one-deep .prev rotation. Final on-disk state after any
   * number of calls: exactly TARGET + PREV, never an orphan TMP.
   * @returns {Promise<{at:number, method:'rename'|'copy'}>}
   */
  async writeExportAtomic(text) {
    if (!(await this.ensurePermission())) throw new Error('permiso denegado sobre la carpeta');
    let method = 'copy';
    try {
      // 1. Rotate: copy the CURRENT target to prev BEFORE we touch it. Copy (read+write),
      //    not move() — robust on every filesystem. If the new write later fails, the old
      //    target stays intact AND prev holds the last good copy: no data can be lost.
      const cur = await this._readFile(TARGET);
      if (cur !== null) await this._writeFile(PREV, cur);

      // 2. Promote the new content into target.
      if (supportsMove && !this._forceCopy && !this._moveBroken) {
        // Fast path: explicit temp + atomic rename.
        await this._writeFile(TMP, text);
        try {
          const tmpH = await this.dir.getFileHandle(TMP);
          await tmpH.move(TARGET); // atomic rename (overwrites the existing target)
          method = 'rename';
        } catch {
          // move() is unreliable on this filesystem — fall back to a direct atomic write,
          // for this call and every future one on this folder.
          this._moveBroken = true;
          await this._writeFile(TARGET, text);
          method = 'copy';
        }
      } else {
        // Robust path: direct atomic write (createWritable does the temp+rename internally).
        await this._writeFile(TARGET, text);
        method = 'copy';
      }
    } finally {
      // 3. GUARANTEE no orphan temp, on every path and even if a step above threw.
      try {
        await this.dir.removeEntry(TMP);
      } catch {
        /* none present — fine */
      }
    }
    return { at: Date.now(), method };
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
