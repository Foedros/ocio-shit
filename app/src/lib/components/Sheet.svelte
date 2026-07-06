<script>
  // pantallas.md: bottom sheet on mobile (sheetUp), centered modal on desktop (scaleIn),
  // over a dimmed scrim. Grip on mobile; eyebrow + title + close.
  // MODO CINE (Tanda 3): `backdrop` = URL de carátula → banda superior con la imagen ampliada
  // y desenfocada, oscurecida hacia el fondo museo en los bordes (estilo Apple TV). Usa la
  // MISMA w342 ya cacheada (mismo src = cero re-fetch); blur+scale en capa compositada.
  let { open = false, title = '', eyebrow = '', onclose, backdrop = null, children } = $props();

  // Un sheet que NACE durante una "carátula que vuela" (html.vt-fly) no corre su animación de
  // entrada NUNCA. Suprimirla solo mientras duraba el vuelo (regla html.vt-fly .sheet en +layout)
  // la RE-ARRANCABA al retirarse la clase — animation:none→sheetUp cuenta como animación nueva
  // desde el keyframe 0 → el sheet saltaba a translateY(100%) y re-subía barriendo la pantalla
  // con el cine recién montado a bordo (el "flash gigante", §11.49). Se evalúa AL ABRIR y queda
  // fijo para esa apertura (vt-fly es transitoria; classList no es reactivo y no debe serlo).
  let noEntry = $derived(open && typeof document !== 'undefined' && document.documentElement.classList.contains('vt-fly'));
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && onclose?.()} />

{#if open}
  <div class="scrim" role="presentation" onclick={onclose}>
    <div class="sheet" class:cine-on={!!backdrop} class:no-entry={noEntry} role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      {#if backdrop}
        <div class="cine" aria-hidden="true"><img src={backdrop} alt="" draggable="false" /></div>
      {/if}
      <div class="grip" aria-hidden="true"></div>
      <header>
        <div>
          {#if eyebrow}<div class="eyebrow">{eyebrow}</div>{/if}
          <h2>{title}</h2>
        </div>
        <button class="x" onclick={onclose} aria-label="Cerrar">✕</button>
      </header>
      <div class="body">{@render children?.()}</div>
    </div>
  </div>
{/if}

<style>
  /* MÓVIL (≤700px): el formulario ocupa TODA la pantalla (no panel flotante). El scroll-lock del
     fondo lo aplica +page.svelte cuando está abierto. DESKTOP (≥701px): modal centrado (igual que
     antes — no cambia). */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: color-mix(in srgb, #000 58%, transparent);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    animation: fade 0.2s ease;
  }
  .sheet {
    position: relative; /* contiene la capa cine */
    background: var(--bg);
    border: none;
    border-radius: 0;
    width: 100%;
    max-width: none;
    height: 100dvh;
    max-height: 100dvh;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 1rem 1.1rem 2.4rem;
    animation: sheetUp 0.34s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  /* MODO CINE: banda superior con la carátula ampliada+desenfocada, fundida a --bg abajo y
     en los laterales. Absoluta dentro del scroller → se desplaza con el contenido (cabecera
     de arte, estilo Apple TV) y el blur se rasteriza UNA vez (capa compositada, scroll gratis). */
  .cine {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 320px;
    overflow: hidden;
    pointer-events: none;
    border-radius: inherit;
  }
  .cine img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    filter: blur(26px) brightness(0.72) saturate(1.08);
    transform: scale(1.2) translateZ(0);
    will-change: transform;
  }
  /* veladura en rgba PLANO (bug iOS §11.46): color-mix(...transparent) + doble posición
     renderizaba casi OPACO en WebKit y se comía el arte — rgba es idéntico en ambos motores */
  .cine::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(11, 10, 8, 0.72) 0%, rgba(11, 10, 8, 0) 22%, rgba(11, 10, 8, 0) 78%, rgba(11, 10, 8, 0.72) 100%),
      linear-gradient(180deg, rgba(11, 10, 8, 0.42) 0%, rgba(11, 10, 8, 0.58) 55%, #0b0a08 100%);
  }
  /* el cine entra con fade (se monta DESPUÉS del vuelo — transition.finished, §11.46) */
  .cine {
    animation: cine-in var(--dur-base) ease both;
  }
  @keyframes cine-in {
    from {
      opacity: 0;
    }
  }
  .body,
  header {
    position: relative;
    z-index: 1;
  }
  /* con cine, la cabecera pegajosa deja ver el arte (tinte + blur para seguir legible al scrollear) */
  .sheet.cine-on header {
    background: color-mix(in srgb, var(--bg) 45%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  @media (min-width: 701px) {
    .scrim {
      align-items: center;
      justify-content: center;
    }
    .sheet {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      width: 100%;
      max-width: 560px;
      height: auto;
      max-height: 90vh;
      padding: 0.6rem 1.3rem 2rem;
      box-shadow: var(--shadow-raised, 0 -8px 30px rgba(0, 0, 0, 0.5));
      animation: scaleIn 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  .grip {
    display: none;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
    position: sticky;
    top: 0;
    background: var(--bg);
    padding-top: 0.2rem;
    z-index: 1;
  }
  @media (min-width: 701px) {
    header {
      /* relative (no static): mismo layout, pero conserva el z-index → el título y la ✕
         quedan SIEMPRE por encima de la capa cine (con static, el absoluto pintaba encima) */
      position: relative;
      background: none;
    }
  }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--label);
    margin-bottom: 0.2rem;
  }
  h2 {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 500;
    margin: 0;
  }
  .x {
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    color: var(--ink-2);
    border-radius: 8px;
    width: 2rem;
    height: 2rem;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .x:hover {
    color: var(--ink);
  }
  /* nacido en pleno vuelo: sin animación de entrada (móvil sheetUp Y escritorio scaleIn) —
     la View Transition ya lleva la continuidad visual */
  .sheet.no-entry {
    animation: none;
  }
  @keyframes sheetUp {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  @keyframes scaleIn {
    from {
      transform: scale(0.96);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .sheet {
      animation: none;
    }
  }
</style>
