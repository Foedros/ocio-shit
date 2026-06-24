<script>
  import Sheet from './Sheet.svelte';
  import { detail, role, busy } from '$lib/stores.js';
  import { closeDetail, openObraDetail, openEntryDetail, deleteEntryAction } from '$lib/boot.js';
  import { CATEGORIA_LABELS, ORIGEN_LABELS, FECHA_TIPO_LABELS } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtFecha, fmtValoracion, fmtDuracion } from '$lib/format.js';

  const label = (map, v) => map[v] ?? v ?? '—';
  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };

  let confirming = $state(false);
  // Reset the delete confirmation whenever the shown item changes.
  $effect(() => {
    void $detail;
    confirming = false;
  });
</script>

<Sheet
  open={!!$detail}
  eyebrow={$detail?.kind === 'obra' ? 'Obra' : 'Entrada'}
  title={$detail?.kind === 'obra' ? $detail.data.obra.titulo : ($detail?.data?.titulo ?? '')}
  onclose={closeDetail}
>
  {#if $detail?.kind === 'entrada'}
    {@const e = $detail.data}
    <div class="chip-row">
      <span class="dot" style="background:{col(e.categoria).c}"></span>
      <span class="cat" style="color:{col(e.categoria).tint}">{label(CATEGORIA_LABELS, e.categoria)}</span>
      {#if e.valoracion != null}<span class="rating">{fmtValoracion(e.valoracion)}</span>{/if}
    </div>
    <dl>
      <div><dt>Fecha de consumo</dt><dd>{fmtFecha(e.fecha)} <span class="sub">· {label(FECHA_TIPO_LABELS, e.fecha_tipo)}</span></dd></div>
      <div><dt>Origen</dt><dd>{label(ORIGEN_LABELS, e.origen)}</dd></div>
      <div><dt>Estado</dt><dd>{e.estado}</dd></div>
      {#if fmtDuracion(e.duracion_min)}<div><dt>Duración</dt><dd>{fmtDuracion(e.duracion_min)}</dd></div>{/if}
      <div><dt>Reconsumo</dt><dd>{e.num_reconsumo > 0 ? `sí · #${e.num_reconsumo}` : 'no'}</dd></div>
    </dl>
    {#if e.nota}<p class="nota">{e.nota}</p>{/if}
    <button class="link" onclick={() => openObraDetail(e.obra_id)}>Ver la obra y sus entradas →</button>

    {#if $role === 'leader'}
      <div class="danger">
        {#if !confirming}
          <button class="del" onclick={() => (confirming = true)}>Eliminar entrada</button>
        {:else}
          <span class="q">¿Eliminar esta entrada de forma permanente?</span>
          <div class="row">
            <button class="yes" onclick={() => deleteEntryAction(e.entrada_id)} disabled={!!$busy}>Sí, eliminar</button>
            <button class="no" onclick={() => (confirming = false)}>Cancelar</button>
          </div>
        {/if}
      </div>
    {/if}
  {:else if $detail?.kind === 'obra'}
    {@const o = $detail.data.obra}
    <div class="chip-row">
      <span class="dot" style="background:{col(o.categoria).c}"></span>
      <span class="cat" style="color:{col(o.categoria).tint}">{label(CATEGORIA_LABELS, o.categoria)}</span>
      {#if o.anio_obra}<span class="sub">{o.anio_obra}</span>{/if}
    </div>
    <dl>
      {#if o.creador}<div><dt>Creador</dt><dd>{o.creador}</dd></div>{/if}
      {#if o.saga}<div><dt>Saga</dt><dd>{o.saga}</dd></div>{/if}
      {#if o.duracion_canonica_min}<div><dt>Duración</dt><dd>{o.duracion_canonica_min} min</dd></div>{/if}
      <div><dt>Entradas</dt><dd>{$detail.data.entradas.length}</dd></div>
    </dl>
    <div class="eyebrow">Entradas</div>
    <ul class="entries">
      {#each $detail.data.entradas as en}
        <li>
          <button class="link" onclick={() => openEntryDetail(en.entrada_id)}>
            <span class="d">{fmtFecha(en.fecha)}</span> · {en.estado}{#if en.valoracion != null} · <span class="g">{fmtValoracion(en.valoracion)}</span>{/if}
            <span class="sub">({label(ORIGEN_LABELS, en.origen)})</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .chip-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-data);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 1rem;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .rating {
    margin-left: auto;
    color: var(--gold);
    font-size: 1rem;
    font-weight: 600;
  }
  .sub {
    color: var(--ink-3);
  }
  dl {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.7rem 1rem;
    margin: 0 0 1rem;
  }
  dl > div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  dt {
    color: var(--label);
    font-family: var(--font-data);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  dd {
    margin: 0;
    font-size: 0.98rem;
  }
  .nota {
    margin: 0 0 1rem;
    padding: 0.8rem 0.9rem;
    background: var(--surface-2);
    border-radius: 12px;
    border-left: 3px solid var(--accent);
    line-height: 1.55;
  }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--label);
    margin: 0.6rem 0 0.4rem;
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .entries li {
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  }
  .link {
    background: none;
    border: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0.45rem 0;
    text-align: left;
    font: inherit;
    width: 100%;
  }
  .entries .link {
    color: var(--ink-2);
  }
  .entries .d {
    font-family: var(--font-data);
    color: var(--ink);
  }
  .g {
    color: var(--gold);
  }
  .danger {
    margin-top: 1.4rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
  }
  .del {
    background: none;
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    color: var(--danger-ink);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1rem;
    cursor: pointer;
    font: inherit;
  }
  .del:hover {
    border-color: var(--danger);
  }
  .q {
    display: block;
    color: var(--ink-2);
    margin-bottom: 0.6rem;
    font-size: 0.92rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .yes {
    background: var(--danger);
    border: 1px solid var(--danger);
    color: #fff;
    border-radius: var(--radius-pill);
    padding: 0.5rem 1rem;
    cursor: pointer;
    font-weight: 700;
  }
  .yes:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .no {
    background: none;
    border: 1px solid var(--hairline-plus);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1rem;
    cursor: pointer;
  }
</style>

