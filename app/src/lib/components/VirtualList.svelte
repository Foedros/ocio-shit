<script>
  // Windowed virtual list: renders only the visible rows (+overscan), so ~4.000 entries
  // scroll smoothly without ever mounting thousands of DOM nodes.
  let { items = [], rowHeight = 60, overscan = 8, key = (it) => it.id, row, resetKey = undefined } = $props();

  let viewport = $state(null);
  let scrollTop = $state(0);
  let height = $state(480);

  $effect(() => {
    if (!viewport) return;
    const ro = new ResizeObserver(() => (height = viewport.clientHeight));
    ro.observe(viewport);
    height = viewport.clientHeight;
    return () => ro.disconnect();
  });

  // Vuelve al principio SOLO cuando cambia resetKey (los filtros del Diario), NO en cada mutación
  // de `items`. Así, puntuar una entrada (patch puntual / re-fetch) NO pierde la posición de scroll
  // — antes el efecto saltaba al top en cualquier cambio del array y había que re-scrollear tras
  // cada voto.
  let lastResetKey = $state(resetKey);
  $effect(() => {
    if (resetKey === lastResetKey) return;
    lastResetKey = resetKey;
    scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
  });

  // Seguridad: si la lista se acorta por debajo del scroll actual (p. ej. borrar cerca del final),
  // ajusta el scroll al máximo válido para no renderizar en blanco — sin saltar al principio.
  $effect(() => {
    const maxTop = Math.max(0, items.length * rowHeight - height);
    if (scrollTop > maxTop) {
      scrollTop = maxTop;
      if (viewport) viewport.scrollTop = maxTop;
    }
  });

  let total = $derived(items.length * rowHeight);
  let start = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
  let visibleCount = $derived(Math.ceil(height / rowHeight) + overscan * 2);
  let slice = $derived(items.slice(start, start + visibleCount));
</script>

<div class="viewport" bind:this={viewport} onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}>
  <div class="spacer" style="height:{total}px">
    <div class="window" style="transform: translateY({start * rowHeight}px)">
      {#each slice as item, i (key(item))}
        <div class="vrow" style="height:{rowHeight}px">{@render row(item)}</div>
      {/each}
    </div>
  </div>
</div>

<style>
  .viewport {
    overflow-y: auto;
    height: min(60vh, 560px);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--surface);
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
    will-change: transform;
  }
  .vrow {
    box-sizing: border-box;
  }
</style>
