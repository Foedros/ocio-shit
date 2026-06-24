<script>
  // pantallas.md: bottom sheet on mobile (sheetUp), centered modal on desktop (scaleIn),
  // over a dimmed scrim. Grip on mobile; eyebrow + title + close.
  let { open = false, title = '', eyebrow = '', onclose, children } = $props();
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && onclose?.()} />

{#if open}
  <div class="scrim" role="presentation" onclick={onclose}>
    <div class="sheet" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
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
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: color-mix(in srgb, #000 58%, transparent);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    animation: fade 0.2s ease;
  }
  .sheet {
    background: var(--surface);
    border: 1px solid var(--line);
    border-bottom: none;
    border-radius: var(--radius) var(--radius) 0 0;
    width: 100%;
    max-width: 560px;
    max-height: 90vh;
    overflow: auto;
    padding: 0.6rem 1.3rem 2rem;
    box-shadow: var(--shadow-raised, 0 -8px 30px rgba(0, 0, 0, 0.5));
    animation: sheetUp 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @media (min-width: 640px) {
    .scrim {
      align-items: center;
    }
    .sheet {
      border-radius: var(--radius);
      border-bottom: 1px solid var(--line);
      animation: scaleIn 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  .grip {
    width: 38px;
    height: 4px;
    border-radius: 999px;
    background: var(--line-strong);
    margin: 0.2rem auto 0.8rem;
  }
  @media (min-width: 640px) {
    .grip {
      display: none;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 1rem;
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
