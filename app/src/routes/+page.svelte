<script>
  import { onMount } from 'svelte';
  import { boot, signOutAction, exportAction, setDisplayNameAction, refreshArchive, refreshColecciones, __installTestHooks } from '$lib/boot-supabase.js';
  import { auth, dbStatus, displayName, busy } from '$lib/stores.js';
  import ArchiveList from '$lib/components/ArchiveList.svelte';
  import DetailPanel from '$lib/components/DetailPanel.svelte';
  import ColeccionesPanel from '$lib/components/ColeccionesPanel.svelte';
  import EstadisticasPanel from '$lib/components/EstadisticasPanel.svelte';
  import TimelinePanel from '$lib/components/TimelinePanel.svelte';
  import PerfilPanel from '$lib/components/PerfilPanel.svelte';
  import HallPanel from '$lib/components/HallPanel.svelte';
  import HomePanel from '$lib/components/HomePanel.svelte';
  import WrappedPanel from '$lib/components/WrappedPanel.svelte';
  import QuickAddForm from '$lib/components/QuickAddForm.svelte';
  import Splash from '$lib/components/Splash.svelte';
  import PullToRefresh from '$lib/components/PullToRefresh.svelte';
  import Constelacion from '$lib/components/Constelacion.svelte';
  import Login from '$lib/components/Login.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Button from '$lib/components/Button.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let view = $state('home'); // home | diario | colecciones | estadisticas | timeline | wrapped | perfil | hall | cuenta
  let showAdd = $state(false);

  // Cierre accidental del registro (✕ / tap fuera / Escape) CON datos escritos → confirmación
  // ("¿Descartar la entrada?"), nunca se pierde ni se guarda nada en silencio. El formulario
  // sigue montado debajo del aviso ("Seguir editando" conserva lo escrito).
  let addFormRef = $state(null);
  let confirmDiscard = $state(false);
  function requestCloseAdd() {
    if (addFormRef?.isDirty?.()) confirmDiscard = true;
    else closeAdd();
  }
  function closeAdd() {
    showAdd = false;
    confirmDiscard = false;
  }

  // Pull-to-refresh (Tanda 7): re-consulta los datos de la PANTALLA ACTUAL. Los paneles
  // cargan en onMount → remontar la vista ({#key refreshTick}) re-consulta; el Diario y
  // Colecciones leen stores → además se refrescan explícitos. Los filtros sobreviven (stores).
  let refreshTick = $state(0);
  async function doRefresh() {
    if (view === 'diario' || view === 'colecciones') {
      await Promise.all([refreshArchive(), refreshColecciones()]);
    }
    refreshTick++;
  }

  // ── Chasis móvil (Design): drawer lateral + cabecera hamburguesa. Escritorio: pestañas (intacto). ──
  let drawerOpen = $state(false);
  let hallMode = $state('fame'); // el drawer entra a Hall por Fame o por Shame (mismo componente)
  let mobile = $state(false); // se fija con matchMedia en onMount

  const TITLES = {
    home: 'Inicio', diario: 'Diario', colecciones: 'Colecciones', estadisticas: 'Estadísticas',
    timeline: 'Timeline', wrapped: 'Wrapped', perfil: 'Perfil', cuenta: 'Cuenta'
  };
  let title = $derived(
    view === 'hall' ? (hallMode === 'shame' ? 'Hall of Shame' : 'Hall of Fame') : (TITLES[view] ?? 'Ocio Shit')
  );
  let avatarInitial = $derived((($displayName || '?').trim().charAt(0) || '?').toUpperCase());

  function navTo(v, opts) {
    if (v === 'hall') hallMode = opts?.hallMode ?? 'fame';
    view = v;
    drawerOpen = false;
  }

  // SCROLL-LOCK: con el formulario a pantalla completa o el drawer abiertos en móvil, el fondo NO se
  // mueve (era la queja principal). Solo móvil → el escritorio no cambia su comportamiento.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const lock = mobile && (showAdd || drawerOpen);
    document.documentElement.style.overflow = lock ? 'hidden' : '';
    document.body.style.overflow = lock ? 'hidden' : '';
  });

  // Nombre de display editable (Cuenta). Se inicializa una vez con el valor guardado en user_metadata.
  let nameDraft = $state('');
  let nameInit = false;
  $effect(() => {
    // espera a que exista el USER (no solo ready: el primer ready llega con user=null antes del login)
    if ($auth.user && !nameInit) {
      nameDraft = $auth.user.user_metadata?.display_name ?? '';
      nameInit = true;
    }
  });
  const saveName = () => setDisplayNameAction(nameDraft);

  let canWrite = $derived(!!$auth.session); // every authenticated tab can write (Postgres arbitra)
  let isEmpty = $derived(($dbStatus?.counts?.entrada ?? 0) === 0);
  let counts = $derived($dbStatus?.counts);

  onMount(() => {
    __installTestHooks();
    boot();
    const mq = window.matchMedia('(max-width: 700px)');
    const upd = () => (mobile = mq.matches);
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  });
</script>

<!-- Splash viva (Tanda 7): cubre la carga real del arranque; una vez por boot, se auto-gestiona -->
<Splash />

{#if !$auth.ready}
  <p class="loading">Conectando…</p>
{:else if !$auth.session}
  <Login />
{:else}
<!-- Pull-to-refresh (Tanda 7, solo móvil): re-consulta la pantalla actual con la corona -->
<PullToRefresh onrefresh={doRefresh} />
<!-- MÓVIL: cabecera hamburguesa + título de sección + avatar. Escritorio: oculta (CSS). -->
<header class="mhead" class:pushed={drawerOpen}>
  <button class="mh-burger" aria-label="Abrir menú" onclick={() => (drawerOpen = true)}>
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  </button>
  <span class="mh-title">{title}</span>
  <button class="mh-avatar" aria-label="Ir a tu perfil" onclick={() => navTo('perfil')}>{avatarInitial}</button>
</header>

<nav class="tabs">
  <button class:active={view === 'home'} onclick={() => (view = 'home')}>Inicio</button>
  <button class:active={view === 'diario'} onclick={() => (view = 'diario')}>Diario</button>
  <button class:active={view === 'colecciones'} onclick={() => (view = 'colecciones')}>Colecciones</button>
  <button class:active={view === 'estadisticas'} onclick={() => (view = 'estadisticas')}>Estadísticas</button>
  <button class:active={view === 'timeline'} onclick={() => (view = 'timeline')}>Timeline</button>
  <button class:active={view === 'wrapped'} onclick={() => (view = 'wrapped')}>Wrapped</button>
  <button class:active={view === 'perfil'} onclick={() => (view = 'perfil')}>Perfil</button>
  <button class:active={view === 'hall'} onclick={() => (view = 'hall')}>Hall of Fame</button>
  <button class:active={view === 'cuenta'} onclick={() => (view = 'cuenta')}>Cuenta</button>
</nav>

<!-- pushed (Tanda 6): parallax de profundidad al abrir el drawer — SOLO móvil; el wrapper no
     contiene nada fixed (drawer/FAB/sheets viven fuera → su posicionamiento no se rompe) -->
<div class="page" class:pushed={drawerOpen}>
{#key refreshTick}
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
{:else if view === 'wrapped'}
  <WrappedPanel />
{:else if view === 'perfil'}
  <PerfilPanel />
{:else if view === 'hall'}
  <HallPanel initialMode={hallMode} />
{:else}
  <section class="cuenta">
    <h2>Cuenta</h2>
    <div class="name-edit">
      <label class="nm-lbl" for="dispname">Tu nombre</label>
      <div class="nm-row">
        <input id="dispname" bind:value={nameDraft} placeholder="Tu nombre" maxlength="40" autocomplete="off" />
        <Button variant="secondary" onclick={saveName} disabled={!!$busy || (nameDraft.trim() === ($auth.user?.user_metadata?.display_name ?? ''))}>Guardar</Button>
      </div>
      <p class="note small">Así te llama la app — el hero de Inicio y el carnet del Perfil. Ahora luces <strong>{$displayName}</strong>. Si lo dejas vacío, se usa tu email.</p>
    </div>
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
{/key}
</div>

<!-- FAB: en móvil en TODAS las pantallas; en escritorio solo en Diario (intacto).
     FUERA de .page: el will-change/transform del parallax (Tanda 6) convertiría a .page en
     containing block del fixed y el FAB quedaría anclado al contenido, no al viewport. -->
{#if canWrite && (mobile || view === 'diario') && !(view === 'diario' && isEmpty)}
  <button class="fab" onclick={() => (showAdd = true)} aria-label="Registrar entrada">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  </button>
{/if}

<!-- Constelación (Tanda 8): pantalla completa FUERA de .page (§11.43); bajo los sheets (z-50<60) -->
<Constelacion />

<!-- MÓVIL: drawer lateral con las 9 secciones + "Cuenta y datos". Escritorio: oculto (CSS). -->
<div class="drawer" class:open={drawerOpen} aria-hidden={!drawerOpen}>
  <button class="scrim" tabindex="-1" aria-label="Cerrar menú" onclick={() => (drawerOpen = false)}></button>
  <nav class="panel" aria-label="Secciones">
    <div class="dhead">
      <span class="dbrand"><span class="dlogo">O</span><span class="dname">Ocio Shit</span></span>
      <button class="dx" aria-label="Cerrar menú" onclick={() => (drawerOpen = false)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
    <button class="navrow" class:on={view === 'home'} onclick={() => navTo('home')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>Inicio</button>
    <button class="navrow" class:on={view === 'diario'} onclick={() => navTo('diario')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="14" y2="18" /></svg>Diario</button>
    <button class="navrow" class:on={view === 'colecciones'} onclick={() => navTo('colecciones')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7l3-3h10l3 3M4 7v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M4 7h16" /></svg>Colecciones</button>
    <button class="navrow" class:on={view === 'estadisticas'} onclick={() => navTo('estadisticas')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-4 3 2 4-6" /></svg>Estadísticas</button>
    <button class="navrow" class:on={view === 'timeline'} onclick={() => navTo('timeline')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /></svg>Timeline</button>
    <button class="navrow" class:on={view === 'hall' && hallMode === 'fame'} onclick={() => navTo('hall', { hallMode: 'fame' })}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2" /></svg>Hall of Fame</button>
    <button class="navrow" class:on={view === 'hall' && hallMode === 'shame'} onclick={() => navTo('hall', { hallMode: 'shame' })}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12M2 13l2-9h13l-1 7M17 11l4 1-2 9H7" /></svg>Hall of Shame</button>
    <button class="navrow" class:on={view === 'wrapped'} onclick={() => navTo('wrapped')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M5 12H2M22 12h-3M6 6l-2-2M20 20l-2-2M6 18l-2 2M20 4l-2 2" /><circle cx="12" cy="12" r="4" /></svg>Wrapped</button>
    <button class="navrow" class:on={view === 'perfil'} onclick={() => navTo('perfil')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>Perfil</button>
    <div class="navfoot">
      <button class="navrow" class:on={view === 'cuenta'} onclick={() => navTo('cuenta')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></svg>Cuenta y datos</button>
    </div>
  </nav>
</div>

<Sheet open={showAdd} title="Nueva entrada" eyebrow="Registro rápido" onclose={requestCloseAdd}>
  <QuickAddForm bind:this={addFormRef} onsaved={closeAdd} />
  {#if confirmDiscard}
    <div class="discard-scrim" role="alertdialog" aria-modal="true" aria-label="Descartar entrada">
      <div class="discard-box">
        <p>¿Descartar la entrada? Hay datos sin guardar.</p>
        <div class="discard-row">
          <button class="d-keep" onclick={() => (confirmDiscard = false)}>Seguir editando</button>
          <button class="d-drop" onclick={closeAdd}>Descartar</button>
        </div>
      </div>
    </div>
  {/if}
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
  .name-edit {
    width: 100%;
    max-width: 34em;
    margin: 0.3rem 0 0.6rem;
  }
  .name-edit .nm-lbl {
    display: block;
    font-family: var(--font-data, monospace);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label);
    margin-bottom: 0.35rem;
  }
  .name-edit .nm-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .name-edit input {
    flex: 1;
    min-width: 0;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font-family: var(--font-display);
    font-size: 1.05rem;
  }
  .name-edit input:focus {
    outline: none;
    border-color: var(--accent);
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

  /* ════════ CHASIS MÓVIL (Design) ════════
     Cabecera hamburguesa + drawer lateral. OCULTO por defecto (escritorio intacto); se activa ≤700px.
     El .page envuelve el contenido de cada vista para darle el aire bajo la cabecera fija en móvil. */
  .mhead { display: none; }
  .drawer { display: none; }
  .page { width: 100%; }

  /* drawer interior (solo se ve dentro del drawer, que es display:none en escritorio) */
  .dhead { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 16px; }
  .dbrand { display: flex; align-items: center; gap: 11px; }
  .dlogo {
    width: 34px; height: 34px; border-radius: 9px;
    background: linear-gradient(135deg, #f4b36c, #c2662c);
    display: grid; place-items: center;
    font-family: var(--font-display); color: #0b0a08; font-weight: 600; font-size: 1.05rem;
  }
  .dname { font-family: var(--font-display); font-size: 1.2rem; color: var(--ink); font-weight: 500; }
  .dx {
    width: 36px; height: 36px; border-radius: 50%; flex: 0 0 auto;
    border: 1px solid var(--line-strong); background: none; color: var(--ink-2);
    display: grid; place-items: center; cursor: pointer;
  }
  .navrow {
    display: flex; align-items: center; gap: 13px; width: 100%;
    text-align: left; background: none; border: none;
    padding: 13px 12px; border-radius: 11px;
    color: var(--ink-2); font-family: var(--font-text); font-size: 0.95rem; cursor: pointer;
    transition: background 0.2s, color 0.2s;
  }
  .navrow svg { width: 19px; height: 19px; flex: 0 0 auto; }
  .navrow:hover { background: #171410; color: var(--ink); }
  .navrow.on { background: #171410; color: var(--gold); font-weight: 600; }
  .navfoot { margin-top: auto; border-top: 1px solid var(--line); padding-top: 12px; }

  @media (max-width: 700px) {
    .tabs { display: none; }
    .page { padding: 70px 16px 96px; }

    .mhead {
      display: flex; align-items: center; justify-content: space-between;
      position: fixed; top: 0; left: 0; right: 0; z-index: 30;
      height: 58px; padding: 0 10px;
      background: color-mix(in srgb, var(--bg) 92%, transparent);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
    }
    .mh-burger,
    .mh-avatar {
      flex: 0 0 auto; display: grid; place-items: center;
      background: none; border: none; cursor: pointer; padding: 0;
    }
    .mh-burger { width: 44px; height: 44px; color: var(--ink); border-radius: 11px; }
    .mh-title {
      flex: 1 1 auto; min-width: 0; text-align: center;
      font-family: var(--font-display); font-size: 1.18rem; font-weight: 500; color: var(--ink);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mh-avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: linear-gradient(140deg, #2e2820, #14110d);
      border: 1px solid var(--hairline-plus);
      font-family: var(--font-display); color: var(--gold); font-size: 1.05rem;
    }

    .drawer { display: block; position: fixed; inset: 0; z-index: 55; pointer-events: none; }
    .drawer .scrim {
      position: absolute; inset: 0; border: none; padding: 0; cursor: pointer;
      background: rgba(7, 6, 5, 0.6); opacity: 0; transition: opacity 0.3s;
    }
    .drawer .panel {
      position: absolute; left: 0; top: 0; bottom: 0;
      width: min(84vw, 300px);
      background: #0e0c09; border-right: 1px solid var(--line);
      transform: translateX(-100%); transition: transform 0.34s cubic-bezier(0.2, 0.8, 0.2, 1);
      display: flex; flex-direction: column; padding: 16px 12px;
      overflow-y: auto; overscroll-behavior: contain;
    }
    .drawer.open { pointer-events: auto; }
    .drawer.open .scrim { opacity: 1; }
    .drawer.open .panel { transform: translateX(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .fab {
      transition: none;
    }
    .drawer .scrim,
    .drawer .panel {
      transition: none;
    }
  }

  /* ── DRAWER PARALLAX (Tanda 6, SOLO móvil + no-preference): al abrir el drawer, el contenido
     de fondo se empuja ~20px a la derecha, escala 0,98 y se oscurece (solo transform+opacity —
     capa compositada; el oscurecimiento extra es opacity, además del scrim). Reduced-motion:
     este bloque ni aplica (solo scrim). Escritorio: sin drawer, intacto. ── */
  @media (max-width: 700px) and (prefers-reduced-motion: no-preference) {
    .page,
    .mhead {
      transition:
        transform var(--dur-base) var(--ease),
        opacity var(--dur-base) var(--ease);
      will-change: transform;
    }
    .page.pushed,
    .mhead.pushed {
      transform: translateX(20px) scale(0.98);
      opacity: 0.62;
    }
  }

  /* Confirmación de descarte del registro (encima del sheet z-60; el form sigue montado debajo) */
  .discard-scrim {
    position: fixed;
    inset: 0;
    z-index: 70;
    background: color-mix(in srgb, #000 55%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.2rem;
  }
  .discard-box {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    padding: 1.1rem 1.2rem;
    max-width: 22rem;
    width: 100%;
    box-shadow: var(--shadow-raised, 0 8px 30px rgba(0, 0, 0, 0.5));
  }
  .discard-box p {
    margin: 0 0 0.9rem;
    line-height: 1.45;
  }
  .discard-row {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .d-keep {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius-pill);
    padding: 0.55rem 1.1rem;
    cursor: pointer;
    font-weight: 700;
  }
  .d-drop {
    background: none;
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    color: var(--danger-ink);
    border-radius: var(--radius-pill);
    padding: 0.55rem 1.1rem;
    cursor: pointer;
  }
  .d-drop:hover {
    border-color: var(--danger);
  }
</style>
