<script>
  import { onMount } from 'svelte';
  import { boot, __installTestHooks } from '$lib/boot.js';
  import { role, dbStatus, busy } from '$lib/stores.js';
  import QuickAddForm from '$lib/components/QuickAddForm.svelte';
  import ArchiveList from '$lib/components/ArchiveList.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import DurabilityPanel from '$lib/components/DurabilityPanel.svelte';

  let view = $state('archivo'); // 'archivo' | 'durabilidad'

  onMount(() => {
    __installTestHooks();
    boot();
  });
</script>

{#if $role === 'follower'}
  <div class="ro-banner">
    Pestaña de <strong>solo lectura</strong>: el archivo está abierto en otra pestaña. Aquí puedes
    explorar, pero no registrar. Si cierras la otra, esta tomará el control automáticamente.
  </div>
{/if}

<nav class="tabs">
  <button class:active={view === 'archivo'} onclick={() => (view = 'archivo')}>Archivo</button>
  <button class:active={view === 'durabilidad'} onclick={() => (view = 'durabilidad')}>Durabilidad</button>
  {#if $dbStatus?.counts}
    <span class="counts">{($dbStatus.counts.obra ?? 0).toLocaleString('es-ES')} obras · {($dbStatus.counts.entrada ?? 0).toLocaleString('es-ES')} entradas</span>
  {/if}
</nav>

{#if view === 'archivo'}
  <section class="card add-card">
    <h2>Registro rápido</h2>
    <QuickAddForm />
  </section>
  <section>
    <ArchiveList />
  </section>
{:else}
  <DurabilityPanel />
{/if}

<DetailPanel />

<style>
  .ro-banner {
    background: color-mix(in srgb, var(--warn) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line));
    color: var(--warn-ink);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--ink-3);
    padding: 0.4rem 0.6rem;
    cursor: pointer;
    font-size: 1rem;
  }
  .tabs button.active {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }
  .counts {
    margin-left: auto;
    color: var(--ink-3);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem 1.1rem;
    margin: 0 0 1rem;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 0.7rem;
    font-weight: 600;
  }
</style>
