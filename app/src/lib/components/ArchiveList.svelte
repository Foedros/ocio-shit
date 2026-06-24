<script>
  import VirtualList from './VirtualList.svelte';
  import { archiveEntries, archiveFilters, filterOpts } from '$lib/stores.js';
  import { setFilters, openEntryDetail } from '$lib/boot.js';
  import {
    CATEGORIA_LABELS,
    ORIGEN_LABELS,
    FECHA_TIPO_LABELS
  } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtFecha, fmtValoracion } from '$lib/format.js';

  let searchTimer;
  function onSearch(e) {
    const v = e.currentTarget.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setFilters({ search: v }), 250);
  }
  const label = (map, v) => map[v] ?? v ?? '—';
</script>

<div class="filters">
  <input class="search" type="search" placeholder="Buscar título…" oninput={onSearch} aria-label="Buscar" />
  <select aria-label="Categoría" value={$archiveFilters.categoria} onchange={(e) => setFilters({ categoria: e.currentTarget.value })}>
    <option value="">Toda categoría</option>
    {#each $filterOpts.categorias as c}<option value={c}>{label(CATEGORIA_LABELS, c)}</option>{/each}
  </select>
  <select aria-label="Origen" value={$archiveFilters.origen} onchange={(e) => setFilters({ origen: e.currentTarget.value })}>
    <option value="">Todo origen</option>
    {#each $filterOpts.origenes as o}<option value={o}>{label(ORIGEN_LABELS, o)}</option>{/each}
  </select>
  <select aria-label="Tipo de fecha" value={$archiveFilters.fecha_tipo} onchange={(e) => setFilters({ fecha_tipo: e.currentTarget.value })}>
    <option value="">Visionado y voto</option>
    {#each $filterOpts.fecha_tipos as f}<option value={f}>{label(FECHA_TIPO_LABELS, f)}</option>{/each}
  </select>
</div>

<p class="count">{$archiveEntries.length.toLocaleString('es-ES')} entradas</p>

{#if $archiveEntries.length === 0}
  <div class="empty">
    <p>No hay entradas con estos filtros.</p>
    <p class="hint">Registra una arriba, o ajusta los filtros.</p>
  </div>
{:else}
  <VirtualList items={$archiveEntries} rowHeight={62} key={(it) => it.entrada_id}>
    {#snippet row(it)}
      <button class="entry" onclick={() => openEntryDetail(it.entrada_id)}>
        <span class="title">{it.titulo}</span>
        <span class="meta">
          <span class="dot" style="background:{CAT_COLOR[it.categoria]?.c ?? 'var(--ink-3)'}"></span>
          <span class="cat" style="color:{CAT_COLOR[it.categoria]?.tint ?? 'var(--ink-2)'}">{label(CATEGORIA_LABELS, it.categoria)}</span>
          <span class="date">{fmtFecha(it.fecha)}</span>
          <span class="badge origen origen-{it.origen}">{label(ORIGEN_LABELS, it.origen)}</span>
          {#if it.fecha_tipo === 'fecha_voto'}<span class="badge voto">voto aprox.</span>{/if}
          {#if it.valoracion != null}<span class="val">{fmtValoracion(it.valoracion)}</span>{/if}
        </span>
      </button>
    {/snippet}
  </VirtualList>
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .search {
    flex: 1 1 12rem;
    min-width: 0;
  }
  input,
  select {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    font: inherit;
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
    font-variant-numeric: tabular-nums;
  }
  .empty {
    text-align: center;
    color: var(--ink-3);
    padding: 2rem 1rem;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
  }
  .empty .hint {
    font-size: 0.85rem;
  }
  .entry {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    height: 100%;
    text-align: left;
    background: none;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
    padding: 0.55rem 0.8rem;
    cursor: pointer;
    color: var(--ink);
  }
  .entry:hover {
    background: var(--surface-2);
  }
  .title {
    font-family: var(--font-display);
    font-size: 1.06rem;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-data);
    font-size: 0.68rem;
    color: var(--ink-3);
    flex-wrap: wrap;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .cat {
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .badge {
    padding: 0.05rem 0.45rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.62rem;
  }
  .origen-sheets {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 35%, var(--line));
  }
  .voto {
    color: var(--gold);
    border-color: color-mix(in srgb, var(--gold) 35%, var(--line));
  }
  .date {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }
  .val {
    margin-left: auto;
    color: var(--gold);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 0.82rem;
  }
</style>
