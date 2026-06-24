<script>
  import { onMount } from 'svelte';
  import { boot, __installTestHooks } from '$lib/boot.js';
  import { role, dbStatus } from '$lib/stores.js';
  import ArchiveList from '$lib/components/ArchiveList.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import DurabilityPanel from '$lib/components/DurabilityPanel.svelte';
  import QuickAddForm from '$lib/components/QuickAddForm.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Button from '$lib/components/Button.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let view = $state('diario'); // 'diario' | 'durabilidad'
  let showAdd = $state(false);

  let canWrite = $derived($role === 'leader');
  let isEmpty = $derived(($dbStatus?.counts?.entrada ?? 0) === 0);

  onMount(() => {
    __installTestHooks();
    boot();
  });
</script>

{#if $role === 'follower'}
  <div class="ro-banner">
    Pestaña de <strong>solo lectura</strong> — el archivo está abierto en otra pestaña. Aquí
    exploras; no se registra. Si cierras la otra, esta toma el control automáticamente.
  </div>
{/if}

<nav class="tabs">
  <button class:active={view === 'diario'} onclick={() => (view = 'diario')}>Diario</button>
  <button class:active={view === 'durabilidad'} onclick={() => (view = 'durabilidad')}>Durabilidad</button>
</nav>

{#if view === 'diario'}
  {#if isEmpty && canWrite}
    <div class="hero-empty">
      <div class="mark">◇</div>
      <h1>Tu biografía cultural empieza con una entrada.</h1>
      <p>Registra lo que ves, lees y juegas. El archivo crece contigo y nunca se pierde.</p>
      <Button variant="primary" onclick={() => (showAdd = true)}>Registrar la primera</Button>
    </div>
  {:else}
    <ArchiveList />
  {/if}
{:else}
  <DurabilityPanel />
{/if}

{#if view === 'diario' && canWrite && !(isEmpty && canWrite)}
  <button class="fab" onclick={() => (showAdd = true)} aria-label="Registrar entrada">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  </button>
{/if}

<Sheet open={showAdd} title="Nueva entrada" eyebrow="Registro rápido · ≈ 7 s" onclose={() => (showAdd = false)}>
  <QuickAddForm onsaved={() => (showAdd = false)} />
</Sheet>

<DetailPanel />
<Toast />

<style>
  .ro-banner {
    background: color-mix(in srgb, var(--gold) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--gold) 38%, var(--line));
    color: var(--gold);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .tabs {
    display: flex;
    gap: 0.3rem;
    margin-bottom: 1.1rem;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-3);
    padding: 0.4rem 0.5rem;
    cursor: pointer;
    font-family: var(--font-display);
    font-size: 1.1rem;
  }
  .tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .hero-empty {
    text-align: center;
    padding: 3rem 1rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }
  .hero-empty .mark {
    color: var(--accent);
    font-size: 2rem;
  }
  .hero-empty h1 {
    font-size: 1.5rem;
    font-weight: 500;
    max-width: 16em;
    margin: 0;
    line-height: 1.2;
  }
  .hero-empty p {
    color: var(--ink-2);
    max-width: 26em;
    margin: 0 0 0.6rem;
    line-height: 1.5;
  }
  .fab {
    position: fixed;
    right: max(1.2rem, env(safe-area-inset-right));
    bottom: max(1.4rem, env(safe-area-inset-bottom));
    width: 58px;
    height: 58px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    display: grid;
    place-items: center;
    cursor: pointer;
    box-shadow: 0 8px 24px rgba(232, 96, 44, 0.4);
    z-index: 40;
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .fab:hover {
    transform: scale(1.08) rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .fab {
      transition: none;
    }
  }
</style>
