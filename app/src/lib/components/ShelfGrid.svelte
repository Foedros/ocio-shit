<script>
  // Vista ESTANTERÍA del Diario (tercera vista, tipo Letterboxd): grid de carátulas puras,
  // columnas responsivas (móvil ~3 · escritorio 6-8), tap → detalle. Recibe items YA
  // deduplicados por obra (ArchiveList: primera aparición = entrada más reciente).
  //
  // VIRTUALIZADO por filas (misma técnica que VirtualList, con filas de `cols` celdas):
  // ~4.500 obras nunca montan más de ~60-80 celdas. Las imágenes además van loading=lazy.
  //
  // Overlay discreto (título + nota): hover en escritorio (@media hover) · LONG-PRESS en
  // móvil (~450ms; el tap corto abre el detalle). En reposo, solo carátulas limpias.
  import { CAT_COLOR } from '$lib/theme.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';
  import { openEntryDetail } from '$lib/boot-supabase.js';
  import { fmtValoracion } from '$lib/format.js';

  let { items = [], resetKey = undefined } = $props();

  const GAP = 8;
  const OVERSCAN = 3;
  let viewport = $state(null);
  let width = $state(360);
  let height = $state(480);
  let scrollTop = $state(0);

  // URLs cuya imagen falló (onerror) → fallback tipográfico. Clave por URL (como GalleryFlow):
  // si la carátula se repara, la URL nueva no está en el Set y se re-intenta sola.
  let broken = $state(new Set());
  const markBroken = (url) => (broken = new Set(broken).add(url));

  $effect(() => {
    if (!viewport) return;
    const ro = new ResizeObserver(() => {
      width = viewport.clientWidth;
      height = viewport.clientHeight;
    });
    ro.observe(viewport);
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    return () => ro.disconnect();
  });

  // Al cambiar los filtros, la estantería vuelve al principio (mismo criterio que la lista).
  let lastReset = $state(resetKey);
  $effect(() => {
    if (resetKey === lastReset) return;
    lastReset = resetKey;
    scrollTop = 0;
    pressedId = null;
    if (viewport) viewport.scrollTop = 0;
  });

  // Geometría: celdas 2:3 (póster; los headers anchos de Steam se recortan, como Letterboxd).
  let cols = $derived(Math.max(3, Math.min(8, Math.floor(width / 120))));
  let cellW = $derived((width - GAP * (cols - 1)) / cols);
  let rowH = $derived(cellW * 1.5 + GAP);
  let rows = $derived(Math.ceil(items.length / cols));
  let total = $derived(Math.max(0, rows * rowH - GAP)); // la última fila no lleva gap
  let startRow = $derived(Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN));
  let visRows = $derived(Math.ceil(height / rowH) + OVERSCAN * 2);
  let slice = $derived(items.slice(startRow * cols, (startRow + visRows) * cols));

  // Seguridad: si la lista encoge por debajo del scroll actual, reajusta (sin saltar al top).
  $effect(() => {
    const maxTop = Math.max(0, total - height);
    if (scrollTop > maxTop) {
      scrollTop = maxTop;
      if (viewport) viewport.scrollTop = maxTop;
    }
  });

  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };

  // ── Long-press (móvil): muestra el overlay SIN abrir el detalle; tap corto → detalle ──
  // JITTER: un dedo sosteniendo 450ms SIEMPRE deriva unos px (lección de GalleryFlow §11.32);
  // el timer solo se cancela si el movimiento supera el umbral (= scroll real, no temblor).
  const JITTER = 8;
  let pressedId = $state(null);
  let pressTimer = null;
  let suppressClick = false;
  let pressX = 0;
  let pressY = 0;
  function tStart(e, it) {
    suppressClick = false;
    if (pressedId && pressedId !== it.entrada_id) pressedId = null; // tocar otra celda limpia
    const t = e.touches?.[0];
    pressX = t?.clientX ?? 0;
    pressY = t?.clientY ?? 0;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressedId = it.entrada_id;
      suppressClick = true; // el release de ESTE long-press no abre el detalle
    }, 450);
  }
  const tCancel = () => clearTimeout(pressTimer);
  function tMove(e) {
    const t = e.touches?.[0];
    if (!t) return;
    if (Math.abs(t.clientX - pressX) > JITTER || Math.abs(t.clientY - pressY) > JITTER) {
      clearTimeout(pressTimer); // movimiento de verdad (scroll) — el temblor no cancela
    }
  }
  function cellClick(it) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    openEntryDetail(it.entrada_id);
  }
  function onScroll(e) {
    scrollTop = e.currentTarget.scrollTop;
    clearTimeout(pressTimer);
    pressedId = null;
  }
</script>

<div class="viewport" bind:this={viewport} onscroll={onScroll}>
  <div class="spacer" style="height:{total}px">
    <div
      class="window"
      style="transform: translateY({startRow * rowH}px); grid-template-columns: repeat({cols}, 1fr); gap:{GAP}px"
    >
      {#each slice as it (it.entrada_id)}
        <button
          class="cell"
          style="--c:{col(it.categoria).c}; --t:{col(it.categoria).tint}"
          onclick={() => cellClick(it)}
          ontouchstart={(e) => tStart(e, it)}
          ontouchend={tCancel}
          ontouchmove={tMove}
          ontouchcancel={tCancel}
          oncontextmenu={(e) => e.preventDefault()}
          aria-label={it.titulo}
          title={it.titulo}
        >
          {#if it.imagen_url && !broken.has(it.imagen_url)}
            <img src={it.imagen_url} alt="" loading="lazy" draggable="false" onerror={() => markBroken(it.imagen_url)} />
          {:else}
            <span class="fb">
              <span class="fb-t">{it.titulo}</span>
              <span class="fb-c">{CATEGORIA_LABELS[it.categoria] ?? it.categoria}</span>
            </span>
          {/if}
          <span class="ol" class:show={pressedId === it.entrada_id}>
            <span class="ol-t">{it.titulo}</span>
            {#if it.valoracion != null}<span class="ol-v">{fmtValoracion(it.valoracion)}</span>{/if}
          </span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewport {
    overflow-y: auto;
    height: min(62vh, 580px);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
    padding: 0;
    overscroll-behavior: contain;
  }
  .spacer {
    position: relative;
    width: 100%;
  }
  .window {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: grid;
    will-change: transform;
  }
  .cell {
    position: relative;
    aspect-ratio: 2 / 3;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface-2);
    cursor: pointer;
    display: block;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
  }
  .cell img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  /* Fallback tipográfico (imagen_url NULL o rota): color de categoría + título */
  .fb {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 0.5rem 0.45rem;
    background: color-mix(in srgb, var(--c) 16%, var(--surface-2));
    text-align: left;
  }
  .fb-t {
    font-family: var(--font-display);
    font-size: 0.8rem;
    line-height: 1.25;
    color: var(--ink);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 5;
    -webkit-box-orient: vertical;
    word-break: break-word;
  }
  .fb-c {
    font-family: var(--font-data);
    font-size: 0.52rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--t);
  }
  /* Overlay discreto: gradiente inferior con título + nota. Reposo = carátula limpia. */
  .ol {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.1rem;
    padding: 0.45rem 0.5rem;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.35) 45%, transparent 70%);
    opacity: 0;
    transition: opacity 0.16s ease;
    pointer-events: none;
    text-align: left;
  }
  .ol.show {
    opacity: 1;
  }
  @media (hover: hover) {
    .cell:hover .ol,
    .cell:focus-visible .ol {
      opacity: 1;
    }
  }
  .ol-t {
    font-family: var(--font-display);
    font-size: 0.78rem;
    line-height: 1.2;
    color: #fff;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  .ol-v {
    font-family: var(--font-data);
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gold);
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .ol {
      transition: none;
    }
  }
</style>
