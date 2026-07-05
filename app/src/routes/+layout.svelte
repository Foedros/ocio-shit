<script>
  let { children } = $props();
</script>

<svelte:head>
  <title>Ocio Shit — archivo cultural</title>
</svelte:head>

<div class="app">
  <header class="bar">
    <div class="brand">
      <span class="mark">◆</span>
      <span class="name">Ocio&nbsp;Shit</span>
      <span class="tag">Archivo&nbsp;cultural</span>
    </div>
  </header>

  <main>
    {@render children()}
  </main>
</div>

<style>
  /* Tokens from diseno/tokens.json (dark = home mode). Custom font files are deferred to
     Sprint 4; the stacks fall back to system serif/sans/mono for now. */
  :global(:root) {
    --bg: #0b0a08; /* ink */
    --surface: #14110d;
    --surface-2: #211c16; /* raised */
    --line: #211c16; /* border */
    --line-strong: #2e2820;
    --hairline-plus: #433b30;
    --ink: #f2ebdd; /* text.primary */
    --ink-2: #a89f8f; /* text.muted */
    --ink-3: #6e665a; /* text.faint */
    --label: #8a6f4a; /* eyebrow */
    --accent: #e8602c; /* amber — primary action */
    --accent-ink: #f2a65a; /* gold — ratings/highlights */
    --gold: #f2a65a;
    --on-accent: #0b0a08;
    --ok: #7e8f5b;
    --warn: #f2a65a;
    --warn-ink: #f2a65a;
    --danger: #c75d52;
    --danger-ink: #d98178;
    --cat-pelicula: #c75d52;
    --cat-serie: #c9a23f;
    --cat-libro: #7e8f5b;
    --cat-videojuego: #9580b0;
    --cat-comic: #5b9298;
    --cat-ocio_libre: #c2796b;
    --radius: 16px;
    --radius-pill: 999px;
    --font-display: 'Newsreader', Georgia, 'Times New Roman', serif;
    --font-text: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
    --font-data: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
    color-scheme: dark;

    /* ── Motion (Tanda 1 · fundación): TODA animación nueva usa estos tokens ── */
    --dur-fast: 150ms; /* micro-feedback: hover, press, toggles */
    --dur-base: 300ms; /* transiciones de UI: sheets, overlays, fades */
    --dur-slow: 600ms; /* momentos editoriales: reveals, count-ups, hero */
    --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1); /* frena elegante (reveals) */
    --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* rebote sutil (chips, medallas) */
    --ease: cubic-bezier(0.2, 0.8, 0.2, 1); /* la curva estándar del diseño (sheets) */
  }

  /* "Carátula que vuela" (Tanda 3, View Transitions API): el grupo cover-fly interpola
     posición/tamaño entre la carátula tocada y su sitio en el detalle. old/new a cover
     evita el estirado cuando los aspectos difieren (celda 2:3 vs cover natural). El JS
     (flyOpen/flyBack en motion.js) ni arranca la transición sin API o con reduced-motion. */
  :global(::view-transition-group(cover-fly)) {
    animation-duration: var(--dur-base);
    animation-timing-function: var(--ease);
  }
  :global(::view-transition-old(cover-fly)),
  :global(::view-transition-new(cover-fly)) {
    height: 100%;
    width: 100%;
    object-fit: cover;
    animation-duration: var(--dur-base);
  }

  /* prefers-reduced-motion GLOBAL: mata toda animación/transición no esencial (patrón
     0.01ms — los estados finales se aplican, el movimiento no). Las animaciones JS (rAF)
     comprueban prefersReducedMotion() de $lib/motion.js. Toda animación futura lo hereda. */
  @media (prefers-reduced-motion: reduce) {
    :global(*),
    :global(*::before),
    :global(*::after) {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }

  :global(*) {
    box-sizing: border-box;
  }
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: var(--font-text);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  :global(button) {
    font: inherit;
  }
  :global(h1, h2, h3, h4) {
    font-family: var(--font-display);
    font-weight: 500;
  }
  :global(code) {
    font-family: var(--font-data);
    font-size: 0.85em;
  }

  .app {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.7rem 1rem;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .mark {
    color: var(--accent);
  }
  .name {
    font-family: var(--font-display);
    font-weight: 500;
    letter-spacing: 0.01em;
  }
  .tag {
    color: var(--label);
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  main {
    flex: 1;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 1rem 1rem 4rem;
  }

  /* ── MÓVIL (≤700px): el chasis Design toma el control ──
     La cabecera de marca se sustituye por la cabecera móvil (hamburguesa/título/avatar) que vive
     en +page.svelte; el ancho es fijo y el scroll SOLO vertical (clip horizontal defensivo). El
     escritorio (≥701px) NO cambia. */
  @media (max-width: 700px) {
    .bar {
      display: none;
    }
    main {
      max-width: 100%;
      padding: 0;
      overflow-x: clip;
    }
  }
</style>
