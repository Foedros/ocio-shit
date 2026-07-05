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

// ── Tilt 3D holográfico (Tanda 5) ────────────────────────────────────────────────────────
// Acción para carátulas protagonistas (detalle + central de la Galería; NO el grid): rota
// sutilmente en 3D siguiendo cursor/dedo (rotateX/Y máx ~8°, perspective) con un BRILLO
// especular que recorre la superficie. Rendimiento: SOLO transform+opacity — el brillo es
// un gradiente PRE-HORNEADO al 200% movido con translate3d (cero repaints, ni del blur del
// modo cine); listeners passive; UN rAF por instancia (muelle propio, se para al asentar).
// Táctil: solo con dedo QUIETO ~150ms (si el dedo se desplaza antes o después, se cancela y
// el swipe/scroll siguen suyos — nunca preventDefault). Reduced-motion: no-op.
export function tilt(node, params = {}) {
  if (typeof window === 'undefined' || prefersReducedMotion()) return {};
  let { enabled = true, max = 8, touchDelay = 150, slop = 10 } = typeof params === 'object' ? params : {};

  const shine = document.createElement('div');
  shine.className = 'holo-shine';
  if (getComputedStyle(node).position === 'static') node.style.position = 'relative';
  node.appendChild(shine);

  let cur = { x: 0, y: 0 };
  let vel = { x: 0, y: 0 };
  let tgt = { x: 0, y: 0 };
  let sTgt = { x: 0.5, y: 0.5 };
  let sCur = { x: 0.5, y: 0.5 };
  let active = false;
  let raf = null;

  const apply = () => {
    node.style.transform = `perspective(650px) rotateX(${cur.x.toFixed(3)}deg) rotateY(${cur.y.toFixed(3)}deg)`;
    shine.style.transform = `translate3d(${((sCur.x - 1) * 50).toFixed(2)}%, ${((sCur.y - 1) * 50).toFixed(2)}%, 0)`;
  };
  const tick = () => {
    const K = 0.16, D = 0.74; // muelle: rigidez + amortiguación
    let energy = 0;
    for (const a of ['x', 'y']) {
      vel[a] = (vel[a] + (tgt[a] - cur[a]) * K) * D;
      cur[a] += vel[a];
      energy += Math.abs(vel[a]) + Math.abs(tgt[a] - cur[a]);
      sCur[a === 'x' ? 'y' : 'x'] += (sTgt[a === 'x' ? 'y' : 'x'] - sCur[a === 'x' ? 'y' : 'x']) * 0.25;
    }
    apply();
    if (active || energy > 0.01) raf = requestAnimationFrame(tick);
    else {
      cur = { ...tgt };
      apply();
      raf = null;
    }
  };
  const wake = () => {
    if (raf == null) raf = requestAnimationFrame(tick);
  };

  function aim(clientX, clientY) {
    const r = node.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, (clientY - r.top) / r.height));
    tgt = { x: -(fy - 0.5) * 2 * max, y: (fx - 0.5) * 2 * max };
    sTgt = { x: fx, y: fy };
    wake();
  }
  function rest() {
    active = false;
    tgt = { x: 0, y: 0 };
    sTgt = { x: 0.5, y: 0.5 };
    shine.style.opacity = '0';
    wake();
  }
  function engage() {
    active = true;
    shine.style.opacity = '1';
    wake();
  }

  // ── ratón: hover directo ──
  const onEnter = (e) => {
    if (!enabled || e.pointerType === 'touch') return;
    engage();
    aim(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (e.pointerType === 'touch') {
      touchMove(e);
      return;
    }
    if (active) aim(e.clientX, e.clientY);
  };
  const onLeave = (e) => {
    if (e.pointerType === 'touch') return;
    rest();
  };

  // ── táctil: dedo quieto ~150ms activa; desplazarse cancela (el swipe manda) ──
  let tTimer = null;
  let t0 = null;
  const onDown = (e) => {
    if (!enabled || e.pointerType !== 'touch') return;
    t0 = { x: e.clientX, y: e.clientY };
    clearTimeout(tTimer);
    tTimer = setTimeout(() => {
      if (!t0) return;
      engage();
      aim(t0.x, t0.y);
    }, touchDelay);
  };
  function touchMove(e) {
    if (!t0) return;
    const d = Math.hypot(e.clientX - t0.x, e.clientY - t0.y);
    if (!active) {
      if (d > slop) {
        clearTimeout(tTimer); // empezó un swipe/scroll antes de armar → nunca activar
        t0 = null;
      }
      return;
    }
    if (d > slop * 2.2) {
      t0 = null;
      rest(); // desplazamiento real tras activar → el gesto de desplazar manda
      return;
    }
    aim(e.clientX, e.clientY);
  }
  const onUp = (e) => {
    if (e.pointerType !== 'touch') return;
    clearTimeout(tTimer);
    t0 = null;
    if (active) rest();
  };

  const OPT = { passive: true };
  node.addEventListener('pointerenter', onEnter, OPT);
  node.addEventListener('pointermove', onMove, OPT);
  node.addEventListener('pointerleave', onLeave, OPT);
  node.addEventListener('pointerdown', onDown, OPT);
  node.addEventListener('pointerup', onUp, OPT);
  node.addEventListener('pointercancel', onUp, OPT);

  return {
    update(p) {
      const np = typeof p === 'object' && p !== null ? p : {};
      const was = enabled;
      ({ enabled = true, max = 8, touchDelay = 150, slop = 10 } = np);
      if (was && !enabled) {
        clearTimeout(tTimer);
        t0 = null;
        rest();
      }
    },
    destroy() {
      clearTimeout(tTimer);
      cancelAnimationFrame(raf);
      node.removeEventListener('pointerenter', onEnter, OPT);
      node.removeEventListener('pointermove', onMove, OPT);
      node.removeEventListener('pointerleave', onLeave, OPT);
      node.removeEventListener('pointerdown', onDown, OPT);
      node.removeEventListener('pointerup', onUp, OPT);
      node.removeEventListener('pointercancel', onUp, OPT);
      shine.remove();
    }
  };
}

// ── Confeti de categoría (Tanda 4) ───────────────────────────────────────────────────────
// Micro-explosión de partículas del color de la categoría al guardar una entrada, desde el
// botón Guardar. Canvas efímero fixed (pointer-events none) → NO bloquea el guardado ni el
// cierre del sheet (sobrevive al desmontaje del botón: el caller pasa el PUNTO, no el nodo).
// Física simple: velocidad radial + gravedad + fade. Con reduced-motion: no-op.
export function confettiBurst({ x, y }, color, { count = 26, duration = 800 } = {}) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const SIZE = 340;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti-burst';
  canvas.dataset.color = color; // verificable en tests
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.style.cssText = `position:fixed;left:${x - SIZE / 2}px;top:${y - SIZE / 2}px;width:${SIZE}px;height:${SIZE}px;pointer-events:none;z-index:200;`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // tonos: el color de la categoría + variante clara y oscura (sin ICU ni color-mix: hex a mano)
  const n = parseInt(color.replace('#', ''), 16);
  const mix = (k) => {
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const t = k > 0 ? 255 : 0, a = Math.abs(k);
    return `rgb(${ch(r + (t - r) * a)},${ch(g + (t - g) * a)},${ch(b + (t - b) * a)})`;
  };
  const shades = [mix(0), mix(0.28), mix(-0.22)];

  const parts = Array.from({ length: count }, (_, i) => {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 120 + Math.random() * 200; // px/s radial
    return {
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 60, // ligero impulso hacia arriba
      s: 3 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 10,
      c: shades[i % shades.length]
    };
  });

  document.body.appendChild(canvas);
  const G = 900; // px/s²
  const t0 = performance.now();
  const tick = (now) => {
    const t = (now - t0) / 1000;
    const p = (now - t0) / duration;
    if (p >= 1) {
      canvas.remove();
      return;
    }
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.globalAlpha = 1 - easeOutExpo(p) * 0.2 - p * 0.8; // fade
    for (const q of parts) {
      const px = SIZE / 2 + q.vx * t;
      const py = SIZE / 2 + q.vy * t + 0.5 * G * t * t;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(q.rot + q.vr * t);
      ctx.fillStyle = q.c;
      ctx.fillRect(-q.s / 2, -q.s / 2, q.s, q.s * 0.72);
      ctx.restore();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
