<script>
  import { onMount } from 'svelte';
  import { boot, signOutAction, exportAction, __installTestHooks } from '$lib/boot-supabase.js';
  import { auth, dbStatus } from '$lib/stores.js';
  import ArchiveList from '$lib/components/ArchiveList.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import ColeccionesPanel from '$lib/components/ColeccionesPanel.svelte';
  import EstadisticasPanel from '$lib/components/EstadisticasPanel.svelte';
  import TimelinePanel from '$lib/components/TimelinePanel.svelte';
  import PerfilPanel from '$lib/components/PerfilPanel.svelte';
  import HallPanel from '$lib/components/HallPanel.svelte';
  import HomePanel from '$lib/components/HomePanel.svelte';
  import QuickAddForm from '$lib/components/QuickAddForm.svelte';
  import Login from '$lib/components/Login.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Button from '$lib/components/Button.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let view = $state('home'); // home | diario | colecciones | estadisticas | timeline | perfil | hall | cuenta
  let showAdd = $state(false);

  let canWrite = $derived(!!$auth.session); // every authenticated tab can write (Postgres arbitra)
  let isEmpty = $derived(($dbStatus?.counts?.entrada ?? 0) === 0);
  let counts = $derived($dbStatus?.counts);

  onMount(() => {
    __installTestHooks();
    boot();
  });
</script>

{#if !$auth.ready}
  <p class="loading">Conectando…</p>
{:else if !$auth.session}
  <Login />
{:else}
<nav class="tabs">
  <button class:active={view === 'home'} onclick={() => (view = 'home')}>Inicio</button>
  <button class:active={view === 'diario'} onclick={() => (view = 'diario')}>Diario</button>
  <button class:active={view === 'colecciones'} onclick={() => (view = 'colecciones')}>Colecciones</button>
  <button class:active={view === 'estadisticas'} onclick={() => (view = 'estadisticas')}>Estadísticas</button>
  <button class:active={view === 'timeline'} onclick={() => (view = 'timeline')}>Timeline</button>
  <button class:active={view === 'perfil'} onclick={() => (view = 'perfil')}>Perfil</button>
  <button class:active={view === 'hall'} onclick={() => (view = 'hall')}>Hall of Fame</button>
  <button class:active={view === 'cuenta'} onclick={() => (view = 'cuenta')}>Cuenta</button>
</nav>

{#if view === 'home'}
  <HomePanel onnavigate={(v) => (view = v)} onregister={() => (showAdd = true)} />
{:else if view === 'diario'}
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
{:else if view === 'colecciones'}
  <ColeccionesPanel />
{:else if view === 'estadisticas'}
  <EstadisticasPanel />
{:else if view === 'timeline'}
  <TimelinePanel />
{:else if view === 'perfil'}
  <PerfilPanel />
{:else if view === 'hall'}
  <HallPanel />
{:else}
  <section class="cuenta">
    <h2>Cuenta</h2>
    <p class="who">Sesión: <strong>{$auth.user?.email}</strong></p>
    {#if counts}
      <p class="counts">{counts.obra} obras · {counts.entrada} entradas · {counts.persona} personas en Supabase.</p>
    {/if}
    <p class="note">Tus datos viven en Supabase (PostgreSQL en la nube), protegidos por RLS. Multi-dispositivo: PC y móvil.</p>
    <div class="cuenta-actions">
      <Button variant="secondary" onclick={() => exportAction()}>Exportar archivo (.json)</Button>
      <Button variant="ghost" onclick={() => signOutAction()}>Cerrar sesión</Button>
    </div>
    <p class="note small">Exportar saca tu archivo completo (todas las entradas, sin truncar) en el formato portable <code>export.json</code> — puedes llevártelo a otro Postgres o a SQLite cuando quieras. Propiedad total del dato.</p>
  </section>
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
{/if}

<Toast />

<style>
  .loading {
    text-align: center;
    color: var(--ink-2);
    padding: 4rem 1rem;
  }
  .cuenta {
    padding: 1rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .cuenta h2 {
    font-family: var(--font-display);
    font-weight: 500;
    margin: 0 0 0.4rem;
  }
  .cuenta .who {
    margin: 0;
  }
  .cuenta .counts {
    color: var(--ink-2);
    font-family: var(--font-mono, monospace);
    font-size: 0.9rem;
    margin: 0;
  }
  .cuenta .note {
    color: var(--ink-3);
    max-width: 34em;
    line-height: 1.5;
    margin: 0.2rem 0 0.8rem;
  }
  .cuenta .note.small {
    font-size: 0.82rem;
  }
  .cuenta-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
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
