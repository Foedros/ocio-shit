<script>
  // Pantallas 03 · Hall of Fame y 09 · Hall of Shame — PAREJA con toggle Fame⇄Shame (un solo
  // componente, esqueleto compartido). Diseño: diseno/Ocio Shit - Hall of Fame|Shame.html. Datos
  // REALES vía ocio_hall() (RPC SECURITY INVOKER) — NUNCA los de muestra del diseño (Elden Ring,
  // Morbius…). Fame = cálido/ascendente; Shame = frío/melancólico (reverso digno, no burla).
  // nota_obra = media de las valoraciones no nulas de la obra (misma regla en ambas vistas).
  import { onMount } from 'svelte';
  import { hall } from '$lib/db/supabase-data.js';

  let loading = $state(true);
  let error = $state(null);
  let h = $state(null);
  let mode = $state('fame'); // 'fame' | 'shame'

  onMount(load);
  async function load() {
    loading = true;
    error = null;
    try {
      h = await hall();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // Notación europea MANUAL. Nota: entera → "10"; con decimal → "9,5". Millares con punto.
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));
  const nota = (n) => {
    if (n == null) return '—';
    const v = Math.round(Number(n) * 10) / 10;
    return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  };

  const CAT = {
    pelicula: { l: 'Cine', c: '#C75D52' }, videojuego: { l: 'Videojuego', c: '#9580B0' },
    serie: { l: 'Serie', c: '#C9A23F' }, libro: { l: 'Libro', c: '#7E8F5B' }, comic: { l: 'Cómic', c: '#5B9298' }
  };
  const ORDER_FAME = ['pelicula', 'videojuego', 'serie', 'libro', 'comic'];
  const ORDER_SHAME = ['pelicula', 'serie', 'videojuego', 'libro', 'comic'];

  // meta line: "Cine · 2022 · vista 2010"
  const meta = (o) => {
    if (!o) return '';
    const p = [CAT[o.categoria]?.l ?? o.categoria];
    if (o.anio) p.push(o.anio);
    if (o.vista && o.vista !== o.anio) p.push('vista ' + o.vista);
    return p.join(' · ');
  };

  function group(rows) {
    const g = {};
    for (const r of rows || []) (g[r.categoria] ??= []).push(r);
    return g;
  }
  // videojuego en Shame: "pending" mientras los juegos valorados no son representativos.
  let vjPending = $derived(h ? h.vj.total > 0 && h.vj.rated / h.vj.total < 0.5 : false);

  let fameCats = $derived.by(() => {
    if (!h) return [];
    const g = group(h.top_rows);
    return ORDER_FAME.filter((c) => g[c]?.length).map((c) => {
      const rs = g[c];
      const tail = c === 'videojuego'
        ? `faltan ${fmt(h.vj.sin_valorar)} juegos por puntuar`
        : rs[0].tail > 0 ? `${fmt(rs[0].tail)} obras de 9+` : 'lo mejor de la categoría';
      return { categoria: c, top: rs[0], runners: rs.slice(1, 3), tail };
    });
  });
  let shameCats = $derived.by(() => {
    if (!h) return [];
    const g = group(h.bottom_rows);
    return ORDER_SHAME.map((c) => {
      if (c === 'videojuego' && vjPending)
        return { categoria: c, pending: true, tail: `${fmt(h.vj.sin_valorar)} sin puntuar · puntúa tus juegos para revelar este fondo` };
      const rs = g[c];
      if (!rs?.length) return null;
      const tail = rs[0].tail > 0 ? `${fmt(rs[0].tail)} obras bajo 4` : 'lo más flojo de la categoría';
      return { categoria: c, top: rs[0], runners: rs.slice(1, 3), tail };
    }).filter(Boolean);
  });

  let cumbre = $derived(h?.cumbre);
  let sima = $derived(h?.sima);
  let pct = $derived(h ? Math.round((100 * h.banner.valoradas) / h.banner.total) : 0);
  let cats = $derived(mode === 'fame' ? fameCats : shameCats);
</script>

<section class="hall {mode}">
  {#if loading}
    <div class="skeleton">{#each Array(3) as _}<div class="sk"></div>{/each}</div>
  {:else if error}
    <div class="err"><p>No se pudo cargar el salón.</p><button onclick={load}>Reintentar</button></div>
  {:else if h}
    <!-- header + toggle -->
    <header class="head">
      <div>
        <div class="eyebrow"><span class="rule"></span>{mode === 'fame' ? 'Lo mejor que has vivido' : 'Lo que no te llegó'}</div>
        <h2>Hall of {mode === 'fame' ? 'Fame' : 'Shame'}</h2>
      </div>
      <div class="toggle">
        <button class:on={mode === 'fame'} onclick={() => (mode = 'fame')}>
          {#if mode === 'shame'}<span class="arr">↑</span>{/if}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/></svg>Fame
        </button>
        <button class:on={mode === 'shame'} onclick={() => (mode = 'shame')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22V8M12 22l-4-4M12 22l4-4M5 3h14"/></svg>Shame{#if mode === 'fame'}<span class="arr"> ↓</span>{/if}
        </button>
      </div>
    </header>

    <!-- hero (cumbre/sima) + cifras -->
    <div class="herogrid">
      <article class="hero">
        <span class="halo"></span>
        <div class="cover" style="--cc:{CAT[(mode === 'fame' ? cumbre : sima)?.categoria]?.c}">
          <span>{(mode === 'fame' ? cumbre : sima)?.inicial}</span>
        </div>
        <div class="hero-body">
          <span class="badge">{mode === 'fame' ? '★ LA CUMBRE · TU NOTA MÁS ALTA' : '↓ LA SIMA · TU NOTA MÁS BAJA'}</span>
          <div class="h-title">{(mode === 'fame' ? cumbre : sima)?.titulo}</div>
          <div class="h-meta mono"><span class="dot" style="background:{CAT[(mode === 'fame' ? cumbre : sima)?.categoria]?.c}"></span>{meta(mode === 'fame' ? cumbre : sima)}</div>
          <div class="h-score">
            <span class="big">{nota((mode === 'fame' ? cumbre : sima)?.nota)}</span>
            <span class="ctx">{mode === 'fame'
              ? `una de tus ${fmt(h.fame.empate_top)} obras de ${nota(cumbre?.nota)}`
              : `una de tus ${fmt(h.shame.obras_bajo_3)} obras bajo 3`}</span>
          </div>
          {#if (mode === 'fame' ? cumbre : sima)?.quote}
            <p class="quote">“{(mode === 'fame' ? cumbre : sima).quote}”</p>
          {/if}
        </div>
      </article>

      <div class="aside">
        <article class="cifras">
          <div class="c-lab mono">{mode === 'fame' ? 'El panteón en cifras' : 'El lado en sombra'}</div>
          <div class="c-nums">
            {#if mode === 'fame'}
              <div><div class="cn acc">{fmt(h.fame.obras_de_10 > 0 ? h.fame.obras_de_10 : h.fame.obras_9plus)}</div><div class="cl mono">{h.fame.obras_de_10 > 0 ? 'OBRAS DE 10' : 'OBRAS DE 9+'}</div></div>
              <div><div class="cn">{nota(h.fame.media_top)}</div><div class="cl mono">MEDIA DEL TOP</div></div>
            {:else}
              <div><div class="cn acc">{fmt(h.shame.obras_bajo_3)}</div><div class="cl mono">OBRAS BAJO 3</div></div>
              <div><div class="cn">{nota(h.shame.media_fondo)}</div><div class="cl mono">MEDIA DEL FONDO</div></div>
            {/if}
          </div>
          <div class="c-bann mono">CONSTRUIDO SOBRE {fmt(h.banner.valoradas)} / {fmt(h.banner.total)} VALORADAS</div>
          <div class="c-bar"><div class="c-fill" style="width:{pct}%"></div></div>
          <div class="c-pct mono">{pct}%</div>
        </article>

        {#if mode === 'fame'}
          <article class="invite">
            <div class="i-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B0A0CC" stroke-width="1.6"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M7 12h4M9 10v4M15 11h.01M18 13h.01"/></svg></div>
            <div><div class="i-t">{fmt(h.vj.sin_valorar)} juegos sin valorar</div><div class="i-d">Puntúalos para completar el panteón.</div></div>
          </article>
        {:else}
          <article class="solace"><p>“No todo lo que vivimos nos marca para bien. Esto también eres tú.”</p></article>
        {/if}
      </div>
    </div>

    <!-- podios por categoría -->
    <div class="eyebrow sec"><span class="rule"></span>{mode === 'fame' ? 'Lo mejor de cada medio' : 'Lo que menos funcionó, por medio'}</div>
    <p class="sec-sub">{mode === 'fame' ? 'Cada medio es un mundo: comparamos cine con cine, no con videojuegos.' : 'Cada decepción en su contexto — sin mezclar medios.'}</p>
    <div class="podios">
      {#each cats as c (c.categoria)}
        {#if c.pending}
          <article class="podio pending">
            <div class="p-head"><span class="dot" style="background:{CAT[c.categoria].c}"></span><span class="p-cat mono">{CAT[c.categoria].l}</span></div>
            <div class="p-one">
              <div class="cover sm q">?</div>
              <div class="p-info"><div class="p-name">No evaluable aún</div><div class="p-pending">{c.tail}</div></div>
            </div>
          </article>
        {:else}
          <article class="podio">
            <div class="p-head"><span class="dot" style="background:{CAT[c.categoria].c}"></span><span class="p-cat mono">{CAT[c.categoria].l}</span></div>
            <div class="p-one">
              <div class="cover sm" style="--cc:{CAT[c.categoria].c}"><span>{c.top.inicial}</span></div>
              <div class="p-info">
                <div class="p-rank mono">{mode === 'fame' ? '№1' : 'EL FONDO'}</div>
                <div class="p-name">{c.top.titulo}</div>
                <div class="p-year mono">{c.top.anio ?? ('vista ' + (c.top.vista ?? '—'))}</div>
              </div>
              <div class="p-score">{nota(c.top.nota)}</div>
            </div>
            {#each c.runners as r}
              <div class="p-run"><span class="p-rn">{r.titulo}</span><span class="p-rs mono">{nota(r.nota)}</span></div>
            {/each}
            <div class="p-tail mono">+ {c.tail}</div>
          </article>
        {/if}
      {/each}
    </div>

    {#if mode === 'shame'}
      <p class="closing">“Toda colección honesta tiene su lado en sombra. No pasa nada por no quererlo todo.”</p>
    {/if}
  {/if}
</section>

<style>
  .hall {
    --cine: #c75d52;
    display: flex; flex-direction: column; gap: 16px; padding-bottom: 1rem;
  }
  /* paleta por modo */
  .hall.fame { --hsurf: #14110d; --hline: #211c16; --hink: #f2ebdd; --hmut: #a89f8f; --hfaint: #6e665a; --hlabel: #8a6f4a; --hacc: #f2a65a; --hacc2: #e8602c; --hherobg: linear-gradient(135deg, #1f1810, #120f0b); --hhalo: rgba(242, 166, 90, 0.2); }
  .hall.shame { --hsurf: #0c1316; --hline: #1c2528; --hink: #d6e0e4; --hmut: #7e8c91; --hfaint: #5a666b; --hlabel: #5b7a86; --hacc: #8fa6ae; --hacc2: #5b7a86; --hherobg: linear-gradient(135deg, #0c1316, #0e1518); --hhalo: rgba(91, 122, 134, 0.16); }

  .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
  .head h2 { font-family: var(--font-display); font-size: 1.9rem; color: var(--hink); margin: 4px 0 0; font-weight: 500; }
  .eyebrow { display: flex; align-items: center; gap: 8px; font-family: var(--font-data); font-size: 0.64rem; letter-spacing: 0.2em; color: var(--hlabel); text-transform: uppercase; }
  .eyebrow .rule { width: 22px; height: 1px; background: var(--hlabel); }
  .eyebrow.sec { margin-top: 8px; }
  .mono { font-family: var(--font-data); }

  .toggle { display: flex; gap: 6px; background: var(--hsurf); border: 1px solid var(--hline); border-radius: 999px; padding: 4px; }
  .toggle button { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; border-radius: 999px; padding: 8px 16px; font-size: 13px; font-weight: 600; color: var(--hfaint); cursor: pointer; font-family: inherit; }
  .toggle button.on { color: var(--on-accent); background: linear-gradient(135deg, var(--hacc), var(--hacc2)); font-weight: 700; }
  .toggle .arr { font-weight: 700; }

  .herogrid { display: grid; grid-template-columns: 1fr; gap: 16px; }
  @media (min-width: 660px) { .herogrid { grid-template-columns: 1.5fr 1fr; align-items: stretch; } }

  .hero { position: relative; overflow: hidden; background: var(--hherobg); border: 1px solid color-mix(in srgb, var(--hacc) 30%, transparent); border-radius: 20px; padding: 24px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0; animation: fadeUp 0.5s both; }
  .hall.fame .hero { animation: fadeUp 0.5s both, glowpulse 4.5s ease-in-out infinite; }
  @media (min-width: 480px) { .hero { flex-direction: row; align-items: center; text-align: left; gap: 24px; } }
  .halo { position: absolute; left: 50%; width: 240px; height: 130px; background: radial-gradient(closest-side, var(--hhalo), transparent); transform: translateX(-50%); pointer-events: none; }
  .hall.fame .halo { top: 0; animation: haloBreath 5s ease-in-out infinite; }
  .hall.shame .halo { bottom: 0; animation: haloFade 6s ease-in-out infinite; }

  .cover { position: relative; flex: none; width: 118px; height: 168px; border-radius: 10px; border: 1px solid var(--hline); display: flex; align-items: center; justify-content: center; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55); background: linear-gradient(160deg, color-mix(in srgb, var(--cc, #2c2a36) 26%, #15131b), #15131b); }
  .cover span { font-family: var(--font-display); font-size: 48px; color: var(--cc, #b0a0cc); }
  .hall.fame .cover { animation: floaty 6s ease-in-out infinite; }
  .hall.shame .cover { filter: grayscale(0.55); animation: sink 6s ease-in-out infinite; }
  .cover.sm { width: 50px; height: 70px; box-shadow: none; border-radius: 7px; animation: none; }
  .cover.sm span { font-size: 22px; }
  .hall.shame .cover.sm { filter: grayscale(0.5); }
  .cover.q { border-style: dashed; color: var(--hlabel); font-family: var(--font-display); font-size: 22px; background: var(--hsurf); }

  .hero-body { position: relative; }
  .badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 4px 12px; font-size: 10px; font-weight: 700; letter-spacing: 0.04em; }
  .hall.fame .badge { background: linear-gradient(135deg, var(--hacc), var(--hacc2)); color: var(--on-accent); }
  .hall.shame .badge { background: color-mix(in srgb, var(--hacc) 16%, transparent); color: var(--hacc); border: 1px solid color-mix(in srgb, var(--hacc) 35%, transparent); }
  .h-title { font-family: var(--font-display); font-size: 30px; color: var(--hink); margin-top: 14px; line-height: 1.05; }
  .h-meta { font-size: 11px; color: var(--hfaint); margin-top: 8px; display: flex; align-items: center; gap: 6px; justify-content: center; }
  @media (min-width: 480px) { .h-meta { justify-content: flex-start; } }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .h-score { display: flex; align-items: baseline; gap: 10px; margin-top: 12px; justify-content: center; }
  @media (min-width: 480px) { .h-score { justify-content: flex-start; } }
  .h-score .big { font-family: var(--font-display); font-size: 50px; color: var(--hacc); font-weight: 500; line-height: 1; }
  .h-score .ctx { font-size: 13px; color: var(--hfaint); }
  .quote { font-family: var(--font-display); font-style: italic; font-size: 15px; color: var(--hmut); margin-top: 12px; max-width: 320px; line-height: 1.4; }

  .aside { display: flex; flex-direction: column; gap: 16px; }
  .cifras { background: var(--hsurf); border: 1px solid var(--hline); border-radius: 18px; padding: 20px; display: flex; flex-direction: column; animation: fadeUp 0.5s both; }
  .c-lab { font-size: 10px; letter-spacing: 0.1em; color: var(--hfaint); text-transform: uppercase; margin-bottom: 12px; }
  .c-nums { display: flex; gap: 24px; margin-bottom: 14px; }
  .cn { font-family: var(--font-display); font-size: 32px; color: var(--hink); line-height: 1; }
  .cn.acc { color: var(--hacc); }
  .cl { font-size: 9px; color: var(--hfaint); letter-spacing: 0.06em; margin-top: 4px; }
  .c-bann { font-size: 10px; color: var(--hmut); letter-spacing: 0.04em; }
  .c-bar { height: 6px; border-radius: 3px; background: var(--hline); overflow: hidden; margin-top: 8px; }
  .c-fill { height: 100%; background: linear-gradient(90deg, var(--hacc2), var(--hacc)); border-radius: 3px; animation: growH 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; transform-origin: left; }
  .c-pct { align-self: flex-end; font-size: 13px; color: var(--hacc); margin-top: 6px; }

  .invite { display: flex; gap: 12px; align-items: center; background: linear-gradient(135deg, rgba(149, 128, 176, 0.1), var(--hsurf)); border: 1px dashed rgba(149, 128, 176, 0.35); border-radius: 18px; padding: 16px; animation: fadeUp 0.5s both; }
  .i-ic { width: 40px; height: 40px; border-radius: 11px; background: rgba(149, 128, 176, 0.14); display: flex; align-items: center; justify-content: center; flex: none; }
  .i-t { font-size: 14px; color: var(--hink); font-weight: 600; }
  .i-d { font-size: 12px; color: var(--hmut); margin-top: 2px; }
  .solace { background: var(--hsurf); border: 1px solid var(--hline); border-radius: 18px; padding: 18px; display: flex; align-items: center; animation: fadeUp 0.5s both; }
  .solace p { font-family: var(--font-display); font-style: italic; font-size: 15px; color: var(--hmut); line-height: 1.45; }

  .sec-sub { font-size: 12px; color: var(--hfaint); margin: 0; }
  .podios { display: grid; grid-template-columns: 1fr; gap: 14px; }
  @media (min-width: 560px) { .podios { grid-template-columns: 1fr 1fr; } }
  .podio { background: var(--hsurf); border: 1px solid var(--hline); border-radius: 16px; padding: 16px; animation: fadeUp 0.5s both; transition: transform 0.3s, border-color 0.3s; }
  .podio:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--hink) 22%, transparent); }
  .podio.pending { border-style: dashed; }
  .p-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .p-cat { font-size: 11px; letter-spacing: 0.1em; color: var(--hmut); text-transform: uppercase; }
  .p-one { display: flex; gap: 14px; align-items: center; margin-bottom: 12px; }
  .p-info { flex: 1; min-width: 0; }
  .p-rank { font-size: 9px; letter-spacing: 0.08em; color: var(--hlabel); margin-bottom: 3px; }
  .p-name { font-family: var(--font-display); font-size: 18px; color: var(--hink); line-height: 1.05; }
  .p-year { font-size: 10px; color: var(--hfaint); margin-top: 3px; }
  .p-pending { font-size: 12px; color: var(--hfaint); margin-top: 4px; line-height: 1.4; }
  .p-score { font-family: var(--font-display); font-size: 30px; color: var(--hacc); font-weight: 500; flex: none; }
  .p-run { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-top: 1px solid color-mix(in srgb, var(--hline) 70%, transparent); }
  .p-rn { font-family: var(--font-display); font-size: 14px; color: var(--hmut); }
  .p-rs { font-size: 12px; color: var(--hlabel); }
  .p-tail { font-size: 9px; color: var(--hfaint); letter-spacing: 0.04em; margin-top: 10px; padding-top: 9px; border-top: 1px solid color-mix(in srgb, var(--hline) 70%, transparent); }

  .closing { text-align: center; font-family: var(--font-display); font-style: italic; font-size: 14px; color: var(--hfaint); margin: 14px 14px 0; line-height: 1.5; }

  .skeleton { display: flex; flex-direction: column; gap: 14px; }
  .sk { height: 150px; border-radius: 18px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes growH { from { transform: scaleX(0); } }
  @keyframes floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
  @keyframes sink { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(7px); } }
  @keyframes haloBreath { 0%, 100% { opacity: 0.4; transform: translateX(-50%) scale(1); } 50% { opacity: 0.72; transform: translateX(-50%) scale(1.12); } }
  @keyframes haloFade { 0%, 100% { opacity: 0.22; transform: translateX(-50%) scale(1.05); } 50% { opacity: 0.4; transform: translateX(-50%) scale(0.95); } }
  @keyframes glowpulse { 0%, 100% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.3), 0 10px 40px rgba(232, 96, 44, 0.12); } 50% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.55), 0 14px 54px rgba(232, 96, 44, 0.26); } }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .hero, .cover, .halo, .c-fill, .podio, .cifras, .invite, .solace, .sk { animation: none !important; }
  }
</style>
