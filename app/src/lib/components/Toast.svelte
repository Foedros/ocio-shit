<script>
  // componentes.md: confirmation toast. Never semaphore red — errors use sober amber.
  import { toast } from '$lib/stores.js';
</script>

{#if $toast}
  <div class="toast {$toast.kind}" role="status">{$toast.msg}</div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    bottom: 1.4rem;
    transform: translateX(-50%);
    z-index: 80;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    color: var(--ink);
    padding: 0.7rem 1.1rem;
    border-radius: var(--radius-pill);
    font-size: 0.9rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    animation: rise 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
    max-width: calc(100vw - 2rem);
  }
  .ok {
    border-color: color-mix(in srgb, var(--gold) 40%, var(--line));
  }
  .error {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
    color: var(--accent-ink);
  }
  @keyframes rise {
    from {
      transform: translate(-50%, 12px);
      opacity: 0;
    }
    to {
      transform: translate(-50%, 0);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .toast {
      animation: none;
    }
  }
</style>
