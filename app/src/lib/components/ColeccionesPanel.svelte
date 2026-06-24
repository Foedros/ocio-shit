<script>
  import { colecciones, coleccionSel, role, busy } from '$lib/stores.js';
  import {
    openColeccion,
    closeColeccion,
    rematerializeColeccionesAction,
    deleteColeccionAction,
    applyR1Action,
    createColeccionAction
  } from '$lib/boot-supabase.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtValoracion } from '$lib/format.js';
  import Sheet from './Sheet.svelte';
  import Button from './Button.svelte';

  let showNew = $state(false);
  let newName = $state('');
  let newDesc = $state('');
  let confirmingDel = $state(false);

  const TIPO = { inteligente: 'Inteligente', manual: 'Manual', ia: 'IA' };
  let canWrite = $derived($role === 'leader');
  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };

  $effect(() => {
    void $coleccionSel;
    confirmingDel = false;
  });

  async function createManual() {
    if (!newName.trim()) return;
    await createColeccionAction({ nombre: newName.trim(), descripcion: newDesc || null, tipo: 'manual' });
    newName = '';
    newDesc = '';
    showNew = false;
  }
</script>

<div class="head">
  <p class="count">{$colecciones.length} colecciones</p>
  {#if canWrite}
    <div class="actions">
      <Button variant="secondary" onclick={rematerializeColeccionesAction} disabled={!!$busy}>Recalcular</Button>
      <Button variant="secondary" onclick={applyR1Action} disabled={!!$busy}>Etiquetas R1</Button>
      <Button variant="primary" onclick={() => (showNew = true)}>Nueva</Button>
    </div>
  {/if}
</div>

<div class="grid">
  {#each $colecciones as c (c.id)}
    <button class="cardc" class:ia={c.tipo === 'ia'} onclick={() => c.tipo !== 'ia' && openColeccion(c.id)} disabled={c.tipo === 'ia'}>
      <div class="topline">
        <span class="badge t-{c.tipo}">{TIPO[c.tipo]}</span>
        {#if c.tipo !== 'ia'}<span class="n">{c.n_obras}</span>{/if}
      </div>
      <h3>{c.nombre}</h3>
      {#if c.descripcion}<p class="desc">{c.descripcion}</p>{/if}
    </button>
  {/each}
</div>

<Sheet open={showNew} title="Nueva colección manual" eyebrow="Colección" onclose={() => (showNew = false)}>
  <div class="form">
    <label class="fld"><span class="lbl">Nombre</span><input bind:value={newName} placeholder="Mis favoritas" /></label>
    <label class="fld"><span class="lbl">Descripción</span><input bind:value={newDesc} placeholder="opcional" /></label>
    <Button variant="primary" onclick={createManual} disabled={!newName.trim() || !!$busy}>Crear colección</Button>
    <p class="hint">Las colecciones inteligentes (por regla) son la Tanda 1; el editor de reglas llega en una iteración futura.</p>
  </div>
</Sheet>

<Sheet
  open={!!$coleccionSel}
  eyebrow={$coleccionSel ? TIPO[$coleccionSel.coleccion.tipo] : ''}
  title={$coleccionSel?.coleccion.nombre ?? ''}
  onclose={closeColeccion}
>
  {#if $coleccionSel}
    {#if $coleccionSel.coleccion.descripcion}<p class="cdesc">{$coleccionSel.coleccion.descripcion}</p>{/if}
    <p class="count">{$coleccionSel.obras.length} obras</p>
    {#if $coleccionSel.obras.length === 0}
      <p class="empty">Esta colección no contiene obras (la regla no encaja con ninguna, o faltan datos).</p>
    {:else}
      <ul class="obras">
        {#each $coleccionSel.obras as o (o.obra_id)}
          <li>
            <span class="cover" style="--c:{col(o.categoria).c}; --t:{col(o.categoria).tint}">{(o.titulo || '?').trim().charAt(0).toUpperCase()}</span>
            <span class="info">
              <span class="ot">{o.titulo}{#if o.anio_obra} <span class="yr">({o.anio_obra})</span>{/if}</span>
              <span class="om"><span class="dot" style="background:{col(o.categoria).c}"></span>{CATEGORIA_LABELS[o.categoria] ?? o.categoria}{#if o.n_entradas} · {o.n_entradas} {o.n_entradas === 1 ? 'entrada' : 'entradas'}{/if}</span>
            </span>
            {#if o.valoracion_media != null}<span class="ov">{fmtValoracion(Math.round(o.valoracion_media * 10) / 10)}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if canWrite}
      <div class="danger">
        {#if !confirmingDel}
          <button class="del" onclick={() => (confirmingDel = true)}>Eliminar colección</button>
        {:else}
          <span class="q">¿Eliminar la colección "{$coleccionSel.coleccion.nombre}"? (las obras no se borran)</span>
          <div class="row">
            <button class="yes" onclick={() => deleteColeccionAction($coleccionSel.coleccion.id)} disabled={!!$busy}>Sí, eliminar</button>
            <button class="no" onclick={() => (confirmingDel = false)}>Cancelar</button>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</Sheet>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.9rem;
    flex-wrap: wrap;
  }
  .count {
    color: var(--label);
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.7rem;
  }
  .cardc {
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.9rem;
    cursor: pointer;
    color: var(--ink);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-height: 110px;
    transition: transform 0.2s, border-color 0.2s;
  }
  .cardc:hover:not(:disabled) {
    transform: translateY(-3px);
    border-color: var(--hairline-plus);
  }
  .cardc.ia {
    opacity: 0.55;
    cursor: default;
  }
  .topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .badge {
    font-family: var(--font-data);
    font-size: 0.58rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-pill);
    border: 1px solid var(--line-strong);
    color: var(--ink-3);
  }
  .t-inteligente {
    color: var(--accent-ink);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--line));
  }
  .n {
    font-family: var(--font-data);
    font-size: 1.3rem;
    color: var(--gold);
    font-variant-numeric: tabular-nums;
  }
  h3 {
    font-size: 1.1rem;
    font-weight: 500;
    margin: 0;
    line-height: 1.15;
  }
  .desc {
    color: var(--ink-3);
    font-size: 0.78rem;
    margin: 0;
    line-height: 1.35;
  }
  .cdesc {
    color: var(--ink-2);
    margin: 0 0 0.6rem;
  }
  .empty {
    color: var(--ink-3);
    padding: 1rem 0;
  }
  .obras {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    max-height: 50vh;
    overflow: auto;
  }
  .obras li {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
  }
  .cover {
    flex: 0 0 auto;
    width: 34px;
    height: 48px;
    border-radius: 5px;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    color: var(--t);
    background: color-mix(in srgb, var(--c) 16%, var(--surface-2));
    border: 1px solid color-mix(in srgb, var(--c) 30%, var(--line));
  }
  .info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .ot {
    font-family: var(--font-display);
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .yr {
    color: var(--ink-3);
  }
  .om {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-data);
    font-size: 0.66rem;
    color: var(--ink-3);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .ov {
    color: var(--gold);
    font-family: var(--font-data);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .fld .lbl {
    font-family: var(--font-data);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label);
  }
  .form input {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.55rem 0.6rem;
    font: inherit;
    font-family: var(--font-text);
  }
  .form input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .hint {
    color: var(--ink-3);
    font-size: 0.8rem;
    margin: 0;
  }
  .danger {
    margin-top: 1.2rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--line);
  }
  .del {
    background: none;
    border: 1px solid color-mix(in srgb, var(--danger) 45%, var(--line));
    color: var(--danger-ink);
    border-radius: var(--radius-pill);
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    font: inherit;
  }
  .q {
    display: block;
    color: var(--ink-2);
    margin-bottom: 0.5rem;
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
    padding: 0.45rem 0.9rem;
    cursor: pointer;
    font-weight: 700;
  }
  .no {
    background: none;
    border: 1px solid var(--hairline-plus);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.45rem 0.9rem;
    cursor: pointer;
  }
  @media (prefers-reduced-motion: reduce) {
    .cardc {
      transition: none;
    }
  }
</style>
