<script>
  // componentes.md §2: 6px dot of category color + tintText, color/14% bg, color/30% border.
  import { CAT_COLOR } from '$lib/theme.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';
  let { categoria, selected = false, onclick, disabled = false } = $props();
  let col = $derived(CAT_COLOR[categoria] ?? { c: '#6E665A', tint: '#A89F8F' });
</script>

<button
  class="chip"
  class:selected
  {disabled}
  {onclick}
  style="--c:{col.c}; --t:{col.tint}"
  aria-pressed={selected}
>
  <span class="dot"></span>
  <span class="lbl">{CATEGORIA_LABELS[categoria] ?? categoria}</span>
</button>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    border-radius: var(--radius-pill);
    font-size: 0.82rem;
    cursor: pointer;
    color: var(--ink-2);
    background: color-mix(in srgb, var(--c) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 22%, var(--line));
    transition: transform 0.12s, border-color 0.18s, background 0.18s, color 0.18s;
  }
  .chip:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .chip.selected {
    color: var(--t);
    background: color-mix(in srgb, var(--c) 16%, transparent);
    border-color: color-mix(in srgb, var(--c) 55%, var(--line));
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--c);
    flex: 0 0 auto;
  }
  @media (prefers-reduced-motion: reduce) {
    .chip {
      transition: none;
    }
  }
</style>
