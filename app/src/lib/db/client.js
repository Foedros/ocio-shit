// Main-thread client for the SQLite worker. Thin promise-based RPC: every call gets a
// correlation id; the worker replies with {id, ok, result|error}.
import { base } from '$app/paths';

export function createDbClient() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let seq = 0;

  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(result);
    else entry.reject(new Error(error));
  };
  worker.onerror = (e) => {
    // Surface worker-level failures to every in-flight call.
    for (const [, entry] of pending) entry.reject(new Error('worker error: ' + e.message));
    pending.clear();
  };

  function call(method, args) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, args });
    });
  }

  // Absolute, base-path-aware URL to the wasm copied into static/ by prepare-assets.
  const wasmUrl = new URL(`${base}/sqlite/sqlite3.wasm`, location.origin).href;

  return {
    init: () => call('init', { wasmUrl }),
    status: () => call('status'),
    verify: () => call('verify'),
    exportJson: () => call('exportJson'),
    rebuildFromExport: (json) => call('rebuildFromExport', { json }),
    simulateOpfsLoss: () => call('simulateOpfsLoss'),
    releaseForWipe: () => call('releaseForWipe'),
    terminate: () => worker.terminate()
  };
}
