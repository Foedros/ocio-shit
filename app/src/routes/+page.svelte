<script>
  import { onMount } from 'svelte';
  import {
    boot,
    chooseDirectory,
    regrantPermission,
    seedFromFile,
    backupNow,
    simulateOpfsLoss,
    __installTestHooks
  } from '$lib/boot.js';
  import { phase, caps, dbStatus, durability, busy, events } from '$lib/stores.js';

  let fileInput;

  onMount(() => {
    __installTestHooks();
    boot();
  });

  function pickFile(e) {
    const f = e.target.files?.[0];
    if (f) seedFromFile(f);
    e.target.value = '';
  }

  const phaseLabel = {
    init: 'Iniciando…',
    ready: 'OPFS sano',
    reconstructed: 'Reconstruida desde copia durable',
    'needs-setup': 'Falta configurar durabilidad',
    'needs-seed': 'Falta sembrar datos',
    'needs-permission': 'Falta reautorizar carpeta',
    error: 'Error'
  };

  function fmtTime(t) {
    const d = new Date(t);
    return d.toLocaleTimeString('es-ES', { hour12: false });
  }
</script>

<section class="hero">
  <h1>La columna de durabilidad</h1>
  <p class="lead">
    El archivo no vive en el navegador. La <strong>verdad durable</strong> es tu
    <code>export.json</code> en una carpeta real de tu disco. OPFS es solo una caché rápida y
    <em>desechable</em>: si se borra, la app se reconstruye sin pérdida.
  </p>
</section>

<!-- Estado del motor / OPFS -->
<div class="card">
  <div class="card-head">
    <h2>Motor & caché (OPFS)</h2>
    <span class="pill phase-{$phase}">{phaseLabel[$phase] ?? $phase}</span>
  </div>
  {#if $dbStatus}
    <dl class="grid">
      <div><dt>VFS</dt><dd><code>{$dbStatus.vfs}</code></dd></div>
      <div><dt>Integridad</dt><dd>{$dbStatus.integrity?.detail ?? '—'}</dd></div>
      <div><dt>Obras</dt><dd>{$dbStatus.counts?.obra ?? '—'}</dd></div>
      <div><dt>Entradas</dt><dd>{$dbStatus.counts?.entrada ?? '—'}</dd></div>
      <div><dt>Personas</dt><dd>{$dbStatus.counts?.persona ?? '—'}</dd></div>
      <div><dt>Vínculos creador</dt><dd>{$dbStatus.counts?.obra_creador ?? '—'}</dd></div>
    </dl>
  {:else}
    <p class="muted">Esperando al motor…</p>
  {/if}
</div>

<!-- Durabilidad -->
<div class="card">
  <div class="card-head">
    <h2>Durabilidad</h2>
    <span class="pill mode-{$durability.mode}">{$durability.mode === 'auto' ? 'Automática' : $durability.mode === 'manual' ? 'Manual (degradada)' : '—'}</span>
  </div>
  <p class="muted small">{$caps?.summary ?? ''}</p>
  {#if $durability.mode === 'manual'}
    <p class="banner warn">
      Este navegador no tiene la <strong>File System Access API</strong> completa. La durabilidad
      automática no está disponible: deberás <strong>exportar tú</strong> el respaldo. (MVP es
      Chromium-only para durabilidad plena.)
    </p>
  {/if}
  {#if !$caps?.isChromium}
    <p class="banner warn">Navegador no-Chromium detectado: soporte de durabilidad no garantizado.</p>
  {/if}
  <dl class="grid">
    <div><dt>Destino durable</dt><dd>{$durability.storeName ?? 'sin elegir'}</dd></div>
    <div><dt>Último backup</dt><dd>{$durability.lastBackupAt ? fmtTime($durability.lastBackupAt) : '—'}</dd></div>
  </dl>
</div>

<!-- Acciones -->
<div class="card">
  <h2>Acciones</h2>
  <div class="actions">
    <button class="primary" onclick={chooseDirectory} disabled={!!$busy}>
      Elegir carpeta durable…
    </button>
    {#if $durability.needsPermission}
      <button onclick={regrantPermission} disabled={!!$busy}>Reautorizar acceso</button>
    {/if}
    <button onclick={() => fileInput.click()} disabled={!!$busy}>Cargar export.json…</button>
    <input
      bind:this={fileInput}
      type="file"
      accept="application/json,.json"
      onchange={pickFile}
      hidden
    />
    <button onclick={backupNow} disabled={!!$busy || !$durability.storeName}>Backup ahora</button>
    <button class="danger" onclick={simulateOpfsLoss} disabled={!!$busy}>
      Simular pérdida de OPFS → reconstruir
    </button>
  </div>
  {#if $busy}
    <p class="busy">⏳ {$busy}</p>
  {/if}
  <p class="hint small muted">
    Flujo: <strong>1.</strong> elige carpeta durable · <strong>2.</strong> carga tu
    <code>export.json</code> (se siembra OPFS y se escribe la copia durable) · <strong>3.</strong>
    pulsa “Simular pérdida de OPFS” para comprobar la reconstrucción.
  </p>
</div>

<!-- Registro de eventos -->
<div class="card">
  <h2>Registro</h2>
  <div class="log" role="log">
    {#each [...$events].reverse() as ev}
      <div class="row lvl-{ev.level}">
        <span class="t">{fmtTime(ev.t)}</span>
        <span class="m">{ev.msg}</span>
      </div>
    {:else}
      <p class="muted small">Sin eventos todavía.</p>
    {/each}
  </div>
</div>

<style>
  .hero h1 {
    font-size: 1.7rem;
    margin: 0.2rem 0 0.5rem;
    letter-spacing: 0.01em;
  }
  .lead {
    color: var(--ink-2);
    line-height: 1.55;
    margin: 0 0 0.5rem;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem 1.1rem;
    margin: 1rem 0;
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  h2 {
    font-size: 1.05rem;
    margin: 0 0 0.6rem;
    font-weight: 600;
  }
  .card-head h2 {
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem 1rem;
    margin: 0.7rem 0 0;
  }
  .grid > div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  dt {
    color: var(--ink-3);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  dd {
    margin: 0;
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
  }
  .pill {
    font-size: 0.75rem;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink-2);
    white-space: nowrap;
  }
  .phase-ready,
  .phase-reconstructed {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, var(--line));
  }
  .phase-error {
    color: var(--danger-ink);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
  }
  .mode-auto {
    color: var(--ok);
    border-color: color-mix(in srgb, var(--ok) 45%, var(--line));
  }
  .mode-manual {
    color: var(--warn-ink);
    border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  }
  .banner {
    border-radius: 10px;
    padding: 0.6rem 0.75rem;
    margin: 0.6rem 0;
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .banner.warn {
    background: color-mix(in srgb, var(--warn) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line));
    color: var(--warn-ink);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  button {
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    padding: 0.55rem 0.85rem;
    border-radius: 10px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  button.primary {
    background: color-mix(in srgb, var(--accent) 18%, var(--surface-2));
    border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
    color: var(--accent-ink);
  }
  button.danger {
    border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
    color: var(--danger-ink);
  }
  .busy {
    color: var(--accent-ink);
    margin: 0.7rem 0 0;
  }
  .hint {
    margin-top: 0.7rem;
  }
  .small {
    font-size: 0.82rem;
  }
  .muted {
    color: var(--ink-3);
  }
  .log {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    max-height: 320px;
    overflow: auto;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 0.8rem;
  }
  .log .row {
    display: flex;
    gap: 0.6rem;
    padding: 0.2rem 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
  }
  .log .t {
    color: var(--ink-3);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .log .m {
    color: var(--ink-2);
  }
  .lvl-ok .m {
    color: var(--ok);
  }
  .lvl-warn .m {
    color: var(--warn-ink);
  }
  .lvl-error .m {
    color: var(--danger-ink);
  }
</style>
