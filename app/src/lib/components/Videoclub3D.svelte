<script>
  // VIDEOCLUB 3D — la tienda completa: todo lo visto/leído/jugado como estuches reales, en
  // pasillos por FORMATO y estanterías por GÉNERO, que se recorre a pie. Overlay a pantalla
  // completa (z-50, bajo los sheets: la ficha de la obra se abre encima). three.js vive SOLO en
  // este chunk (import dinámico desde +page): el resto de la app no carga ni un byte de 3D.
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { createVideoclub } from '$lib/videoclub3d.js';
  import { buildSections, FORMATOS } from '$lib/videoclub-sections.js';
  import { videoclubObras } from '$lib/db/supabase-data.js';
  import { openObraDetail } from '$lib/boot-supabase.js';
  import { detail } from '$lib/stores.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtCount, prefersReducedMotion } from '$lib/motion.js';

  let { onclose } = $props();

  let wrap = $state(null);
  let fase = $state('cargando'); // cargando | listo | vacio | error
  let errMsg = $state('');
  let secciones = $state.raw([]); // [{ id, formato, formatoLabel, label, obras }]
  let total = $state(0);
  let sel = $state.raw(null); // obra seleccionada (estuche fuera de la balda)
  let stats = $state.raw(null);
  let coarse = $state(false);
  let debug = $state(false);
  let engine = null;

  const fmtNota = (n) => (n == null ? 'sin nota' : String(n).replace('.', ','));
  // directorio: formato → sus secciones
  let directorio = $derived(
    FORMATOS.map((f) => ({ ...f, secs: secciones.filter((s) => s.formato === f.id) })).filter((f) => f.secs.length)
  );

  onMount(() => {
    coarse = window.matchMedia('(pointer: coarse)').matches;
    debug = new URLSearchParams(location.search).has('vcdebug');
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    let vivo = true;

    (async () => {
      try {
        const listas = await Promise.all(FORMATOS.map((f) => videoclubObras(f.id)));
        if (!vivo) return;
        const porFormato = Object.fromEntries(FORMATOS.map((f, i) => [f.id, listas[i]]));
        const secs = buildSections(porFormato);
        total = secs.reduce((n, s) => n + s.obras.length, 0);
        if (!total) {
          fase = 'vacio';
          return;
        }
        secciones = secs;
        engine = createVideoclub(wrap, {
          colors: Object.fromEntries(Object.entries(CAT_COLOR).map(([k, v]) => [k, v.c])),
          woodUrl: `${base}/wood.jpg`,
          reduced: prefersReducedMotion(),
          coarse,
          onSelect: (o) => (sel = o),
          onStats: (s) => (stats = s)
        });
        window.__videoclub = engine; // gancho de E2E/depuración (hitAt, getState)
        engine.setStore(secs);
        fase = 'listo';
        engine.focus();
      } catch (e) {
        if (!vivo) return;
        errMsg = e?.message ?? String(e);
        fase = 'error';
      }
    })();

    const onKey = (e) => {
      // Escape cierra el videoclub, salvo que haya una ficha abierta encima (la cierra su sheet)
      if (e.key === 'Escape' && !$detail) onclose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      vivo = false;
      window.removeEventListener('keydown', onKey);
      document.documentElement.style.overflow = prevOverflow;
      engine?.dispose();
      engine = null;
      delete window.__videoclub;
    };
  });

  function irA(e) {
    const id = e.currentTarget.value;
    e.currentTarget.value = '';
    if (id) engine?.goToSection(id);
    engine?.focus();
  }

  // botones de andar y de girar: mantener pulsado
  const andar = (v) => (e) => {
    e.preventDefault();
    engine?.setWalk(v);
  };
  const girar = (v) => (e) => {
    e.preventDefault();
    engine?.setTurn(v);
  };
</script>

<div class="vc" role="dialog" aria-modal="true" aria-label="Videoclub 3D">
  <div class="stage" bind:this={wrap}></div>

  <header class="hud top">
    <div class="ttl">
      <span class="lbl">Videoclub{#if fase === 'listo'} · {fmtCount(total)} obras{/if}</span>
      {#if fase === 'listo'}
        <strong class="here">{stats?.here ?? 'Pasillo central'}</strong>
        <select aria-label="Ir a una sección" value="" onchange={irA}>
          <option value="">Ir a…</option>
          {#each directorio as f (f.id)}
            <optgroup label={f.label}>
              {#each f.secs as s (s.id)}
                <option value={s.id}>{s.label} · {fmtCount(s.obras.length)}</option>
              {/each}
            </optgroup>
          {/each}
        </select>
      {/if}
    </div>
    <button class="x" aria-label="Salir del videoclub" onclick={() => onclose?.()}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>

  {#if fase === 'cargando'}
    <p class="msg">Abriendo el videoclub…</p>
  {:else if fase === 'vacio'}
    <p class="msg">Todavía no hay obras que colocar en las estanterías.</p>
  {:else if fase === 'error'}
    <p class="msg">No se pudo abrir el videoclub. {errMsg}</p>
  {/if}

  {#if fase === 'listo'}
    {#if sel}
      <div class="card" aria-live="polite">
        <div class="c-txt">
          <strong>{sel.titulo}</strong>
          <span>{sel.seccion} · {sel.anio_obra ?? 's. f.'} · nota {fmtNota(sel.nota)}</span>
        </div>
        <div class="c-act">
          <button onclick={() => engine?.flip()}>Girar</button>
          <button class="pri" onclick={() => openObraDetail(sel.id)}>Abrir ficha</button>
          <button aria-label="Devolver a la balda" onclick={() => engine?.deselect()}>✕</button>
        </div>
      </div>
    {:else}
      <p class="hint">
        {#if coarse}
          Arrastra o usa ◀ ▶ para girar · toca una carátula o el suelo
        {:else}
          W A S D o flechas para andar · arrastra para mirar · clic en una carátula
        {/if}
      </p>
    {/if}

    <div class="pad">
      <button aria-label="Volver a la entrada" title="Volver a la entrada" onclick={() => engine?.goEntrance()}>⌂</button>
      <button
        class="hold"
        aria-label="Girar a la izquierda"
        onpointerdown={girar(1)}
        onpointerup={girar(0)}
        onpointercancel={girar(0)}
        onpointerleave={girar(0)}
        oncontextmenu={(e) => e.preventDefault()}>◀</button>
      <button
        class="hold"
        aria-label="Avanzar"
        onpointerdown={andar(1)}
        onpointerup={andar(0)}
        onpointercancel={andar(0)}
        onpointerleave={andar(0)}
        oncontextmenu={(e) => e.preventDefault()}>▲</button>
      <button
        class="hold"
        aria-label="Retroceder"
        onpointerdown={andar(-1)}
        onpointerup={andar(0)}
        onpointercancel={andar(0)}
        onpointerleave={andar(0)}
        oncontextmenu={(e) => e.preventDefault()}>▼</button>
      <button
        class="hold"
        aria-label="Girar a la derecha"
        onpointerdown={girar(-1)}
        onpointerup={girar(0)}
        onpointercancel={girar(0)}
        onpointerleave={girar(0)}
        oncontextmenu={(e) => e.preventDefault()}>▶</button>
    </div>

    <p class="attr">Carátulas: TMDB · Steam · Open Library</p>
    {#if debug && stats}
      <pre class="dbg">{stats.fps} fps · {stats.draw} draws · {stats.tex} tex
módulos {stats.pages} (lo {stats.lo} · hi {stats.hi})
imgs {stats.imgs} · fallos {stats.fallos} · cola {stats.pend}</pre>
    {/if}
  {/if}
</div>

<style>
  .vc {
    position: fixed;
    inset: 0;
    z-index: 50;
    isolation: isolate;
    background: #0c0a0b;
    color: var(--ink);
    font-family: var(--font-text);
    overscroll-behavior: contain;
    user-select: none;
    -webkit-user-select: none;
  }
  .stage {
    position: absolute;
    inset: 0;
  }
  .hud.top {
    position: absolute;
    z-index: 2;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: calc(0.8rem + env(safe-area-inset-top)) 1rem 1.4rem;
    background: linear-gradient(rgba(8, 7, 8, 0.82), rgba(8, 7, 8, 0));
    pointer-events: none;
  }
  .hud.top > * {
    pointer-events: auto;
  }
  .ttl {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }
  .lbl {
    font-family: var(--font-data);
    font-size: 0.66rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-2);
  }
  select {
    font: 600 0.86rem var(--font-text);
    color: var(--ink);
    background: rgba(20, 17, 13, 0.86);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    padding: 0.42rem 0.6rem;
    max-width: min(72vw, 22rem);
  }
  .x {
    flex: none;
    width: 2.6rem;
    height: 2.6rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background: rgba(20, 17, 13, 0.86);
    color: var(--ink);
    cursor: pointer;
  }
  .msg {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 2rem;
    text-align: center;
    color: var(--ink-2);
  }
  .here {
    font: 600 1.05rem var(--font-display);
    text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
  }
  .hint,
  .card {
    position: absolute;
    z-index: 2;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(5.4rem + env(safe-area-inset-bottom));
  }
  .hint {
    margin: 0;
    padding: 0.4rem 0.8rem;
    border-radius: 999px;
    background: rgba(8, 7, 8, 0.6);
    color: var(--ink-2);
    font-size: 0.76rem;
    text-align: center;
    width: max-content;
    max-width: calc(100vw - 2rem);
    pointer-events: none;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    width: max-content;
    max-width: calc(100vw - 1.5rem);
    padding: 0.6rem 0.7rem 0.6rem 0.95rem;
    border-radius: 14px;
    border: 1px solid var(--line-strong);
    background: rgba(20, 17, 13, 0.94);
  }
  .c-txt {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .c-txt strong {
    font: 600 1rem var(--font-display);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 44vw;
  }
  .c-txt span {
    font-size: 0.76rem;
    color: var(--ink-2);
  }
  .c-act {
    display: flex;
    gap: 0.35rem;
    flex: none;
  }
  .c-act button,
  .pad button {
    font: 600 0.8rem var(--font-text);
    color: var(--ink);
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    padding: 0.45rem 0.75rem;
    cursor: pointer;
    touch-action: manipulation;
  }
  .c-act .pri {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .pad {
    position: absolute;
    z-index: 2;
    left: 50%;
    transform: translateX(-50%);
    bottom: calc(1.1rem + env(safe-area-inset-bottom));
    display: flex;
    gap: 0.45rem;
    max-width: calc(100vw - 1rem);
  }
  .pad button {
    width: 3.1rem;
    height: 3.1rem;
    padding: 0;
    font-size: 1.05rem;
    background: rgba(20, 17, 13, 0.86);
  }
  .pad .hold {
    touch-action: none;
  }
  .attr {
    position: absolute;
    z-index: 1;
    left: 0.8rem;
    bottom: calc(0.5rem + env(safe-area-inset-bottom));
    margin: 0;
    font-size: 0.62rem;
    color: var(--ink-3);
    pointer-events: none;
  }
  .dbg {
    position: absolute;
    z-index: 2;
    right: 0.9rem;
    bottom: calc(0.5rem + env(safe-area-inset-bottom));
    margin: 0;
    padding: 0.4rem 0.55rem;
    border-radius: 8px;
    background: rgba(8, 7, 8, 0.7);
    font: 0.62rem/1.35 var(--font-data);
    color: var(--ink-2);
    pointer-events: none;
  }
  @media (max-width: 700px) {
    .attr {
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(0.15rem + env(safe-area-inset-bottom));
      white-space: nowrap;
    }
    .pad {
      bottom: calc(1.3rem + env(safe-area-inset-bottom));
    }
    .card {
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }
    .c-txt strong {
      max-width: 78vw;
    }
    .c-act {
      justify-content: space-between;
    }
  }
</style>
