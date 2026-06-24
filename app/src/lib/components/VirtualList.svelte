<script>
  // Windowed virtual list: renders only the visible rows (+overscan), so ~4.000 entries
  // scroll smoothly without ever mounting thousands of DOM nodes.
  let { items = [], rowHeight = 60, overscan = 8, key = (it) => it.id, row } = $props();

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

  // When the list changes (e.g. a filter narrows it), reset scroll to the top — otherwise a
  // leftover scrollTop can point past the end of a shorter result set and render blank.
  $effect(() => {
    void items.length;
    scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
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
