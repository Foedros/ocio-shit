<script module>
  // UNA vez por arranque (jamás en navegaciones internas ni re-logins): flag de módulo.
  let alreadyShown = false;
</script>

<script>
  // SPLASH VIVA (Tanda 7): overlay sobre #0B0A08 donde la O coronada del logo se dibuja en
  // stroke (~650ms; abreviada ~400ms si la carga ya está lista/cacheada) y ESTALLA en
  // partículas del color de la ÚLTIMA categoría registrada (localStorage, escrito por
  // addEntryAction) revelando la app. CUBRE la carga real (sustituye al skeleton de Inicio):
  // no se retira hasta que el arranque termina (ready/needs-login/error). Con reduced-motion:
  // logo estático + fade, sin partículas. El trazado sale de ocio-shit-icon.svg (corona
  // M102,84… + anillo exterior de la O), medido con getTotalLength() en runtime.
  import { onMount } from 'svelte';
  import { phase } from '$lib/stores.js';
  import { confettiBurst, prefersReducedMotion, easeOutExpo } from '$lib/motion.js';
  import { CAT_COLOR } from '$lib/theme.js';

  let visible = $state(!alreadyShown);
  let fading = $state(false);
  let pulsing = $state(false);
  let crownEl = $state(null);
  let ringEl = $state(null);
  let logoEl = $state(null);
  const reduced = prefersReducedMotion();

  let loaded = $derived(['ready', 'needs-login', 'error'].includes($phase));

  function lastCatColor() {
    try {
      const cat = localStorage.getItem('ocio:lastCat');
      return CAT_COLOR[cat]?.c ?? '#F2A65A';
    } catch {
      return '#F2A65A';
    }
  }

  onMount(() => {
    if (alreadyShown) return;
    alreadyShown = true;
    if (reduced) return; // estático: espera a loaded y desvanece (el $effect de abajo)
    // dibujo en stroke con rAF: duración adaptativa (todo cacheado/listo → abreviada)
    const L1 = crownEl.getTotalLength();
    const L2 = ringEl.getTotalLength();
    crownEl.style.strokeDasharray = String(L1);
    ringEl.style.strokeDasharray = String(L2);
    const dur = loaded ? 400 : 650;
    const t0 = performance.now();
    const tick = (now) => {
      if (!visible) return;
      const p = Math.min(1, (now - t0) / dur);
      const e = easeOutExpo(p);
      ringEl.style.strokeDashoffset = String(L2 * (1 - e));
      crownEl.style.strokeDashoffset = String(L1 * (1 - Math.max(0, e - 0.25) / 0.75)); // la corona entra tras el anillo
      if (p < 1) requestAnimationFrame(tick);
      else drawDone = true;
    };
    requestAnimationFrame(tick);
  });

  let drawDone = $state(reduced); // reduced: no hay dibujo que esperar
  // dibujo completo + carga completa → estallido y retirada. Si la carga tarda más que el
  // dibujo, el logo PULSA mientras espera (cubre la carga real).
  $effect(() => {
    if (!visible || fading) return;
    if (drawDone && !loaded) pulsing = true;
    if (drawDone && loaded) {
      pulsing = false;
      fading = true;
      if (!reduced && logoEl) {
        const r = logoEl.getBoundingClientRect();
        confettiBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, lastCatColor(), { count: 30, duration: 750 });
      }
      setTimeout(() => (visible = false), reduced ? 220 : 380);
    }
  });
</script>

{#if visible}
  <div class="splash" class:fading role="presentation" aria-hidden="true">
    <svg
      bind:this={logoEl}
      class="logo"
      class:pulsing
      class:static={reduced}
      viewBox="54 44 132 160"
      width="110"
      height="133"
      fill="none"
      stroke="var(--gold)"
      stroke-width="4.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <!-- anillo exterior de la O (ocio-shit-icon.svg) -->
      <path bind:this={ringEl} class="ring" d="M68,134 A52,60 0 1,1 172,134 A52,60 0 1,1 68,134 Z" />
      <!-- la corona -->
      <path bind:this={crownEl} class="crown" d="M102,84 L108,66 L114,76 L120,58 L126,76 L132,66 L138,84 Z" />
    </svg>
  </div>
{/if}

<style>
  .splash {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: #0b0a08;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 1;
    transition: opacity var(--dur-base) var(--ease);
  }
  .splash.fading {
    opacity: 0;
    pointer-events: none;
  }
  .logo.pulsing {
    animation: splash-pulse 1.1s ease-in-out infinite;
  }
  /* reduced-motion: logo completo estático (sin dibujo); el fade lo da .fading */
  .logo.static .ring,
  .logo.static .crown {
    stroke-dasharray: none;
    stroke-dashoffset: 0;
  }
  /* estado inicial del trazo (antes de medir): invisible hasta que el rAF fija dasharray */
  .logo:not(.static) .ring,
  .logo:not(.static) .crown {
    stroke-dasharray: 1000;
    stroke-dashoffset: 1000;
  }
  @keyframes splash-pulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.06);
    }
  }
</style>
