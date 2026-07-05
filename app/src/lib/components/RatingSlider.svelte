<script>
  // Registro rápido nota: 0,0–10,0 step 0,5, big serif gold number in European comma.
  // Tanda 4 · FÍSICA: el VALOR lo sigue dando el <input type=range> nativo (precisión exacta,
  // teclado y accesibilidad intactos — va invisible encima como capa de interacción); debajo,
  // track/fill/thumb CUSTOM cuya posición es un spring (svelte/motion) → el thumb sigue el
  // dedo con un rebote elástico sutil al soltar. El número grande hace un pop (~1→1,15→1)
  // con spring en cada cambio. Con reduced-motion: movimiento directo (hard) y sin pop.
  import { spring } from 'svelte/motion';
  import { prefersReducedMotion } from '$lib/motion.js';

  let { value = $bindable('') } = $props();
  let display = $derived(value === '' || value == null ? '—' : String(value).replace('.', ','));
  let rated = $derived(!(value === '' || value == null));

  const reduced = prefersReducedMotion();
  const pctOf = (v) => (v === '' || v == null ? 50 : (Number(v) / 10) * 100);

  // Puntero EXPLÍCITO (táctil y ratón por el mismo camino, pointer events + captura): el
  // valor se calcula de la posición y se REDONDEA al paso 0,5 — nunca pasa por el spring,
  // la precisión es aritmética. El input nativo queda debajo para teclado/lectores.
  let slEl = $state(null);
  let inputEl = $state(null);
  let dragging = false;
  function setFromX(clientX) {
    const r = slEl.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    value = Math.round(f * 20) / 2; // 0–10 en pasos de 0,5 exactos
  }
  function pDown(e) {
    dragging = true;
    slEl.setPointerCapture?.(e.pointerId);
    inputEl?.focus({ preventScroll: true });
    setFromX(e.clientX);
  }
  function pMove(e) {
    if (dragging) setFromX(e.clientX);
  }
  function pUp() {
    dragging = false;
  }

  // posición visual del thumb/fill (0–100). El valor real NUNCA pasa por el spring.
  const pos = spring(pctOf(value), { stiffness: 0.18, damping: 0.55 });
  // pop del número: salto duro a 1,15 y asentado elástico a 1.
  const pop = spring(1, { stiffness: 0.25, damping: 0.45 });

  let prev = value;
  $effect(() => {
    const p = pctOf(value);
    pos.set(p, { hard: reduced });
    if (value !== prev) {
      prev = value;
      if (!reduced && value !== '' && value != null) {
        pop.set(1.15, { hard: true });
        pop.set(1);
      }
    }
  });
</script>

<div class="rating">
  <div class="head">
    <span class="eyebrow">3 · Tu nota</span>
    <div class="num" class:unset={!rated} style="transform: scale({$pop}); transform-origin: right bottom;">{display}</div>
  </div>
  <div
    class="slider"
    class:unset={!rated}
    bind:this={slEl}
    onpointerdown={pDown}
    onpointermove={pMove}
    onpointerup={pUp}
    onpointercancel={pUp}
  >
    <div class="track" aria-hidden="true">
      <div class="fill" style="width:{Math.max(0, Math.min(100, $pos))}%"></div>
      <div class="thumb" style="left:{Math.max(0, Math.min(100, $pos))}%"></div>
    </div>
    <input
      bind:this={inputEl}
      type="range"
      min="0"
      max="10"
      step="0.5"
      value={rated ? value : 5}
      oninput={(e) => (value = Number(e.currentTarget.value))}
      aria-label="Valoración 0 a 10"
    />
  </div>
  <div class="foot">
    <span class="scale">0</span>
    {#if rated}<button type="button" class="clear" onclick={() => (value = '')}>sin nota</button>{/if}
    <span class="scale">10</span>
  </div>
</div>

<style>
  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--label);
  }
  .num {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 500;
    color: var(--gold);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    will-change: transform;
  }
  .num.unset {
    color: var(--ink-3);
  }
  /* capa de interacción: el range nativo, invisible, ENCIMA de los visuales custom */
  .slider {
    position: relative;
    height: 1.9rem;
    margin: 0.5rem 0 0.3rem;
    touch-action: none; /* el gesto sobre el slider es del slider (franja baja, como el nativo iOS) */
    cursor: pointer;
  }
  .slider input[type='range'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    pointer-events: none; /* el puntero lo maneja el wrapper; el input queda para teclado/AT */
  }
  .track {
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 7px;
    transform: translateY(-50%);
    border-radius: 5px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    border-radius: 5px;
    background: linear-gradient(90deg, #c9883f, var(--accent));
  }
  .thumb {
    position: absolute;
    top: 50%;
    width: 22px;
    height: 22px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    background: var(--gold);
    border: 2px solid #0b0a08;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    will-change: left;
  }
  .slider.unset .thumb {
    background: var(--ink-3);
  }
  .slider.unset .fill {
    opacity: 0.35;
  }
  /* foco de teclado visible en el thumb custom (el input real es invisible) */
  .slider:focus-within .thumb {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-data);
    font-size: 0.7rem;
    color: var(--ink-3);
  }
  .clear {
    background: none;
    border: none;
    color: var(--ink-3);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
  }
  .clear:hover {
    color: var(--ink-2);
  }
</style>
