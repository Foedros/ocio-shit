<script>
  import favicon from '$lib/assets/favicon.svg';
  import BackupIndicator from '$lib/components/BackupIndicator.svelte';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Ocio Shit — durabilidad</title>
</svelte:head>

<div class="app">
  <header class="bar">
    <div class="brand">
      <span class="mark">◆</span>
      <span class="name">Ocio&nbsp;Shit</span>
      <span class="tag">Sprint&nbsp;1 · durabilidad</span>
    </div>
    <BackupIndicator />
  </header>

  <main>
    {@render children()}
  </main>
</div>

<style>
  :global(:root) {
    --bg: #0e0d10;
    --surface: #17151b;
    --surface-2: #1f1d25;
    --line: #2c2933;
    --ink: #f3eee9;
    --ink-2: #c9c2bb;
    --ink-3: #8a8290;
    --accent: #c8a24a;
    --accent-ink: #f0d493;
    --ok: #4caf7d;
    --warn: #d9a441;
    --warn-ink: #f0c873;
    --danger: #d9534f;
    --danger-ink: #f08d8a;
    --radius: 14px;
    color-scheme: dark;
  }

  :global(*) {
    box-sizing: border-box;
  }
  :global(html, body) {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  :global(button) {
    font: inherit;
  }
  :global(code) {
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, monospace;
    font-size: 0.85em;
  }

  .app {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .bar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    padding: 0.7rem 1rem;
    background: color-mix(in srgb, var(--bg) 86%, transparent);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
  }
  .mark {
    color: var(--accent);
  }
  .name {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .tag {
    color: var(--ink-3);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  main {
    flex: 1;
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 1rem 1rem 4rem;
  }
</style>
