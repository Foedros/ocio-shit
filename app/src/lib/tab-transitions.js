// TRANSICIONES DE PESTAÑA (§11.59-11.61) · diseño: diseno/Ocio Shit - Transiciones.html +
// diseno/Ocio Shit - Pagina WebGL.html. TRES formas, sorteo aleatorio en cada cambio de sección
// ENTRE LAS ACTIVAS en las preferencias del usuario (Cuenta → user_metadata.tab_tx; ausente =
// activa; 1 activa = siempre esa; 0 activas = fundido):
//   CINE · cinemascope — dos barras negras cierran (380ms) con una junta cálida donde se
//     encuentran, el swap ocurre detrás, y retraen (460ms ease-out-expo).
//   LITERATURA · pasar página — malla WebGL deformable (§11.61, lib/page-turn-gl.js): el folio
//     saliente pivota en el lomo izquierdo combándose hacia el usuario, la esquina inferior
//     derecha lidera con un pliegue diagonal, dorso de papel cálido, ~1000ms con overshoot
//     elástico. Sin WebGL → fundido.
//   VIDEOJUEGO · píxeles — 20×11 del acento en BARRIDO DIAGONAL (rango col+fila × 20ms + jitter
//     ≤34ms, 150ms scale .28): level-load ordenado, no ruido puro.
//   (CÓMIC · viñetas: RETIRADA en §11.61 — el pool queda en 3.)
// SOLO transform+opacity (y un canvas WebGL propio) sobre OVERLAYS position:fixed (z-15: bajo
// topbar 20 · mhead 30 · FAB 40, que permanecen quietos) → cero layout shift. reduced-motion =
// FUNDIDO simple SIEMPRE (340ms, clon del contenido saliente que se desvanece), por encima de
// las preferencias. Web Animations API / canvas propio, NO la View Transitions API → no compite
// con la "carátula que vuela" del detalle (verificado E2E). La Constelación queda FUERA
// (overlay fijo con su propia presentación e history) — lo decide navTo en +page.
import { get } from 'svelte/store';
import { prefersReducedMotion } from './motion.js';
import { pageTurn } from './page-turn-gl.js';
import { auth } from './stores.js';

const BG = '#0b0a08'; // --bg (los overlays no pueden leer var() con fiabilidad en gradientes inline)
const TYPES = ['cine', 'literatura', 'videojuego'];
// color de acento por sección DESTINO (píxeles del videojuego)
const ACCENT = {
  home: '#F2A65A', diario: '#C75D52', colecciones: '#5B9298', estadisticas: '#9580B0',
  timeline: '#C9A23F', wrapped: '#F2A65A', perfil: '#C9A23F', hall: '#F2A65A', cuenta: '#8A6F4A'
};

let active = false;

// contador de NAVEGACIONES: cada cambio de vista (animado o directo) lo incrementa. CINE difiere
// su swap 380ms — si en esa ventana entra OTRA navegación (swap directo por active=true, o la
// Constelación vía tabTxInterrupt), el swap diferido ya es VIEJO y no debe ejecutarse: revertía
// al usuario a la primera pestaña que tocó.
let seq = 0;

/** Navegación que cambia la vista FUERA de este módulo (Constelación en navTo): invalida
 *  cualquier swap diferido pendiente para que no la revierta. */
export function tabTxInterrupt() {
  seq++;
}

// formas activas según las preferencias del usuario (Cuenta): tab_tx[k] !== false. navTo pasa
// las prefs VIVAS de la UI (mezcla auth + flips optimistas) para que sorteo y toggles nunca
// diverjan; sin ellas se cae al auth store. Ausente = activa (por defecto las 3; una forma
// nueva futura entra activa sin migración).
function activePool(prefs) {
  const p = prefs ?? get(auth).user?.user_metadata?.tab_tx;
  return TYPES.filter((t) => p?.[t] !== false);
}

function layer() {
  const el = document.createElement('div');
  el.className = 'tabtx';
  el.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;';
  document.body.appendChild(el);
  return el;
}
const mark = (type) => {
  if (typeof window !== 'undefined' && window.__ocio) window.__ocio.lastTabTx = type; // test hook (?test=1)
};

/** Ejecuta `swap()` (el cambio real de vista) envuelto en una de las transiciones activas. */
export function tabTransition(swap, { to = '', prefs = null } = {}) {
  const my = ++seq; // esta navegación invalida cualquier swap diferido anterior
  if (typeof document === 'undefined' || active || document.hidden) {
    swap(); // nunca se pierde la navegación: sin animación si ya hay una en vuelo o pestaña oculta
    return;
  }
  active = true;
  const done = (els, ms) => setTimeout(() => { for (const e of els) e.remove(); active = false; }, ms);

  // reduced-motion: FUNDIDO simple SIEMPRE (por encima de las preferencias)
  if (prefersReducedMotion()) return fade(swap, done);

  const force = typeof window !== 'undefined' && window.__ocio?.forceTabTx;
  const pool = activePool(prefs);
  if (!force && pool.length === 0) return fade(swap, done); // 0 activas = fundido
  const type = force || pool[(Math.random() * pool.length) | 0]; // 1 activa = siempre esa
  mark(type);
  const accent = ACCENT[to] ?? '#F2A65A';
  if (type === 'cine') cine(swap, done, () => seq === my);
  else if (type === 'literatura') literatura(swap, done);
  else videojuego(accent, swap, done);
}

// ── FUNDIDO · clon del contenido saliente que se desvanece (reduced-motion / 0 activas /
//    fallback sin WebGL) — solo opacity ──
function fade(swap, done) {
  mark('fade');
  const wrap = layer();
  wrap.style.background = BG;
  clonePage(wrap);
  swap();
  wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'ease', fill: 'forwards' });
  done([wrap], 360);
}

// clona el contenido de sección actual (.page) en coordenadas de viewport (para fundir lo
// SALIENTE mientras lo nuevo ya vive debajo). Canvas no clona — la Constelación está excluida.
function clonePage(wrap) {
  const page = document.querySelector('.page');
  if (!page) return;
  const r = page.getBoundingClientRect();
  const clone = page.cloneNode(true);
  clone.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;`;
  wrap.appendChild(clone);
}

// ── CINE · cinemascope: dos barras negras cierran con junta cálida, swap detrás, retraen ──
function cine(swap, done, fresh) {
  const wrap = layer();
  const CLOSE = 380, OPEN = 460;
  const ei = 'cubic-bezier(.5,0,.5,1)', eo = 'cubic-bezier(.22,1,.3,1)';
  const barT = document.createElement('div');
  barT.style.cssText = 'position:absolute;left:0;right:0;top:0;height:52%;background:#060504;transform:translateY(-100%);will-change:transform;';
  const barB = document.createElement('div');
  barB.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:52%;background:#060504;transform:translateY(100%);will-change:transform;';
  // filete cálido donde las barras se encuentran
  const seam = document.createElement('div');
  seam.style.cssText = 'position:absolute;left:0;right:0;top:50%;height:2px;transform:translateY(-1px);opacity:0;' +
    'background:linear-gradient(90deg,transparent,#F2C88A 30%,#FBF1DF 50%,#F2C88A 70%,transparent);';
  wrap.append(barT, barB, seam);
  barT.animate([{ transform: 'translateY(-100%)' }, { transform: 'translateY(0)' }], { duration: CLOSE, easing: ei, fill: 'forwards' });
  barB.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: CLOSE, easing: ei, fill: 'forwards' });
  seam.animate([{ opacity: 0 }, { opacity: 0.95 }], { duration: CLOSE, easing: 'ease-in', fill: 'forwards' });
  setTimeout(() => {
    // a pantalla cubierta por las barras: lo nuevo entra sin verse el corte. Si durante el
    // cierre hubo OTRA navegación (swap directo / Constelación), SU vista ya está puesta y
    // este swap viejo la revertiría — se descarta y las barras solo se retiran.
    if (fresh()) swap();
    barT.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: OPEN, easing: eo, fill: 'forwards' });
    barB.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: OPEN, easing: eo, fill: 'forwards' });
    seam.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: OPEN * 0.5, easing: 'ease-out', fill: 'forwards' });
  }, CLOSE);
  done([wrap], CLOSE + OPEN + 30);
}

// ── LITERATURA · pasar página WebGL (page-turn-gl.js). Sin WebGL/textura → fundido ──
function literatura(swap, done) {
  const wrap = layer();
  let d = 0;
  try {
    d = pageTurn(wrap, swap);
  } catch {
    d = 0; // blindaje: una excepción imprevista en raster/GL no puede perder la navegación
  } //        ni dejar `active` atascado (el swap de fade es idempotente: view = v)
  if (d === 0) {
    wrap.remove();
    return fade(swap, done); // el swap ocurre dentro del fundido (o se re-aplica, inocuo)
  }
  if (d < 0) return; // congelada para captura (hook de test): el overlay se queda montado
  done([wrap], d + 60);
}

// ── VIDEOJUEGO · píxeles 20×11 del acento, barrido diagonal (col+fila) con jitter leve ──
function videojuego(accent, swap, done) {
  swap(); // lo nuevo entra cubierto por la rejilla, que se disuelve revelándolo
  const wrap = layer();
  wrap.style.display = 'grid';
  const cols = 20, rows = 11, base = 20;
  wrap.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  wrap.style.gridTemplateRows = `repeat(${rows},1fr)`;
  const N = cols * rows;
  const tiles = [];
  for (let i = 0; i < N; i++) {
    const t = document.createElement('div');
    t.style.cssText = `background:${accent};will-change:transform,opacity;`;
    wrap.appendChild(t);
    tiles.push({ el: t, col: i % cols, row: (i / cols) | 0 });
  }
  let maxDelay = 0;
  for (const t of tiles) {
    const delay = (t.col + t.row) * base + Math.random() * 34;
    if (delay > maxDelay) maxDelay = delay;
    t.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.28)' }], { duration: 150, delay, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' });
  }
  done([wrap], maxDelay + 170 + 40);
}
