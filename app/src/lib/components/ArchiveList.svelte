<script>
  import VirtualList from './VirtualList.svelte';
  import GalleryFlow from './GalleryFlow.svelte';
  import ShelfGrid from './ShelfGrid.svelte';
  import { archiveEntries, archiveFilters, archiveView, filterOpts, dbStatus } from '$lib/stores.js';
  import { setFilters, openEntryDetail } from '$lib/boot-supabase.js';
  import { buscarPersonas } from '$lib/db/supabase-data.js';
  import { CATEGORIA_LABELS, ORIGEN_LABELS } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtFecha, fmtValoracion } from '$lib/format.js';

  let searchTimer;
  function onSearch(e) {
    const v = e.currentTarget.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilters({ search: v }), 220);
  }
  const label = (map, v) => map[v] ?? v ?? '—';

  // AÑO de la obra (§11.65): solo los años que existen en el archivo, agrupados por década
  // (optgroup nativo — legible sin inventar un widget) de la más reciente a la más antigua
  let decadas = $derived.by(() => {
    const by = new Map();
    for (const a of $filterOpts.anios ?? []) {
      const dec = Math.floor(a / 10) * 10;
      if (!by.has(dec)) by.set(dec, []);
      by.get(dec).push(a);
    }
    return [...by.entries()]
      .sort((x, y) => y[0] - x[0])
      .map(([dec, anios]) => ({ label: `${dec}s`, anios: anios.sort((a, b) => b - a) }));
  });

  // CREADOR (§11.65): autocompletado contra personas (patrón de La Indecisión — debounce +
  // guard de secuencia contra respuestas rancias); elegido → chip con ✕ que restaura
  let cq = $state('');
  let csug = $state([]);
  let cSeq = 0;
  let cTimer;
  function onCreadorInput() {
    clearTimeout(cTimer);
    const t = cq.trim();
    if (t.length < 2) {
      cSeq++; // invalida búsquedas ya despachadas
      csug = [];
      return;
    }
    const seq = ++cSeq;
    cTimer = setTimeout(async () => {
      try {
        const r = await buscarPersonas(t);
        if (seq === cSeq) csug = r;
      } catch {
        /* la búsqueda no bloquea el filtrado */
      }
    }, 250);
  }
  function pickCreador(p) {
    cq = '';
    csug = [];
    cSeq++;
    setFilters({ creador: { id: p.id, nombre: p.nombre } });
  }
  // cierra e INVALIDA: sin cSeq++/clearTimeout una búsqueda ya despachada re-abriría el
  // desplegable huérfano tras el blur. Las filas hacen preventDefault en pointerdown (el input
  // no pierde el foco al tocarlas) → elegir va por click (teclado incluido) y el blur real
  // puede cerrar de inmediato.
  function closeSug() {
    clearTimeout(cTimer);
    cSeq++;
    csug = [];
  }
  function onCreadorKey(e) {
    if (e.key === 'Escape') closeSug();
  }
  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };
  // La lista solo vuelve al principio cuando cambian los FILTROS — no al puntuar una entrada.
  let filterKey = $derived(JSON.stringify($archiveFilters));

  // ESTANTERÍA: deduplicación visual por OBRA — reconsumos y entradas-año (LoL/HotS/SC2)
  // aparecen UNA vez. La lista viene ordenada fecha desc → la primera aparición de cada obra
  // es su entrada más reciente (la representante). Respeta los mismos filtros/buscador.
  let shelfItems = $derived.by(() => {
    const seen = new Set();
    const out = [];
    for (const e of $archiveEntries) {
      if (seen.has(e.obra_id)) continue;
      seen.add(e.obra_id);
      out.push(e);
    }
    return out;
  });
</script>

<!-- ESCRITORIO ≥1000 (refresh §11.57): título "Diario" + cifras integradas (obras · entradas)
     junto a él; la barra de filtros pasa a UNA fila. Solo desktop (CSS); móvil intacto. -->
<div class="diario-head">
  <h2 class="dh-title">Diario</h2>
  {#if $dbStatus?.counts}
    <div class="dh-count">
      <span class="dh-n gold">{$dbStatus.counts.obra.toLocaleString('es-ES')}</span><span class="dh-l">obras</span>
      <span class="dh-dot"></span>
      <span class="dh-n">{$dbStatus.counts.entrada.toLocaleString('es-ES')}</span><span class="dh-l">entradas</span>
    </div>
  {/if}
</div>

<div class="filters">
  <div class="toprow">
    <input class="search" type="search" placeholder="Buscar en el archivo…" oninput={onSearch} aria-label="Buscar" />
    <!-- Toggle de 3 vistas: Lista (filas) · Galería (cover flow) · Estantería (grid Letterboxd) -->
    <div class="viewtoggle" role="group" aria-label="Vista">
      <button type="button" class="vbtn" class:on={$archiveView === 'lista'} onclick={() => archiveView.set('lista')} aria-label="Lista" title="Lista">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.5 3.5h11M2.5 8h11M2.5 12.5h11" /></svg>
      </button>
      <button type="button" class="vbtn" class:on={$archiveView === 'galeria'} onclick={() => archiveView.set('galeria')} aria-label="Galería" title="Galería (cover flow)">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="5.6" y="2.8" width="4.8" height="10.4" rx="1" /><path d="M2.8 5v6M13.2 5v6" /></svg>
      </button>
      <button type="button" class="vbtn" class:on={$archiveView === 'estanteria'} onclick={() => archiveView.set('estanteria')} aria-label="Estantería" title="Estantería (videoclub)">
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.6v8.8M6 2.6v8.8M9.4 3.2l2.9 8.3" /><path d="M1.8 13.4h12.4" /></svg>
      </button>
    </div>
  </div>
  <div class="selects">
    <select aria-label="Categoría" value={$archiveFilters.categoria} onchange={(e) => setFilters({ categoria: e.currentTarget.value })}>
      <option value="">Toda categoría</option>
      {#each $filterOpts.categorias as c}<option value={c}>{label(CATEGORIA_LABELS, c)}</option>{/each}
    </select>
    <select aria-label="Año de la obra" value={String($archiveFilters.anio ?? '')} onchange={(e) => setFilters({ anio: e.currentTarget.value })}>
      <option value="">Cualquier año</option>
      {#if $archiveFilters.anio && !($filterOpts.anios ?? []).includes(Math.trunc(Number($archiveFilters.anio)))}
        <!-- el año activo desapareció de la lista (última entrada de ese año borrada): la opción
             huérfana se pinta explícita para que el select no quede en blanco con el filtro vivo -->
        <option value={String($archiveFilters.anio)}>{$archiveFilters.anio}</option>
      {/if}
      {#each decadas as d (d.label)}
        <optgroup label={d.label}>
          {#each d.anios as a (a)}<option value={String(a)}>{a}</option>{/each}
        </optgroup>
      {/each}
    </select>
    <div class="creador-filter">
      {#if $archiveFilters.creador}
        <button type="button" class="creador-chip" onclick={() => setFilters({ creador: null })} title="{$archiveFilters.creador.nombre} — quitar el filtro" aria-label="Quitar el filtro de creador">
          <span class="nm">{$archiveFilters.creador.nombre}</span><span class="x">✕</span>
        </button>
      {:else}
        <input
          class="creador-q"
          type="search"
          placeholder="Creador…"
          bind:value={cq}
          oninput={onCreadorInput}
          onblur={closeSug}
          onkeydown={onCreadorKey}
          aria-label="Filtrar por creador"
          autocomplete="off"
        />
        {#if csug.length}
          <div class="csug" role="listbox">
            {#each csug as p (p.id)}
              <!-- preventDefault en pointerdown: el input CONSERVA el foco (el blur no se
                   adelanta) y NO se elige en el touchstart (un scroll que empiece aquí no
                   aplica nada — regla 12); la selección va por click, que también dispara
                   el teclado (Enter sobre el botón) -->
              <button type="button" class="csug-row" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pickCreador(p)}>{p.nombre}</button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
    <button
      type="button"
      class="encurso-filter"
      class:on={$archiveFilters.en_curso}
      aria-pressed={$archiveFilters.en_curso}
      onclick={() => setFilters({ en_curso: !$archiveFilters.en_curso })}
      title="Ver solo las series que tienes a medias, para retomarlas"
    >◐ En curso</button>
    <button
      type="button"
      class="resena-filter"
      class:on={$archiveFilters.con_resena}
      aria-pressed={$archiveFilters.con_resena}
      onclick={() => setFilters({ con_resena: !$archiveFilters.con_resena })}
      title="Ver solo las entradas con reseña personal"
    >✎ Con reseña</button>
  </div>
</div>

{#if $archiveView === 'galeria'}
  <GalleryFlow resetKey={filterKey} />
{:else if $archiveView === 'estanteria'}
  <p class="count">{shelfItems.length.toLocaleString('es-ES')} obras</p>
  {#if shelfItems.length === 0}
    <div class="empty">
      <div class="mark">◇</div>
      <p class="lead">No hay obras con estos filtros.</p>
      <p class="hint">Ajusta los filtros, o registra una nueva con el botón +.</p>
    </div>
  {:else}
    <ShelfGrid items={shelfItems} resetKey={filterKey} />
  {/if}
{:else}
<p class="count">{$archiveEntries.length.toLocaleString('es-ES')} entradas</p>

{#if $archiveEntries.length === 0}
  <div class="empty">
    <div class="mark">◇</div>
    <p class="lead">No hay entradas con estos filtros.</p>
    <p class="hint">Ajusta los filtros, o registra una nueva con el botón +.</p>
  </div>
{:else}
  <VirtualList items={$archiveEntries} rowHeight={80} key={(it) => it.entrada_id} resetKey={filterKey}>
    {#snippet row(it)}
      <button class="entry" onclick={() => openEntryDetail(it.entrada_id)}>
        <span class="cover" style="--c:{col(it.categoria).c}; --t:{col(it.categoria).tint}">{(it.titulo || '?').trim().charAt(0).toUpperCase()}</span>
        <span class="content">
          <span class="title">{it.titulo}</span>
          <span class="meta">
            <span class="dot" style="background:{col(it.categoria).c}"></span>
            <span class="cat" style="color:{col(it.categoria).tint}">{label(CATEGORIA_LABELS, it.categoria)}</span>
            {#if it.en_curso}<span class="encurso">EN CURSO</span>{/if}
            <span class="sep">·</span>
            <span class="date">{fmtFecha(it.fecha)}</span>
            <span class="origen">{label(ORIGEN_LABELS, it.origen)}</span>
            {#if it.fecha_tipo === 'fecha_voto'}<span class="voto">voto aprox.</span>{/if}
            {#if it.nota}<span class="hasnota" title="Tiene reseña">✎</span>{/if}
          </span>
        </span>
        {#if it.valoracion != null}<span class="val">{fmtValoracion(it.valoracion)}</span>{/if}
      </button>
    {/snippet}
  </VirtualList>
{/if}
{/if}

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
  }
  .selects {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  input,
  select {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.55rem 0.7rem;
    font: inherit;
    font-family: var(--font-text);
  }
  .toprow {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .search {
    flex: 1 1 auto;
    min-width: 0;
  }
  .viewtoggle {
    flex: 0 0 auto;
    display: flex;
    gap: 3px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px;
  }
  .vbtn {
    background: none;
    border: none;
    border-radius: 999px;
    padding: 0.42rem 0.62rem;
    display: grid;
    place-items: center;
    color: var(--ink-3);
    cursor: pointer;
  }
  .vbtn svg {
    display: block;
  }
  .vbtn.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .selects select {
    flex: 1 1 8rem;
    font-size: 0.85rem;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  /* filtro por CREADOR (§11.65): input con desplegable propio; elegido → chip con ✕ */
  .creador-filter {
    position: relative;
    isolation: isolate; /* regla 9: el z del desplegable no compite fuera */
    z-index: 7; /* SIN esto el contexto pinta en orden de árbol y las VISTAS (posteriores) taparían el desplegable */
    flex: 1 1 9rem;
    min-width: 0;
  }
  .creador-q {
    width: 100%;
    font-size: 0.85rem;
  }
  .csug {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 6;
    background: #100e0b;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  }
  .csug-row {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-top: 1px solid var(--line);
    color: var(--ink);
    font-family: var(--font-display);
    font-size: 0.9rem;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
  }
  .csug-row:first-child {
    border-top: none;
  }
  .csug-row:hover {
    background: #171410;
  }
  .creador-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 100%;
    background: #171410;
    border: 1px solid rgba(242, 166, 90, 0.45);
    color: var(--gold);
    border-radius: 999px;
    padding: 0.5rem 0.85rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  /* el ellipsis va en el SPAN del nombre: text-overflow no aplica a un contenedor flex, y sin
     min-width:0 el nombre (nowrap) no encogería y empujaría el ✕ fuera del recorte */
  .creador-chip .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .creador-chip .x {
    color: var(--ink-3);
    font-size: 0.75rem;
    flex: none;
  }
  .count {
    color: var(--label);
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin: 0 0 0.4rem;
  }
  .empty {
    text-align: center;
    color: var(--ink-3);
    padding: 2.6rem 1rem;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
  }

  /* ── cabecera del Diario (título + cifras integradas): solo escritorio ≥1000 ── */
  .diario-head {
    display: none;
  }
  @media (min-width: 1000px) {
    .diario-head {
      display: flex;
      align-items: baseline;
      gap: 16px;
      margin: 0 0 18px;
    }
    .dh-title {
      font-family: var(--font-display);
      font-size: 2.1rem;
      font-weight: 500;
      line-height: 1;
      margin: 0;
    }
    .dh-count {
      display: flex;
      align-items: center;
      gap: 7px;
      padding-bottom: 3px;
    }
    .dh-n {
      font-family: var(--font-data);
      font-size: 0.95rem;
      color: var(--ink-2);
    }
    .dh-n.gold {
      color: var(--gold);
    }
    .dh-l {
      font-family: var(--font-data);
      font-size: 0.62rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--ink-3);
    }
    .dh-dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--line-strong);
      margin: 0 3px;
    }
    /* filtros en UNA fila: toprow y selects se disuelven (display:contents) → sus hijos fluyen */
    .filters {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      padding-bottom: 16px;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--line);
    }
    .toprow,
    .selects {
      display: contents;
    }
    .search {
      flex: 1 1 260px;
    }
    .selects select {
      flex: 0 1 auto;
    }
    .creador-filter {
      flex: 0 1 12rem;
    }
    /* el toggle de vista, a la derecha del todo */
    .viewtoggle {
      order: 99;
      margin-left: auto;
    }
    /* el contador suelto se integra en la cabecera → se oculta en escritorio */
    .count {
      display: none;
    }
  }
  .empty .mark {
    color: var(--accent);
    font-size: 1.6rem;
    margin-bottom: 0.4rem;
  }
  .empty .lead {
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--ink-2);
    margin: 0 0 0.3rem;
  }
  .empty .hint {
    font-size: 0.85rem;
    margin: 0;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    height: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    padding: 0.5rem 0.8rem;
    cursor: pointer;
    color: var(--ink);
    transition: transform 0.2s, background 0.2s;
  }
  .entry:hover {
    background: var(--surface-2);
    transform: translateX(3px);
  }
  .cover {
    flex: 0 0 auto;
    width: 42px;
    height: 60px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--t);
    background: color-mix(in srgb, var(--c) 16%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
  }
  .content {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.08rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-data);
    font-size: 0.66rem;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    overflow: hidden;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .sep {
    opacity: 0.5;
  }
  .date {
    font-variant-numeric: tabular-nums;
  }
  .voto {
    color: var(--gold);
  }
  .encurso-filter {
    flex: 0 0 auto;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
    border-radius: 10px;
    padding: 0.55rem 0.8rem;
    font: inherit;
    font-family: var(--font-data);
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .encurso-filter:hover {
    border-color: #7fb2b8;
    color: #7fb2b8;
  }
  .encurso-filter.on {
    border-color: #7fb2b8;
    color: #7fb2b8;
    background: color-mix(in srgb, #7fb2b8 14%, var(--surface-2));
  }
  .meta .encurso {
    color: #7fb2b8;
    border: 1px solid color-mix(in srgb, #7fb2b8 36%, transparent);
    background: color-mix(in srgb, #7fb2b8 12%, transparent);
    border-radius: var(--radius-pill, 999px);
    padding: 0.02rem 0.34rem;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    flex: 0 0 auto;
  }
  .resena-filter {
    flex: 0 0 auto;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
    border-radius: 10px;
    padding: 0.55rem 0.8rem;
    font: inherit;
    font-family: var(--font-data);
    font-size: 0.8rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .resena-filter:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .resena-filter.on {
    border-color: var(--accent);
    color: var(--accent-ink);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-2));
  }
  .meta .hasnota {
    color: var(--accent-ink);
    flex: 0 0 auto;
    font-size: 0.72rem;
  }
  .val {
    flex: 0 0 auto;
    color: var(--gold);
    font-family: var(--font-data);
    font-weight: 600;
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .entry {
      transition: none;
    }
  }
</style>
