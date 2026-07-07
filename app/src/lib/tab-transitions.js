// TRANSICIONES DE PESTAÑA (§11.59, refinadas §11.60) · diseño: diseno/Ocio Shit - Transiciones.html
// Cuatro formas, sorteo aleatorio en cada cambio de sección — duraciones/curvas/efectos del bundle:
//   CINE · cinemascope — dos barras negras cierran (380ms) con una junta cálida donde se
//     encuentran, el swap ocurre detrás, y retraen (460ms ease-out-expo).
//   LITERATURA · página — la hoja saliente (clon opaco del .page) voltea desde el lomo izquierdo
//     (780ms, 3 keyframes −46°→−152°, perspectiva 1900px origen 32%) con doble luz: sombra
//     ambiental sobre lo nuevo (se disipa) + iluminación cálida→sombra en la propia hoja.
//   CÓMIC · viñetas — rejilla 3×2 (gutter 7px, filete 1px del acento) resuelta en ORDEN DE
//     LECTURA (90ms/viñeta, 380ms con leve overshoot, scale .9).
//   VIDEOJUEGO · píxeles — 20×11 del acento en BARRIDO DIAGONAL (rango col+fila × 20ms + jitter
//     ≤34ms, 150ms scale .28): level-load ordenado, no ruido puro.
// SOLO transform+opacity sobre OVERLAYS position:fixed (z-15: bajo topbar 20 · mhead 30 · FAB 40,
// que permanecen quietos) → cero layout shift. reduced-motion = FUNDIDO simple (340ms, clon del
// contenido saliente que se desvanece). Web Animations API, NO la View Transitions API → no
// compite con la "carátula que vuela" del detalle (verificado E2E). La Constelación queda FUERA
// (overlay fijo con su propia presentación e history) — lo decide navTo en +page.
import { prefersReducedMotion } from './motion.js';

const BG = '#0b0a08'; // --bg (los overlays no pueden leer var() con fiabilidad en gradientes inline)
const TYPES = ['cine', 'literatura', 'comic', 'videojuego'];
// color de acento por sección DESTINO (viñetas del cómic / píxeles del videojuego)
const ACCENT = {
  home: '#F2A65A', diario: '#C75D52', colecciones: '#5B9298', estadisticas: '#9580B0',
  timeline: '#C9A23F', wrapped: '#F2A65A', perfil: '#C9A23F', hall: '#F2A65A', cuenta: '#8A6F4A'
};

let active = false;

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

/** Ejecuta `swap()` (el cambio real de vista) envuelto en una de las 4 transiciones. */
export function tabTransition(swap, { to = '' } = {}) {
  if (typeof document === 'undefined' || active || document.hidden) {
    swap(); // nunca se pierde la navegación: sin animación si ya hay una en vuelo o pestaña oculta
    return;
  }
  active = true;
  const done = (els, ms) => setTimeout(() => { for (const e of els) e.remove(); active = false; }, ms);

  // reduced-motion: FUNDIDO simple — clon del contenido saliente que se desvanece (solo opacity)
  if (prefersReducedMotion()) {
    mark('fade');
    const wrap = layer();
    wrap.style.background = BG;
    clonePage(wrap);
    swap();
    wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: 'ease', fill: 'forwards' });
    done([wrap], 360);
    return;
  }

  const type = (typeof window !== 'undefined' && window.__ocio?.forceTabTx) || TYPES[(Math.random() * 4) | 0];
  mark(type);
  const accent = ACCENT[to] ?? '#F2A65A';
  if (type === 'cine') cine(swap, done);
  else if (type === 'literatura') literatura(swap, done);
  else tiles(type, accent, swap, done);
}

// clona el contenido de sección actual (.page) en coordenadas de viewport (para voltear/fundir
// lo SALIENTE mientras lo nuevo ya vive debajo). Canvas no clona — la Constelación está excluida.
function clonePage(wrap) {
  const page = document.querySelector('.page');
  if (!page) return;
  const r = page.getBoundingClientRect();
  const clone = page.cloneNode(true);
  clone.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;margin:0;`;
  wrap.appendChild(clone);
}

// ── CINE · cinemascope: dos barras negras cierran con junta cálida, swap detrás, retraen ──
function cine(swap, done) {
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
    swap(); // a pantalla cubierta por las barras: lo nuevo entra sin verse el corte
    barT.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-100%)' }], { duration: OPEN, easing: eo, fill: 'forwards' });
    barB.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(100%)' }], { duration: OPEN, easing: eo, fill: 'forwards' });
    seam.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: OPEN * 0.5, easing: 'ease-out', fill: 'forwards' });
  }, CLOSE);
  done([wrap], CLOSE + OPEN + 30);
}

// ── LITERATURA · página: la hoja saliente voltea desde el lomo izquierdo, con doble luz ──
function literatura(swap, done) {
  const D = 780;
  const wrap = layer();
  wrap.style.perspective = '1900px';
  wrap.style.perspectiveOrigin = '32% 50%';
  // sombra AMBIENTAL sobre lo nuevo (aún cubierto): se disipa mientras la hoja se levanta
  const cast = document.createElement('div');
  cast.style.cssText = 'position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.42),rgba(0,0,0,0) 55%);opacity:1;';
  wrap.appendChild(cast);
  const holder = document.createElement('div');
  holder.style.cssText = `position:absolute;inset:0;transform-origin:left center;backface-visibility:hidden;will-change:transform;background:${BG};overflow:hidden;`;
  clonePage(holder);
  // iluminación de la hoja que gira: brillo cálido junto al lomo, sombra creciente al borde lejano
  const shade = document.createElement('div');
  shade.style.cssText = 'position:absolute;inset:0;opacity:0;' +
    'background:linear-gradient(90deg,rgba(255,247,235,.12),rgba(0,0,0,0) 26%,rgba(0,0,0,.32) 84%,rgba(0,0,0,.52));';
  holder.appendChild(shade);
  wrap.appendChild(holder);
  swap(); // lo nuevo ya vive DEBAJO de la página que voltea
  holder.animate(
    [
      { transform: 'rotateY(0deg)', offset: 0 },
      { transform: 'rotateY(-46deg)', offset: 0.4 },
      { transform: 'rotateY(-152deg)', offset: 1 }
    ],
    { duration: D, easing: 'cubic-bezier(.42,0,.26,1)', fill: 'forwards' }
  );
  shade.animate([{ opacity: 0 }, { opacity: 1, offset: 0.55 }, { opacity: 0.82 }], { duration: D, easing: 'ease-in-out', fill: 'forwards' });
  cast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: D * 0.72, easing: 'ease-out', fill: 'forwards' });
  done([wrap], D + 30);
}

// ── CÓMIC (viñetas 3×2, orden de lectura) · VIDEOJUEGO (20×11, barrido diagonal + jitter) ──
function tiles(type, accent, swap, done) {
  swap(); // lo nuevo entra cubierto por la rejilla, que se disuelve revelándolo
  const wrap = layer();
  wrap.style.display = 'grid';
  let cols, rows, base;
  if (type === 'comic') {
    cols = 3; rows = 2; base = 90;
    wrap.style.gap = '7px';
    wrap.style.padding = '7px';
  } else {
    cols = 20; rows = 11; base = 20;
  }
  wrap.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  wrap.style.gridTemplateRows = `repeat(${rows},1fr)`;
  const N = cols * rows;
  const tiles = [];
  for (let i = 0; i < N; i++) {
    const t = document.createElement('div');
    t.style.cssText = type === 'comic'
      ? `background:${BG};box-shadow:inset 0 0 0 1px ${accent}66;border-radius:2px;will-change:transform,opacity;`
      : `background:${accent};will-change:transform,opacity;`;
    wrap.appendChild(t);
    tiles.push({ el: t, col: i % cols, row: (i / cols) | 0, i });
  }
  let maxDelay = 0;
  for (const t of tiles) {
    // cómic: stagger en ORDEN DE LECTURA · videojuego: barrido DIAGONAL (col+fila) con jitter leve
    const rank = type === 'comic' ? t.i : t.col + t.row;
    const delay = rank * base + (type === 'videojuego' ? Math.random() * 34 : 0);
    if (delay > maxDelay) maxDelay = delay;
    if (type === 'comic') {
      t.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 380, delay, easing: 'cubic-bezier(.34,1.16,.5,1)', fill: 'forwards' });
    } else {
      t.el.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.28)' }], { duration: 150, delay, easing: 'cubic-bezier(.6,0,.4,1)', fill: 'forwards' });
    }
  }
  const tail = type === 'comic' ? 400 : 170;
  done([wrap], maxDelay + tail + 40);
}
