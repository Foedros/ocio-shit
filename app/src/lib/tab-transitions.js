// TRANSICIONES DE PESTAÑA (§11.59) · diseño: diseno/Ocio Shit - Transiciones.html
// Cuatro formas, un ritmo común (~350ms, --ease-out-expo): al cambiar de sección se SORTEA una —
//   cine (diafragma que cierra/abre + parpadeo de proyector) · literatura (la página saliente
//   voltea desde el lomo izquierdo, con sombra) · cómic (viñetas que se resuelven en stagger) ·
//   videojuego (disolución pixelada tipo level-load, con el color de la sección destino).
// SOLO transform+opacity sobre OVERLAYS position:fixed (z-15: bajo topbar 20 · mhead 30 · FAB 40,
// que permanecen quietos como en el diseño) → cero layout shift. reduced-motion = FUNDIDO simple
// (clon del contenido saliente que se desvanece). Web Animations API, NO la View Transitions API
// → no compite con la "carátula que vuela" del detalle (la VT captura y las WAAPI siguen su
// timeline; los overlays se auto-retiran). La Constelación queda FUERA (overlay fijo con su
// propia presentación e history) — lo decide navTo en +page.
import { DUR, prefersReducedMotion } from './motion.js';

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'; // --ease-out-expo
const TX = DUR.base + 50; // ritmo común ~350ms (entre --dur-base y --dur-slow)
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
    wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR.base, easing: 'ease', fill: 'forwards' });
    done([wrap], DUR.base + 40);
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

// ── CINE · diafragma: iris que cierra sobre lo viejo, swap a oscuras, iris que abre + parpadeo ──
function cine(swap, done) {
  const wrap = layer();
  const iris = document.createElement('div');
  iris.style.cssText =
    'position:absolute;left:-100%;top:-100%;width:300%;height:300%;transform:scale(1.9);will-change:transform;' +
    `background:radial-gradient(circle at center, rgba(11,10,8,0) 0%, rgba(11,10,8,0) 21%, ${BG} 22%, ${BG} 100%);`;
  wrap.appendChild(iris);
  const flick = document.createElement('div');
  flick.style.cssText = `position:absolute;inset:0;background:#F2EBDD;opacity:0;`;
  wrap.appendChild(flick);
  const close = Math.round(TX * 0.4); // ~140ms cierre (ease-in), el resto apertura
  const open = TX - close;
  iris.animate([{ transform: 'scale(1.9)' }, { transform: 'scale(0.02)' }], { duration: close, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
  setTimeout(() => {
    swap(); // a pantalla (casi) cubierta: lo nuevo entra sin verse el corte
    iris.animate([{ transform: 'scale(0.02)' }, { transform: 'scale(1.9)' }], { duration: open, easing: EASE, fill: 'forwards' });
    flick.animate([{ opacity: 0 }, { opacity: 0.45 }, { opacity: 0 }, { opacity: 0.25 }, { opacity: 0 }], { duration: open, easing: 'linear' });
  }, close + 10);
  done([wrap], TX + 90);
}

// ── LITERATURA · página: lo SALIENTE (clon opaco) voltea desde el lomo izquierdo, con sombra ──
function literatura(swap, done) {
  const wrap = layer();
  wrap.style.perspective = '1600px';
  const holder = document.createElement('div');
  holder.style.cssText = `position:absolute;inset:0;transform-origin:left center;backface-visibility:hidden;will-change:transform;background:${BG};overflow:hidden;`;
  clonePage(holder);
  const shadow = document.createElement('div');
  shadow.style.cssText = 'position:absolute;inset:0;background:linear-gradient(90deg,rgba(0,0,0,.5),rgba(0,0,0,0) 60%);opacity:0;';
  holder.appendChild(shadow);
  wrap.appendChild(holder);
  swap(); // lo nuevo ya vive DEBAJO de la página que voltea
  holder.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-108deg)' }], { duration: TX, easing: EASE, fill: 'forwards' });
  shadow.animate([{ opacity: 0 }, { opacity: 0.6 }], { duration: TX, easing: EASE, fill: 'forwards' });
  done([wrap], TX + 60);
}

// ── CÓMIC (viñetas 3×2, stagger secuencial) · VIDEOJUEGO (12×7 píxeles, orden aleatorio) ──
function tiles(type, accent, swap, done) {
  swap(); // lo nuevo entra cubierto por la rejilla, que se disuelve revelándolo
  const wrap = layer();
  wrap.style.display = 'grid';
  let cols, rows, stagger, dur;
  if (type === 'comic') {
    cols = 3; rows = 2; stagger = 30; dur = 200;
    wrap.style.gap = '4px';
    wrap.style.padding = '4px';
  } else {
    cols = 12; rows = 7; stagger = 2; dur = 180;
    wrap.style.gap = '2px';
  }
  wrap.style.gridTemplateColumns = `repeat(${cols},1fr)`;
  wrap.style.gridTemplateRows = `repeat(${rows},1fr)`;
  const N = cols * rows;
  const order = [...Array(N).keys()];
  if (type === 'videojuego') order.sort(() => Math.random() - 0.5); // disolución pixelada
  const tls = [];
  for (let i = 0; i < N; i++) {
    const t = document.createElement('div');
    t.style.cssText = type === 'comic'
      ? `background:${BG};box-shadow:inset 0 0 0 1.5px ${accent}66;border-radius:3px;will-change:transform,opacity;`
      : `background:${accent};opacity:.92;will-change:transform,opacity;`;
    wrap.appendChild(t);
    tls.push(t);
  }
  order.forEach((tileIdx, k) => {
    const t = tls[tileIdx];
    if (type === 'comic') {
      t.animate([{ opacity: 1, transform: 'scale(1) rotate(0deg)' }, { opacity: 0, transform: 'scale(.86) rotate(2.5deg)' }], { duration: dur, delay: k * stagger, easing: EASE, fill: 'forwards' });
    } else {
      t.animate([{ opacity: 0.92, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.4)' }], { duration: dur, delay: k * stagger, easing: 'cubic-bezier(.7,0,.5,1)', fill: 'forwards' });
    }
  });
  done([wrap], N * stagger + dur + 40);
}
