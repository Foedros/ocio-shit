// ════════════════════════════════════════════════════════════════════════════
// Motion — fundación (Tanda 1). Helpers compartidos por TODAS las animaciones.
// Reglas: (1) duraciones/easings = tokens CSS de +layout.svelte (--dur-*/--ease-*);
// (2) toda animación JS (rAF) respeta prefersReducedMotion() — la CSS la mata el
// bloque global de +layout; (3) para MUELLES usar svelte/motion (spring/tweened)
// directamente en el componente — NO reinventar física aquí.
// ════════════════════════════════════════════════════════════════════════════

/** Duraciones canónicas en ms (espejo de --dur-fast/base/slow para animación JS). */
export const DUR = { fast: 150, base: 300, slow: 600 };

/** ease-out-expo (espejo JS de --ease-out-expo): arranca rápido, frena elegante. */
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** ¿El usuario pidió menos movimiento? Las animaciones JS deben saltar al estado final. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Formato europeo MANUAL (constraint dura del proyecto: no fiarse del ICU del navegador):
 *  punto de miles, coma decimal. fmtCount(6211.5, 1) → "6.211,5". */
export function fmtCount(n, decimals = 0) {
  const v = Number(n) || 0;
  const [int, dec] = Math.abs(v).toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (v < 0 ? '-' : '') + grouped + (dec ? ',' + dec : '');
}

/**
 * Acción count-up: anima el textContent de 0 → valor con ease-out-expo y formato europeo.
 *   use:countUp={82.92}  ·  use:countUp={{ value: 4480, decimals: 0, duration: 600 }}
 * Con reduced-motion (o duration 0) pinta el valor final directamente. `update` re-anima
 * desde el valor mostrado cuando el dato cambia (paneles en vivo).
 */
export function countUp(node, params) {
  let raf = null;
  let shown = 0;

  const norm = (p) => (typeof p === 'object' && p !== null ? p : { value: p });

  function render(v, decimals) {
    node.textContent = fmtCount(v, decimals);
  }

  function run(p) {
    const { value = 0, decimals = 0, duration = DUR.slow } = norm(p);
    cancelAnimationFrame(raf);
    if (prefersReducedMotion() || duration <= 0) {
      shown = value;
      render(value, decimals);
      return;
    }
    const from = shown;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      shown = from + (value - from) * easeOutExpo(t);
      render(t >= 1 ? value : shown, decimals);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  run(params);
  return {
    update(p) {
      run(p);
    },
    destroy() {
      cancelAnimationFrame(raf);
    }
  };
}

/**
 * Acción inView: UN IntersectionObserver COMPARTIDO para todos los nodos (no uno por celda).
 *   use:inView={(visible, entry) => { ... }}
 *   use:inView={{ cb, once: true, threshold: 0.25 }}   (threshold distinto → observer aparte)
 * `once: true` deja de observar tras la primera entrada (reveals de una sola vez).
 */
const observers = new Map(); // threshold → { io, cbs: Map<node, {cb, once}> }
function getObserver(threshold) {
  let o = observers.get(threshold);
  if (!o) {
    const cbs = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const reg = cbs.get(entry.target);
          if (!reg) continue;
          reg.cb(entry.isIntersecting, entry);
          if (reg.once && entry.isIntersecting) {
            io.unobserve(entry.target);
            cbs.delete(entry.target);
          }
        }
      },
      { threshold }
    );
    o = { io, cbs };
    observers.set(threshold, o);
  }
  return o;
}

export function inView(node, params) {
  const norm = (p) => (typeof p === 'function' ? { cb: p } : p || {});
  let { cb, once = false, threshold = 0.2 } = norm(params);
  let o = getObserver(threshold);
  o.cbs.set(node, { cb, once });
  o.io.observe(node);
  return {
    update(p) {
      ({ cb, once = false, threshold = 0.2 } = norm(p));
      const reg = o.cbs.get(node);
      if (reg) {
        reg.cb = cb;
        reg.once = once;
      }
    },
    destroy() {
      o.io.unobserve(node);
      o.cbs.delete(node);
    }
  };
}
