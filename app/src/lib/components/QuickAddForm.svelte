<script>
  // Alta rápida: registrar una Obra+Entrada en segundos. Título + categoría + Enter.
  import { addEntryAction } from '$lib/boot.js';
  import { CATEGORIAS, CATEGORIA_LABELS } from '$lib/db/queries.js';
  import { busy, role } from '$lib/stores.js';
  import { todayISO } from '$lib/format.js';

  let titulo = $state('');
  let categoria = $state('pelicula');
  let fecha = $state(todayISO());
  let nota = $state('');
  let valoracion = $state('');
  let anio = $state('');
  let more = $state(false);
  let tituloInput = $state(null);
  let lastMsg = $state('');

  let canWrite = $derived($role === 'leader');

  async function submit(e) {
    e?.preventDefault();
    if (!titulo.trim() || !canWrite || $busy) return;
    try {
      const res = await addEntryAction({
        obra: { titulo: titulo.trim(), categoria, anio_obra: anio || null },
        entrada: { fecha: fecha || null, nota: nota || null, valoracion: valoracion || null }
      });
      lastMsg = `✓ "${titulo.trim()}" registrada (${res.obraCreated ? 'obra nueva' : 'obra existente, reconsumo ' + res.numReconsumo}).`;
      // Keep categoria + fecha for speed; clear the rest and refocus the title.
      titulo = '';
      nota = '';
      valoracion = '';
      anio = '';
      tituloInput?.focus();
    } catch {
      lastMsg = '';
    }
  }
</script>

<form class="quickadd" onsubmit={submit}>
  <div class="primary">
    <select bind:value={categoria} disabled={!canWrite} aria-label="Categoría">
      {#each CATEGORIAS as c}
        <option value={c}>{CATEGORIA_LABELS[c]}</option>
      {/each}
    </select>
    <input
      bind:this={tituloInput}
      bind:value={titulo}
      placeholder="Título…"
      disabled={!canWrite}
      aria-label="Título"
      autocomplete="off"
    />
    <button class="add" type="submit" disabled={!canWrite || !titulo.trim() || $busy}>Registrar</button>
  </div>

  <div class="secondary">
    <label>Fecha <input type="date" bind:value={fecha} disabled={!canWrite} /></label>
    <button type="button" class="link" onclick={() => (more = !more)}>{more ? 'menos' : 'más campos'}</button>
  </div>

  {#if more}
    <div class="extra">
      <label>Año <input type="number" bind:value={anio} min="1850" max="2100" disabled={!canWrite} placeholder="—" /></label>
      <label>Valoración <input type="number" bind:value={valoracion} min="0" max="10" step="0.5" disabled={!canWrite} placeholder="0–10" /></label>
      <label class="note">Nota <input bind:value={nota} disabled={!canWrite} placeholder="micro-reseña…" /></label>
    </div>
  {/if}

  {#if lastMsg}<p class="ok">{lastMsg}</p>{/if}
  {#if !canWrite}<p class="ro">Solo lectura: el registro está activo en la pestaña principal.</p>{/if}
</form>

<style>
  .quickadd {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .primary {
    display: flex;
    gap: 0.5rem;
  }
  .primary select {
    flex: 0 0 auto;
  }
  .primary input {
    flex: 1 1 auto;
    min-width: 0;
  }
  select,
  input {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.55rem 0.6rem;
    font: inherit;
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .add {
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--on-accent);
    border-radius: var(--radius-pill);
    padding: 0.55rem 1.1rem;
    cursor: pointer;
    white-space: nowrap;
    font-weight: 700;
    transition: transform 0.12s;
  }
  .add:hover:not(:disabled) {
    transform: scale(1.03);
  }
  .add:active:not(:disabled) {
    transform: scale(0.98);
  }
  .add:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .secondary {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    color: var(--ink-3);
    font-size: 0.85rem;
  }
  .secondary label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .secondary input {
    padding: 0.3rem 0.4rem;
  }
  .extra {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .extra label {
    display: inline-flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    color: var(--ink-3);
  }
  .extra .note {
    flex: 1 1 12rem;
  }
  .link {
    background: none;
    border: none;
    color: var(--accent-ink);
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
  }
  .ok {
    color: var(--ok);
    font-size: 0.85rem;
    margin: 0;
  }
  .ro {
    color: var(--warn-ink);
    font-size: 0.82rem;
    margin: 0;
  }
</style>
