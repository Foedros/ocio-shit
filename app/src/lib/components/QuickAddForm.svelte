<script>
  // pantallas.md 02 · Registro rápido: alta en <10 s, 3 toques (categoría → nombre → nota).
  import { addEntryAction } from '$lib/boot-supabase.js';
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
  let fecha = $state(todayISO()); // CUÁNDO lo viví (Entrada) — por defecto hoy
  let nota = $state('');
  let anio = $state(''); // AÑO DE ESTRENO de la obra (Obra) — NUNCA autorrellenado
  let durH = $state('');
  let durMin = $state('');
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
      const durMinTotal =
        durH !== '' || durMin !== '' ? (Number(durH) || 0) * 60 + (Number(durMin) || 0) : null;
      const res = await addEntryAction({
        obra: { titulo: titulo.trim(), categoria, anio_obra: anio === '' ? null : anio },
        entrada: {
          fecha: fecha || null, // CUÁNDO se vivió → Entrada
          nota: nota || null,
          valoracion: valoracion === '' ? null : valoracion,
          duracion_min: durMinTotal // tiempo dedicado → Entrada (A-07 en queries.js)
        }
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
      <label class="fld">
        <span class="lbl">Fecha de consumo</span>
        <input type="date" bind:value={fecha} disabled={!canWrite} />
        <span class="hint">cuándo lo viste / leíste / jugaste</span>
      </label>
      <label class="fld">
        <span class="lbl">Año de la obra</span>
        <input type="number" bind:value={anio} min="1850" max="2100" placeholder="ej. 2019" disabled={!canWrite} />
        <span class="hint">año de estreno / publicación · NO el de consumo</span>
      </label>
      <div class="fld">
        <span class="lbl">Duración</span>
        <div class="dur">
          <input type="number" bind:value={durH} min="0" placeholder="0" disabled={!canWrite} aria-label="horas" /><span class="u">h</span>
          <input type="number" bind:value={durMin} min="0" max="59" placeholder="0" disabled={!canWrite} aria-label="minutos" /><span class="u">min</span>
        </div>
        <span class="hint">tiempo dedicado en esta experiencia</span>
      </div>
      <label class="fld wide">
        <span class="lbl">Nota personal</span>
        <input bind:value={nota} placeholder="micro-reseña…" disabled={!canWrite} />
      </label>
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
  .extra input {
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: 10px;
    padding: 0.5rem 0.6rem;
    font-family: var(--font-text);
    font-size: 0.95rem;
    width: 100%;
  }
  .extra input:focus {
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
