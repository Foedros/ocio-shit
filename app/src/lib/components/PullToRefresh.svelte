<script>
  // PULL-TO-REFRESH propio (Tanda 7, SOLO móvil): al tirar hacia abajo desde el TOPE de la
  // página, la corona del logo se dibuja en stroke proporcional al arrastre (0→100%); al
  // soltar pasado el umbral, PULSA mientras onrefresh() re-consulta la pantalla actual y se
  // retira con spring (transición --ease-spring). DISCIPLINA DE INTENCIÓN (lección §11.32):
  // solo arma si window.scrollY===0 y el PRIMER movimiento es claramente vertical hacia abajo
  // — un gesto horizontal (swipe de la Galería) o hacia arriba (scroll) lo descarta, y dentro
  // de sheets/drawer/scrollers internos con scroll propio ni se considera. El preventDefault
  // solo se emite ARMADO (touchmove no pasivo), y overscroll-behavior-y: contain (en +layout)
  // evita competir con el pull-to-refresh nativo. Reduced-motion: indicador ESTÁTICO (corona
  // completa, sin dibujo) — funcional igualmente.
  import { prefersReducedMotion, haptic } from '$lib/motion.js';

  let { onrefresh } = $props();

  const THRESH = 92; // px de arrastre efectivo para disparar
  const reduced = prefersReducedMotion();

  let crownEl = $state(null);
  let progress = $state(0); // 0..1
  let pull = $state(0); // px visuales del indicador
  let armed = $state(false);
  let refreshing = $state(false);
  let L = 0;

  let y0 = 0;
  let x0 = 0;
  let decided = false;
  let give = false;

  function reset() {
    armed = false;
    decided = false;
    give = false;
    progress = 0;
    pull = 0;
  }

  function ts(e) {
    if (refreshing || e.touches.length !== 1) return;
    if (window.matchMedia('(min-width: 701px)').matches) return; // solo móvil
    if (window.scrollY > 0) return; // solo desde el tope
    const t = e.target;
    // dentro de un sheet/drawer/constelación nunca; en un scroller interno solo si está en su tope
    if (t.closest?.('.sheet, .drawer, nav.panel, .constel')) return;
    const sc = t.closest?.('.viewport');
    if (sc && sc.scrollTop > 0) return;
    y0 = e.touches[0].clientY;
    x0 = e.touches[0].clientX;
    decided = false;
    give = false;
    armed = false;
  }

  function tm(e) {
    if (refreshing || give || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - y0;
    const dx = e.touches[0].clientX - x0;
    if (!decided) {
      if (Math.abs(dy) < 7 && Math.abs(dx) < 7) return; // aún sin intención
      decided = true;
      // vertical hacia ABAJO con claridad — si no, el gesto es de otro (scroll/swipe)
      if (dy > 0 && dy > Math.abs(dx) * 1.4 && window.scrollY <= 0) armed = true;
      else {
        give = true;
        return;
      }
    }
    if (!armed) return;
    if (e.cancelable) e.preventDefault(); // armado: el gesto es nuestro (listener no pasivo)
    const eff = Math.max(0, dy - 7);
    pull = Math.min(74, eff * 0.42); // resistencia
    progress = Math.min(1, eff / THRESH);
  }

  async function te() {
    if (give || !armed) {
      reset();
      return;
    }
    if (progress >= 1) {
      refreshing = true;
      progress = 1;
      pull = 58;
      haptic(10);
      const t0 = performance.now();
      try {
        await onrefresh?.();
      } catch {
        /* el refresco nunca revienta el gesto */
      }
      const rest = Math.max(0, 620 - (performance.now() - t0)); // pulso visible como mínimo
      await new Promise((r) => setTimeout(r, rest));
      refreshing = false;
    }
    reset();
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('touchstart', ts, { passive: true });
    window.addEventListener('touchmove', tm, { passive: false }); // preventDefault SOLO armado
    window.addEventListener('touchend', te, { passive: true });
    window.addEventListener('touchcancel', te, { passive: true });
    return () => {
      window.removeEventListener('touchstart', ts);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', te);
      window.removeEventListener('touchcancel', te);
    };
  });

  // corona dibujada en proporción al arrastre (reduced: completa y estática)
  $effect(() => {
    if (!crownEl) return;
    if (!L) L = crownEl.getTotalLength();
    if (reduced) {
      crownEl.style.strokeDasharray = 'none';
      crownEl.style.strokeDashoffset = '0';
    } else {
      crownEl.style.strokeDasharray = String(L);
      crownEl.style.strokeDashoffset = String(L * (1 - progress));
    }
  });

  let showing = $derived(armed || refreshing);
</script>

<div
  class="ptr"
  class:showing
  class:refreshing
  style="transform: translate(-50%, {showing ? pull : -64}px)"
  aria-hidden="true"
>
  <svg viewBox="96 52 48 40" width="30" height="25" fill="none" stroke="var(--gold)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
    <path bind:this={crownEl} d="M102,84 L108,66 L114,76 L120,58 L126,76 L132,66 L138,84 Z" />
  </svg>
</div>

<style>
  .ptr {
    position: fixed;
    top: 6px;
    left: 50%;
    z-index: 90;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.45);
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    opacity: 0;
    transition:
      transform var(--dur-base) var(--ease-spring),
      opacity var(--dur-fast) ease;
  }
  @media (max-width: 700px) {
    .ptr {
      display: flex;
    }
  }
  .ptr.showing {
    opacity: 1;
    transition: opacity var(--dur-fast) ease; /* el transform sigue AL DEDO (sin transición) */
  }
  .ptr.refreshing {
    transition:
      transform var(--dur-base) var(--ease-spring),
      opacity var(--dur-fast) ease;
    animation: ptr-pulse 0.9s ease-in-out infinite;
  }
  @keyframes ptr-pulse {
    0%,
    100% {
      transform: translate(-50%, 58px) scale(1);
    }
    50% {
      transform: translate(-50%, 58px) scale(1.12);
    }
  }
</style>
