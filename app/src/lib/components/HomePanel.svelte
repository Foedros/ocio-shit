<script>
  // Pantalla 01 · Home / Dashboard — el aterrizaje. Diseño: diseno/Ocio Shit - Home.html. SÍNTESIS
  // + PUERTAS: cada módulo es un vistazo que ENLAZA a su pantalla. Datos REALES vía ocio_home()
  // (1 RPC que REUTILIZA ocio_progresion/hall/stats por dentro → coherente con Perfil/Hall/
  // Estadísticas, nunca los números del diseño). Home no escribe (solo lectura).
  import { onMount } from 'svelte';
  import { displayName } from '$lib/stores.js';
  import { home } from '$lib/db/supabase-data.js';
  import Skeleton from './Skeleton.svelte';

  let { onnavigate = () => {}, onregister = () => {} } = $props();

  let loading = $state(true);
  let error = $state(null);
  let d = $state(null);

  onMount(load);
  async function load() {
    loading = true;
    error = null;
    try {
      d = await home();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // Notación europea MANUAL
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));
  const num = (n) => {
    if (n == null) return '—';
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : String(v).replace('.', ',');
  };

  const CAT = {
    pelicula: { l: 'Cine', c: '#C75D52' }, serie: { l: 'Serie', c: '#C9A23F' },
    videojuego: { l: 'Videojuego', c: '#9580B0' }, libro: { l: 'Libro', c: '#7E8F5B' },
    comic: { l: 'Cómic', c: '#5B9298' }, ocio_libre: { l: 'Ocio libre', c: '#8A6F4A' }
  };
  const CHIPS = [['pelicula', 'Cine'], ['serie', 'Serie'], ['videojuego', 'Juego'], ['libro', 'Libro'], ['comic', 'Cómic']];
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const fechaCorta = (f) => {
    if (!f) return 'sin fecha';
    const [y, m, dd] = String(f).split('-');
    return `${Number(dd)} ${MES[Number(m) - 1] ?? '?'} ${y}`;
  };
  const ini = (t) => (t ? t.trim().charAt(0).toUpperCase() : '?');

  // saludo por hora (display, JS local)
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  let ahora = new Date();
  let hh = ahora.getHours();
  let saludo = $derived(hh < 6 ? 'buenas noches' : hh < 13 ? 'buenos días' : hh < 21 ? 'buenas tardes' : 'buenas noches');
  let cuando = $derived(`${DIAS[ahora.getDay()]} · ${saludo}`);
  let nombre = $derived($displayName); // fuente única (user_metadata → fallback email)

  // ── slivers (todo de ocio_home; coherente con Perfil/Hall/Estadísticas) ──
  let prog = $derived(d?.progresion);
  let nivel = $derived(prog?.nivel);
  let faltan = $derived(nivel ? Math.max(0, Math.round(Number(nivel.e_siguiente) - Number(prog.exp.total))) : 0);
  let ringOff = $derived(nivel ? 170 * (1 - (nivel.progreso ?? 0)) : 170); // dasharray 170
  let claseObra = $derived(prog?.clase?.por_obra?.[0]?.arquetipo);
  let claseHoras = $derived(prog?.clase?.por_horas?.[0]?.arquetipo);
  let claseObraCat = $derived(prog?.clase?.por_obra?.[0]?.categoria);
  let claseHorasCat = $derived(prog?.clase?.por_horas?.[0]?.categoria);
  let racha = $derived(prog?.racha?.maxima ?? 0);
  let cumbre = $derived(d?.cumbre);
  let cumbreEmpate = $derived(d?.cumbre_empate);
  let reciente = $derived(d?.reciente);
  let ultimas = $derived(d?.ultimas ?? []);
  let titulo = $derived(d?.titulo);
  // anillo del teaser de diversidad (dasharray 214)
  let divOff = $derived(d ? 214 * (1 - Math.max(0, Math.min(100, Number(d.diversidad) || 0)) / 100) : 214);
</script>

<section class="home">
  {#if loading}
    <div class="skeleton">{#each Array(4) as _}<Skeleton h="110px" r="18px" />{/each}</div>
  {:else if error}
    <div class="err"><p>No se pudo cargar el inicio.</p><button onclick={load}>Reintentar</button></div>
  {:else if d}
    <!-- ===== HERO IDENTIDAD (→ Perfil) ===== -->
    <button class="hero door" onclick={() => onnavigate('perfil')}>
      <div class="hero-top">
        <div class="avatar">
          <span class="aura"></span>
          <svg class="ring" viewBox="0 0 58 58"><circle cx="29" cy="29" r="27" fill="none" stroke="var(--line-strong)" stroke-width="3" /><circle cx="29" cy="29" r="27" fill="none" stroke="var(--gold)" stroke-width="3" stroke-linecap="round" stroke-dasharray="170" stroke-dashoffset={ringOff} /></svg>
          <span class="ini">{ini(nombre)}</span>
          <span class="lvl-badge">{nivel.nivel}</span>
        </div>
        <div class="hero-id">
          <div class="micro mono">{cuando}</div>
          <div class="name">{nombre}</div>
          <div class="lvl-line mono">NIVEL {nivel.nivel} · {fmt(faltan)} EXP → {nivel.nivel + 1}</div>
        </div>
        <span class="arrow mono">→</span>
      </div>
      <div class="hero-chips">
        {#if titulo}
          <span class="chip-tit"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4 4 5-7 5 7 4-4v10H3z" /></svg><span class="t-name">{titulo.nombre}</span></span>
        {:else}
          <span class="chip-tit empty">Sin título · elígelo en Perfil</span>
        {/if}
        {#if claseObra}
          <span class="chip-clase">
            <span class="cl"><span class="dot" style="background:{CAT[claseObraCat]?.c}"></span>{claseObra}</span>
            <span class="sep">·</span>
            <span class="cl muted"><span class="dot" style="background:{CAT[claseHorasCat]?.c}"></span>{claseHoras} <span class="faint">por horas</span></span>
          </span>
        {/if}
      </div>
      <div class="hero-nums">
        <div class="hn"><div class="hn-v">{fmt(d.obras)}</div><div class="hn-l mono">OBRAS VIVIDAS</div></div>
        <div class="hn-sep"></div>
        <div class="hn"><div class="hn-v gold">{num(d.diversidad)}</div><div class="hn-l mono">DIVERSIDAD</div></div>
        <span class="ver mono">ver carnet</span>
      </div>
    </button>

    <!-- racha aproximada (honesta) -->
    <div class="racha">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--label)" style="opacity:.8"><path d="M12 2c1 4-2 5-2 8a4 4 0 0 0 8 0c0-1 0-2-1-3 2 1 4 4 4 7a7 7 0 0 1-14 0c0-4 4-6 5-12z" /></svg>
      <span class="r-txt"><strong>~{racha} días</strong> de racha máxima</span>
      <span class="r-cav mono">APROX. · FECHAS DE VOTO</span>
    </div>

    <!-- ===== REGISTRAR (acción principal) ===== -->
    <div class="reg-block">
      <button class="reg" onclick={() => onregister()}>
        <span class="reg-ic"><span class="pulse"></span><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg></span>
        <span class="reg-body"><span class="reg-t">Registra algo</span><span class="reg-d">¿Qué has vivido hoy?</span></span>
      </button>
      <div class="chips">
        {#each CHIPS as [cat, lab]}
          <button class="chip" onclick={() => onregister()}><span class="dot" style="background:{CAT[cat].c}"></span>{lab}</button>
        {/each}
      </div>
    </div>

    <!-- ===== LO ÚLTIMO (→ Diario) ===== -->
    <button class="door card lo-ultimo" onclick={() => onnavigate('diario')}>
      <div class="card-head"><span class="ttl">Lo último</span><span class="arrow mono">ABRIR DIARIO →</span></div>
      {#each ultimas.slice(0, 4) as e (e.id)}
        <div class="row">
          <span class="cover" style="--cc:{CAT[e.categoria]?.c}">{ini(e.titulo)}</span>
          <div class="row-body">
            <div class="row-top"><span class="r-name">{e.titulo}</span>{#if e.valoracion != null}<span class="r-nota mono">{num(e.valoracion)}</span>{/if}</div>
            <div class="row-meta mono"><span class="dot" style="background:{CAT[e.categoria]?.c}"></span>{CAT[e.categoria]?.l ?? e.categoria} · {fechaCorta(e.fecha)}</div>
          </div>
        </div>
      {/each}
    </button>

    <!-- ===== TU CUMBRE (→ Hall of Fame) ===== -->
    {#if cumbre}
      <button class="door cumbre" onclick={() => onnavigate('hall')}>
        <span class="halo"></span>
        <div class="card-head"><span class="eyebrow mono">Tu Cumbre del momento</span><span class="arrow mono">HALL OF FAME →</span></div>
        <div class="cumbre-body">
          <span class="cover big" style="--cc:{CAT[cumbre.categoria]?.c}">{cumbre.inicial}</span>
          <div class="cumbre-info">
            <div class="cu-name">{cumbre.titulo}</div>
            <div class="cu-meta mono"><span class="dot" style="background:{CAT[cumbre.categoria]?.c}"></span>{CAT[cumbre.categoria]?.l ?? cumbre.categoria} · TU PANTEÓN</div>
            <div class="cu-sub">{cumbreEmpate > 1 ? `una de tus ${fmt(cumbreEmpate)} obras de ${num(cumbre.nota)}` : 'tu nota más alta'}</div>
          </div>
          <div class="cu-score"><div class="cs-v">{num(cumbre.nota)}</div><div class="cs-l mono">NOTA</div></div>
        </div>
      </button>
    {/if}

    <!-- ===== DOS PUERTAS: diversidad + recién desbloqueado ===== -->
    <div class="two-doors">
      <button class="door mini-door div" onclick={() => onnavigate('estadisticas')}>
        <div class="div-ring">
          <svg viewBox="0 0 84 84"><circle cx="42" cy="42" r="34" fill="none" stroke="var(--surface-2)" stroke-width="7" /><circle cx="42" cy="42" r="34" fill="none" stroke="var(--gold)" stroke-width="7" stroke-linecap="round" stroke-dasharray="214" stroke-dashoffset={divOff} /></svg>
          <span class="div-v">{num(d.diversidad)}</span>
        </div>
        <div class="md-t">Diversidad alta</div>
        <div class="arrow mono">ESTADÍSTICAS →</div>
      </button>

      <button class="door mini-door logro" onclick={() => onnavigate('perfil')}>
        <div class="ld-head">
          <span class="ld-ic"><svg width="19" height="19" viewBox="0 0 24 24" fill="var(--gold)"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg></span>
          <span class="ld-lab mono">{reciente ? 'ÚLTIMO DESBLOQUEADO' : 'LOGROS'}</span>
        </div>
        {#if reciente}
          <div class="ld-name">{reciente.nombre}</div>
          <div class="ld-d">{reciente.tipo === 'titulo' ? 'Título' : 'Logro'} · {fechaCorta(reciente.fecha)}</div>
        {:else}
          <div class="ld-name">Tu gabinete</div>
          <div class="ld-d">aún sin desbloqueos datados</div>
        {/if}
        <div class="arrow mono push">PERFIL →</div>
      </button>
    </div>
  {/if}
</section>

<style>
  .home { display: flex; flex-direction: column; gap: 14px; padding-bottom: 1rem; }
  .mono { font-family: var(--font-data); }
  .micro { font-size: 10px; letter-spacing: 0.14em; color: var(--ink-3); text-transform: uppercase; }
  .faint { color: var(--ink-3); }
  .gold { color: var(--gold) !important; }
  .arrow { font-size: 10px; color: var(--label); letter-spacing: 0.06em; transition: transform 0.3s, color 0.3s; }

  .door { display: block; width: 100%; text-align: left; background: none; border: none; padding: 0; cursor: pointer; font: inherit; color: inherit; }
  .card, .door.card { background: var(--surface); border: 1px solid var(--line); border-radius: 18px; padding: 18px; transition: transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.35s; animation: fadeUp 0.5s both; }
  .door.card:hover, .door.cumbre:hover, .mini-door:hover, .hero:hover { transform: translateY(-3px); }
  .door:hover .arrow { transform: translateX(4px); color: var(--gold); }

  /* hero */
  .hero { position: relative; border-radius: 20px; padding: 20px; background: linear-gradient(165deg, #1b1610, #100d0a); border: 1px solid #2a2218; transition: transform 0.35s, border-color 0.35s; animation: fadeUp 0.5s both; }
  .hero:hover { border-color: var(--line-strong); }
  .hero-top { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
  .avatar { position: relative; width: 58px; height: 58px; flex: none; }
  .avatar .aura { position: absolute; inset: -6px; border-radius: 50%; background: radial-gradient(closest-side, rgba(242, 166, 90, 0.28), transparent); animation: aura 5.5s ease-in-out infinite; }
  .avatar .ring { position: absolute; inset: 0; transform: rotate(-90deg); }
  .avatar .ring circle:last-child { animation: ringdraw 1.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .avatar .ini { position: absolute; inset: 5px; border-radius: 50%; background: linear-gradient(140deg, #2e2820, #14110d); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); color: var(--gold); font-size: 22px; }
  .lvl-badge { position: absolute; bottom: -3px; right: -3px; min-width: 24px; height: 20px; padding: 0 5px; border-radius: 10px; background: var(--accent); border: 2px solid #100d0a; display: flex; align-items: center; justify-content: center; font-family: var(--font-data); font-size: 11px; font-weight: 700; color: var(--on-accent); }
  .hero-id { flex: 1; min-width: 0; }
  .name { font-family: var(--font-display); font-size: 26px; color: var(--ink); font-weight: 500; line-height: 1.05; }
  .lvl-line { font-size: 9px; color: var(--label); letter-spacing: 0.06em; margin-top: 2px; }
  .hero .arrow { font-size: 18px; align-self: center; }
  .hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
  .chip-tit { display: inline-flex; align-items: center; gap: 7px; background: rgba(242, 166, 90, 0.1); border: 1px solid rgba(242, 166, 90, 0.28); border-radius: 999px; padding: 6px 12px; color: var(--gold); }
  .chip-tit .t-name { font-family: var(--font-display); font-style: italic; font-size: 15px; }
  .chip-tit.empty { background: var(--surface); border-color: var(--line); color: var(--ink-3); font-size: 12px; font-style: italic; }
  .chip-clase { display: inline-flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 6px 12px; }
  .chip-clase .cl { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ink); font-weight: 600; }
  .chip-clase .cl.muted { color: var(--ink-2); font-weight: 400; }
  .chip-clase .sep { color: var(--ink-3); }
  .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .hero-nums { display: flex; align-items: flex-end; gap: 0; }
  .hn { flex: 0 0 auto; padding-right: 18px; }
  .hn:nth-child(3) { padding-left: 18px; padding-right: 0; }
  .hn-v { font-family: var(--font-display); font-size: 30px; color: var(--ink); font-weight: 500; line-height: 1; }
  .hn-l { font-size: 9px; color: var(--ink-3); letter-spacing: 0.1em; margin-top: 4px; }
  .hn-sep { width: 1px; align-self: stretch; background: #2a2218; }
  .ver { margin-left: auto; align-self: flex-end; font-size: 10px; color: var(--label); }

  /* racha */
  .racha { display: flex; align-items: center; gap: 9px; padding: 9px 14px; background: #100e0b; border: 1px solid #1f1a14; border-radius: 12px; animation: fadeUp 0.5s both; }
  .r-txt { font-size: 12px; color: var(--ink-2); }
  .r-txt strong { color: var(--ink); }
  .r-cav { font-size: 9px; color: var(--ink-3); letter-spacing: 0.06em; margin-left: auto; }

  /* registrar */
  .reg-block { display: flex; flex-direction: column; gap: 10px; }
  .reg { display: flex; align-items: center; gap: 14px; background: var(--accent); border: none; border-radius: 16px; padding: 17px 18px; cursor: pointer; box-shadow: 0 8px 24px rgba(232, 96, 44, 0.3); transition: transform 0.3s, box-shadow 0.3s; animation: fadeUp 0.5s both; }
  .reg:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(232, 96, 44, 0.4); }
  .reg-ic { position: relative; width: 42px; height: 42px; flex: none; border-radius: 50%; background: rgba(11, 10, 8, 0.18); display: flex; align-items: center; justify-content: center; }
  .reg-ic .pulse { position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid rgba(11, 10, 8, 0.4); animation: pulse 2.4s ease-out infinite; }
  .reg-body { display: flex; flex-direction: column; text-align: left; }
  .reg-t { font-family: var(--font-display); font-size: 20px; color: var(--on-accent); font-weight: 600; line-height: 1; }
  .reg-d { font-size: 12px; color: #3a1505; }
  .chips { display: flex; gap: 7px; }
  .chip { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 5px; background: var(--surface); border: 1px solid var(--line); border-radius: 11px; padding: 10px 0; cursor: pointer; color: var(--ink-2); font-size: 10px; transition: transform 0.25s, border-color 0.25s; }
  .chip:hover { transform: translateY(-2px); border-color: var(--line-strong); }

  /* lo último */
  .card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
  .ttl { font-family: var(--font-display); font-size: 19px; color: var(--ink); }
  .row { display: flex; gap: 12px; align-items: center; padding: 8px; border-radius: 10px; margin: 0 -8px; transition: background 0.25s; }
  .row:not(:last-child) { border-bottom: 1px solid #1a1610; }
  .door.card:hover .row { background: transparent; }
  .cover { width: 38px; height: 54px; border-radius: 5px; flex: none; display: flex; align-items: center; justify-content: center; border: 1px solid var(--line-strong); font-family: var(--font-display); font-size: 17px; color: var(--cc, var(--ink-2)); background: linear-gradient(160deg, color-mix(in srgb, var(--cc, #2e2820) 22%, #1a1610), #15120e); }
  .cover.big { width: 52px; height: 74px; border-radius: 7px; font-size: 24px; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5); }
  .row-body { flex: 1; min-width: 0; }
  .row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .r-name { font-family: var(--font-display); font-size: 16px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r-nota { font-size: 13px; color: var(--gold); flex: none; }
  .row-meta { font-size: 9px; color: var(--ink-3); margin-top: 3px; display: flex; align-items: center; gap: 5px; }

  /* cumbre */
  .cumbre { position: relative; overflow: hidden; background: linear-gradient(165deg, #1b1610, #100d0a); border: 1px solid rgba(242, 166, 90, 0.28); border-radius: 18px; padding: 18px; transition: transform 0.35s, border-color 0.35s; animation: fadeUp 0.5s both, glowpulse 5s ease-in-out infinite; }
  .cumbre .halo { position: absolute; top: -20px; right: -10px; width: 160px; height: 140px; background: radial-gradient(closest-side, rgba(242, 166, 90, 0.14), transparent); animation: aura 6s ease-in-out infinite; pointer-events: none; }
  .cumbre .eyebrow { font-size: 10px; letter-spacing: 0.14em; color: var(--label); text-transform: uppercase; }
  .cumbre-body { position: relative; display: flex; gap: 14px; align-items: center; }
  .cumbre-info { flex: 1; min-width: 0; }
  .cu-name { font-family: var(--font-display); font-size: 21px; color: var(--ink); line-height: 1.05; }
  .cu-meta { font-size: 10px; color: var(--ink-3); margin-top: 4px; display: flex; align-items: center; gap: 5px; }
  .cu-sub { font-size: 12px; color: var(--ink-2); font-style: italic; font-family: var(--font-display); margin-top: 6px; }
  .cu-score { text-align: center; flex: none; }
  .cs-v { font-family: var(--font-display); font-size: 38px; color: var(--gold); font-weight: 500; line-height: 1; }
  .cs-l { font-size: 8px; color: var(--label); letter-spacing: 0.1em; }

  /* dos puertas */
  .two-doors { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .mini-door { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; transition: transform 0.35s, border-color 0.35s; animation: fadeUp 0.5s both; }
  .mini-door.div { align-items: center; text-align: center; }
  .div-ring { position: relative; width: 84px; height: 84px; margin-bottom: 10px; }
  .div-ring svg { transform: rotate(-90deg); }
  .div-ring svg circle:last-child { animation: ringdraw 1.4s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .div-v { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 23px; color: var(--gold); font-weight: 500; }
  .md-t { font-size: 13px; color: var(--ink); font-weight: 600; }
  .mini-door.div .arrow { margin-top: 6px; }
  .ld-head { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .ld-ic { width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(150deg, var(--surface-2), var(--surface)); border: 1px solid rgba(242, 166, 90, 0.32); display: flex; align-items: center; justify-content: center; flex: none; }
  .ld-lab { font-size: 8px; color: #7e8f5b; letter-spacing: 0.1em; line-height: 1.3; }
  .ld-name { font-family: var(--font-display); font-size: 16px; color: var(--ink); line-height: 1.1; }
  .ld-d { font-size: 11px; color: var(--ink-3); margin-top: 3px; }
  .arrow.push { margin-top: auto; padding-top: 12px; }

  /* skeleton / error */
  .skeleton { display: flex; flex-direction: column; gap: 14px; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes aura { 0%, 100% { opacity: 0.3; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.06); } }
  @keyframes ringdraw { from { stroke-dashoffset: 170; } }
  @keyframes pulse { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2); opacity: 0; } }
  @keyframes glowpulse { 0%, 100% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.28), 0 6px 22px rgba(232, 96, 44, 0.1); } 50% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.48), 0 8px 30px rgba(232, 96, 44, 0.2); } }
  @media (prefers-reduced-motion: reduce) {
    .hero, .reg, .card, .cumbre, .mini-door, .racha, .avatar .aura, .reg-ic .pulse, .div-ring svg circle, .avatar .ring circle { animation: none !important; }
  }
</style>
