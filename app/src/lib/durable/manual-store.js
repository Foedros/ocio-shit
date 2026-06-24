// Degraded durable store for browsers WITHOUT the File System Access API (Safari, Firefox).
//
// We cannot silently write to the user's disk here, so durability becomes MANUAL and the UI
// says so loudly (capabilities.mode === 'manual'). "Writing" downloads the export.json so the
// user keeps their own copy; reconstruction asks the user to pick that file back.
const LAST_AT = 'ocioshit:manual-backup-at';

export class ManualDurableStore {
  constructor() {
    this.kind = 'manual';
    this._pickedText = null;
  }
  describe() {
    return 'Descarga manual (sin File System Access API)';
  }
  isAutomatic() {
    return false;
  }
  async hasPermission() {
    return true;
  }
  async ensurePermission() {
    return true;
  }

  /** Reconstruction provides the file the user picked; otherwise nothing to read. */
  async readExport() {
    return this._pickedText;
  }
  setPickedText(text) {
    this._pickedText = text;
  }

  /** "Write" = trigger a download so the user keeps a durable copy themselves. */
  async writeExportAtomic(text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocioshit.export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const at = Date.now();
    try {
      localStorage.setItem(LAST_AT, String(at));
    } catch {
      /* ignore */
    }
    return { at };
  }

  async getLastBackupTime() {
    try {
      const v = localStorage.getItem(LAST_AT);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  }
}
