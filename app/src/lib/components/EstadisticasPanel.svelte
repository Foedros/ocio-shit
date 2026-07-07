<script>
  // Pantalla 06 · Estadísticas. Diseño: diseno/Ocio Shit - Estadisticas.html (composición móvil
  // como fuente de verdad). Datos REALES vía ocio_stats() (RPC SECURITY INVOKER) — nunca los
  // números de muestra del diseño. Se actualiza solo (lee de Supabase en vivo).
  import { onMount } from 'svelte';
  import { stats } from '$lib/db/supabase-data.js';
  import Skeleton from './Skeleton.svelte';
  import { countUp, countUpInView, inView, prefersReducedMotion } from '$lib/motion.js';

  let loading = $state(true);
  let error = $state(null);
  let d = $state(null);

  // Tanda 2 · el anillo se dibuja al ENTRAR en viewport (una vez por visita); el número
  // central cuenta en paralelo. Con reduced-motion, todo al valor final desde el arranque.
  let ringSeen = $state(false);
  onMount(() => {
    if (prefersReducedMotion()) ringSeen = true;
  });

  onMount(load);
  async function load() {
    loading = true;
    error = null;
    try {
      d = await stats();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // Notación europea MANUAL (punto de millar, coma decimal) — no depende del ICU del navegador
  // (constraint dura del proyecto: coma decimal). toLocaleString fallaba en navegadores sin es-ES.
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));
  const dec = (n, k = 2) => {
    if (n == null) return '—';
    const [i, fr] = Number(n).toFixed(k).split('.');
    return k > 0 ? `${grp(i)},${fr}` : grp(i);
  };
  // slugs de género → etiqueta con acentos/espacios
  const GEN_LABEL = {
    accion: 'Acción', aventura: 'Aventura', animacion: 'Animación', comedia: 'Comedia',
    'ciencia-ficcion': 'Ciencia ficción', belica: 'Bélica', musica: 'Música', simulacion: 'Simulación',
    'pelicula-de-tv': 'Película de TV', 'multijugador-masivo': 'Multijugador masivo', rol: 'Rol'
  };
  const genLabel = (s) => GEN_LABEL[s] || s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

  // colores de categoría (= tokens de diseno/) y de dimensión
  const CAT = {
    videojuego: { l: 'Videojuego', c: '#9580B0' },
    serie: { l: 'Serie', c: '#C9A23F' },
    pelicula: { l: 'Cine', c: '#C75D52' },
    libro: { l: 'Libros', c: '#7E8F5B' },
    comic: { l: 'Cómic', c: '#5B9298' },
    ocio_libre: { l: 'Ocio libre', c: '#8A6F4A' }
  };
  const GEN_COLORS = ['#C75D52', '#C9A23F', '#7E8F5B', '#9580B0', '#5B9298'];

  // anillo de 3 arcos (década · género · creador) — geometría exacta del diseño (desktop 210)
  const RINGS = [
    { key: 'd_decada', r: 90, w: 11, c: '#9580B0' },
    { key: 'd_genero', r: 75, w: 9, c: '#C75D52' },
    { key: 'd_creador', r: 61, w: 9, c: '#7E8F5B' }
  ];
  const circ = (r) => 2 * Math.PI * r;
  const dashoff = (r, v) => circ(r) * (1 - Math.max(0, Math.min(100, v ?? 0)) / 100);

  // vistas derivadas (todo real, de ocio_stats)
  let cor = $derived(d?.corpus);
  let div = $derived(d?.diversidad);
  let tiempo = $derived(d?.tiempo ?? []);
  let totObras = $derived(tiempo.reduce((s, t) => s + (t.obras || 0), 0));
  let totHoras = $derived(tiempo.reduce((s, t) => s + Number(t.horas || 0), 0));
  let obrasSeg = $derived([...tiempo].sort((a, b) => b.obras - a.obras));
  let horasSeg = $derived([...tiempo].sort((a, b) => Number(b.horas) - Number(a.horas)));
  let generos = $derived(d?.generos ?? []);
  let genTop = $derived(generos.slice(0, 5));
  let genMax = $derived(genTop[0]?.n || 1);
  let sinGenero = $derived(cor ? cor.obras - (cor.con_genero ?? 0) : 0);
  let decadas = $derived(d?.decadas ?? []);
  let decMax = $derived(Math.max(1, ...decadas.map((x) => x.n)));
  let decFechadas = $derived(decadas.reduce((s, x) => s + x.n, 0));
  let cre = $derived((d?.creadores_top ?? []).slice(0, 4));
  let creMax = $derived(cre[0]?.n || 1);
  let val = $derived(d?.valoraciones);
  let pctPunt = $derived(val ? Math.round((100 * val.puntuadas) / val.total) : 0);
  let histo = $derived(
    Array.from({ length: 10 }, (_, i) => val?.histograma?.find((h) => h.bucket === i + 1)?.n ?? 0)
  );
  let histoMax = $derived(Math.max(1, ...histo));
  let dias = $derived(cor ? Math.round(Number(cor.horas) / 24) : 0);
  const DIM_LABEL = { d_decada: 'Década', d_genero: 'Género', d_creador: 'Creador' };
  let dimDesc = $derived({
    d_decada: 'repartes entre épocas',
    d_genero: `${generos.length} géneros distintos`,
    d_creador: `${fmt(cor?.creadores)} creadores`
  });
  function decColor(n) {
    const p = (100 * n) / decMax;
    if (p >= 99) return 'linear-gradient(#F2A65A,#E8602C)';
    if (p >= 80) return '#E89A4A';
    if (p >= 50) return '#C9883F';
    if (p >= 20) return '#6E5A3A';
    if (p >= 4) return '#4a4030';
    return '#3a3327';
  }
  const decLabel = (dd) => String(((dd % 100) + 100) % 100).padStart(2, '0') + 's';
</script>

<section class="stats">
  <header class="head">
    <div class="eyebrow">Tu vida cultural, en cifras</div>
    <h2>Estadísticas</h2>
  </header>

  {#if loading}
    <div class="skeleton">
      {#each Array(4) as _}<Skeleton h="120px" r="18px" />{/each}
    </div>
  {:else if error}
    <div class="err">
      <p>No se pudieron cargar las estadísticas.</p>
      <button onclick={load}>Reintentar</button>
    </div>
  {:else if d}
    <!-- ROW: diversidad (hero) + grandes números -->
    <div class="row split">
      <!-- 01 · ÍNDICE DE DIVERSIDAD -->
      <article class="card hero glow">
        <span class="aura"></span>
        <div class="ring-wrap" use:inView={{ once: true, cb: (v) => v && (ringSeen = true) }}>
          <svg viewBox="0 0 210 210" class="ring">
            {#each RINGS as g}
              <circle cx="105" cy="105" r={g.r} fill="none" stroke="#211C16" stroke-width={g.w} />
            {/each}
            <!-- Los 3 arcos se dibujan SECUENCIALMENTE (década → género → creador) con solape
                 parcial: 600ms + delay de 250ms por arco, ease-out-expo (tokens de motion). -->
            {#each RINGS as g, i}
              <circle
                class="arc"
                cx="105"
                cy="105"
                r={g.r}
                fill="none"
                stroke={g.c}
                stroke-width={g.w}
                stroke-linecap="round"
                stroke-dasharray={circ(g.r)}
                style="--i:{i};stroke-dashoffset:{ringSeen ? dashoff(g.r, div?.[g.key]) : circ(g.r)}"
              />
            {/each}
          </svg>
          <div class="ring-center">
            <span
              class="big-gold"
              use:countUp={ringSeen
                ? { value: Number(div?.indice ?? 0), decimals: 2, duration: 1100 }
                : { value: 0, decimals: 2, duration: 0 }}
            ></span>
            <span class="mono dim">/ 100 · ALTO</span>
          </div>
        </div>
        <div class="hero-body">
          <div class="eyebrow gold">Índice de diversidad</div>
          <p class="serif-it">Tu apertura cultural combina tres miradas: cuándo, qué y quién.</p>
          <div class="dims">
            {#each RINGS as g}
              <div class="dim-row">
                <span class="dot" style="background:{g.c}"></span>
                <span class="dim-name">{DIM_LABEL[g.key]}</span>
                <span class="dim-desc">{dimDesc[g.key]}</span>
                <span class="dim-val mono">{dec(div?.[g.key], 1)}</span>
              </div>
            {/each}
          </div>
        </div>
      </article>

      <!-- 05 · GRANDES NÚMEROS — cuentan 0→valor al entrar en viewport (una vez) -->
      <div class="bignums">
        <article class="card stat"><div class="num"><span use:countUpInView={{ value: Math.round(Number(cor?.obras ?? 0)) }}></span></div><div class="lab mono">OBRAS</div></article>
        <article class="card stat"><div class="num gold"><span use:countUpInView={{ value: Math.round(Number(cor?.horas ?? 0)) }}></span><span class="u"> h</span></div><div class="lab mono">≈ {fmt(dias)} DÍAS</div></article>
        <article class="card stat"><div class="num"><span use:countUpInView={{ value: Math.round(Number(cor?.entradas ?? 0)) }}></span></div><div class="lab mono">ENTRADAS</div></article>
        <article class="card stat"><div class="num"><span use:countUpInView={{ value: Math.round(Number(cor?.creadores ?? 0)) }}></span></div><div class="lab mono">CREADORES</div></article>
      </div>
    </div>

    <!-- ROW: reparto del tiempo + décadas -->
    <div class="row split">
      <!-- 02 · REPARTO DEL TIEMPO -->
      <article class="card">
        <div class="card-head"><span class="title">Reparto del tiempo</span><span class="mono faint">OBRAS vs HORAS</span></div>
        <p class="lead">El <b style="color:#D98178">cine</b> domina lo que <span class="ink">cuentas</span>. El <b style="color:#B0A0CC">videojuego</b> domina lo que <span class="ink">vives</span>.</p>
        <div class="seg-block">
          <div class="seg-head mono"><span>POR Nº DE OBRAS</span><span>{fmt(totObras)} obras</span></div>
          <div class="segbar">
            {#each obrasSeg as t}
              <span class="segfill" style="width:{(100 * t.obras) / (totObras || 1)}%;background:{CAT[t.categoria]?.c}"></span>
            {/each}
          </div>
        </div>
        <div class="seg-block">
          <div class="seg-head mono"><span>POR HORAS VIVIDAS</span><span>~{fmt(totHoras)} h</span></div>
          <div class="segbar">
            {#each horasSeg as t}
              <span class="segfill" style="width:{(100 * Number(t.horas)) / (totHoras || 1)}%;background:{CAT[t.categoria]?.c}"></span>
            {/each}
          </div>
        </div>
        <div class="legend">
          {#each horasSeg as t}
            <span class="leg"><span class="sw" style="background:{CAT[t.categoria]?.c}"></span>{CAT[t.categoria]?.l} {fmt(t.horas)} h</span>
          {/each}
        </div>
      </article>

      <!-- DÉCADAS -->
      <article class="card">
        <div class="card-head"><span class="title">Décadas de las obras</span><span class="mono faint">{fmt(decFechadas)} FECHADAS</span></div>
        <div class="histo">
          {#each decadas as dd}
            <div class="hbar">
              <div class="hfill" style="height:{Math.max(1.5, (100 * dd.n) / decMax)}%;background:{decColor(dd.n)}"></div>
              <span class="hlab mono" class:hot={dd.n / decMax >= 0.5}>{decLabel(dd.decada)}</span>
            </div>
          {/each}
        </div>
        <p class="note">El grueso vive en los <span class="ink">2000s–2010s</span>, con una cola que llega hasta los <span class="ink">años 20</span>.</p>
      </article>
    </div>

    <!-- ROW: géneros + creadores -->
    <div class="row even">
      <!-- 03 · GÉNEROS -->
      <article class="card">
        <div class="card-head"><span class="title">Géneros</span><span class="mono faint">{generos.length} DISTINTOS</span></div>
        <div class="hbars">
          {#each genTop as g, i}
            <div class="hbar-row">
              <span class="hbar-name">{genLabel(g.nombre)}</span>
              <div class="track"><div class="fill" style="width:{(100 * g.n) / genMax}%;background:{GEN_COLORS[i % GEN_COLORS.length]}"></div></div>
            </div>
          {/each}
        </div>
        <div class="gap-note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6E665A" stroke-width="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
          <span>{fmt(sinGenero)} obras aún sin género (libros, cómics y parte del cine)</span>
        </div>
      </article>

      <!-- CREADORES -->
      <article class="card">
        <div class="card-head"><span class="title">Creadores de cabecera</span></div>
        <div class="hbars">
          {#each cre as c, i}
            <div class="hbar-row">
              <span class="hbar-name serif">{c.nombre}</span>
              <div class="track"><div class="fill" style="width:{(100 * c.n) / creMax}%;background:{i === 0 ? 'linear-gradient(90deg,#F2A65A,#E8602C)' : '#C75D52'}"></div></div>
              <span class="cre-n mono" class:gold={i === 0}>{c.n}</span>
            </div>
          {/each}
        </div>
        <p class="note">De {fmt(cor?.creadores)} creadores registrados, estos marcan tu cine.</p>
      </article>
    </div>

    <!-- 04 · VALORACIONES (estado parcial) -->
    <article class="card vals">
      <span class="dashed-top"></span>
      <div class="card-head">
        <span class="title">Tus valoraciones</span>
        <span class="badge mono"><span class="bdot"></span>EN CONSTRUCCIÓN</span>
      </div>
      <div class="vals-grid">
        <div class="vals-left">
          <div class="media-row">
            <span class="media serif">{dec(val?.media)}<span class="ast">*</span></span>
            <span class="media-cap">media<br />provisional</span>
          </div>
          <p class="tiny">* sobre las obras ya puntuadas — se moverá según completes</p>
          <div class="seg-head mono compl"><span>{fmt(val?.puntuadas)} / {fmt(val?.total)} PUNTUADAS</span><span class="gold">{pctPunt}%</span></div>
          <div class="compl-bar">
            <div class="compl-fill" style="width:{pctPunt}%"></div>
            <div class="compl-rest"></div>
          </div>
          <div class="gap-note">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6E665A" stroke-width="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
            <span><span class="ink2">{fmt(val?.sin_nota_vj)} videojuegos aún sin nota.</span> Tu media y el reparto se afinarán según los puntúes.</span>
          </div>
        </div>
        <div class="vals-right">
          <div class="card-head sm"><span class="title sm">Cómo repartes tus notas</span><span class="mono faint">PROVISIONAL · 0–10</span></div>
          <div class="histo notes">
            {#each histo as n, i}
              <div class="hbar">
                <div class="hfill" style="height:{Math.max(3, (100 * n) / histoMax)}%;background:{decColor(n)}"></div>
                <span class="hlab mono">{i + 1}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </article>
  {/if}
</section>

<style>
  .stats {
    --pur: #9580b0;
    --clay: #c75d52;
    --grn: #7e8f5b;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding-bottom: 1rem;
  }
  .head { margin-bottom: 2px; }
  .head h2 { font-size: 1.7rem; color: var(--ink); margin: 2px 0 0; }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.66rem;
    letter-spacing: 0.13em;
    color: var(--ink-3);
    text-transform: uppercase;
  }
  .eyebrow.gold { color: var(--label); }

  .row { display: grid; grid-template-columns: 1fr; gap: 14px; }
  /* Sin esto, el histograma de décadas (25 barras, cada una con el min-width de su etiqueta) infla
     la columna 1fr (grid blowout) y arrastra TODA la fila —reparto incluido— fuera de la pantalla
     en móvil. min-width:0 ata las tarjetas al ancho del contenedor. */
  .row > * { min-width: 0; }
  @media (min-width: 640px) {
    .row.split { grid-template-columns: 1.5fr 1fr; align-items: stretch; }
    .row.even { grid-template-columns: 1fr 1fr; }
  }

  .card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 18px;
    animation: fadeUp 0.5s both;
  }
  .card.hero {
    background: linear-gradient(180deg, #1b1610, #120f0b);
    border-color: rgba(242, 166, 90, 0.28);
    border-radius: 20px;
    padding: 22px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  @media (min-width: 640px) {
    .card.hero { flex-direction: row; align-items: center; gap: 22px; padding: 24px; }
    .card.hero .hero-body { flex: 1; }
  }
  .card.glow { animation: fadeUp 0.5s both, glow 5s ease-in-out infinite; }
  .aura {
    position: absolute; top: -8px; left: 50%; width: 240px; height: 150px;
    background: radial-gradient(closest-side, rgba(242, 166, 90, 0.15), transparent);
    transform: translateX(-50%); pointer-events: none; animation: aura 6s ease-in-out infinite;
  }

  .ring-wrap { position: relative; width: 200px; height: 200px; flex: none; }
  .ring { width: 100%; height: 100%; transform: rotate(-90deg); }
  /* Tanda 2: los arcos se dibujan por TRANSICIÓN al fijar ringSeen (inView, una vez) —
     600ms ease-out-expo con 250ms de escalera (solape parcial). Reduced-motion global → 0.01ms. */
  .ring .arc {
    transition: stroke-dashoffset var(--dur-slow) var(--ease-out-expo);
    transition-delay: calc(var(--i) * 250ms);
  }
  .ring-center {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  /* 36px: "NN,NN" ≈ 87px de ancho — aire claro dentro del hueco del arco más interno (radio
     interior 61−4,5 escalado ≈ 54px a 200px → 108px de diámetro). A 50px eran ~122px y el número
     se montaba sobre los arcos; a 40px los dígitos extremos aún besaban el arco verde
     (verificado midiendo rects reales + captura). */
  .big-gold { font-family: var(--font-display); font-size: 36px; color: var(--gold); font-weight: 500; line-height: 0.9; font-variant-numeric: tabular-nums; }
  .mono { font-family: var(--font-data); }
  .dim { font-size: 10px; color: var(--ink-3); letter-spacing: 0.1em; margin-top: 4px; }
  .serif-it { font-family: var(--font-display); font-style: italic; font-size: 0.95rem; color: var(--ink-2); line-height: 1.35; margin: 6px 0 16px; text-align: center; }
  @media (min-width: 640px) { .serif-it { text-align: left; } }

  .dims { display: flex; flex-direction: column; gap: 10px; width: 100%; }
  .dim-row { display: flex; align-items: center; gap: 10px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dim-name { font-size: 0.82rem; color: var(--ink); width: 64px; }
  .dim-desc { font-size: 0.78rem; color: var(--ink-2); flex: 1; }
  .dim-val { font-size: 0.86rem; color: var(--ink); width: 42px; text-align: right; }
  /* ESCRITORIO (≥640px): con el hero en fila (anillo + cuerpo estrecho ~200px), la terna
     etiqueta·descripción·número NO cabe limpia en una línea (la descripción de 21 caracteres se
     aplastaba y el número se montaba encima). Solución: rejilla de 2 filas → número alineado a la
     derecha en la fila de la etiqueta (columna limpia, nunca se solapa) y descripción en su propia
     línea completa debajo (legible de una sola línea). Móvil (cuerpo full-width, una línea) intacto. */
  @media (min-width: 640px) {
    .dim-row {
      display: grid;
      grid-template-columns: auto 1fr auto;
      column-gap: 10px;
      row-gap: 1px;
      align-items: center;
    }
    .dim-row .dot { grid-column: 1; grid-row: 1; }
    .dim-name { grid-column: 2; grid-row: 1; width: auto; }
    .dim-val { grid-column: 3; grid-row: 1; }
    .dim-desc { grid-column: 2 / 4; grid-row: 2; }
  }

  .bignums { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .card.stat { padding: 16px 18px; display: flex; flex-direction: column; justify-content: center; }
  .card.stat .num { font-family: var(--font-display); font-size: 34px; color: var(--ink); font-weight: 500; line-height: 0.9; font-variant-numeric: tabular-nums; }
  .card.stat .num.gold { color: var(--gold); }
  /* la unidad respira con MARGEN (6px): el espacio del markup colapsa — el span de dígitos está
     vacío en el primer layout (countUp lo rellena después) y el navegador no lo recupera. */
  .card.stat .num .u { font-size: 15px; color: var(--ink-3); margin-left: 6px; }
  .card.stat .lab { font-size: 10px; color: var(--ink-3); letter-spacing: 0.08em; margin-top: 8px; }

  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .card-head.sm { margin-bottom: 12px; }
  .title { font-family: var(--font-display); font-size: 1.15rem; color: var(--ink); }
  .title.sm { font-size: 1rem; }
  .faint { font-size: 10px; color: var(--ink-3); }
  .lead { font-size: 0.86rem; color: var(--ink-2); line-height: 1.5; margin: 0 0 14px; }
  .lead .ink, .ink { color: var(--ink); }
  .ink2 { color: var(--ink-2); }

  .seg-block { margin-bottom: 12px; }
  .seg-head { display: flex; justify-content: space-between; font-size: 9px; color: var(--ink-3); letter-spacing: 0.08em; margin-bottom: 6px; }
  .segbar { height: 22px; border-radius: 6px; background: var(--surface-2); overflow: hidden; display: flex; }
  .segfill { height: 100%; animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; }
  .leg { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ink-2); }
  .sw { width: 7px; height: 7px; border-radius: 2px; }

  .histo { display: flex; align-items: flex-end; gap: 3px; height: 100px; }
  .histo.notes { height: 120px; gap: 5px; }
  /* min-width:0 → las 25 barras de décadas se comprimen para caber en el ancho de la tarjeta
     (si no, la etiqueta de cada barra fija su ancho mínimo y el histograma se desborda). */
  .hbar { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 5px; height: 100%; }
  .hfill { width: 100%; border-radius: 2px; animation: colGrow 1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .hlab { font-size: 7px; color: var(--ink-3); }
  .histo.notes .hlab { font-size: 9px; }
  .hlab.hot { color: var(--gold); }
  /* En estrecho, 25 etiquetas de década no caben horizontales → verticales (legibles, sin solape).
     El histograma de notas (1–10, sólo 10 barras) NO se rota: caben de sobra. */
  @media (max-width: 700px) {
    .histo:not(.notes) { height: 92px; padding-bottom: 20px; }
    .histo:not(.notes) .hlab {
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      letter-spacing: 0;
      line-height: 1;
      margin-top: 3px;
    }
  }
  .note { font-size: 0.78rem; color: var(--ink-2); margin: 12px 0 0; line-height: 1.5; }

  .hbars { display: flex; flex-direction: column; gap: 9px; }
  .hbar-row { display: flex; align-items: center; gap: 10px; }
  .hbar-name { font-size: 0.82rem; color: var(--ink-2); width: 76px; flex: none; }
  .hbar-name.serif { font-family: var(--font-display); font-size: 0.95rem; color: var(--ink); width: 96px; }
  .track { flex: 1; height: 9px; border-radius: 5px; background: var(--surface-2); overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .cre-n { font-size: 0.82rem; color: var(--ink-2); width: 24px; text-align: right; }
  .cre-n.gold { color: var(--gold); }

  .gap-note { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #1a1610; }
  .gap-note svg { flex: none; margin-top: 1px; }
  .gap-note span { font-size: 11px; color: var(--ink-3); line-height: 1.4; }

  /* valoraciones */
  .card.vals { overflow: hidden; }
  .dashed-top { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: repeating-linear-gradient(90deg, var(--label) 0 8px, transparent 8px 16px); opacity: 0.6; }
  .badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(138, 111, 74, 0.15); color: #c9a877; border: 1px solid rgba(138, 111, 74, 0.35); border-radius: 999px; padding: 4px 10px; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; }
  .bdot { width: 5px; height: 5px; border-radius: 50%; background: #c9a877; }
  .vals-grid { display: grid; grid-template-columns: 1fr; gap: 18px; }
  @media (min-width: 640px) { .vals-grid { grid-template-columns: 300px 1fr; gap: 28px; } .vals-left { border-right: 1px solid #1a1610; padding-right: 26px; } .vals-right { display: flex; flex-direction: column; } .histo.notes { flex: 1; } }
  .media-row { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 4px; }
  .media { font-family: var(--font-display); font-size: 46px; color: var(--ink-2); font-weight: 500; line-height: 0.85; }
  .media .ast { font-size: 20px; color: var(--ink-3); vertical-align: super; }
  .media-cap { font-size: 12px; color: var(--ink-3); line-height: 1.3; padding-bottom: 6px; }
  .tiny { font-size: 12px; color: var(--ink-3); margin: 0 0 18px; }
  .seg-head.compl { font-size: 10px; color: var(--ink-2); margin-bottom: 7px; }
  .compl-bar { height: 9px; border-radius: 5px; background: var(--surface-2); overflow: hidden; display: flex; }
  .compl-fill { background: linear-gradient(90deg, #c9883f, #e8602c); animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .compl-rest { flex: 1; background: repeating-linear-gradient(45deg, #2e2820 0 4px, #211c16 4px 8px); }

  /* skeleton / error */
  .skeleton { display: flex; flex-direction: column; gap: 14px; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes barGrow { from { width: 0; } }
  @keyframes colGrow { from { height: 0; } }
  @keyframes aura { 0%, 100% { opacity: 0.3; transform: translateX(-50%) scale(1); } 50% { opacity: 0.55; transform: translateX(-50%) scale(1.06); } }
  @keyframes glow { 0%, 100% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.28), 0 8px 30px rgba(232, 96, 44, 0.1); } 50% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.45), 0 10px 38px rgba(232, 96, 44, 0.2); } }
  @media (prefers-reduced-motion: reduce) {
    .card, .segfill, .fill, .hfill, .compl-fill, .ring circle, .aura, .card.glow { animation: none !important; }
  }
</style>
