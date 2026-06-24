// Unit test for the File System Access atomic-write algorithm (FsaDurableStore).
//
// The real directory picker can't be automated, so the E2E test uses an IndexedDB backend.
// This test closes that gap deterministically: it drives FsaDurableStore against an
// in-memory mock of the File System Access API that implements createWritable (commit on
// close), move() (atomic rename, overwrite) and removeEntry — proving temp+rename, the
// prev rotation, and the read fallback chain (target -> prev -> tmp).

let failures = 0;
function check(label, cond, extra = '') {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

// --- In-memory File System Access mock -------------------------------------------------
let clock = 1000;
class MockWritable {
  constructor(fileRef) {
    this.fileRef = fileRef;
    this.buf = '';
  }
  async write(data) {
    this.buf += data;
  }
  async close() {
    // Commit atomically on close (matches createWritable semantics).
    this.fileRef.content = this.buf;
    this.fileRef.lastModified = ++clock;
  }
}
class MockFileHandle {
  constructor(dir, name) {
    this.dir = dir;
    this.name = name;
    this.content = '';
    this.lastModified = ++clock;
  }
  async getFile() {
    const self = this;
    return { lastModified: self.lastModified, async text() { return self.content; } };
  }
  async createWritable() {
    return new MockWritable(this);
  }
  async move(newName) {
    // Atomic rename within the same directory; overwrite any existing entry.
    this.dir.files.delete(this.name);
    this.dir.files.set(newName, this);
    this.name = newName;
  }
}
class MockDirHandle {
  constructor(name = 'durable') {
    this.name = name;
    this.files = new Map();
  }
  async getFileHandle(name, opts = {}) {
    if (!this.files.has(name)) {
      if (!opts.create) {
        const err = new Error('NotFound');
        err.name = 'NotFoundError';
        throw err;
      }
      this.files.set(name, new MockFileHandle(this, name));
    }
    return this.files.get(name);
  }
  async removeEntry(name) {
    this.files.delete(name);
  }
  async queryPermission() {
    return 'granted';
  }
  async requestPermission() {
    return 'granted';
  }
}

// Enable the move() path (production/Chromium) before importing the module under test.
globalThis.FileSystemFileHandle = MockFileHandle;
const { FsaDurableStore } = await import('../src/lib/durable/fsa-store.js');

console.log('\nOcio Shit — FsaDurableStore atomic-write test\n');

const dir = new MockDirHandle('MiArchivo');
const store = new FsaDurableStore(dir);

// 1. First write: target exists with correct content; no prev yet; tmp cleaned/renamed away.
await store.writeExportAtomic('{"v":1}');
check('after 1st write: target present', dir.files.has('ocioshit.export.json'));
check('after 1st write: target content correct', (await store.readExport()) === '{"v":1}');
check('after 1st write: no leftover .tmp', !dir.files.has('ocioshit.export.json.tmp'));
check('after 1st write: no prev yet', !dir.files.has('ocioshit.export.prev.json'));
const t1 = await store.getLastBackupTime();
check('after 1st write: lastBackupTime is set', typeof t1 === 'number' && t1 > 0);

// 2. Second write: target = new, prev = old (atomic rotation), still no leftover tmp.
await store.writeExportAtomic('{"v":2}');
check('after 2nd write: target is new', (await store.readExport()) === '{"v":2}');
check('after 2nd write: prev holds old', dir.files.get('ocioshit.export.prev.json')?.content === '{"v":1}');
check('after 2nd write: no leftover .tmp', !dir.files.has('ocioshit.export.json.tmp'));

// 3. Read fallback: if target is missing, readExport falls back to prev.
dir.files.delete('ocioshit.export.json');
check('read fallback: returns prev when target gone', (await store.readExport()) === '{"v":1}');

// 4. Read fallback: if target and prev are gone, falls back to tmp.
dir.files.delete('ocioshit.export.prev.json');
const tmp = await dir.getFileHandle('ocioshit.export.json.tmp', { create: true });
const w = await tmp.createWritable();
await w.write('{"v":"tmp"}');
await w.close();
check('read fallback: returns tmp as last resort', (await store.readExport()) === '{"v":"tmp"}');

// 5. Nothing present -> null.
dir.files.clear();
check('empty dir: readExport returns null', (await store.readExport()) === null);

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
