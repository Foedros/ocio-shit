<script>
  import { detail } from '$lib/stores.js';
  import { closeDetail, openObraDetail, openEntryDetail } from '$lib/boot.js';
  import {
    CATEGORIA_LABELS,
    ORIGEN_LABELS,
    FECHA_TIPO_LABELS
  } from '$lib/db/queries.js';
  import { fmtFecha, fmtValoracion } from '$lib/format.js';

  const label = (map, v) => map[v] ?? v ?? '—';
</script>

{#if $detail}
  <div
    class="overlay"
    role="button"
    tabindex="-1"
    onclick={closeDetail}
    onkeydown={(e) => e.key === 'Escape' && closeDetail()}
  >
    <div class="panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <button class="close" onclick={closeDetail} aria-label="Cerrar">✕</button>

      {#if $detail.kind === 'entrada'}
        {@const e = $detail.data}
        <span class="badge cat">{label(CATEGORIA_LABELS, e.categoria)}</span>
        <h3>{e.titulo}</h3>
        <dl>
          <div><dt>Fecha</dt><dd>{fmtFecha(e.fecha)} <span class="sub">({label(FECHA_TIPO_LABELS, e.fecha_tipo)})</span></dd></div>
          <div><dt>Origen</dt><dd>{label(ORIGEN_LABELS, e.origen)}</dd></div>
          <div><dt>Estado</dt><dd>{e.estado}</dd></div>
          <div><dt>Valoración</dt><dd>{fmtValoracion(e.valoracion)}</dd></div>
          <div><dt>Reconsumo</dt><dd>{e.num_reconsumo > 0 ? `sí (#${e.num_reconsumo})` : 'no'}</dd></div>
        </dl>
        {#if e.nota}<p class="nota">{e.nota}</p>{/if}
        <button class="link" onclick={() => openObraDetail(e.obra_id)}>Ver la obra y sus entradas →</button>
      {:else if $detail.kind === 'obra'}
        {@const o = $detail.data.obra}
        <span class="badge cat">{label(CATEGORIA_LABELS, o.categoria)}</span>
        <h3>{o.titulo}{#if o.anio_obra} <span class="sub">({o.anio_obra})</span>{/if}</h3>
        <dl>
          {#if o.creador}<div><dt>Creador</dt><dd>{o.creador}</dd></div>{/if}
          {#if o.saga}<div><dt>Saga</dt><dd>{o.saga}</dd></div>{/if}
          {#if o.duracion_canonica_min}<div><dt>Duración</dt><dd>{o.duracion_canonica_min} min</dd></div>{/if}
          <div><dt>Entradas</dt><dd>{$detail.data.entradas.length}</dd></div>
        </dl>
        <h4>Entradas</h4>
        <ul class="entries">
          {#each $detail.data.entradas as en}
            <li>
              <button class="link" onclick={() => openEntryDetail(en.entrada_id)}>
                {fmtFecha(en.fecha)} · {en.estado}{#if en.valoracion != null} · {fmtValoracion(en.valoracion)}{/if}
                <span class="sub">({label(ORIGEN_LABELS, en.origen)})</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, #000 55%, transparent);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 50;
    padding: 0;
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius) var(--radius) 0 0;
    width: 100%;
    max-width: 640px;
    max-height: 85vh;
    overflow: auto;
    padding: 1.2rem 1.2rem 2rem;
    position: relative;
  }
  @media (min-width: 640px) {
    .overlay {
      align-items: center;
    }
    .panel {
      border-radius: var(--radius);
    }
  }
  .close {
    position: absolute;
    top: 0.7rem;
    right: 0.7rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
    border-radius: 8px;
    width: 2rem;
    height: 2rem;
    cursor: pointer;
  }
  h3 {
    margin: 0.4rem 0 0.8rem;
    font-size: 1.3rem;
  }
  h4 {
    margin: 1rem 0 0.4rem;
    font-size: 0.95rem;
    color: var(--ink-2);
  }
  .sub {
    color: var(--ink-3);
    font-weight: 400;
    font-size: 0.85em;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem 1rem;
    margin: 0;
  }
  dl > div {
    display: flex;
    flex-direction: column;
  }
  dt {
    color: var(--ink-3);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dd {
    margin: 0;
  }
  .nota {
    margin: 0.9rem 0;
    padding: 0.7rem 0.8rem;
    background: var(--surface-2);
    border-radius: 10px;
    border-left: 3px solid var(--accent);
    line-height: 1.5;
  }
  .badge.cat {
    display: inline-block;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    color: var(--accent-ink);
    font-size: 0.75rem;
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0.2rem 0;
    text-align: left;
    font: inherit;
  }
</style>
