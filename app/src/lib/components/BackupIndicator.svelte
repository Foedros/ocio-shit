<script>
  // Permanent, honest indicator of the durable backup state (roadmap S1 task 6).
  import { durability } from '$lib/stores.js';

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  function ago(ms) {
    if (!ms) return null;
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return `hace ${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return `hace ${d} d`;
  }

  // state: 'none' (no durable target), 'manual' (degraded), 'ok' (durable + backed up),
  // 'pending' (durable target chosen but nothing written yet)
  let level = $derived(
    !$durability.storeName
      ? 'none'
      : !$durability.automatic
        ? 'manual'
        : $durability.lastBackupAt
          ? 'ok'
          : 'pending'
  );

  let label = $derived(
    level === 'none'
      ? 'Sin copia durable'
      : level === 'manual'
        ? 'Durabilidad MANUAL'
        : level === 'pending'
          ? 'Carpeta durable lista — sin backup aún'
          : `Último backup durable: ${ago($durability.lastBackupAt) ?? '—'}`
  );
</script>

<div class="indicator {level}" title={$durability.storeName ?? 'No has elegido carpeta durable'}>
  <span class="dot" aria-hidden="true"></span>
  <span class="label">{label}</span>
  {#if $durability.storeName}
    <span class="store">· {$durability.storeName}</span>
  {/if}
  {#if $durability.needsPermission}
    <span class="warn">· reautoriza acceso</span>
  {/if}
</div>

<style>
  .indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.7rem;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 500;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink-2);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    flex: 0 0 auto;
    background: var(--ink-3);
  }
  .ok .dot {
    background: var(--ok);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent);
  }
  .pending .dot {
    background: var(--accent);
  }
  .manual .dot {
    background: var(--warn);
  }
  .none .dot {
    background: var(--danger);
  }
  .ok {
    color: var(--ink);
    border-color: color-mix(in srgb, var(--ok) 40%, var(--line));
  }
  .manual {
    color: var(--warn-ink);
    border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
  }
  .none {
    color: var(--danger-ink);
    border-color: color-mix(in srgb, var(--danger) 45%, var(--line));
  }
  .store {
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .warn {
    color: var(--warn-ink);
  }
</style>
