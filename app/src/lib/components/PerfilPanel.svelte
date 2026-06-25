<script>
  // Pantalla 08 · Perfil. Diseño: diseno/Ocio Shit - Perfil.html ("identidad & logros, sin
  // EXP/Nivel"). Datos REALES: el carnet + el ADN de ocio_stats(); la galería del SISTEMA DE
  // LOGROS (evaluateLogros() = ocio_evaluate_logros + logros-catalog) — NUNCA los nombres/% de
  // muestra del diseño. Dinámico: se reevalúa al leer (un logro que cruce su umbral pasa a
  // conseguido solo). El título equipado se guarda por RPC INVOKER (ocio_set_titulo_activo).
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores.js';
  import { stats, evaluateLogros, getProfile, setTituloActivo } from '$lib/db/supabase-data.js';

  let loading = $state(true);
  let error = $state(null);
  let st = $state(null);
  let logros = $state([]);
  let activoId = $state(null);
  let filtro = $state('todos'); // todos | conseguidos | progreso | titulos
  let pickerOpen = $state(false);
  let saving = $state(false);

  onMount(load);
  async function load() {
    loading = true;
    error = null;
    try {
      const [s, l, p] = await Promise.all([stats(), evaluateLogros(), getProfile()]);
      st = s;
      logros = l;
      activoId = p?.titulo_activo_id ?? null;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // Notación europea MANUAL (constraint dura: coma decimal, punto de millar) — no se fía del ICU.
  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmt = (n) => (n == null ? '—' : grp(Math.round(Number(n))));

  // Paleta de categoría (= tokens de diseno/)
  const G = '#F2A65A', CI = '#C75D52', VJ = '#9580B0', SE = '#C9A23F', LI = '#7E8F5B', CO = '#5B9298';

  // Inner-SVG de cada icono (del diseño). Se inyecta con {@html} dentro de <svg>.
  const ICON = {
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
    tv: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 3l4 4 4-4"/>',
    game: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M7 12h4M9 10v4M15 11h.01M18 13h.01"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    comic: '<path d="M3 5l9-2 9 2v14l-9 2-9-2z"/><path d="M12 3v18"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    star: '<polygon points="12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    crown: '<path d="M3 8l4 4 5-7 5 7 4-4v10H3z"/>',
    flame: '<path d="M12 2c1 4-2 5-2 8a4 4 0 0 0 8 0c0-1 0-2-1-3 2 1 4 4 4 7a7 7 0 0 1-14 0c0-4 4-6 5-12z"/>',
    layers: '<path d="M12 3l8 4.5-8 4.5-8-4.5z"/><path d="M4 12l8 4.5 8-4.5"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 4H4v2a3 3 0 0 0 3 3M17 4h3v2a3 3 0 0 0-3 3"/>'
  };
  const ID_ICON = {
    LOG_RELECTOR: 'repeat', LOG_VIAJERO_TIEMPO: 'compass', TIT_MAESTRO_TIEMPO: 'clock',
    LOG_PRIMER_PASO: 'calendar', LOG_DESPIERTO: 'eye', LOG_RITMO_FIRME: 'clock',
    LOG_MARATONIANO: 'flame', LOG_ENCICLOPEDIA: 'layers', LOG_MENTE_ABIERTA: 'compass',
    TIT_ALMA_INQUIETA: 'compass', LOG_QUINIENTAS: 'trophy', LOG_CENTENARIO: 'trophy',
    LOG_CRITICO: 'star', TIT_CRITICO: 'star', LOG_AUTOR_CABECERA: 'star',
    LOG_TERMINADOR: 'trophy', TIT_FINISHER: 'trophy'
  };
  const CLASE_ICON = { cine: 'film', serie: 'tv', libro: 'book', comic: 'comic', juego: 'game',
    videojuego: 'game', diversidad: 'globe', habito: 'eye', ocio: 'compass', general: 'star' };
  const CLASE_COL = { cine: CI, serie: SE, juego: VJ, videojuego: VJ, libro: LI, comic: CO,
    diversidad: G, habito: G, ocio: G, general: G };

  const iconKey = (it) => ID_ICON[it.id] || (it.tipo === 'titulo' ? 'crown' : CLASE_ICON[it.clase] || 'star');
  const colorOf = (it) => (it.tipo === 'titulo' ? G : CLASE_COL[it.clase] || G);
  const tier = (r) => (r === 'legendario' ? 'leg' : r === 'comun' ? 'com' : 'rare');
  const catGlyph = (it) => (it.tipo === 'titulo' ? '◆' : '●');
  const yearOf = (it) => (it.fecha_desbloqueo ? String(it.fecha_desbloqueo).slice(0, 4) : null);
  const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
  const fullDec = (dd) => `${dd}s`;

  // ── vistas derivadas (todo real) ──
  let unlocked = $derived(logros.filter((l) => l.desbloqueado));
  let inProgress = $derived(
    logros.filter((l) => l.evaluable && !l.desbloqueado).sort((a, b) => (b.progreso ?? 0) - (a.progreso ?? 0))
  );
  let notEval = $derived(logros.filter((l) => !l.evaluable));
  let evaluables = $derived(logros.filter((l) => l.evaluable).length);
  let titulosUnlocked = $derived(unlocked.filter((l) => l.tipo === 'titulo'));
  let nLogros = $derived(unlocked.length);
  let nTitulos = $derived(titulosUnlocked.length);
  let cor = $derived(st?.corpus);
  let indice = $derived(Math.round(st?.diversidad?.indice ?? 0));
  let equipped = $derived(activoId ? logros.find((l) => l.id === activoId) : null);

  // filtros → qué se muestra
  let showUnlocked = $derived(
    filtro === 'progreso' ? [] : filtro === 'titulos' ? unlocked.filter((l) => l.tipo === 'titulo') : unlocked
  );
  let showProgress = $derived(
    filtro === 'conseguidos' ? [] : filtro === 'titulos' ? inProgress.filter((l) => l.tipo === 'titulo') : inProgress
  );

  // nombre del usuario (de la sesión) + inicial del carnet
  let nombre = $derived(($auth.user?.email || 'Tú').split('@')[0].replace(/^\w/, (c) => c.toUpperCase()));
  let inicial = $derived(nombre.charAt(0).toUpperCase());

  // ── ADN como identidad (rasgos narrados desde datos reales; NO el dashboard de Estadísticas) ──
  let adn = $derived(deriveADN(st));
  function deriveADN(d) {
    if (!d) return [];
    const div = d.diversidad, tiempo = d.tiempo ?? [], cre = d.creadores_top ?? [], decs = d.decadas ?? [];
    const out = [];
    const idx = Math.round(div?.indice ?? 0);
    if (idx >= 80) out.push({ k: 'compass', col: G, t: 'Espíritu abierto', d: `Tu diversidad cultural roza el techo (${idx}/100): más variada que casi cualquier archivo.` });
    else if (idx >= 60) out.push({ k: 'compass', col: G, t: 'Mente curiosa', d: `Tu diversidad es alta (${idx}/100): exploras a lo ancho, sin encasillarte.` });
    else out.push({ k: 'compass', col: G, t: 'Gustos definidos', d: `Sabes lo que te gusta y vuelves a ello (diversidad ${idx}/100).` });

    const totObras = tiempo.reduce((s, t) => s + (t.obras || 0), 0);
    const top = [...tiempo].sort((a, b) => (b.obras || 0) - (a.obras || 0))[0];
    if (top && totObras) {
      const x = Math.round((10 * top.obras) / totObras);
      const M = {
        pelicula: { t: 'Alma de cine', k: 'film', col: CI, d: `El cine es tu lengua materna — ${x} de cada 10 obras de tu vida.` },
        serie: { t: 'Serieadicto', k: 'tv', col: SE, d: `Las series te tienen — ${x} de cada 10 obras que registras.` },
        videojuego: { t: 'Jugador de corazón', k: 'game', col: VJ, d: `El mando es tu hábitat — ${x} de cada 10 obras.` },
        libro: { t: 'Ratón de biblioteca', k: 'book', col: LI, d: `Vives entre páginas — ${x} de cada 10 obras.` },
        comic: { t: 'Viñetista', k: 'comic', col: CO, d: `Las viñetas son lo tuyo — ${x} de cada 10 obras.` },
        ocio_libre: { t: 'Explorador', k: 'compass', col: G, d: `El ocio en vivo te define — ${x} de cada 10 obras.` }
      }[top.categoria];
      if (M) out.push(M);
    }
    if (cre[0] && cre[0].n >= 8) {
      out.push({ k: 'star', col: G, t: 'Autor de cabecera', d: `${cre[0].nombre} te ha marcado como nadie: ${cre[0].n} obras suyas, más que de ningún otro.` });
    } else {
      const td = [...decs].sort((a, b) => b.n - a.n)[0];
      if (td) out.push({ k: 'calendar', col: VJ, t: `Hijo de los ${fullDec(td.decada)}`, d: 'La mayor parte de tu archivo nació en esa época.' });
    }
    return out.slice(0, 3);
  }

  async function equipar(id) {
    if (saving) return;
    saving = true;
    pickerOpen = false;
    try {
      await setTituloActivo(id);
      activoId = id;
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }
</script>

<section class="perfil">
  <header class="head">
    <div class="eyebrow">Identidad &amp; logros</div>
    <h2>Perfil</h2>
  </header>

  {#if loading}
    <div class="skeleton">{#each Array(3) as _}<div class="sk"></div>{/each}</div>
  {:else if error}
    <div class="err"><p>No se pudo cargar el perfil.</p><button onclick={load}>Reintentar</button></div>
  {:else}
    <!-- ===== CARNET ===== -->
    <div class="carnet">
      <div class="avatar"><span class="aura"></span><span class="ini">{inicial}</span></div>
      <div class="name">{nombre}</div>

      <button class="titulo-badge" class:empty={!equipped} onclick={() => (pickerOpen = !pickerOpen)} disabled={!titulosUnlocked.length}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.5 6.5L21 9l-5 4.5L17.5 20 12 16.5 6.5 20 8 13.5 3 9l6.5-.5z"/></svg>
        <span class="tit-name">{equipped ? equipped.nombre : titulosUnlocked.length ? 'Elige un título' : 'Sin títulos aún'}</span>
      </button>
      <div class="tit-cap mono">
        {#if titulosUnlocked.length}TÍTULO EQUIPADO · {equipped ? `1 DE ${nTitulos}` : `${nTitulos} DISPONIBLES`} · TOCA PARA CAMBIAR{:else}DESBLOQUEA UN TÍTULO PARA LUCIRLO{/if}
      </div>

      {#if pickerOpen}
        <div class="picker">
          {#each titulosUnlocked as t}
            <button class="pick" class:on={t.id === activoId} onclick={() => equipar(t.id)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.5 6.5L21 9l-5 4.5L17.5 20 12 16.5 6.5 20 8 13.5 3 9l6.5-.5z"/></svg>
              <span>{t.nombre}</span>{#if t.id === activoId}<span class="check">✓</span>{/if}
            </button>
          {/each}
          {#if equipped}<button class="pick clear" onclick={() => equipar(null)}>Quitar título</button>{/if}
        </div>
      {/if}

      <div class="stats4">
        <div class="s"><div class="n">{nLogros}</div><div class="l mono">LOGROS</div></div>
        <div class="s"><div class="n">{nTitulos}</div><div class="l mono">TÍTULOS</div></div>
        <div class="s"><div class="n">{fmt(cor?.obras)}</div><div class="l mono">OBRAS</div></div>
        <div class="s"><div class="n gold">{indice}</div><div class="l mono">DIVERSIDAD</div></div>
      </div>
    </div>

    <!-- ===== QUIÉN ERES (ADN) ===== -->
    <div class="eyebrow section">Quién eres</div>
    <div class="adn">
      {#each adn as a}
        <div class="trait">
          <div class="t-ic" style="background:rgba({hexRgb(a.col)},.12);border-color:rgba({hexRgb(a.col)},.3)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a.col} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{@html ICON[a.k]}</svg>
          </div>
          <div class="t-body"><div class="t-title">{a.t}</div><div class="t-desc">{a.d}</div></div>
        </div>
      {/each}
    </div>

    <!-- ===== EL GABINETE (galería de logros) ===== -->
    <div class="gab-head">
      <div><div class="eyebrow">Tu colección de logros</div><h3>El gabinete</h3></div>
      <div class="segmented">
        {#each [['todos', 'Todos'], ['conseguidos', 'Conseguidos'], ['progreso', 'En progreso'], ['titulos', 'Títulos']] as [k, lab]}
          <button class:on={filtro === k} onclick={() => (filtro = k)}>{lab}</button>
        {/each}
      </div>
    </div>

    <div class="progress-summary">
      <div class="ps-bar"><div class="ps-fill" style="width:{evaluables ? (100 * nLogros) / evaluables : 0}%"></div></div>
      <span class="mono">{nLogros} / {evaluables} evaluables · <span class="faint">+{notEval.length} no evaluables</span></span>
    </div>

    {#if showUnlocked.length}
      <div class="grp-lab mono won">✓ CONSEGUIDOS · {unlocked.length}{#if filtro === 'titulos'} (títulos){/if}</div>
      <div class="medals">
        {#each showUnlocked as it (it.id)}
          {@const lg = tier(it.rareza) === 'leg'}
          <div class="medal" class:leg={lg} class:rare={tier(it.rareza) === 'rare'} title={it.descripcion}>
            <div class="m-disc" style={lg ? '' : `background:rgba(${hexRgb(colorOf(it))},.13);border:1px solid rgba(${hexRgb(colorOf(it))},.35)`}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={lg ? '#0B0A08' : colorOf(it)} stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">{@html ICON[iconKey(it)]}</svg>
              {#if lg}<span class="m-star">★</span>{/if}
            </div>
            <div class="m-name">{it.nombre}</div>
            <div class="m-meta mono">{catGlyph(it)} {yearOf(it) ?? '—'}</div>
          </div>
        {/each}
      </div>
    {/if}

    {#if showProgress.length}
      <div class="grp-lab mono prog">◷ EN PROGRESO · {inProgress.length}{#if filtro === 'titulos'} (títulos){/if} <span class="faint">· las metas aspiracionales también cuentan</span></div>
      <div class="prows">
        {#each showProgress as it (it.id)}
          {@const pc = Math.round((it.progreso ?? 0) * 100)}
          <div class="prow">
            <div class="p-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8A8070" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{@html ICON[iconKey(it)]}</svg></div>
            <div class="p-body">
              <div class="p-top"><span class="p-name">{it.nombre}</span><span class="p-pct mono" class:hot={pc >= 80}>{pc}%</span></div>
              <div class="p-goal">{catGlyph(it)} {it.descripcion}</div>
              <div class="p-track"><div class="p-fill" style="width:{pc}%;background:linear-gradient(90deg,{colorOf(it)},rgba({hexRgb(colorOf(it))},.7))"></div></div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if notEval.length && filtro !== 'titulos'}
      <div class="note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6E665A" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
        <span><span class="ink2">{notEval.length} logros aún no evaluables.</span> Dependen de subsistemas que llegarán (rachas, EXP/nivel, momentos canon, antigüedad). Aparecerán cuando se puedan medir — nada de marcadores vacíos hasta entonces.</span>
      </div>
    {/if}
  {/if}
</section>

<style>
  .perfil { display: flex; flex-direction: column; gap: 14px; padding-bottom: 1rem; }
  .head { margin-bottom: 2px; }
  .head h2 { font-size: 1.7rem; color: var(--ink); margin: 2px 0 0; font-weight: 500; }
  .eyebrow { font-family: var(--font-data); font-size: 0.66rem; letter-spacing: 0.13em; color: var(--label); text-transform: uppercase; }
  .eyebrow.section { margin-top: 8px; }
  .mono { font-family: var(--font-data); }
  .faint { color: var(--ink-3); }
  .ink2 { color: var(--ink-2); }
  .gold { color: var(--gold) !important; }

  /* ── carnet ── */
  .carnet {
    display: flex; flex-direction: column; align-items: center; text-align: center;
    background: radial-gradient(120% 60% at 50% 0%, #16120d 0%, var(--surface) 70%);
    border: 1px solid var(--line); border-radius: 20px; padding: 26px 18px 18px;
    position: relative; animation: fadeUp 0.5s both;
  }
  .avatar { position: relative; width: 96px; height: 96px; margin-bottom: 12px; }
  .avatar .aura { position: absolute; inset: -8px; border-radius: 50%; background: radial-gradient(closest-side, rgba(242, 166, 90, 0.3), transparent); animation: aura 5.5s ease-in-out infinite; }
  .avatar .ini { position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(140deg, #2e2820, #14110d); border: 1px solid var(--line-strong); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); color: var(--gold); font-size: 40px; }
  .name { font-family: var(--font-display); font-size: 27px; color: var(--ink); font-weight: 500; line-height: 1; }

  .titulo-badge {
    display: inline-flex; align-items: center; gap: 6px; margin-top: 10px;
    background: linear-gradient(135deg, rgba(242, 166, 90, 0.18), rgba(232, 96, 44, 0.12));
    border: 1px solid rgba(242, 166, 90, 0.35); border-radius: 999px; padding: 5px 13px;
    color: var(--gold); cursor: pointer; transition: filter 0.2s;
  }
  .titulo-badge:hover:not(:disabled) { filter: brightness(1.15); }
  .titulo-badge:disabled { cursor: default; opacity: 0.85; }
  .titulo-badge.empty { background: var(--surface-2); border-color: var(--line-strong); color: var(--ink-2); }
  .tit-name { font-family: var(--font-display); font-style: italic; font-size: 15px; }
  .tit-cap { font-size: 10px; color: var(--ink-3); letter-spacing: 0.06em; margin-top: 8px; }

  .picker { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; width: min(280px, 90%); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 14px; padding: 8px; animation: fadeUp 0.25s both; }
  .pick { display: flex; align-items: center; gap: 8px; background: none; border: none; border-radius: 9px; padding: 9px 11px; color: var(--ink-2); font-size: 0.9rem; cursor: pointer; text-align: left; }
  .pick svg { color: var(--gold); flex: none; }
  .pick span { font-family: var(--font-display); font-style: italic; flex: 1; }
  .pick:hover { background: var(--surface-2); color: var(--ink); }
  .pick.on { color: var(--gold); }
  .pick .check { flex: none; }
  .pick.clear { justify-content: center; color: var(--ink-3); font-style: normal; font-family: var(--font-data); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px; border-top: 1px solid var(--line); border-radius: 0; padding-top: 10px; }

  .stats4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; width: 100%; margin-top: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px 4px; }
  .stats4 .s { text-align: center; border-right: 1px solid var(--line); }
  .stats4 .s:last-child { border-right: none; }
  .stats4 .n { font-family: var(--font-display); font-size: 22px; color: var(--ink); }
  .stats4 .l { font-size: 8px; color: var(--ink-3); letter-spacing: 0.08em; margin-top: 3px; }
  @media (min-width: 520px) { .stats4 .n { font-size: 26px; } .stats4 .l { font-size: 9px; } }

  /* ── ADN ── */
  .adn { display: grid; grid-template-columns: 1fr; gap: 10px; }
  @media (min-width: 640px) { .adn { grid-template-columns: 1fr 1fr 1fr; } }
  .trait { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 14px; display: flex; gap: 13px; align-items: center; animation: fadeUp 0.5s both; transition: transform 0.3s, border-color 0.3s; }
  .trait:hover { transform: translateY(-3px); border-color: var(--line-strong); }
  .t-ic { width: 42px; height: 42px; border-radius: 12px; border: 1px solid; display: flex; align-items: center; justify-content: center; flex: none; }
  .t-title { font-family: var(--font-display); font-size: 18px; color: var(--ink); line-height: 1.05; }
  .t-desc { font-size: 13px; color: var(--ink-2); margin-top: 3px; line-height: 1.4; }

  /* ── gabinete ── */
  .gab-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-top: 6px; }
  .gab-head h3 { font-family: var(--font-display); font-size: 1.5rem; color: var(--ink); font-weight: 500; margin: 2px 0 0; }
  .segmented { display: flex; gap: 4px; background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 4px; }
  .segmented button { background: none; border: none; border-radius: 999px; padding: 6px 12px; font-size: 12px; font-weight: 600; color: var(--ink-2); cursor: pointer; font-family: inherit; }
  .segmented button.on { color: var(--on-accent); background: var(--accent); }

  .progress-summary { display: flex; align-items: center; gap: 14px; }
  .ps-bar { flex: 1; max-width: 280px; height: 7px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
  .ps-fill { height: 100%; background: linear-gradient(90deg, #7e8f5b, #9db073); border-radius: 4px; animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
  .progress-summary .mono { font-size: 11px; color: var(--ink-2); }

  .grp-lab { font-size: 10px; letter-spacing: 0.1em; margin: 6px 0 2px; }
  .grp-lab.won { color: #7e8f5b; }
  .grp-lab.prog { color: var(--label); }

  .medals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  @media (min-width: 560px) { .medals { grid-template-columns: repeat(4, 1fr); gap: 12px; } }
  @media (min-width: 700px) { .medals { grid-template-columns: repeat(5, 1fr); } }
  .medal { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 13px 8px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 7px; cursor: default; animation: medalIn 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; transition: transform 0.3s, border-color 0.3s; }
  .medal:hover { transform: translateY(-3px); border-color: var(--line-strong); }
  .medal.rare { border-color: rgba(242, 166, 90, 0.2); }
  .medal.leg { border-color: rgba(242, 166, 90, 0.4); animation: medalIn 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both, glowpulse 4.5s ease-in-out infinite; }
  .m-disc { position: relative; width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex: none; }
  .medal.leg .m-disc { background: linear-gradient(135deg, #f2a65a, #e8602c); }
  .m-star { position: absolute; right: -2px; bottom: -2px; width: 16px; height: 16px; border-radius: 50%; background: var(--bg); display: flex; align-items: center; justify-content: center; color: var(--gold); font-size: 10px; }
  .m-name { font-family: var(--font-display); font-size: 13px; color: var(--ink); line-height: 1.05; }
  .m-meta { font-size: 8px; color: var(--ink-3); letter-spacing: 0.04em; }

  .prows { display: grid; grid-template-columns: 1fr; gap: 10px; }
  @media (min-width: 640px) { .prows { grid-template-columns: 1fr 1fr; gap: 12px; } }
  .prow { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 13px; display: flex; gap: 13px; align-items: center; animation: fadeIn 0.5s both; transition: background 0.25s; }
  .prow:hover { background: #1b1712; }
  .p-ic { width: 42px; height: 42px; border-radius: 12px; background: #1b1712; border: 1px solid var(--line-strong); display: flex; align-items: center; justify-content: center; flex: none; filter: grayscale(0.4); opacity: 0.75; }
  .p-body { flex: 1; min-width: 0; }
  .p-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .p-name { font-family: var(--font-display); font-size: 16px; color: var(--ink); }
  .p-pct { font-size: 12px; color: var(--ink-2); flex: none; }
  .p-pct.hot { color: var(--gold); }
  .p-goal { font-size: 12px; color: var(--ink-3); margin: 4px 0 8px; line-height: 1.35; }
  .p-track { height: 7px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
  .p-fill { height: 100%; border-radius: 4px; animation: barGrow 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }

  .note { display: flex; align-items: flex-start; gap: 8px; margin-top: 8px; padding: 13px 14px; background: #100e0b; border: 1px dashed var(--line-strong); border-radius: 12px; }
  .note svg { flex: none; margin-top: 1px; }
  .note span { font-size: 12px; color: var(--ink-3); line-height: 1.45; }

  /* skeleton / error */
  .skeleton { display: flex; flex-direction: column; gap: 14px; }
  .sk { height: 130px; border-radius: 18px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
  .err { text-align: center; padding: 2rem; color: var(--ink-2); }
  .err button { margin-top: 0.6rem; background: var(--surface-2); color: var(--ink); border: 1px solid var(--line-strong); border-radius: 10px; padding: 0.5rem 1rem; cursor: pointer; }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes medalIn { from { opacity: 0; transform: scale(0.7); } to { opacity: 1; transform: scale(1); } }
  @keyframes barGrow { from { width: 0; } }
  @keyframes aura { 0%, 100% { opacity: 0.32; transform: scale(1); } 50% { opacity: 0.55; transform: scale(1.07); } }
  @keyframes glowpulse { 0%, 100% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.3), 0 6px 22px rgba(232, 96, 44, 0.1); } 50% { box-shadow: 0 0 0 1px rgba(242, 166, 90, 0.5), 0 8px 30px rgba(232, 96, 44, 0.2); } }
  @keyframes shimmer { to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .carnet, .trait, .medal, .prow, .ps-fill, .p-fill, .avatar .aura, .sk { animation: none !important; }
  }
</style>
