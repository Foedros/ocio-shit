<script>
  // pantallas.md 02 · Registro rápido: alta en pocos toques (categoría → nombre → nota).
  // "Más" añade los METADATOS DE OBRA a mano (año · director/developer/autor · género), opcionales,
  // para que las obras nuevas nazcan con los mismos datos que las enriquecidas por API. Create-vs-link:
  // si el título ya existe, se detecta y se PRE-RELLENA para confirmar/corregir (no se duplica).
  import { addEntryAction, lookupObra, listGeneros } from '$lib/boot-supabase.js';
  import { CATEGORIAS, ROL_CREADOR_LABEL, generoLabel, slugifyGenero } from '$lib/db/queries.js';
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
  let anio = $state(''); // AÑO DE ESTRENO de la obra (Obra) — NUNCA autorrellenado salvo create-vs-link
  let durH = $state('');
  let durMin = $state('');
  let creador = $state(''); // director / developer / autor (texto) → obra.creador + obra_creador
  let generos = $state([]); // slugs de género (taxonomía unificada)
  let genInput = $state('');
  let genOptions = $state([]); // slugs existentes (datalist)
  let matched = $state(null); // resultado de create-vs-link (obra ya existente)
  let more = $state(false);
  let tituloInput = $state(null);

  let canWrite = $derived($role === 'leader');
  let creadorLabel = $derived(ROL_CREADOR_LABEL[categoria] ?? 'Creador');

  $effect(() => {
    // Autofocus the name field when the sheet opens (the keyboard surfaces alone on mobile).
    tituloInput?.focus();
  });

  // Datalist de géneros existentes (una vez).
  $effect(() => {
    listGeneros().then((g) => (genOptions = g)).catch(() => {});
  });

  // Create-vs-link: detecta una obra existente por título+categoría (+año si lo hay) y PRE-RELLENA
  // los campos vacíos para confirmar/corregir (no a ciegas). Debounced; ignora resultados obsoletos.
  let lookupSeq = 0;
  let debTimer;
  $effect(() => {
    const t = titulo.trim();
    const c = categoria;
    const a = anio; // depende también del año (afina el match)
    clearTimeout(debTimer);
    if (!t || !canWrite) {
      matched = null;
      return;
    }
    const seq = ++lookupSeq;
    debTimer = setTimeout(async () => {
      try {
        const r = await lookupObra(t, c, a === '' ? null : a);
        if (seq !== lookupSeq) return; // resultado obsoleto
        if (r?.exists) {
          matched = r;
          // PRE-RELLENA solo lo que el usuario aún no ha tocado (manual gana después).
          if ((anio === '' || anio == null) && r.anio_obra != null) anio = String(r.anio_obra);
          if (!creador.trim() && r.creador) creador = r.creador;
          if (generos.length === 0 && r.generos?.length) generos = [...r.generos];
        } else {
          matched = null;
        }
      } catch {
        /* el alta sigue funcionando aunque la detección falle */
      }
    }, 350);
    return () => clearTimeout(debTimer);
  });

  function addGenero() {
    const slug = slugifyGenero(genInput);
    if (slug && !generos.includes(slug)) generos = [...generos, slug];
    genInput = '';
  }
  function genKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addGenero();
    }
  }
  const removeGenero = (slug) => (generos = generos.filter((g) => g !== slug));

  function reset() {
    titulo = '';
    valoracion = '';
    nota = '';
    anio = '';
    durH = '';
    durMin = '';
    creador = '';
    generos = [];
    genInput = '';
    matched = null;
  }

  async function submit(e) {
    e?.preventDefault();
    if (!titulo.trim() || !canWrite || $busy) return;
    if (genInput.trim()) addGenero(); // no perder un género tecleado sin confirmar
    try {
      const durMinTotal =
        durH !== '' || durMin !== '' ? (Number(durH) || 0) * 60 + (Number(durMin) || 0) : null;
      const res = await addEntryAction({
        obra: {
          titulo: titulo.trim(),
          categoria,
          anio_obra: anio === '' ? null : anio,
          creador: creador.trim() || null, // manual gana; vacío = no-op (no borra el existente)
          generos // slugs; vacío = no-op
        },
        entrada: {
          fecha: fecha || null, // CUÁNDO se vivió → Entrada
          nota: nota || null,
          valoracion: valoracion === '' ? null : valoracion,
          duracion_min: durMinTotal // tiempo dedicado → Entrada (A-07 en queries.js)
        }
      });
      showToast(`Entrada guardada${res.obraCreated ? '' : ' · reconsumo ' + res.numReconsumo}`);
      reset();
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
    {#if matched?.exists}
      <p class="matched">
        Ya tienes <strong>«{matched.titulo}{#if matched.anio_obra} ({matched.anio_obra}){/if}»</strong> ·
        será tu entrada nº {matched.n_entradas + 1} (reconsumo). {#if !more}<button type="button" class="inline" onclick={() => (more = true)}>Ver datos →</button>{/if}
      </p>
    {/if}
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
        <span class="hint">estreno / publicación · NO el de consumo</span>
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
        <span class="lbl">{creadorLabel}</span>
        <input bind:value={creador} placeholder="quién la firma" disabled={!canWrite} aria-label={creadorLabel} />
        <span class="hint">se guarda en la OBRA (vale para futuros reconsumos)</span>
      </label>
      <div class="fld wide">
        <span class="lbl">Género</span>
        <input
          bind:value={genInput}
          onkeydown={genKeydown}
          list="gen-list"
          placeholder="añade y pulsa Enter"
          disabled={!canWrite}
          aria-label="Género"
        />
        <datalist id="gen-list">
          {#each genOptions as g}<option value={generoLabel(g)}></option>{/each}
        </datalist>
        {#if generos.length}
          <div class="gen-chips">
            {#each generos as g}
              <button type="button" class="gchip" onclick={() => removeGenero(g)} disabled={!canWrite} title="Quitar">
                {generoLabel(g)} <span class="x">×</span>
              </button>
            {/each}
          </div>
        {/if}
        <span class="hint">uno o varios · en español · cuentan para la diversidad</span>
      </div>
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
  .matched {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-2);
    line-height: 1.4;
  }
  .matched strong {
    color: var(--ink);
  }
  .inline {
    background: none;
    border: none;
    color: var(--accent-ink);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: underline;
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
    min-width: 0;
  }
  .fld.wide {
    flex: 1 1 100%;
  }
  /* En móvil, Fecha/Año/Duración a ancho completo (apilados). El <input type=date> nativo de iOS
     no encoge con flex y se solapaba con "Año de la obra"; apilar lo resuelve de raíz. En escritorio
     (modal ~560px) siguen lado a lado. */
  @media (max-width: 700px) {
    .extra .fld {
      flex-basis: 100%;
    }
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
  .gen-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.15rem;
  }
  .gchip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
    border: 1px solid var(--line);
    color: var(--ink);
    border-radius: var(--radius-pill);
    padding: 0.28rem 0.6rem;
    font-family: var(--font-text);
    font-size: 0.82rem;
    cursor: pointer;
  }
  .gchip .x {
    color: var(--ink-3);
    font-weight: 700;
  }
  .gchip:hover .x {
    color: var(--danger-ink);
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
