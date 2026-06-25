<script>
  // Pantalla 04 · Timeline Vital (rediseño v2, eje de por vida 2006→2026). Diseño:
  // diseno/Ocio Shit - Timeline Vital.html. EJE = fecha de la ENTRADA (cuándo se vivió), NO
  // anio_obra. Datos REALES vía ocio_timeline_macro() (volumen+mezcla por año) + ocio_timeline_year()
  // (detalle por año, bajo demanda; el cliente agrupa por mes y agrupa los votos FA en clúster).
  import { onMount } from 'svelte';
  import { timelineMacro, timelineYear } from '$lib/db/supabase-data.js';

  let loading = $state(true);
  let error = $state(null);
  let macro = $state(null);
  let selYear = $state(null);
  let yearData = $state(null);
  let yearLoading = $state(false);
  let yearErr = $state(null);
  let openVoto = $state({}); // {mes: bool} clúster de votos desplegado
  let openReal = $state({}); // {mes: bool} mes denso de reales desplegado

  onMount(loadMacro);
  async function loadMacro() {
    loading = true; error = null;
    try { macro = await timelineMacro(); } catch (e) { error = e.message; } finally { loading = false; }
  }
  async function selectYear(y) {
    if (!y) return;
    selYear = y; yearData = null; yearErr = null; yearLoading = true; openVoto = {}; openReal = {};
    try { yearData = await timelineYear(y); } catch (e) { yearErr = e.message; } finally { yearLoading = false; }
  }
  function back() { selYear = null; yearData = null; }

  // notación europea manual (no toLocaleString — ICU)
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));
  const dec = (n, k = 1) => { if (n == null) return '—'; const [i, fr] = Number(n).toFixed(k).split('.'); return k > 0 ? `${grp(i)},${fr}` : grp(i); };

  // categorías (etiqueta + color del diseño; videojuego → "Juego")
  const CATS = [
    { cat: 'pelicula', key: 'cine', l: 'Cine', c: '#C75D52' },
    { cat: 'serie', key: 'serie', l: 'Serie', c: '#C9A23F' },
    { cat: 'videojuego', key: 'vj', l: 'Juego', c: '#9580B0' },
    { cat: 'libro', key: 'libro', l: 'Libro', c: '#7E8F5B' },
    { cat: 'comic', key: 'comic', l: 'Cómic', c: '#5B9298' },
    { cat: 'ocio_libre', key: 'ocio', l: 'Ocio', c: '#C2796B' }
  ];
  const CATBY = Object.fromEntries(CATS.map((c) => [c.cat, c]));
  const MES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MABBR = ['', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const dateFmt = (f) => { if (!f) return ''; const [Y, M, D] = String(f).slice(0, 10).split('-'); return `${Number(D)} ${MABBR[Number(M)]} ${Y}`; };

  // ── macro: rango completo con huecos a 0 ──
  let byYear = $derived(new Map((macro?.anios ?? []).map((a) => [a.anio, a])));
  let years = $derived(
    macro?.rango
      ? Array.from({ length: macro.rango.max - macro.rango.min + 1 }, (_, i) => {
          const y = macro.rango.min + i;
          return byYear.get(y) ?? { anio: y, total: 0, cine: 0, serie: 0, vj: 0, libro: 0, comic: 0, ocio: 0 };
        }).reverse()
      : []
  );
  let maxTot = $derived(Math.max(1, ...years.map((a) => a.total)));
  let maxYear = $derived((macro?.anios ?? []).reduce((a, b) => (b.total > (a?.total ?? -1) ? b : a), null)?.anio);
  const segsOf = (a) => CATS.map((c) => ({ ...c, n: a[c.key] || 0 })).filter((s) => s.n > 0);

  // ── detalle del año seleccionado, agrupado por mes (desc) ──
  let months = $derived.by(() => {
    if (!yearData) return [];
    const m = new Map();
    for (const e of yearData) {
      if (!m.has(e.mes)) m.set(e.mes, { mes: e.mes, votos: [], reales: [] });
      m.get(e.mes)[e.fecha_tipo === 'fecha_voto' ? 'votos' : 'reales'].push(e);
    }
    return [...m.values()].sort((a, b) => b.mes - a.mes).map((mo) => ({ ...mo, total: mo.votos.length + mo.reales.length }));
  });
  let selMeta = $derived(byYear.get(selYear));
  let selSubtitle = $derived(selYear === maxYear ? 'Tu año más intenso.' : '');
  const votoLabel = (votos) => `${fmt(votos.length)} ${votos.every((e) => e.categoria === 'pelicula') ? 'películas' : 'obras'} votadas`;
</script>

<section class="tl">
  {#if loading}
    <div class="sk">{#each Array(8) as _}<div class="sk-row"></div>{/each}</div>
  {:else if error}
    <div class="err"><p>No se pudo cargar el timeline.</p><button onclick={loadMacro}>Reintentar</button></div>
  {:else if macro}
    {#if selYear == null}
      <!-- ══════ MACRO · la forma de tu vida ══════ -->
      <header class="head">
        <div class="eyebrow">Tu vida cultural en el tiempo · {macro.rango?.min}–{macro.rango?.max}</div>
        <h2>Timeline</h2>
        <p class="sub serif-it">La corriente del tiempo — el eje es cuándo lo viviste, no cuándo se estrenó.</p>
      </header>

      <div class="legend">
        {#each CATS.slice(0, 5) as c}
          <span class="leg"><span class="sw" style="background:{c.c}"></span>{c.l}</span>
        {/each}
      </div>

      <div class="mono col-head"><span>AÑO · VOLUMEN Y MEZCLA</span><span>Nº</span></div>
      <div class="rows">
        {#each years as a (a.anio)}
          <button class="yr" class:sel={a.anio === maxYear} disabled={a.total === 0} onclick={() => selectYear(a.anio)}>
            <span class="yl mono" class:hot={a.anio === maxYear}>{a.anio}</span>
            <span class="wrap">
              <span class="bar" style="width:{(100 * a.total) / maxTot}%">
                {#each segsOf(a) as s}<span class="seg" style="width:{(100 * s.n) / a.total}%;background:{s.c}"></span>{/each}
              </span>
            </span>
            <span class="cnt mono" class:hot={a.anio === maxYear}>{fmt(a.total)}</span>
          </button>
        {/each}
      </div>

      <button class="shelf" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E665A" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5M12 16h.01" /></svg>
        <span class="shelf-l">Sin fecha registrada <span class="mono dim">· fuera del eje</span></span>
        <span class="mono dim">{fmt(macro.sin_fecha)}</span>
      </button>
      <p class="hint mono">toca un año para entrar en el detalle</p>
    {:else}
      <!-- ══════ DETALLE · zoom a un año ══════ -->
      <button class="backbtn mono" onclick={back}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6" /></svg>
        VOLVER A LA FORMA
      </button>
      <div class="yhead">
        <span class="ynum">{selYear}</span>
        <span class="ycount mono">{fmt(selMeta?.total ?? yearData?.length ?? 0)} entradas</span>
        {#if selSubtitle}<span class="ysub serif-it">· {selSubtitle}</span>{/if}
      </div>
      {#if selMeta}
        <div class="ymix">
          {#each segsOf(selMeta) as s}<span style="width:{(100 * s.n) / selMeta.total}%;background:{s.c}"></span>{/each}
        </div>
        <div class="ycifras">
          {#each segsOf(selMeta) as s}
            <span class="cif"><span class="dot2" style="background:{s.c}"></span>{s.l} <b>{dec((100 * s.n) / selMeta.total, 0)}%</b></span>
          {/each}
        </div>
      {/if}

      {#if yearLoading}
        <div class="sk">{#each Array(4) as _}<div class="sk-row"></div>{/each}</div>
      {:else if yearErr}
        <div class="err"><p>No se pudo cargar {selYear}.</p><button onclick={() => selectYear(selYear)}>Reintentar</button></div>
      {:else}
        <div class="river">
          <div class="spine"></div>
          {#each months as mo (mo.mes)}
            <div class="mmark">
              <span class="mname serif-it">{MES[mo.mes]} {selYear}</span>
              <span class="mline"></span>
              <span class="mcount mono">{fmt(mo.total)}</span>
            </div>

            {#if mo.votos.length}
              <div class="ev">
                <span class="node voto"></span>
                <div class="card cluster">
                  <div class="cl-top">
                    <div class="peek">
                      {#each mo.votos.slice(0, 3) as _, i}<span class="thumb" style="margin-left:{i ? -10 : 0}px"></span>{/each}
                      {#if mo.votos.length > 3}<span class="thumb more" style="margin-left:-10px">+{mo.votos.length - 3}</span>{/if}
                    </div>
                    <span class="cl-title serif">{votoLabel(mo.votos)} en FilmAffinity</span>
                  </div>
                  <div class="approx mono"><span class="dashdot"></span>FECHA DE VOTO (APROX.) · no necesariamente vistas este mes</div>
                  {#if openVoto[mo.mes]}
                    <ul class="votolist">
                      {#each mo.votos as e (e.id)}
                        <li><span class="vt">{e.titulo}</span><span class="vmeta mono">{CATBY[e.categoria]?.l} · {dateFmt(e.fecha)}{e.valoracion != null ? ` · ${dec(e.valoracion)}` : ''}</span></li>
                      {/each}
                    </ul>
                  {/if}
                  <button class="expand" onclick={() => (openVoto = { ...openVoto, [mo.mes]: !openVoto[mo.mes] })}>
                    {openVoto[mo.mes] ? 'Ocultar' : `Desplegar las ${fmt(mo.votos.length)}`}
                  </button>
                </div>
              </div>
            {/if}

            {#each (openReal[mo.mes] ? mo.reales : mo.reales.slice(0, 25)) as e (e.id)}
              <div class="ev">
                <span class="node" style="background:{CATBY[e.categoria]?.c ?? '#A89F8F'};box-shadow:0 0 0 3px {(CATBY[e.categoria]?.c ?? '#888') + '2e'}"></span>
                <div class="card entry">
                  <span class="cover serif" style="color:{CATBY[e.categoria]?.c}">{(e.titulo || '·').trim().charAt(0).toUpperCase()}</span>
                  <div class="ebody">
                    <div class="etop"><span class="etitle serif">{e.titulo}</span>{#if e.valoracion != null}<span class="enota mono">{dec(e.valoracion)}</span>{/if}</div>
                    <div class="emeta mono">
                      <span style="color:{CATBY[e.categoria]?.c}">●</span> {CATBY[e.categoria]?.l ?? e.categoria} · {dateFmt(e.fecha)}{#if e.anio_obra} · <span class="obrayr">obra de {e.anio_obra}{e.categoria === 'pelicula' && selYear - e.anio_obra >= 25 ? ` — vista ${selYear - e.anio_obra} años después` : ''}</span>{/if}
                    </div>
                    <div class="real mono"><span class="realdot"></span>VISIONADO REAL</div>
                  </div>
                </div>
              </div>
            {/each}
            {#if mo.reales.length > 25 && !openReal[mo.mes]}
              <button class="morereal mono" onclick={() => (openReal = { ...openReal, [mo.mes]: true })}>y {fmt(mo.reales.length - 25)} visionados más en {MES[mo.mes]}</button>
            {/if}
          {/each}
          {#if !months.length}<p class="empty mono">{selYear} no tiene entradas con fecha.</p>{/if}
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .tl { display: flex; flex-direction: column; padding-bottom: 1.5rem; }
  .head h2 { font-size: 1.7rem; color: var(--ink); margin: 2px 0 0; }
  .eyebrow { font-family: var(--font-data); font-size: 0.66rem; letter-spacing: 0.12em; color: var(--ink-3); text-transform: uppercase; }
  .sub { margin: 4px 0 14px; }
  .serif-it { font-family: var(--font-display); font-style: italic; color: var(--ink-2); }
  .serif { font-family: var(--font-display); }
  .mono { font-family: var(--font-data); }
  .dim { color: var(--ink-3); }

  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-bottom: 16px; }
  .leg { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; color: var(--ink-2); }
  .sw { width: 8px; height: 8px; border-radius: 2px; }

  .col-head { display: flex; justify-content: space-between; font-size: 0.6rem; letter-spacing: 0.1em; color: var(--ink-3); margin-bottom: 8px; text-transform: uppercase; }
  .rows { display: flex; flex-direction: column; }
  .yr { display: flex; align-items: center; gap: 10px; padding: 4px 4px; cursor: pointer; border: none; background: none; border-radius: 7px; width: 100%; text-align: left; transition: background 0.2s, transform 0.2s; }
  .yr:not(:disabled):hover { background: #14110d; transform: translateX(2px); }
  .yr:disabled { cursor: default; opacity: 0.55; }
  .yl { font-size: 0.72rem; width: 36px; flex: none; color: var(--ink-3); }
  .yl.hot, .cnt.hot { color: var(--gold); }
  .wrap { flex: 1; height: 16px; border-radius: 4px; overflow: hidden; background: #120f0b; }
  .bar { height: 100%; display: flex; border-radius: 4px; overflow: hidden; transform-origin: left; animation: growH 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .yr.sel .bar { box-shadow: 0 0 0 1.5px rgba(242, 166, 90, 0.55); }
  .seg { height: 100%; }
  .cnt { font-size: 0.7rem; width: 34px; flex: none; text-align: right; color: var(--ink-3); }

  .shelf { margin-top: 16px; background: #100e0b; border: 1px dashed var(--line-strong); border-radius: 12px; padding: 13px 14px; display: flex; align-items: center; gap: 10px; width: 100%; color: var(--ink-2); cursor: default; }
  .shelf-l { flex: 1; text-align: left; font-size: 0.82rem; }
  .hint { text-align: center; font-size: 0.62rem; color: var(--ink-3); margin: 14px 0 0; }

  /* ── detalle ── */
  .backbtn { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; color: var(--ink-2); font-size: 0.66rem; letter-spacing: 0.1em; cursor: pointer; padding: 0 0 10px; align-self: flex-start; }
  .yhead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; animation: fadeUp 0.5s both; }
  .ynum { font-family: var(--font-display); font-size: 2.4rem; color: var(--ink); font-weight: 500; line-height: 1; }
  .ycount { font-size: 0.82rem; color: var(--gold); }
  .ysub { font-size: 0.95rem; }
  .ymix { height: 8px; border-radius: 4px; overflow: hidden; display: flex; margin: 12px 0 10px; background: #120f0b; max-width: 480px; }
  .ymix span { height: 100%; }
  .ycifras { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-bottom: 20px; }
  .cif { display: flex; align-items: center; gap: 6px; font-size: 0.78rem; color: var(--ink-2); }
  .cif b { color: var(--ink); font-family: var(--font-data); font-weight: 500; }
  .dot2 { width: 7px; height: 7px; border-radius: 50%; }

  .river { position: relative; padding-left: 4px; }
  .spine { position: absolute; left: 13px; top: 4px; bottom: 0; width: 2px; background: linear-gradient(#c75d52, #2e2820); transform-origin: top; animation: growline 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .mmark { display: flex; align-items: center; gap: 10px; margin: 10px 0 12px; padding-left: 36px; }
  .mname { font-size: 0.9rem; white-space: nowrap; }
  .mline { flex: 1; height: 1px; background: #1a1610; }
  .mcount { font-size: 0.6rem; color: var(--ink-3); }

  .ev { display: flex; gap: 14px; margin-bottom: 12px; position: relative; animation: fadeUp 0.45s both; }
  .node { width: 12px; height: 12px; border-radius: 50%; flex: none; margin-left: 8px; margin-top: 16px; z-index: 1; animation: dotpop 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .node.voto { background: transparent; border: 1.5px dashed #8a6f4a; box-shadow: none; }
  .card { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; transition: transform 0.25s, border-color 0.25s, background 0.25s; }
  .card.entry { display: flex; gap: 12px; }
  .card.entry:hover, .card.cluster:hover { transform: translateX(3px); border-color: var(--hairline-plus); }

  .cl-top { display: flex; align-items: center; gap: 12px; }
  .peek { display: flex; flex: none; }
  .thumb { width: 30px; height: 42px; border-radius: 4px; background: linear-gradient(160deg, #3a2f24, #241d16); border: 1px solid var(--line-strong); }
  .thumb.more { background: #1b1712; display: flex; align-items: center; justify-content: center; font-family: var(--font-data); font-size: 0.6rem; color: var(--ink-2); }
  .cl-title { font-size: 1rem; color: var(--ink); line-height: 1.15; }
  .approx { display: flex; align-items: center; gap: 6px; font-size: 0.56rem; color: var(--ink-3); margin-top: 10px; letter-spacing: 0.04em; }
  .dashdot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px dashed #8a6f4a; flex: none; }
  .expand { margin-top: 10px; background: transparent; border: 1px solid var(--line-strong); color: var(--ink-2); border-radius: 999px; padding: 7px 14px; font-size: 0.74rem; font-weight: 600; font-family: var(--font-text); cursor: pointer; }
  .expand:hover { border-color: var(--hairline-plus); color: var(--ink); }
  .votolist { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 280px; overflow-y: auto; }
  .votolist li { display: flex; justify-content: space-between; gap: 10px; font-size: 0.78rem; color: var(--ink-2); border-top: 1px solid #1a1610; padding-top: 6px; }
  .votolist .vt { color: var(--ink); }
  .vmeta { font-size: 0.6rem; color: var(--ink-3); white-space: nowrap; }

  .cover { width: 40px; height: 58px; border-radius: 6px; background: linear-gradient(160deg, #241d18, #161210); flex: none; display: flex; align-items: center; justify-content: center; border: 1px solid var(--line-strong); font-size: 1.1rem; }
  .ebody { flex: 1; min-width: 0; }
  .etop { display: flex; justify-content: space-between; gap: 8px; }
  .etitle { font-size: 1rem; color: var(--ink); line-height: 1.1; }
  .enota { font-size: 0.82rem; color: var(--gold); flex: none; }
  .emeta { font-size: 0.6rem; color: var(--ink-3); margin-top: 5px; line-height: 1.4; }
  .obrayr { color: var(--label); }
  .real { display: flex; align-items: center; gap: 5px; font-size: 0.54rem; color: var(--ink-3); margin-top: 6px; letter-spacing: 0.03em; }
  .realdot { width: 7px; height: 7px; border-radius: 50%; background: #7fb2b8; }
  .morereal { background: none; border: none; color: var(--ink-3); font-size: 0.66rem; cursor: pointer; padding: 0 0 12px 36px; text-align: left; }
  .empty { color: var(--ink-3); padding: 1rem 0; }

  .sk { display: flex; flex-direction: column; gap: 8px; }
  .sk-row { height: 26px; border-radius: 6px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes growH { from { transform: scaleX(0); } }
  @keyframes growline { from { transform: scaleY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes dotpop { 0% { transform: scale(0); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) { .bar, .spine, .ev, .node, .sk-row { animation: none !important; } }
</style>
