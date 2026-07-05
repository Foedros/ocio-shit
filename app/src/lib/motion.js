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

// ── Shared element "carátula que vuela" (View Transitions API, Tanda 3) ─────────────────
// flyOpen(el, apply): marca la carátula ORIGEN con view-transition-name y ejecuta `apply`
// (que monta el detalle, cuyo cover lleva el MISMO nombre en el estado nuevo) dentro de
// document.startViewTransition → el navegador interpola posición/tamaño (la carátula
// "vuela"). flyBack(apply) hace el viaje inverso hacia el origen recordado.
// Fallback LIMPIO: sin API (Safari iOS <18), con reduced-motion o si el origen ya no está
// montado, `apply` corre directo (fade/sheet estándar — la navegación jamás se rompe).
let flyOrigin = null;

const vtAvailable = () =>
  typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && !prefersReducedMotion();

export function flyClearOrigin() {
  flyOrigin = null;
}

export async function flyOpen(el, apply) {
  flyOrigin = el && el.isConnected ? el : null;
  if (!flyOrigin || !vtAvailable()) {
    await apply();
    return;
  }
  el.style.viewTransitionName = 'cover-fly';
  try {
    const vt = document.startViewTransition(async () => {
      el.style.viewTransitionName = ''; // el nombre pasa al cover del detalle (único por estado)
      await apply();
    });
    await vt.finished;
  } catch {
    el.style.viewTransitionName = '';
  }
}

export async function flyBack(apply) {
  const el = flyOrigin;
  flyOrigin = null;
  if (!el?.isConnected || !vtAvailable()) {
    await apply();
    return;
  }
  try {
    const vt = document.startViewTransition(async () => {
      await apply(); // desmonta el detalle…
      el.style.viewTransitionName = 'cover-fly'; // …y el nombre vuelve al origen
    });
    await vt.finished;
  } catch {
    /* transición saltada: la navegación ya se aplicó */
  } finally {
    el.style.viewTransitionName = '';
  }
}

/**
 * countUp + inView compuestos (el patrón de las pantallas de datos): pinta el valor FINAL
 * de inmediato (layout estable, nada de saltos) y, la PRIMERA vez que el nodo entra en el
 * viewport, cuenta 0→valor. Con reduced-motion se queda en el valor final (sin animación).
 *   use:countUpInView={{ value: 4480 }} · use:countUpInView={{ value: 82.92, decimals: 2 }}
 */
export function countUpInView(node, params) {
  const norm = (p) => (typeof p === 'object' && p !== null ? p : { value: p });
  let p = norm(params);
  let fired = false;
  let inner = null;
  node.textContent = fmtCount(p.value ?? 0, p.decimals ?? 0);
  if (prefersReducedMotion()) {
    return {
      update(np) {
        p = norm(np);
        node.textContent = fmtCount(p.value ?? 0, p.decimals ?? 0);
      }
    };
  }
  const obs = inView(node, {
    once: true,
    cb: (visible) => {
      if (!visible || fired) return;
      fired = true;
      inner = countUp(node, p);
    }
  });
  return {
    update(np) {
      p = norm(np);
      if (fired) inner?.update(p);
      else node.textContent = fmtCount(p.value ?? 0, p.decimals ?? 0);
    },
    destroy() {
      obs.destroy();
      inner?.destroy();
    }
  };
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
