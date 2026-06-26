<script>
  // Pantalla 05 · Wrapped — el anuario que se SELLA. Diseño: diseno/Ocio Shit - Wrapped.html. Tres
  // estados: ARCHIVO (años) · ANTESALA (año en curso) · SELLADO (7 stories deslizables). Eje = FECHA
  // DE ENTRADA (como Timeline). Datos REALES vía ocio_wrapped_years()/ocio_wrapped(year). El sellado
  // se DERIVA de la fecha (año < actual). Honestidad: "año de actividad (registro+consumo)", no "esto
  // viviste". NO compartible (decisión: archivo íntimo) → sin botón de compartir. Solo lectura.
  import { onMount } from 'svelte';
  import { wrappedYears, wrapped } from '$lib/db/supabase-data.js';

  let loading = $state(true);
  let error = $state(null);
  let yd = $state(null); // { actual, years, antesala }
  let mode = $state('archivo'); // archivo | antesala | stories
  let w = $state(null); // anuario del año abierto
  let wLoading = $state(false);
  let storyIdx = $state(0);
  let progress = $state(0); // 0..1 del segmento actual
  let paused = $state(false);

  const STORIES = ['portada', 'volumen', 'cumbre', 'generos', 'personaje', 'mes', 'cierre'];

  onMount(load);
  async function load() {
    loading = true; error = null;
    try { yd = await wrappedYears(); } catch (e) { error = e.message; } finally { loading = false; }
  }

  async function openYear(anio) {
    wLoading = true; mode = 'stories'; storyIdx = 0; progress = 0; paused = false;
    try { w = await wrapped(anio); } catch (e) { error = e.message; mode = 'archivo'; } finally { wLoading = false; }
  }
  function toArchivo() { mode = 'archivo'; w = null; }

  // ── autoplay tipo stories (≈7s/card; mantener pulsado pausa; tap navega) ──
  $effect(() => {
    if (mode !== 'stories' || paused || wLoading || !w) return;
    const id = setInterval(() => {
      if (storyIdx >= STORIES.length - 1 && progress >= 1) return; // última: se queda
      progress = Math.min(1, progress + 1 / 140);
      if (progress >= 1 && storyIdx < STORIES.length - 1) { progress = 0; storyIdx++; }
    }, 50);
    return () => clearInterval(id);
  });
  function next() { if (storyIdx < STORIES.length - 1) { storyIdx++; progress = 0; } else toArchivo(); }
  function prev() { if (storyIdx > 0) { storyIdx--; progress = 0; } else toArchivo(); }

  // Notación europea manual
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));
  const num = (n) => { if (n == null) return '—'; const v = Math.round(Number(n) * 10) / 10; return Number.isInteger(v) ? String(v) : String(v).replace('.', ','); };

  const CAT = { pelicula: { l: 'Cine', c: '#C75D52' }, videojuego: { l: 'Videojuego', c: '#9580B0' }, serie: { l: 'Serie', c: '#C9A23F' }, libro: { l: 'Libro', c: '#7E8F5B' }, comic: { l: 'Cómic', c: '#5B9298' }, ocio_libre: { l: 'Ocio libre', c: '#8A6F4A' } };
  const MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MABBR = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const GEN_LABEL = { accion: 'Acción', aventura: 'Aventura', animacion: 'Animación', comedia: 'Comedia', 'ciencia-ficcion': 'Ciencia ficción', belica: 'Bélica', musica: 'Música', simulacion: 'Simulación', rol: 'Rol', 'multijugador-masivo': 'Multijugador masivo' };
  const genLabel = (s) => GEN_LABEL[s] || (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : '');

  let years = $derived(yd?.years ?? []);
  let sealed = $derived(years.filter((y) => y.sellado));
  let antesala = $derived(yd?.antesala);
  let antMezclaTot = $derived(antesala ? (antesala.mezcla ?? []).reduce((s, m) => s + m.obras, 0) : 0);

  // derivados del anuario abierto
  let vol = $derived(w?.volumen ?? []);
  let volMax = $derived(Math.max(1, ...vol.map((v) => v.obras)));
  let cadencia = $derived(w && w.meses_activos ? Math.round(w.total_obras / w.meses_activos) : 0);
  let cumbre = $derived(w?.cumbre);
  let gen = $derived(w?.generos ?? []);
  let histo = $derived(w?.histograma ?? []);
  let histoMax = $derived(Math.max(1, ...histo.map((h) => h.n)));
  let mesCumbre = $derived(w?.mes_cumbre);
  let cumbreSub = $derived(
    !cumbre ? '' : w.empate > 1 ? `una de tus ${fmt(w.empate)} obras de ${num(cumbre.nota)} este año` : `tu nota más alta de ${w.anio}`
  );
</script>

<section class="wrapped">
  {#if loading}
    <div class="skeleton"><div class="sk big"></div></div>
  {:else if error && mode === 'archivo'}
    <div class="err"><p>No se pudo cargar el anuario.</p><button onclick={load}>Reintentar</button></div>

  {:else if mode === 'archivo'}
    <!-- ===== ESTADO 3 · ARCHIVO DE AÑOS ===== -->
    <header class="ar-head"><div class="eyebrow mono">Tus anuarios</div><h2>El archivo</h2></header>
    {#if antesala}
      <button class="warc pending" onclick={() => (mode = 'antesala')}>
        <span class="p-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>
        <span class="p-body"><span class="p-y">{antesala.anio}</span><span class="p-d">En curso · se sella en {fmt(antesala.dias_para_sellar)} días</span></span>
        <span class="arrow mono">→</span>
      </button>
    {/if}
    {#each sealed as y, i (y.anio)}
      <button class="warc sealed" class:nuevo={i === 0} onclick={() => openYear(y.anio)}>
        <span class="halo"></span>
        <div class="s-row">
          <span class="s-year">{y.anio}</span>
          {#if i === 0}<span class="badge">★ NUEVO</span>{/if}
        </div>
        <div class="s-nums">
          <div><div class="s-v gold">{fmt(y.obras)}</div><div class="s-l mono">OBRAS</div></div>
        </div>
        <div class="s-open mono">ABRIR ANUARIO →</div>
      </button>
    {/each}
    <div class="ar-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <span>El año en curso se sella cada 31 de diciembre y se añade a este estante. Un anuario sellado es fijo: refleja todo lo que tenga fecha de entrada en ese año.</span>
    </div>

  {:else if mode === 'antesala'}
    <!-- ===== ESTADO 1 · ANTESALA (año en curso) ===== -->
    <button class="back mono" onclick={toArchivo}>← El archivo</button>
    <div class="antesala">
      <div class="an-eyebrow mono">El anuario</div>
      <div class="an-title">Wrapped</div>
      <div class="an-ring">
        <span class="aura"></span>
        <svg viewBox="0 0 230 230"><circle cx="115" cy="115" r="102" fill="none" stroke="#1a1610" stroke-width="3"/><circle cx="115" cy="115" r="102" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-dasharray="641" stroke-dashoffset={641 * (1 - (365 - antesala.dias_para_sellar) / 365)}/></svg>
        <div class="an-ring-c"><span class="an-rl mono">SE SELLA EN</span><span class="an-rn">{fmt(antesala.dias_para_sellar)}</span><span class="an-ru mono">días</span></div>
      </div>
      <div class="an-msg">Tu <em>{antesala.anio}</em> se está escribiendo solo.</div>
      <div class="an-sub">El 31 de diciembre se sella y se convierte en un anuario que ya no cambia. Hasta entonces, sigue registrando.</div>
      <div class="an-teaser">
        <div class="t-head mono"><span>{antesala.anio} hasta hoy</span><span class="faint">SIN SPOILERS</span></div>
        <div class="t-row">
          <div class="t-n"><span class="t-num">{fmt(antesala.obras)}</span><span class="t-u">obras</span></div>
          <div class="t-bar">
            {#each antesala.mezcla as m}<span class="t-seg" style="width:{(100 * m.obras) / (antMezclaTot || 1)}%;background:{CAT[m.categoria]?.c}"></span>{/each}
          </div>
        </div>
      </div>
    </div>

  {:else if mode === 'stories'}
    <!-- ===== ESTADO 2 · WRAPPED SELLADO (stories) ===== -->
    <div class="stage">
      {#if wLoading || !w}
        <div class="story loading-story"><div class="sp"></div></div>
      {:else}
        <div class="story" class:s-portada={storyIdx === 0} class:s-cumbre={storyIdx === 2} class:s-cierre={storyIdx === 6}
          onpointerdown={() => (paused = true)} onpointerup={() => (paused = false)} onpointerleave={() => (paused = false)}>
          <!-- progress bar -->
          <div class="pbar">
            {#each STORIES as _, i}
              <span class="pseg"><span class="pfill" style="width:{i < storyIdx ? 100 : i === storyIdx ? progress * 100 : 0}%"></span></span>
            {/each}
          </div>
          <!-- tap zones -->
          <button class="tap left" aria-label="anterior" onclick={prev}></button>
          <button class="tap right" aria-label="siguiente" onclick={next}></button>
          <button class="closeb" aria-label="cerrar" onclick={toArchivo}>✕</button>

          <div class="story-in">
            {#if storyIdx === 0}
              <div class="eyebrow mono spaced">Ocio Shit · Anuario</div>
              <div class="big-year">{w.anio}</div>
              <div class="serif-it gold">El año que viviste así.</div>
              <div class="honesty mt-auto"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7FB2B8" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span class="mono">AÑO DE ACTIVIDAD · registro + consumo</span></div>
              <div class="hint">mantén pulsado para pausar · toca para avanzar</div>
            {:else if storyIdx === 1}
              <div class="eyebrow mono">Tu año en</div>
              <div class="vol-num"><span class="big">{fmt(w.total_obras)}</span><span class="u">obras</span></div>
              <div class="serif-it">una media de {fmt(cadencia)} al mes.</div>
              <div class="vol-list">
                {#each vol as v}
                  <div class="vrow"><div class="vtop"><span><span class="dot" style="background:{CAT[v.categoria]?.c}"></span>{CAT[v.categoria]?.l ?? v.categoria}</span><span class="mono">{fmt(v.obras)}</span></div><div class="vtrack"><div class="vfill" style="width:{(100 * v.obras) / volMax}%;background:{CAT[v.categoria]?.c}"></div></div></div>
                {/each}
              </div>
            {:else if storyIdx === 2}
              <div class="eyebrow mono spaced">Tu cumbre del año</div>
              {#if cumbre}
                <div class="cu-cover" style="--cc:{CAT[cumbre.categoria]?.c}">{cumbre.inicial}</div>
                <div class="cu-name">{cumbre.titulo}</div>
                <div class="cu-meta mono"><span class="dot" style="background:{CAT[cumbre.categoria]?.c}"></span>{CAT[cumbre.categoria]?.l ?? cumbre.categoria} · NOTA MÁXIMA</div>
                <div class="cu-nota">{num(cumbre.nota)}</div>
                <div class="serif-it">{cumbreSub}.</div>
              {:else}
                <div class="cu-name">Sin obras valoradas este año</div>
              {/if}
            {:else if storyIdx === 3}
              <div class="eyebrow mono">Tu año sonó a</div>
              <div class="gen-top">{genLabel(gen[0]?.nombre)}</div>
              {#if gen.length > 1}<div class="serif-it">seguido de cerca por {genLabel(gen[1]?.nombre)}{#if gen[2]} y {genLabel(gen[2]?.nombre)}{/if}.</div>{/if}
              <div class="gen-chips">
                {#each gen.slice(0, 5) as g, i}<span class="gchip" style="font-size:{30 - i * 3}px">{genLabel(g.nombre)}</span>{/each}
              </div>
              <div class="gen-foot mono">{fmt(w.generos_distintos)} GÉNEROS DISTINTOS EN {w.anio}</div>
            {:else if storyIdx === 4}
              <div class="eyebrow mono spaced">El personaje de tu año</div>
              {#if w.personaje}
                <div class="pe-av">{w.personaje.inicial}</div>
                <div class="pe-name">{w.personaje.nombre}</div>
                <div class="pe-n mono">PRESENTE EN <span class="gold">{fmt(w.personaje.n)} OBRAS</span> ESTE AÑO</div>
              {:else}
                <div class="pe-name">Sin creador destacado</div>
              {/if}
              <div class="honesty mt-auto"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7FB2B8" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>Cuenta lo que <b>catalogaste</b> en {w.anio} — no siempre lo que viviste por primera vez este año.</span></div>
            {:else if storyIdx === 5}
              <div class="eyebrow mono">Tu mes más intenso</div>
              <div class="mes-name">{MES[(mesCumbre?.mes ?? 1) - 1]}</div>
              <div class="mes-n"><span class="gold">{fmt(mesCumbre?.n)}</span> obras ese mes</div>
              <div class="mes-bars">
                {#each histo as h}<div class="mbar" style="height:{Math.max(4, (100 * h.n) / histoMax)}%" class:peak={h.mes === mesCumbre?.mes}></div>{/each}
              </div>
              <div class="mes-axis mono">{#each MABBR as a}<span>{a}</span>{/each}</div>
            {:else if storyIdx === 6}
              <div class="eyebrow mono spaced">Tu {w.anio}, en una línea</div>
              <div class="cierre-line">{fmt(w.total_obras)} obras{#if cumbre}, con {cumbre.titulo} en la cima{/if} y un {MES[(mesCumbre?.mes ?? 1) - 1]} imparable.</div>
              <div class="cierre-chips">
                {#if vol[0]}<span class="cchip mono">{CAT[vol[0].categoria]?.l?.toUpperCase()} {fmt(vol[0].obras)}</span>{/if}
                {#if gen[0]}<span class="cchip mono">{genLabel(gen[0].nombre).toUpperCase()}</span>{/if}
                {#if w.personaje}<span class="cchip mono">{w.personaje.nombre}</span>{/if}
              </div>
              <div class="cierre-actions"><button class="guardar" onclick={toArchivo}>Guardar en el archivo</button></div>
              <div class="sellado mono">SELLADO EL 31·DIC·{w.anio}</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .wrapped { display: flex; flex-direction: column; gap: 12px; padding-bottom: 1rem; }
  .mono { font-family: var(--font-data); }
  .eyebrow { font-size: 0.64rem; letter-spacing: 0.14em; color: var(--label); text-transform: uppercase; }
  .eyebrow.spaced { letter-spacing: 0.24em; }
  .gold { color: var(--gold) !important; }
  .faint { color: var(--ink-3); }
  .arrow { font-size: 16px; color: var(--label); }
  .serif-it { font-family: var(--font-display); font-style: italic; color: var(--ink-2); }

  /* ── archivo ── */
  .ar-head h2 { font-family: var(--font-display); font-size: 1.7rem; color: var(--ink); margin: 2px 0 0; font-weight: 500; }
  .warc { display: block; width: 100%; text-align: left; border-radius: 18px; padding: 18px; cursor: pointer; font: inherit; color: inherit; animation: fadeUp 0.4s both; transition: transform 0.35s, border-color 0.35s; }
  .warc:hover { transform: translateY(-3px); }
  .warc.pending { display: flex; align-items: center; gap: 16px; background: #100e0b; border: 1px dashed var(--line-strong); }
  .warc.pending:hover { border-color: #433b30; }
  .p-ic { width: 50px; height: 50px; border-radius: 12px; border: 1px dashed var(--line-strong); display: flex; align-items: center; justify-content: center; flex: none; }
  .p-body { flex: 1; }
  .p-y { display: block; font-family: var(--font-display); font-size: 22px; color: var(--ink-2); }
  .p-d { font-size: 12px; color: var(--ink-3); }
  .warc.sealed { position: relative; overflow: hidden; background: linear-gradient(135deg, #2a1c14, var(--surface)); border: 1px solid rgba(242, 166, 90, 0.3); }
  .warc.sealed:hover { border-color: rgba(242, 166, 90, 0.5); }
  .warc.sealed .halo { position: absolute; top: -30px; right: -20px; width: 160px; height: 160px; background: radial-gradient(closest-side, rgba(242, 166, 90, 0.18), transparent); pointer-events: none; }
  .s-row { display: flex; justify-content: space-between; align-items: flex-start; position: relative; }
  .s-year { font-family: var(--font-display); font-size: 38px; color: var(--ink); font-weight: 500; line-height: 0.9; }
  .badge { display: inline-flex; align-items: center; gap: 5px; background: linear-gradient(135deg, var(--gold), var(--accent)); color: var(--on-accent); border-radius: 999px; padding: 4px 10px; font-size: 9px; font-weight: 700; letter-spacing: 0.04em; }
  .s-nums { display: flex; gap: 18px; margin-top: 14px; }
  .s-v { font-family: var(--font-display); font-size: 22px; }
  .s-l { font-size: 9px; color: var(--label); letter-spacing: 0.08em; }
  .s-open { font-size: 11px; color: var(--gold); margin-top: 14px; }
  .ar-note { display: flex; align-items: flex-start; gap: 9px; padding: 12px 4px; }
  .ar-note svg { flex: none; margin-top: 1px; }
  .ar-note span { font-size: 12px; color: var(--ink-3); line-height: 1.5; }

  /* ── antesala ── */
  .back { background: none; border: none; color: var(--ink-2); cursor: pointer; font-size: 0.8rem; padding: 0.3rem 0; text-align: left; align-self: flex-start; }
  .antesala { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 8px 0; animation: fadeUp 0.5s both; }
  .an-eyebrow { font-size: 11px; letter-spacing: 0.12em; color: var(--ink-3); text-transform: uppercase; }
  .an-title { font-family: var(--font-display); font-size: 27px; color: var(--ink); font-weight: 500; margin: 2px 0 22px; }
  .an-ring { position: relative; width: 230px; height: 230px; margin-bottom: 24px; }
  .an-ring .aura { position: absolute; inset: -6px; border-radius: 50%; background: radial-gradient(closest-side, rgba(242, 166, 90, 0.16), transparent); animation: aura 6s ease-in-out infinite; }
  .an-ring svg { transform: rotate(-90deg); }
  .an-ring svg circle:last-child { animation: ringdraw 1.6s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .an-ring-c { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .an-rl { font-size: 10px; color: var(--label); letter-spacing: 0.16em; }
  .an-rn { font-family: var(--font-display); font-size: 62px; color: var(--ink); font-weight: 500; line-height: 0.9; margin-top: 6px; }
  .an-ru { font-size: 11px; color: var(--ink-2); letter-spacing: 0.1em; margin-top: 4px; }
  .an-msg { font-family: var(--font-display); font-size: 25px; color: var(--ink); line-height: 1.25; }
  .an-msg em { font-style: italic; color: var(--gold); }
  .an-sub { font-size: 14px; color: var(--ink-2); line-height: 1.5; margin-top: 12px; max-width: 340px; }
  .an-teaser { width: 100%; max-width: 360px; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px 18px; margin-top: 24px; }
  .t-head { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.1em; color: var(--ink-3); text-transform: uppercase; margin-bottom: 12px; }
  .t-row { display: flex; align-items: flex-end; gap: 14px; }
  .t-num { font-family: var(--font-display); font-size: 34px; color: var(--ink); font-weight: 500; }
  .t-u { font-size: 12px; color: var(--ink-2); margin-left: 5px; }
  .t-bar { flex: 1; height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; display: flex; margin-bottom: 7px; }
  .t-seg { height: 100%; animation: barGrow 1.1s ease both; }

  /* ── stories ── */
  .stage { display: flex; justify-content: center; }
  .story { position: relative; width: 100%; max-width: 420px; aspect-ratio: 360 / 740; max-height: calc(100vh - 160px); border-radius: 28px; overflow: hidden; border: 1px solid var(--line-strong); background: radial-gradient(120% 80% at 50% 12%, #2a1c14 0%, var(--bg) 60%); user-select: none; touch-action: manipulation; }
  .story.s-cumbre { background: radial-gradient(120% 70% at 50% 30%, #1f1a2b 0%, var(--bg) 62%); }
  .story.s-cierre { background: radial-gradient(130% 90% at 50% 50%, #2a1c14 0%, var(--bg) 66%); border-color: rgba(242, 166, 90, 0.25); }
  .loading-story { display: flex; align-items: center; justify-content: center; }
  .sp { width: 32px; height: 32px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--gold); animation: spin 0.8s linear infinite; }
  .pbar { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; gap: 5px; z-index: 4; }
  .pseg { flex: 1; height: 3px; border-radius: 2px; background: #3a3327; overflow: hidden; }
  .pfill { display: block; height: 100%; background: var(--gold); border-radius: 2px; }
  .tap { position: absolute; top: 0; bottom: 0; z-index: 3; background: none; border: none; cursor: pointer; padding: 0; }
  .tap.left { left: 0; width: 33%; }
  .tap.right { left: 33%; right: 0; width: 67%; }
  .closeb { position: absolute; top: 28px; right: 16px; z-index: 5; background: rgba(11, 10, 8, 0.4); border: none; color: var(--ink-2); width: 26px; height: 26px; border-radius: 50%; cursor: pointer; font-size: 12px; }
  .story-in { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 48px 30px 32px; pointer-events: none; }
  .story-in :global(button) { pointer-events: auto; }
  .mt-auto { margin-top: auto; }
  .hint { font-size: 11px; color: var(--ink-3); margin-top: 10px; }
  .honesty { display: flex; align-items: flex-start; gap: 8px; text-align: left; background: rgba(91, 146, 152, 0.1); border: 1px solid rgba(91, 146, 152, 0.26); border-radius: 12px; padding: 11px 13px; }
  .honesty span { font-size: 10px; color: #7fb2b8; line-height: 1.45; font-family: var(--font-data); letter-spacing: 0.02em; }
  .honesty b { color: #9fcdd2; }

  .big-year { font-family: var(--font-display); font-size: 92px; color: var(--ink); font-weight: 500; line-height: 0.86; margin: 14px 0; animation: popIn 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .s-portada .serif-it { font-size: 21px; }
  /* volumen */
  .story-in .eyebrow { animation: fadeUp 0.5s both; }
  .vol-num { display: flex; align-items: flex-end; gap: 10px; margin: 4px 0; }
  .vol-num .big { font-family: var(--font-display); font-size: 80px; color: var(--ink); font-weight: 500; line-height: 0.82; animation: popIn 0.7s both; }
  .vol-num .u { font-size: 16px; color: var(--ink-2); padding-bottom: 12px; }
  .story-in.vol { justify-content: center; }
  .vol-list { width: 100%; margin-top: 26px; display: flex; flex-direction: column; gap: 12px; }
  .vrow .vtop { display: flex; justify-content: space-between; font-size: 13px; color: var(--ink); margin-bottom: 5px; align-items: center; }
  .vrow .vtop .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 5px; }
  .vrow .vtop .mono { color: var(--ink-2); }
  .vtrack { height: 9px; border-radius: 5px; background: #1a1610; overflow: hidden; }
  .vfill { height: 100%; border-radius: 5px; animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .dot { flex: none; }
  /* cumbre */
  .cu-cover { width: 134px; height: 190px; border-radius: 12px; background: linear-gradient(160deg, color-mix(in srgb, var(--cc) 26%, #15131b), #15131b); border: 1px solid var(--line-strong); display: flex; align-items: center; justify-content: center; margin: 20px 0 16px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55); font-family: var(--font-display); font-size: 58px; color: var(--cc, #b0a0cc); animation: floaty 6s ease-in-out infinite; }
  .cu-name { font-family: var(--font-display); font-size: 30px; color: var(--ink); font-weight: 500; line-height: 1.05; }
  .cu-meta { font-size: 11px; color: var(--ink-3); margin-top: 8px; display: flex; align-items: center; gap: 5px; justify-content: center; }
  .cu-nota { font-family: var(--font-display); font-size: 68px; color: var(--gold); font-weight: 500; line-height: 0.9; margin-top: 8px; animation: popIn 0.7s both; }
  .s-cumbre .serif-it { font-size: 13px; margin-top: 6px; }
  /* generos */
  .gen-top { font-family: var(--font-display); font-size: 50px; color: var(--ink); font-weight: 500; line-height: 1; margin-top: 10px; animation: popIn 0.7s both; }
  .story-in .gen-top + .serif-it { font-size: 17px; margin-top: 6px; }
  .gen-chips { display: flex; flex-wrap: wrap; gap: 9px; justify-content: center; margin-top: 28px; }
  .gchip { font-family: var(--font-display); color: var(--ink); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 12px; padding: 6px 14px; }
  .gen-foot { font-size: 11px; color: var(--ink-3); margin-top: 26px; }
  /* personaje */
  .pe-av { width: 116px; height: 116px; border-radius: 50%; background: linear-gradient(140deg, #2e2820, #14110d); border: 1px solid var(--line-strong); display: flex; align-items: center; justify-content: center; margin: 20px 0 16px; font-family: var(--font-display); font-size: 50px; color: var(--gold); animation: floaty 6s ease-in-out infinite; }
  .pe-name { font-family: var(--font-display); font-size: 36px; color: var(--ink); font-weight: 500; line-height: 1; animation: popIn 0.7s both; }
  .pe-n { font-size: 11px; color: var(--ink-3); margin-top: 10px; }
  /* mes */
  .mes-name { font-family: var(--font-display); font-size: 58px; color: var(--ink); font-weight: 500; line-height: 0.92; margin-top: 10px; animation: popIn 0.7s both; }
  .mes-n { font-size: 16px; color: var(--ink-2); margin-top: 4px; }
  .mes-n .gold { font-family: var(--font-display); font-size: 26px; }
  .mes-bars { width: 100%; height: 130px; display: flex; align-items: flex-end; gap: 5px; margin-top: 28px; }
  .mbar { flex: 1; background: #2e2820; border-radius: 3px; animation: barUp 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .mbar.peak { background: linear-gradient(var(--gold), var(--accent)); }
  .mes-axis { width: 100%; display: flex; justify-content: space-between; font-size: 8px; color: var(--ink-3); margin-top: 8px; }
  /* cierre */
  .cierre-line { font-family: var(--font-display); font-size: 26px; color: var(--ink); font-weight: 500; line-height: 1.25; margin-top: 16px; }
  .cierre-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 22px; }
  .cchip { font-size: 10px; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 999px; padding: 6px 11px; }
  .cierre-actions { margin-top: 28px; width: 100%; }
  .guardar { width: 100%; background: transparent; color: var(--ink-2); border: 1px solid var(--line-strong); border-radius: 999px; padding: 13px; font-family: var(--font-text, inherit); font-weight: 600; font-size: 14px; cursor: pointer; pointer-events: auto; }
  .guardar:hover { border-color: var(--gold); color: var(--gold); }
  .sellado { font-size: 11px; color: var(--ink-3); margin-top: 18px; letter-spacing: 0.04em; }

  /* skeleton / error */
  .skeleton .sk.big { height: 60vh; border-radius: 22px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes popIn { 0% { opacity: 0; transform: scale(0.86); } 60% { transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } }
  @keyframes floaty { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
  @keyframes aura { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 0.8; transform: scale(1.1); } }
  @keyframes ringdraw { from { stroke-dashoffset: 641; } }
  @keyframes barGrow { from { width: 0; } }
  @keyframes barUp { from { height: 0 !important; } }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .warc, .antesala, .an-ring .aura, .an-ring svg circle, .t-seg, .big-year, .vol-num .big, .vfill, .cu-cover, .cu-nota, .gen-top, .pe-av, .pe-name, .mes-name, .mbar, .sp { animation: none !important; }
  }
</style>
