<script>
  // componentes.md §1. Variants: primary (amber fill), secondary (outline), ghost.
  let { variant = 'primary', type = 'button', disabled = false, onclick, full = false, children } = $props();
</script>

<button class="btn {variant}" class:full {type} {disabled} {onclick}>{@render children?.()}</button>

<style>
  .btn {
    font-family: var(--font-text);
    font-weight: 700;
    border-radius: var(--radius-pill);
    padding: 0.7rem 1.3rem;
    cursor: pointer;
    border: 1px solid transparent;
    transition: transform 0.12s var(--ease, ease), border-color 0.2s, background 0.2s, color 0.2s;
    line-height: 1;
  }
  .btn.full {
    width: 100%;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .primary {
    background: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover:not(:disabled) {
    transform: scale(1.02);
  }
  .primary:active:not(:disabled) {
    transform: scale(0.98);
  }
  .secondary {
    background: transparent;
    border-color: var(--hairline-plus);
    color: var(--ink);
    font-weight: 600;
  }
  .secondary:hover:not(:disabled) {
    border-color: var(--line-strong);
  }
  .ghost {
    background: none;
    border: none;
    color: var(--ink-2);
    font-weight: 600;
    padding: 0.6rem 0.8rem;
  }
  .ghost:hover:not(:disabled) {
    color: var(--ink);
  }
  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
  }
</style>
