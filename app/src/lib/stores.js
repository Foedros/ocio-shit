// Reactive state for the durability dashboard.
import { writable, derived } from 'svelte/store';

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

// Stage 3 (Supabase) — auth session of the single user
export const auth = writable({ session: null, user: null, ready: false });

// FUENTE ÚNICA del nombre de display: el `display_name` guardado en user_metadata de Supabase Auth
// (editable por el propio usuario); si no hay, se deriva del email (fde868686 → "Fde868686"). Tanto
// el hero de Home (01) como el carnet del Perfil (08) leen ESTE store — no se hardcodea en cada sitio.
export const displayName = derived(auth, ($a) => {
  const meta = $a.user?.user_metadata?.display_name;
  if (typeof meta === 'string' && meta.trim()) return meta.trim();
  const email = $a.user?.email;
  return email ? email.split('@')[0].replace(/^\w/, (c) => c.toUpperCase()) : 'Tú';
});

// Sprint 2 — multi-tab role + archive view
export const role = writable('init'); // 'leader' | 'follower' | 'init'
export const archiveEntries = writable([]); // current filtered list of entradas
export const archiveFilters = writable({ categoria: '', origen: '', fecha_tipo: '', search: '', en_curso: false, con_resena: false });
export const archiveView = writable('lista'); // 'lista' | 'galeria' — el toggle del Diario (persiste al navegar)
// Constelación de creadores (Tanda 8): overlay a pantalla completa. Vive como store porque el
// botón está en el Perfil (dentro de .page) pero el overlay se monta FUERA del wrapper con
// parallax (lección del FAB §11.43: will-change/transform crean containing block de los fixed).
export const constelOpen = writable(false);
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
