// Reactive state for the durability dashboard.
import { writable } from 'svelte/store';

// Boot/recovery phase:
//   init | ready | reconstructed | needs-setup | needs-seed | needs-permission | error
export const phase = writable('init');

export const caps = writable(null); // capabilities object
export const dbStatus = writable(null); // worker status() result
export const busy = writable(null); // current async op label, or null

export const durability = writable({
  mode: 'unknown', // 'auto' | 'manual'
  automatic: false,
  kind: null, // 'fsa' | 'idb' | 'manual'
  storeName: null, // human description of the durable target
  lastBackupAt: null, // ms timestamp of last durable write
  needsPermission: false
});

// Sprint 2 — multi-tab role + archive view
export const role = writable('init'); // 'leader' | 'follower' | 'init'
export const archiveEntries = writable([]); // current filtered list of entradas
export const archiveFilters = writable({ categoria: '', origen: '', fecha_tipo: '', search: '' });
export const filterOpts = writable({ categorias: [], origenes: [], fecha_tipos: [] });
export const detail = writable(null); // { kind:'obra'|'entrada', data } selected for the detail panel
export const colecciones = writable([]); // list of collections with n_obras
export const coleccionSel = writable(null); // { coleccion, obras } currently opened
export const toast = writable(null); // { msg, kind:'ok'|'error' } transient confirmation

let toastTimer;
export function showToast(msg, kind = 'ok') {
  toast.set({ msg, kind });
  if (typeof clearTimeout !== 'undefined') {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.set(null), 2600);
  }
}

export const events = writable([]); // [{ t, level, msg }]

export function logEvent(level, msg) {
  const entry = { t: Date.now(), level, msg };
  events.update((list) => [...list, entry].slice(-300));
  if (level === 'error') console.error('[ocio]', msg);
  else if (level === 'warn') console.warn('[ocio]', msg);
  else console.log('[ocio]', msg);
}
