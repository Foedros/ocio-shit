<script>
  // pantallas.md 02 · Registro rápido: alta en <10 s, 3 toques (categoría → nombre → nota).
  import { addEntryAction } from '$lib/boot.js';
  import { CATEGORIAS } from '$lib/db/queries.js';
  import { busy, role, showToast } from '$lib/stores.js';
  import { todayISO } from '$lib/format.js';
  import Button from './Button.svelte';
  import CategoryChip from './CategoryChip.svelte';
  import RatingSlider from './RatingSlider.svelte';

  let { onsaved } = $props();

  let titulo = $state('');
  let categoria = $state('pelicula');
  let valoracion = $state('');
  let fecha = $state(todayISO());
  let nota = $state('');
  let anio = $state('');
  let more = $state(false);
  let tituloInput = $state(null);

  let canWrite = $derived($role === 'leader');

  $effect(() => {
    // Autofocus the name field when the sheet opens (the keyboard surfaces alone on mobile).
    tituloInput?.focus();
  });

  async function submit(e) {
    e?.preventDefault();
    if (!titulo.trim() || !canWrite || $busy) return;
    try {
      const res = await addEntryAction({
        obra: { titulo: titulo.trim(), categoria, anio_obra: anio || null },
        entrada: { fecha: fecha || null, nota: nota || null, valoracion: valoracion === '' ? null : valoracion }
      });
      showToast(`Entrada guardada${res.obraCreated ? '' : ' · reconsumo ' + res.numReconsumo}`);
      onsaved?.();
    } catch {
      showToast('No se pudo guardar. Reintenta.', 'error');
    }
  }
</script>

<form class="reg" onsubmit={submit}>
  {#if !canWrite}
    <p class="ro">Esta pestaña es de solo lectura. Registra desde la pestaña principal.</p>
  {/if}

  <section>
    <div class="eyebrow">1 · Categoría</div>
    <div class="chips">
      {#each CATEGORIAS as c}
        <CategoryChip categoria={c} selected={categoria === c} disabled={!canWrite} onclick={() => (categoria = c)} />
      {/each}
    </div>
  </section>

  <section>
    <div class="eyebrow">2 · Nombre</div>
    <input
      class="name"
      bind:this={tituloInput}
      bind:value={titulo}
      placeholder="¿Qué consumiste?"
      disabled={!canWrite}
      autocomplete="off"
      aria-label="Nombre de la obra"
    />
  </section>

  <section>
    <RatingSlider bind:value={valoracion} />
  </section>

  {#if more}
    <section class="extra">
      <label>Fecha <input type="date" bind:value={fecha} disabled={!canWrite} /></label>
      <label>Año <input type="number" bind:value={anio} min="1850" max="2100" placeholder="—" disabled={!canWrite} /></label>
      <label class="wide">Nota personal <input bind:value={nota} placeholder="micro-reseña…" disabled={!canWrite} /></label>
    </section>
  {/if}

  <div class="actions">
    <Button variant="secondary" type="button" onclick={() => (more = !more)}>{more ? 'Menos' : 'Más'}</Button>
    <Button variant="primary" type="submit" disabled={!canWrite || !titulo.trim() || !!$busy}>Guardar entrada</Button>
  </div>
  <p class="foot"><span>Hoy · {fecha}</span><span class="kbd">⏎ guardar</span></p>
</form>

<style>
  .reg {
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--label);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .name {
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 400;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--line-strong);
    color: var(--ink);
    padding: 0.3rem 0;
  }
  .name::placeholder {
    color: var(--ink-3);
  }
  .name:focus {
    outline: none;
    border-bottom-color: var(--accent);
  }
  .extra {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 0.7rem;
  }
  .extra label {
    display: inline-flex;
    flex-direction: column;
    gap: 0.25rem;
    font-family: var(--font-data);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--label);
  }
  .extra .wide {
    flex: 1 1 12rem;
  }
  .extra input {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    font-family: var(--font-text);
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: normal;
  }
  .extra input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .foot {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-data);
    font-size: 0.7rem;
    color: var(--ink-3);
    margin: 0;
  }
  .kbd {
    color: var(--ink-3);
  }
  .ro {
    color: var(--warn-ink);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
