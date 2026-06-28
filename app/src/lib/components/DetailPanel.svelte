<script>
  import Sheet from './Sheet.svelte';
  import RatingSlider from './RatingSlider.svelte';
  import { detail, role, busy } from '$lib/stores.js';
  import { closeDetail, openObraDetail, openEntryDetail, deleteEntryAction, updateEntryAction, setCanonAction, setEnCursoAction } from '$lib/boot-supabase.js';
  import { CATEGORIA_LABELS, ORIGEN_LABELS, FECHA_TIPO_LABELS, generoLabel } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtFecha, fmtValoracion, fmtDuracion } from '$lib/format.js';

  const label = (map, v) => map[v] ?? v ?? '—';
  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };

  let confirming = $state(false);
  let editing = $state(false);
  // edit buffer (precargado del valor actual al abrir el modo edición)
  let edVal = $state('');
  let edFecha = $state('');
  let edDurH = $state('');
  let edDurMin = $state('');
  let edNota = $state('');

  // Reset confirm + edit whenever the shown item changes.
  $effect(() => {
    void $detail;
    confirming = false;
    editing = false;
  });

  function startEdit(e) {
    edVal = e.valoracion != null ? String(e.valoracion) : '';
    edFecha = e.fecha ?? ''; // YYYY-MM-DD o '' (sin fecha)
    edDurH = e.duracion_min != null ? String(Math.floor(e.duracion_min / 60)) : '';
    edDurMin = e.duracion_min != null ? String(e.duracion_min % 60) : '';
    edNota = e.nota ?? '';
    editing = true;
  }

  async function save(e) {
    const duracion_min =
      edDurH !== '' || edDurMin !== '' ? (Number(edDurH) || 0) * 60 + (Number(edDurMin) || 0) : null;
    try {
      await updateEntryAction(e.entrada_id, {
        valoracion: edVal === '' ? null : Number(edVal),
        nota: edNota.trim() || null,
        fecha: edFecha || null, // vacío → NULL (quitar la fecha)
        duracion_min
      });
      editing = false; // la acción recarga el detalle con los valores nuevos
    } catch {
      /* el toast de error lo lanza la acción; nos quedamos en edición */
    }
  }
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
      {#if e.categoria === 'serie' && e.en_curso}<span class="encurso" title="Aún la estás viendo — la nota es provisional">EN CURSO</span>{/if}
      {#if !editing && e.valoracion != null}<span class="rating">{fmtValoracion(e.valoracion)}</span>{/if}
    </div>

    {#if !editing}
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
        <div class="actions-row">
          <button class="edit" onclick={() => startEdit(e)}>Editar</button>
          <button class="canon" class:on={e.es_canon} onclick={() => setCanonAction(e.entrada_id, !e.es_canon)} disabled={!!$busy} title="Marca esta obra como un momento que significó algo más allá de la nota">
            {e.es_canon ? '★ Momento canon' : '☆ Marcar canon'}
          </button>
          {#if e.categoria === 'serie'}
            <button class="encurso-btn" class:on={e.en_curso} onclick={() => setEnCursoAction(e.obra_id, !e.en_curso, { entradaId: e.entrada_id })} disabled={!!$busy} title="Aún la estás viendo a trozos — la nota es provisional hasta que la termines">
              {e.en_curso ? '◐ En curso' : '◌ Marcar en curso'}
            </button>
          {/if}
        </div>
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
    {:else}
      <!-- MODO EDICIÓN: campos editables precargados (valoracion/fecha/duración/nota) -->
      <div class="edit-form">
        <RatingSlider bind:value={edVal} />
        <div class="grid">
          <label class="fld">
            <span class="lbl">Fecha de consumo</span>
            <input type="date" bind:value={edFecha} />
            <span class="hint">vacío = sin fecha · el tipo ({label(FECHA_TIPO_LABELS, e.fecha_tipo)}) se mantiene</span>
          </label>
          <div class="fld">
            <span class="lbl">Duración</span>
            <div class="dur">
              <input type="number" bind:value={edDurH} min="0" placeholder="0" aria-label="horas" /><span class="u">h</span>
              <input type="number" bind:value={edDurMin} min="0" max="59" placeholder="0" aria-label="minutos" /><span class="u">min</span>
            </div>
          </div>
          <label class="fld wide">
            <span class="lbl">Nota personal</span>
            <input bind:value={edNota} placeholder="micro-reseña…" aria-label="Nota personal" />
          </label>
        </div>
        <div class="edit-actions">
          <button class="no" onclick={() => (editing = false)}>Cancelar</button>
          <button class="save" onclick={() => save(e)} disabled={!!$busy}>{$busy ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </div>
    {/if}
  {:else if $detail?.kind === 'obra'}
    {@const o = $detail.data.obra}
    <div class="chip-row">
      <span class="dot" style="background:{col(o.categoria).c}"></span>
      <span class="cat" style="color:{col(o.categoria).tint}">{label(CATEGORIA_LABELS, o.categoria)}</span>
      {#if o.categoria === 'serie' && o.en_curso}<span class="encurso" title="Aún la estás viendo — la nota es provisional">EN CURSO</span>{/if}
      {#if o.anio_obra}<span class="sub">{o.anio_obra}</span>{/if}
    </div>
    {#if $role === 'leader' && o.categoria === 'serie'}
      <div class="actions-row">
        <button class="encurso-btn" class:on={o.en_curso} onclick={() => setEnCursoAction(o.id, !o.en_curso)} disabled={!!$busy} title="Aún la estás viendo a trozos — la nota es provisional hasta que la termines">
          {o.en_curso ? '◐ En curso' : '◌ Marcar en curso'}
        </button>
      </div>
    {/if}
    <dl>
      {#if o.creador}<div><dt>Creador</dt><dd>{o.creador}</dd></div>{/if}
      {#if o.saga}<div><dt>Saga</dt><dd>{o.saga}</dd></div>{/if}
      {#if o.duracion_canonica_min}<div><dt>Duración</dt><dd>{o.duracion_canonica_min} min</dd></div>{/if}
      <div><dt>Entradas</dt><dd>{$detail.data.entradas.length}</dd></div>
    </dl>
    {#if $detail.data.generos?.length}
      <div class="eyebrow">Género</div>
      <div class="gen-chips">
        {#each $detail.data.generos as g}<span class="gchip">{generoLabel(g)}</span>{/each}
      </div>
    {/if}
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
  .gen-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }
  .gchip {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.24rem 0.6rem;
    font-size: 0.82rem;
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
  .actions-row {
    margin-top: 1.2rem;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .canon {
    background: none;
    border: 1px solid var(--hairline-plus);
    color: var(--ink-2);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1.1rem;
    cursor: pointer;
    font: inherit;
  }
  .canon:hover {
    border-color: var(--gold);
    color: var(--gold);
  }
  .canon.on {
    border-color: var(--gold);
    color: var(--gold);
    background: color-mix(in srgb, var(--gold) 12%, transparent);
  }
  .canon:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  /* "En curso" — indicador y toggle, tono teal sereno (provisional, no destacado como el oro) */
  .encurso {
    font-family: var(--font-data);
    font-size: 0.58rem;
    letter-spacing: 0.1em;
    color: #7fb2b8;
    border: 1px solid color-mix(in srgb, #7fb2b8 38%, transparent);
    background: color-mix(in srgb, #7fb2b8 12%, transparent);
    border-radius: var(--radius-pill);
    padding: 0.12rem 0.45rem;
  }
  .encurso-btn {
    background: none;
    border: 1px solid var(--hairline-plus);
    color: var(--ink-2);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1.1rem;
    cursor: pointer;
    font: inherit;
  }
  .encurso-btn:hover {
    border-color: #7fb2b8;
    color: #7fb2b8;
  }
  .encurso-btn.on {
    border-color: #7fb2b8;
    color: #7fb2b8;
    background: color-mix(in srgb, #7fb2b8 12%, transparent);
  }
  .encurso-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .edit {
    background: none;
    border: 1px solid var(--hairline-plus);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1.1rem;
    cursor: pointer;
    font: inherit;
  }
  .edit:hover {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  /* Modo edición — mismo idioma visual que QuickAddForm (.extra) */
  .edit-form {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.9rem;
  }
  .fld {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 9rem;
  }
  .fld.wide {
    flex: 1 1 100%;
  }
  .fld .lbl {
    font-family: var(--font-data);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--label);
  }
  .fld .hint {
    font-size: 0.72rem;
    color: var(--ink-3);
    line-height: 1.3;
  }
  .edit-form input {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    font-family: var(--font-text);
    font-size: 0.95rem;
    width: 100%;
  }
  .edit-form input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .dur {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .dur input {
    width: 3.4rem;
    text-align: center;
  }
  .dur .u {
    font-family: var(--font-data);
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .edit-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .save {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius-pill);
    padding: 0.5rem 1.2rem;
    cursor: pointer;
    font-weight: 700;
  }
  .save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>

