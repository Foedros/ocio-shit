<script>
  import { onMount } from 'svelte';
  import { boot, signOutAction, exportAction, setDisplayNameAction, setTabTxAction, refreshArchive, refreshColecciones, __installTestHooks } from '$lib/boot-supabase.js';
  import { auth, dbStatus, displayName, busy, constelOpen } from '$lib/stores.js';
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
  import IndecisionPanel from '$lib/components/IndecisionPanel.svelte';
  import { tabTransition, tabTxInterrupt } from '$lib/tab-transitions.js';
  import Login from '$lib/components/Login.svelte';
  import Sheet from '$lib/components/Sheet.svelte';
  import Button from '$lib/components/Button.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let view = $state('home'); // home | diario | colecciones | estadisticas | timeline | constelacion | indecision | wrapped | perfil | hall | cuenta
  let showAdd = $state(false);
  let addPrefill = $state(null); // La Indecisión (§11.63): registrar en el Diario con la obra precargada

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
    addPrefill = null;
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
    timeline: 'Timeline', constelacion: 'Constelación', indecision: 'La Indecisión',
    wrapped: 'Wrapped', perfil: 'Perfil', cuenta: 'Cuenta'
  };
  let title = $derived(
    view === 'hall' ? (hallMode === 'shame' ? 'Hall of Shame' : 'Hall of Fame') : (TITLES[view] ?? 'Ocio Shit')
  );
  let avatarInitial = $derived((($displayName || '?').trim().charAt(0) || '?').toUpperCase());

  function navTo(v, opts) {
    if (v === 'hall') hallMode = opts?.hallMode ?? 'fame';
    if (v === 'constelacion' && view !== 'constelacion') prevView = view;
    const from = view;
    drawerOpen = false;
    if (v === from) return;
    // TRANSICIONES DE PESTAÑA (§11.59-11.61): cada cambio de sección sortea una de las formas
    // ACTIVAS en las preferencias (cine/literatura/videojuego; 0 activas o reduced-motion =
    // fundido). La Constelación queda FUERA en ambos sentidos: es un overlay fijo con su propia
    // presentación e history, y detrás de su cielo el .page renderiza otra cosa (el sorteo la
    // revelaría a medias).
    if (v === 'constelacion' || from === 'constelacion') {
      tabTxInterrupt(); // que ningún swap diferido (cine) revierta esta navegación
      view = v;
      return;
    }
    tabTransition(() => (view = v), { to: v, prefs: txPrefs });
  }

  // ── CONSTELACIÓN como SECCIÓN (§11.51): view='constelacion' monta el cielo (el componente
  // sigue siendo pantalla completa fija FUERA de .page, §11.43 — esa presentación ES la
  // sección). X/back devuelven a la sección ANTERIOR (o Inicio); deep-link = #constelacion. ──
  let prevView = 'home';
  $effect(() => {
    constelOpen.set(view === 'constelacion');
  });
  // el componente cierra por X/back (popstate) → volvemos a la sección anterior y limpiamos
  // el hash residual del deep-link (replaceState: sin ensuciar la pila)
  $effect(() => {
    if (!$constelOpen && view === 'constelacion') {
      view = prevView ?? 'home';
      if (typeof location !== 'undefined' && location.hash === '#constelacion') {
        try {
          history.replaceState(null, '', location.pathname + location.search);
        } catch {
          /* ignore */
        }
      }
    }
  });

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

  // Transiciones de pestaña (Cuenta, §11.61): qué formas entran en el sorteo. La VERDAD vive en
  // user_metadata.tab_tx del auth store (lo actualizan los guardados, USER_UPDATED y el token
  // refresh — clave en multi-dispositivo); txLocal es la capa OPTIMISTA de los clics aún sin
  // confirmar. UI y sorteo leen la MISMA mezcla (txPrefs — navTo se la pasa a tabTransition), y
  // el snapshot que se persiste se construye desde el metadata VIVO en el momento del clic —
  // nunca desde una semilla vieja que pisaría cambios hechos en otro dispositivo/pestaña.
  const TX_OPTS = [['cine', 'Cine'], ['literatura', 'Literatura'], ['videojuego', 'Videojuego']];
  let txLocal = $state(null);
  let txPrefs = $derived({ ...($auth.user?.user_metadata?.tab_tx ?? {}), ...(txLocal ?? {}) });
  // los guardados van EN CADENA: varios clics rápidos no lanzan updateUser concurrentes
  // (llegarían desordenados y podría ganar un estado viejo); cada uno persiste su snapshot.
  let txSaving = Promise.resolve();
  let txPending = 0;
  function toggleTx(k) {
    txLocal = { ...(txLocal ?? {}), [k]: !(txPrefs[k] !== false) };
    const snapshot = { ...($auth.user?.user_metadata?.tab_tx ?? {}), ...txLocal };
    txPending++;
    txSaving = txSaving
      .then(() => setTabTxAction(snapshot))
      .finally(() => {
        // al vaciarse la cadena el auth store ya es la verdad (o el guardado falló, con toast)
        // → se retira la capa optimista y la UI CONVERGE al estado persistido real
        if (--txPending === 0) txLocal = null;
      });
  }

  let canWrite = $derived(!!$auth.session); // every authenticated tab can write (Postgres arbitra)
  let isEmpty = $derived(($dbStatus?.counts?.entrada ?? 0) === 0);
  let counts = $derived($dbStatus?.counts);

  onMount(() => {
    __installTestHooks();
    boot();
    // deep-link a la Constelación (#constelacion): entra directo; back/X → Inicio.
    // Se limpia el hash de ESTA entrada de history (el componente empuja la suya propia
    // con #constelacion) — si no, el back() de la X aterrizaría en una entrada con hash.
    if (location.hash === '#constelacion') {
      prevView = 'home';
      view = 'constelacion';
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        /* ignore */
      }
    }
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

<!-- ESCRITORIO ≥1000 (refresh §11.57): top bar en una línea — marca · nav agrupada por intención
     (Consulta · Análisis · Personal, con separadores) · buscar/cuenta. Solo ≥1000px (CSS);
     entre 701-999 se muestra el .tabs de siempre; ≤700 el chasis móvil. -->
<nav class="topbar" aria-label="Navegación">
  <div class="tb-brand">
    <span class="tb-logo">O</span>
    <span class="tb-name"><span class="tb-title">Ocio&nbsp;Shit</span><span class="tb-sub lbl">Archivo cultural</span></span>
  </div>
  <div class="tb-nav">
    <button class="tb-i" class:on={view === 'home'} onclick={() => navTo('home')}>Inicio</button>
    <button class="tb-i" class:on={view === 'diario'} onclick={() => navTo('diario')}>Diario</button>
    <button class="tb-i" class:on={view === 'colecciones'} onclick={() => navTo('colecciones')}>Colecciones</button>
    <span class="tb-sep"></span>
    <button class="tb-i" class:on={view === 'estadisticas'} onclick={() => navTo('estadisticas')}>Estadísticas</button>
    <button class="tb-i" class:on={view === 'timeline'} onclick={() => navTo('timeline')}>Timeline</button>
    <button class="tb-i" class:on={view === 'constelacion'} onclick={() => navTo('constelacion')}>Constelación</button>
    <button class="tb-i" class:on={view === 'indecision'} onclick={() => navTo('indecision')}>La Indecisión</button>
    <span class="tb-sep"></span>
    <button class="tb-i" class:on={view === 'perfil'} onclick={() => navTo('perfil')}>Perfil</button>
    <button class="tb-i" class:on={view === 'hall'} onclick={() => navTo('hall', { hallMode: 'fame' })}>Hall of Fame</button>
    <button class="tb-i" class:on={view === 'wrapped'} onclick={() => navTo('wrapped')}>Wrapped</button>
  </div>
  <div class="tb-right">
    <button class="tb-search" aria-label="Buscar en el Diario" onclick={() => navTo('diario')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
    </button>
    <button class="tb-acct" class:on={view === 'cuenta'} aria-label="Cuenta y datos" onclick={() => navTo('cuenta')}>
      <span class="tb-av">{avatarInitial}</span>
    </button>
  </div>
</nav>

<nav class="tabs">
  <button class:active={view === 'home'} onclick={() => navTo('home')}>Inicio</button>
  <button class:active={view === 'diario'} onclick={() => navTo('diario')}>Diario</button>
  <button class:active={view === 'colecciones'} onclick={() => navTo('colecciones')}>Colecciones</button>
  <button class:active={view === 'estadisticas'} onclick={() => navTo('estadisticas')}>Estadísticas</button>
  <button class:active={view === 'timeline'} onclick={() => navTo('timeline')}>Timeline</button>
  <button class:active={view === 'constelacion'} onclick={() => navTo('constelacion')}>Constelación</button>
  <button class:active={view === 'indecision'} onclick={() => navTo('indecision')}>La Indecisión</button>
  <button class:active={view === 'wrapped'} onclick={() => navTo('wrapped')}>Wrapped</button>
  <button class:active={view === 'perfil'} onclick={() => navTo('perfil')}>Perfil</button>
  <button class:active={view === 'hall'} onclick={() => navTo('hall')}>Hall of Fame</button>
  <button class:active={view === 'cuenta'} onclick={() => navTo('cuenta')}>Cuenta</button>
</nav>

<!-- pushed (Tanda 6): parallax de profundidad al abrir el drawer — SOLO móvil; el wrapper no
     contiene nada fixed (drawer/FAB/sheets viven fuera → su posicionamiento no se rompe) -->
<div class="page" class:pushed={drawerOpen}>
{#key refreshTick}
{#if view === 'home'}
  <HomePanel onnavigate={(v) => navTo(v)} onregister={() => (showAdd = true)} />
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
{:else if view === 'indecision'}
  <IndecisionPanel onregistrar={(pre) => { addPrefill = pre; showAdd = true; }} />
{:else if view === 'wrapped'}
  <WrappedPanel />
{:else if view === 'perfil'}
  <PerfilPanel onconstelacion={() => navTo('constelacion')} />
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
    <div class="tx-prefs">
      <span class="nm-lbl" id="txlbl">Transiciones de pestaña</span>
      <div class="tx-row" role="group" aria-labelledby="txlbl">
        {#each TX_OPTS as [k, lbl] (k)}
          <button
            class="tx-toggle"
            class:on={txPrefs[k] !== false}
            role="switch"
            aria-checked={txPrefs[k] !== false}
            disabled={!$auth.user}
            onclick={() => toggleTx(k)}>{lbl}</button>
        {/each}
      </div>
      <p class="note small">Al cambiar de sección se sortea una de las activas — Cine (cinemascope), Literatura (pasar página) o Videojuego (píxeles). Con una sola activa, siempre esa; sin ninguna, un fundido simple.</p>
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
<!-- En La Indecisión el FAB se retira: la sección tiene su propio "+ Añadir" y el botón
     flotante tapaba el extremo del "✦ Girar" a lo ancho en móvil (§11.63). -->
{#if canWrite && ((mobile && view !== 'indecision') || view === 'diario') && !(view === 'diario' && isEmpty)}
  <button class="fab" onclick={() => (showAdd = true)} aria-label="Registrar entrada">
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  </button>
{/if}

<!-- Constelación — SECCIÓN propia (§11.51) con presentación a pantalla completa, FUERA de
     .page (§11.43); bajo los sheets (z-50<60). view='constelacion' la monta (sync arriba). -->
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
    <button class="navrow" class:on={view === 'constelacion'} onclick={() => navTo('constelacion')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="1.6" /><circle cx="12" cy="6" r="1.6" /><circle cx="19" cy="13" r="1.6" /><path d="M7.2 15.8L10.9 7.4M13.5 6.9l4.2 5M17.5 13.9l-9.9 2.7" /></svg>Constelación</button>
    <button class="navrow" class:on={view === 'indecision'} onclick={() => navTo('indecision')}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></svg>La Indecisión</button>
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
  <QuickAddForm bind:this={addFormRef} onsaved={closeAdd} prefill={addPrefill} />
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
  /* Transiciones de pestaña (§11.61): qué formas entran en el sorteo */
  .tx-prefs {
    width: 100%;
    max-width: 34em;
    margin: 0.1rem 0 0.6rem;
  }
  .tx-prefs .nm-lbl {
    display: block;
    font-family: var(--font-data, monospace);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label);
    margin-bottom: 0.4rem;
  }
  .tx-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .tx-toggle {
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--ink-3);
    border-radius: 999px;
    padding: 0.4rem 0.95rem;
    font-size: 0.85rem;
    font-family: inherit;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .tx-toggle.on {
    background: #171410;
    border-color: rgba(242, 166, 90, 0.45);
    color: var(--gold);
    font-weight: 600;
  }
  .tx-toggle:disabled {
    opacity: 0.5;
    cursor: default;
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
    flex-wrap: wrap;
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

  /* ════ TOP BAR de escritorio (refresh §11.57) — oculta por defecto; solo ≥1000px ════ */
  .topbar {
    display: none;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    height: 62px;
    padding: 0 18px;
    margin: -0.4rem 0 1.4rem;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, #0b0a08 82%, transparent);
    backdrop-filter: blur(12px);
    position: sticky;
    top: 8px;
    z-index: 20;
  }
  .tb-brand {
    display: flex;
    align-items: center;
    gap: 11px;
    flex: none;
  }
  .tb-logo {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: linear-gradient(135deg, #f4b36c, #c2662c);
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    color: #0b0a08;
    font-weight: 600;
    font-size: 1.2rem;
    box-shadow: 0 3px 10px rgba(232, 96, 44, 0.3);
  }
  .tb-name {
    display: flex;
    flex-direction: column;
    line-height: 1;
  }
  .tb-title {
    font-family: var(--font-display);
    font-size: 1.15rem;
    color: var(--ink);
    font-weight: 500;
  }
  .tb-sub {
    font-size: 0.5rem;
    color: var(--ink-3);
    margin-top: 3px;
  }
  .tb-nav {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
    justify-content: center;
    min-width: 0;
  }
  .tb-i {
    background: none;
    border: none;
    color: var(--ink-2);
    font-family: var(--font-text);
    font-size: 0.87rem;
    padding: 7px 10px;
    border-radius: 9px;
    cursor: pointer;
    white-space: nowrap;
    transition: color 0.2s, background 0.2s;
  }
  .tb-i:hover {
    color: var(--ink);
    background: var(--surface);
  }
  .tb-i.on {
    color: var(--gold);
    background: #171410;
    font-weight: 600;
  }
  .tb-sep {
    width: 1px;
    height: 20px;
    background: var(--line-strong);
    flex: none;
    margin: 0 7px;
  }
  .tb-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }
  .tb-search {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--ink-2);
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
  }
  .tb-search:hover {
    color: var(--ink);
    border-color: var(--hairline-plus);
  }
  .tb-acct {
    display: flex;
    align-items: center;
    padding: 4px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    background: none;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .tb-acct:hover,
  .tb-acct.on {
    border-color: var(--hairline-plus);
  }
  .tb-av {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(140deg, #2e2820, #14110d);
    border: 1px solid var(--hairline-plus);
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    color: var(--gold);
    font-size: 0.95rem;
  }
  @media (min-width: 1000px) {
    .topbar { display: flex; }
    .tabs { display: none; }
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
