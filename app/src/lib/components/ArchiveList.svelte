<script>
  import VirtualList from './VirtualList.svelte';
  import { archiveEntries, archiveFilters, filterOpts } from '$lib/stores.js';
  import { setFilters, openEntryDetail } from '$lib/boot-supabase.js';
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
  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };
</script>

<div class="filters">
  <input class="search" type="search" placeholder="Buscar en el archivo…" oninput={onSearch} aria-label="Buscar" />
  <div class="selects">
    <select aria-label="Categoría" value={$archiveFilters.categoria} onchange={(e) => setFilters({ categoria: e.currentTarget.value })}>
      <option value="">Toda categoría</option>
      {#each $filterOpts.categorias as c}<option value={c}>{label(CATEGORIA_LABELS, c)}</option>{/each}
    </select>
    <select aria-label="Origen" value={$archiveFilters.origen} onchange={(e) => setFilters({ origen: e.currentTarget.value })}>
      <option value="">Todo origen</option>
      {#each $filterOpts.origenes as o}<option value={o}>{label(ORIGEN_LABELS, o)}</option>{/each}
    </select>
    <select aria-label="Tipo de fecha" value={$archiveFilters.fecha_tipo} onchange={(e) => setFilters({ fecha_tipo: e.currentTarget.value })}>
      <option value="">Cualquier fecha</option>
      <option value="fecha_visionado">Fecha real (visionado)</option>
      <option value="fecha_voto">Fecha de voto (aprox.)</option>
    </select>
    <button
      type="button"
      class="encurso-filter"
      class:on={$archiveFilters.en_curso}
      aria-pressed={$archiveFilters.en_curso}
      onclick={() => setFilters({ en_curso: !$archiveFilters.en_curso })}
      title="Ver solo las series que tienes a medias, para retomarlas"
    >◐ En curso</button>
  </div>
</div>

<p class="count">{$archiveEntries.length.toLocaleString('es-ES')} entradas</p>

{#if $archiveEntries.length === 0}
  <div class="empty">
    <div class="mark">◇</div>
    <p class="lead">No hay entradas con estos filtros.</p>
    <p class="hint">Ajusta los filtros, o registra una nueva con el botón +.</p>
  </div>
{:else}
  <VirtualList items={$archiveEntries} rowHeight={80} key={(it) => it.entrada_id}>
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
          </span>
        </span>
        {#if it.valoracion != null}<span class="val">{fmtValoracion(it.valoracion)}</span>{/if}
      </button>
    {/snippet}
  </VirtualList>
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
  .search {
    width: 100%;
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
