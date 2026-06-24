<script>
  // Registro rápido nota: 0,0–10,0 step 0,5, big serif gold number in European comma.
  let { value = $bindable('') } = $props();
  let display = $derived(value === '' || value == null ? '—' : String(value).replace('.', ','));
  let rated = $derived(!(value === '' || value == null));
</script>

<div class="rating">
  <div class="head">
    <span class="eyebrow">3 · Tu nota</span>
    <div class="num" class:unset={!rated}>{display}</div>
  </div>
  <input
    type="range"
    min="0"
    max="10"
    step="0.5"
    value={rated ? value : 5}
    oninput={(e) => (value = Number(e.currentTarget.value))}
    aria-label="Valoración 0 a 10"
  />
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
  }
  .num.unset {
    color: var(--ink-3);
  }
  input[type='range'] {
    width: 100%;
    margin: 0.5rem 0 0.3rem;
    accent-color: var(--accent);
    height: 1.4rem;
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
