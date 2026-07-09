<script>
  // Pantalla 11 · LA INDECISIÓN — el decisor de ocio (§11.63). Diseño: diseno/Ocio Shit - El
  // Oraculo.html ("El Oráculo" era el placeholder del diseño; el nombre final es LA INDECISIÓN,
  // frases adaptadas). Anti-watchlist por diseño: pool de DIEZ huecos duros (límite server-side),
  // el ánimo PONDERA el azar (+2 por coincidencia en energía y foco), solo el tiempo EXCLUYE
  // (lo que no cabe se atenúa en vivo); un solo VETO por decisión y la segunda palabra es final.
  // El pool flota como DOM (deriva suave hermana de la Constelación) — NO canvas: así el
  // rasterizador de la transición literatura no corre riesgo de taint y la sección entra al
  // sorteo de transiciones como una pestaña normal.
  import { onMount } from 'svelte';
  import { poolList, poolAgregar, poolQuitar, buscarObras } from '$lib/db/supabase-data.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { prefersReducedMotion } from '$lib/motion.js';
  import { showToast } from '$lib/stores.js';
  import Sheet from './Sheet.svelte';
  import Skeleton from './Skeleton.svelte';

  let { onregistrar } = $props(); // abre el registro del Diario con la obra precargada

  const NEUTRO = { c: '#8A6F4A', tint: '#C9A877' }; // texto libre: sin categoría (decisión de esquema)
  const col = (o) => (o?.obra?.categoria ? (CAT_COLOR[o.obra.categoria] ?? NEUTRO) : NEUTRO);
  const CAT_LABEL = { pelicula: 'PELÍCULA', serie: 'SERIE', libro: 'LIBRO', videojuego: 'VIDEOJUEGO', comic: 'CÓMIC', ocio_libre: 'OCIO LIBRE' };
  const catLabel = (o) => (o?.obra?.categoria ? (CAT_LABEL[o.obra.categoria] ?? o.obra.categoria.toUpperCase()) : 'TEXTO LIBRE');
  const TIME_LABEL = ['30 MIN', '1–2 H', 'LA TARDE'];
  const titleOf = (o) => o?.obra?.titulo ?? o?.texto_libre ?? '';
  const iniOf = (o) => (titleOf(o).trim().charAt(0) || '?').toUpperCase();
  // huecos del escenario (dispersión del diseño; 10 posiciones estables por índice). Los índices
  // CONSECUTIVOS caen lejos (columnas alternas): con pocas tarjetas nunca se solapan, ni en 390px
  // (con 8-10 en móvil el solape parcial es geométricamente inevitable y la deriva las despega).
  const SLOTS = [
    { x: 5, y: 6 }, { x: 68, y: 10 }, { x: 36, y: 40 }, { x: 6, y: 62 }, { x: 70, y: 58 },
    { x: 38, y: 2 }, { x: 8, y: 32 }, { x: 72, y: 34 }, { x: 40, y: 66 }, { x: 24, y: 16 }
  ];

  let loading = $state(true);
  let error = $state(null);
  let pool = $state([]);

  // ánimo (pre-sorteo): pondera; solo el tiempo excluye
  let energia = $state('pasiva');
  let foco = $state('disperso');
  let tiempo = $state(1);

  let phase = $state('idle'); // idle | spinning | revealed | done
  let winner = $state(null);
  let vetoUsed = $state(false);
  let quitando = $state(null); // id de la tarjeta con el "✕ Quitar" desplegado

  let candidatos = $derived(pool.filter((o) => o.tiempo <= tiempo));

  onMount(load);
  async function load() {
    loading = true;
    error = null;
    try {
      pool = await poolList();
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  // ── deriva en reposo (hermana de la Constelación): rAF sobre los 10 nodos DOM ──
  let stageEl = $state(null);
  let raf = null;
  function tick() {
    raf = requestAnimationFrame(tick);
    if (phase !== 'idle' || !stageEl || prefersReducedMotion()) return;
    const t = Date.now() / 1000;
    stageEl.querySelectorAll('.dr').forEach((d, i) => {
      d.style.transform = `translate(${(Math.sin(t * 0.5 + i * 1.7) * 9).toFixed(1)}px,${(Math.cos(t * 0.4 + i * 2.3) * 7).toFixed(1)}px)`;
    });
  }
  onMount(() => {
    const vis = () => {
      if (document.hidden) {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
      } else if (raf == null) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', vis);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', vis);
    };
  });
  // al volver a idle (cerrar revelación / veto resuelto) las tarjetas centrifugadas se restauran
  $effect(() => {
    if (phase === 'idle' && stageEl) {
      stageEl.querySelectorAll('.opt').forEach((n) => n.getAnimations().forEach((a) => a.cancel()));
    }
  });

  // ── sorteo PONDERADO en cliente: peso 1 + 2·(energía coincide) + 2·(foco coincide); el tiempo
  //    ya excluyó (candidatos). El azar es sustituible en test (?test=1: __ocio.poolRandSeq). ──
  const rand = () => {
    const seq = typeof window !== 'undefined' && window.__ocio?.poolRandSeq;
    if (Array.isArray(seq) && seq.length) return seq.shift();
    return Math.random();
  };
  function pick(exclude) {
    const list = candidatos.filter((o) => o.id !== exclude?.id);
    const cands = list.length ? list : candidatos; // con 1 candidato, el veto no puede cambiarlo
    if (!cands.length) return null; // candidatos vaciados con el vuelo en marcha: sin ganador
    const weights = cands.map((o) => 1 + (o.energia === energia ? 2 : 0) + (o.foco === foco ? 2 : 0));
    const sum = weights.reduce((a, b) => a + b, 0);
    let r = rand() * sum;
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i];
      if (r <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  let timers = [];
  onMount(() => () => timers.forEach(clearTimeout));
  function girar() {
    if (phase !== 'idle' || !candidatos.length) return;
    vetoUsed = false;
    launch(null);
  }
  function launch(exclude, { respin = false } = {}) {
    const w = pick(exclude);
    if (!w) {
      closeReveal();
      showToast('Nada cabe en ese tiempo');
      return;
    }
    winner = w;
    if (prefersReducedMotion()) {
      phase = 'revealed'; // revelación DIRECTA con fundido, sin centrifugado
      return;
    }
    phase = 'spinning';
    // el re-giro del veto NO re-centrifuga: las tarjetas ya están recogidas (fill forwards) —
    // re-animarlas desde el estado oculto solo ensucia; una pausa corta y la nueva palabra
    if (!respin) centrifuge();
    timers.push(setTimeout(() => {
      if (phase === 'spinning') phase = 'revealed';
    }, respin ? 620 : 1060));
  }
  function centrifuge() {
    if (!stageEl) return;
    const sr = stageEl.getBoundingClientRect();
    const cx = sr.left + sr.width / 2;
    const cy = sr.top + sr.height / 2;
    stageEl.querySelectorAll('.opt').forEach((n, i) => {
      const nr = n.getBoundingClientRect();
      const dx = cx - (nr.left + nr.width / 2);
      const dy = cy - (nr.top + nr.height / 2);
      const fits = !n.classList.contains('unfit');
      n.animate(
        [
          { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: fits ? 1 : 0.26 },
          { transform: `translate(${dx.toFixed(0)}px,${dy.toFixed(0)}px) rotate(${400 + i * 40}deg) scale(.22)`, opacity: 0 }
        ],
        { duration: 900, delay: i * 35, easing: 'cubic-bezier(.5,0,.15,1)', fill: 'forwards' }
      );
    });
  }
  // VETO ÚNICO: el segundo resultado es inapelable — se comunica en serif cursiva, sin regañar
  function veto() {
    if (vetoUsed || phase !== 'revealed') return;
    vetoUsed = true;
    launch(winner, { respin: true });
  }
  let doing = $state(false); // reentrada: "Lo hago" en vuelo deshabilita los botones del overlay
  async function doIt() {
    const w = winner;
    if (!w || doing) return;
    if (w.tipo === 'consumible') {
      doing = true;
      try {
        await poolQuitar(w.id);
      } catch {
        showToast('No se pudo quitar — sigue en el pool', 'error');
        doing = false;
        return; // el overlay se queda: la UI no afirma lo que el server no confirmó
      }
      await load();
      doing = false;
      if (w.obra_id) {
        phase = 'done'; // consumible + obra → enlace a registrarlo en el Diario
        return;
      }
    } else {
      showToast('Recurrente — sigue en el pool');
    }
    closeReveal();
  }
  function registrar() {
    const w = winner;
    closeReveal();
    onregistrar?.({ titulo: w?.obra?.titulo ?? '', categoria: w?.obra?.categoria ?? 'pelicula', anio: w?.obra?.anio_obra ?? null });
  }
  function closeReveal() {
    winner = null;
    vetoUsed = false;
    phase = 'idle';
  }

  // ── quitar del pool (tap en la tarjeta → chip de confirmación) ──
  function tapCard(o) {
    quitando = quitando === o.id ? null : o.id;
  }
  async function quitar(o) {
    try {
      await poolQuitar(o.id);
      quitando = null;
      await load();
      showToast('Fuera del pool');
    } catch {
      showToast('No se pudo quitar', 'error');
    }
  }

  // ── añadir al pool: autocompletado contra el archivo + texto libre + 3 atributos + tipo;
  //    con 10/10 el flujo "hacer sitio" (tocar la que sale; el intercambio es atómico) ──
  let showAdd = $state(false);
  let q = $state('');
  let sug = $state([]);
  let selObra = $state(null);
  let fTipo = $state('consumible');
  let fEnergia = $state('activa');
  let fFoco = $state('centrado');
  let fTiempo = $state(1);
  let makingRoom = $state(false);
  let saleId = $state(null);
  let saving = $state(false);
  let addSeq = 0;
  let addTimer;
  $effect(() => {
    const t = q.trim();
    const locked = selObra;
    clearTimeout(addTimer);
    if (locked || t.length < 2) {
      addSeq++; // invalida cualquier búsqueda YA despachada: su respuesta tardía no re-pinta sug
      sug = [];
      return;
    }
    const seq = ++addSeq;
    addTimer = setTimeout(async () => {
      try {
        const r = await buscarObras(t);
        if (seq === addSeq) sug = r;
      } catch {
        /* la búsqueda no bloquea el alta: siempre queda el texto libre */
      }
    }, 250);
    return () => clearTimeout(addTimer);
  });
  function openAdd() {
    q = '';
    sug = [];
    selObra = null;
    fTipo = 'consumible';
    fEnergia = 'activa';
    fFoco = 'centrado';
    fTiempo = 1;
    makingRoom = false;
    saleId = null;
    showAdd = true;
  }
  function pickSug(o) {
    selObra = o;
    q = o.titulo;
    sug = [];
  }
  let addTitle = $derived(selObra?.titulo ?? q.trim());
  let canSubmit = $derived(!!(selObra || q.trim().length >= 2));
  async function submitAdd() {
    if (saving || !canSubmit) return;
    if (pool.length >= 10 && !saleId) {
      makingRoom = true; // el pool está lleno: elige la que sale (el server lo re-impone igualmente)
      return;
    }
    saving = true;
    try {
      await poolAgregar({
        tipo: fTipo,
        obra_id: selObra?.id ?? null,
        texto_libre: selObra ? null : q.trim(),
        energia: fEnergia,
        foco: fFoco,
        tiempo: fTiempo,
        sale_id: saleId
      });
      await load();
      showAdd = false;
      showToast('En el pool');
    } catch (e) {
      const msg = e.message.replace(/^poolAgregar: /, '');
      if (/lleno|ya no está/.test(msg)) {
        // límite SERVER-SIDE / estado rancio (otro dispositivo tocó el pool): la parrilla de
        // "hacer sitio" se reconstruye sobre el estado FRESCO — nunca un bucle sobre datos viejos
        await load();
        saleId = null;
        makingRoom = true;
        if (/ya no está/.test(msg)) showToast(msg, 'error');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      saving = false;
    }
  }

  // teclado + foco del overlay: Escape cierra; al revelar, el foco va al botón principal
  function onKey(e) {
    if (e.key === 'Escape' && (phase === 'revealed' || phase === 'done') && !doing) closeReveal();
  }
  $effect(() => {
    if (phase === 'revealed' || phase === 'done') {
      const t = setTimeout(() => document.querySelector('.ovl .obtns .ambtn')?.focus(), 60);
      return () => clearTimeout(t);
    }
  });

  // hooks de test (?test=1)
  onMount(() => {
    if (typeof window !== 'undefined' && window.__ocio) {
      window.__ocio.indecision = {
        state: () => ({
          n: pool.length,
          phase,
          vetoUsed,
          winnerId: winner?.id ?? null,
          winnerTitle: winner ? titleOf(winner) : null,
          candidatos: candidatos.map((c) => c.id),
          ids: pool.map((p) => ({ id: p.id, t: titleOf(p), tiempo: p.tiempo }))
        }),
        reload: () => load()
      };
      return () => {
        delete window.__ocio.indecision;
      };
    }
  });
</script>

<svelte:window onkeydown={onKey} />

<section class="indeci">
  <header class="ihead">
    <div>
      <div class="eyebrow">EL DECISOR DE OCIO</div>
      <h2>La Indecisión</h2>
    </div>
    <div class="ihr">
      <span class="chip" class:full={pool.length >= 10}>{pool.length} / 10</span>
      <button class="ghostbtn" onclick={openAdd}>+ Añadir</button>
    </div>
  </header>

  {#if loading}
    <div class="skel"><Skeleton h="320px" r="18px" /></div>
  {:else if error}
    <div class="err">
      <p>No se pudo cargar el pool.</p>
      <button class="ghostbtn" onclick={load}>Reintentar</button>
    </div>
  {:else if pool.length === 0}
    <div class="empty">
      <div class="ecirc"><span>✦</span></div>
      <div class="etit">La indecisión espera.</div>
      <p>Añade hasta diez planes — una película, una partida, un paseo — y deja que el azar decida por ti.</p>
      <div class="ecap">MÁXIMO 10 · ESTO NO ES OTRA WATCHLIST</div>
      <button class="ambtn" onclick={openAdd}>Añadir la primera opción</button>
    </div>
  {:else}
    <div class="stage" bind:this={stageEl}>
      {#each pool as o, i (o.id)}
        <div class="opt" class:unfit={o.tiempo > tiempo} style="left:{SLOTS[i % 10].x}%; top:{SLOTS[i % 10].y}%">
          <div class="dr">
            <div class="ocard" class:rec={o.tipo === 'recurrente'} role="button" tabindex="0" onclick={() => tapCard(o)} onkeydown={(e) => e.key === 'Enter' && tapCard(o)}>
              {#if o.tipo === 'recurrente'}<span class="recbadge">↻ RECURRENTE</span>{/if}
              {#if o.obra_id}
                <!-- la inicial vive SIEMPRE debajo: si la URL remota falla (onerror), la carátula
                     rota se retira y queda el fallback tipográfico, no un hueco -->
                <div class="cov" style="background:linear-gradient(160deg, {col(o).c}33, #14110d)">
                  <span class="ini" style="color:{col(o).tint}">{iniOf(o)}</span>
                  {#if o.obra?.imagen_url}
                    <img src={o.obra.imagen_url} alt="" loading="lazy" onerror={(e) => e.currentTarget.remove()} />
                  {/if}
                </div>
                <div class="cname">{o.obra?.titulo}</div>
              {:else}
                <div class="tname" style="color:{col(o).tint}">{o.texto_libre}</div>
              {/if}
              <div class="cmeta"><span style="color:{col(o).c}">●</span> {catLabel(o)}</div>
              {#if quitando === o.id}
                <button class="qbtn" onclick={(e) => { e.stopPropagation(); quitar(o); }}>✕ Quitar</button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
      <div class="cred">IMÁGENES: TMDB · STEAM · OPENLIBRARY</div>
    </div>

    <div class="moodbar">
      <!-- el ánimo se toca ANTES de girar: con el sorteo en vuelo los candidatos no se mueven -->
      <div class="mgrp">
        <div class="mlbl">ENERGÍA</div>
        <div class="seg">
          <button class="sb" class:on={energia === 'activa'} disabled={phase !== 'idle'} onclick={() => (energia = 'activa')}>Activa</button>
          <button class="sb" class:on={energia === 'pasiva'} disabled={phase !== 'idle'} onclick={() => (energia = 'pasiva')}>Pasiva</button>
        </div>
      </div>
      <div class="mgrp">
        <div class="mlbl">FOCO</div>
        <div class="seg">
          <button class="sb" class:on={foco === 'centrado'} disabled={phase !== 'idle'} onclick={() => (foco = 'centrado')}>Centrado</button>
          <button class="sb" class:on={foco === 'disperso'} disabled={phase !== 'idle'} onclick={() => (foco = 'disperso')}>Disperso</button>
        </div>
      </div>
      <div class="mgrp mtime">
        <div class="mlbl">TIEMPO DISPONIBLE</div>
        <div class="seg">
          <button class="sb" class:on={tiempo === 0} disabled={phase !== 'idle'} onclick={() => (tiempo = 0)}>30 min</button>
          <button class="sb" class:on={tiempo === 1} disabled={phase !== 'idle'} onclick={() => (tiempo = 1)}>1–2 h</button>
          <button class="sb" class:on={tiempo === 2} disabled={phase !== 'idle'} onclick={() => (tiempo = 2)}>La tarde</button>
        </div>
      </div>
      <div class="mnote">
        {#if candidatos.length}
          El ánimo pondera el azar; solo el tiempo excluye.<br />Lo que no cabe se atenúa.
        {:else}
          Nada cabe en ese tiempo — ajústalo, o acepta un plan más corto.
        {/if}
      </div>
      <button class="spinbtn" onclick={girar} disabled={phase !== 'idle' || !candidatos.length}>
        <span class="spinring"></span>{phase === 'spinning' ? 'Girando…' : '✦ Girar'}
      </button>
    </div>
  {/if}
</section>

<!-- REVELACIÓN — overlay fijo (z-50, mismo hueco que la Constelación: nunca coexisten) -->
{#if phase === 'revealed' || phase === 'done'}
  <div class="ovl" role="dialog" aria-modal="true" aria-label="La Indecisión dice">
    <button class="ox" aria-label="Cerrar" onclick={closeReveal}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
    </button>
    <div class="obody">
      {#if phase === 'revealed' && winner}
        <div class="olbl">LA INDECISIÓN DICE</div>
        <div class="ocov-wrap">
          <div class="oglow" style="background:radial-gradient(closest-side, {col(winner).c}55, transparent)"></div>
          <div class="ocov" style="background:linear-gradient(160deg, {col(winner).c}44, #14110d)">
            <span class="oini" style="color:{col(winner).tint}">{iniOf(winner)}</span>
            {#if winner.obra?.imagen_url}
              <img src={winner.obra.imagen_url} alt="" onerror={(e) => e.currentTarget.remove()} />
            {/if}
          </div>
        </div>
        <div class="oname">{titleOf(winner)}</div>
        <div class="ometa">{catLabel(winner)} · {TIME_LABEL[winner.tiempo]}</div>
        <div class="oattrs">{winner.energia === 'activa' ? 'ACTIVA' : 'PASIVA'} · {winner.foco === 'centrado' ? 'CENTRADO' : 'DISPERSO'}</div>
        <div class="ostay">{winner.tipo === 'consumible' ? 'Al hacerlo, sale del pool.' : 'Recurrente — se queda en el pool.'}</div>
        {#if vetoUsed}
          <div class="ofinal">Palabra final. El veto ya está jugado — confía en el azar.</div>
        {/if}
        <div class="obtns">
          <button class="ambtn" disabled={doing} onclick={doIt}>{doing ? 'Un momento…' : 'Lo hago →'}</button>
          {#if !vetoUsed && candidatos.length > 1}
            <!-- con 1 solo candidato el veto no puede cambiar nada: ofrecerlo sería mentir -->
            <button class="ghostbtn" disabled={doing} onclick={veto}>Veto · te queda 1</button>
          {/if}
        </div>
        <div class="ocred">IMÁGENES: TMDB · STEAM · OPENLIBRARY</div>
      {:else if phase === 'done'}
        <div class="olbl">HECHO</div>
        <div class="oname">Fuera del pool.</div>
        <div class="ostay">Cuando lo vivas, regístralo — el archivo es lo que cuenta.</div>
        <div class="obtns">
          <button class="ambtn" onclick={registrar}>Registrarlo en el Diario →</button>
          <button class="ghostbtn" onclick={closeReveal}>Cerrar</button>
        </div>
        <div class="ocred">IMÁGENES: TMDB · STEAM · OPENLIBRARY</div>
      {/if}
    </div>
  </div>
{/if}

<!-- AÑADIR AL POOL (sheet): autocompletado + texto libre + tipo + 3 atributos · "hacer sitio" -->
<Sheet open={showAdd} title={makingRoom ? 'Hacer sitio' : 'Añadir al pool'} eyebrow="La Indecisión" onclose={() => (showAdd = false)}>
  {#if !makingRoom}
    <div class="addform">
      <input class="addq" placeholder="Busca en tu archivo o escribe un plan…" bind:value={q} oninput={() => (selObra = null)} maxlength="90" autocomplete="off" />
      {#if sug.length || (q.trim().length >= 2 && !selObra)}
        <div class="suglist">
          {#each sug as s (s.id)}
            <button class="sugrow" onclick={() => pickSug(s)}>
              <div class="sugcov" style="background:linear-gradient(160deg, {(CAT_COLOR[s.categoria] ?? NEUTRO).c}33, #14110d)">
                <span style="color:{(CAT_COLOR[s.categoria] ?? NEUTRO).tint}">{(s.titulo || '?').charAt(0).toUpperCase()}</span>
                {#if s.imagen_url}<img src={s.imagen_url} alt="" loading="lazy" onerror={(e) => e.currentTarget.remove()} />{/if}
              </div>
              <div class="sugtxt">
                <div class="sugt">{s.titulo}{#if s.anio_obra}&nbsp;({s.anio_obra}){/if}</div>
                <div class="sugm"><span style="color:{(CAT_COLOR[s.categoria] ?? NEUTRO).c}">●</span> {CAT_LABEL[s.categoria] ?? s.categoria} · DE TU ARCHIVO</div>
              </div>
            </button>
          {/each}
          {#if q.trim().length >= 2 && !selObra}
            <button class="sugrow libre" onclick={() => { selObra = null; sug = []; }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
              <span>Añadir «{q.trim()}» como texto libre</span>
            </button>
          {/if}
        </div>
      {/if}
      {#if selObra}
        <p class="sugsel"><span style="color:{(CAT_COLOR[selObra.categoria] ?? NEUTRO).c}">●</span> Del archivo: <strong>{selObra.titulo}</strong></p>
      {/if}

      <div class="flbl">TIPO</div>
      <div class="seg wide">
        <button class="sb" class:on={fTipo === 'consumible'} onclick={() => (fTipo = 'consumible')}>Consumible · se hace y sale</button>
        <button class="sb" class:on={fTipo === 'recurrente'} onclick={() => (fTipo = 'recurrente')}>↻ Recurrente</button>
      </div>
      <div class="flbl">ENERGÍA</div>
      <div class="seg wide">
        <button class="sb" class:on={fEnergia === 'activa'} onclick={() => (fEnergia = 'activa')}>Activa</button>
        <button class="sb" class:on={fEnergia === 'pasiva'} onclick={() => (fEnergia = 'pasiva')}>Pasiva</button>
      </div>
      <div class="flbl">FOCO</div>
      <div class="seg wide">
        <button class="sb" class:on={fFoco === 'centrado'} onclick={() => (fFoco = 'centrado')}>Centrado</button>
        <button class="sb" class:on={fFoco === 'disperso'} onclick={() => (fFoco = 'disperso')}>Disperso</button>
      </div>
      <div class="flbl">TIEMPO QUE PIDE</div>
      <div class="seg wide">
        <button class="sb" class:on={fTiempo === 0} onclick={() => (fTiempo = 0)}>30 min</button>
        <button class="sb" class:on={fTiempo === 1} onclick={() => (fTiempo = 1)}>1–2 h</button>
        <button class="sb" class:on={fTiempo === 2} onclick={() => (fTiempo = 2)}>La tarde</button>
      </div>
      <button class="ambtn addgo" disabled={!canSubmit || saving} onclick={submitAdd}>{saving ? 'Añadiendo…' : 'Añadir al pool'}</button>
    </div>
  {:else}
    <div class="room">
      <div class="roombanner">
        <div class="rtit">El pool está lleno.</div>
        <p>Para que entre <span class="ink">«{addTitle}»</span>, toca la opción que sale. Diez huecos: así el azar significa algo.</p>
      </div>
      <div class="roomgrid">
        {#each pool as o (o.id)}
          <button class="roomcell" class:rec={o.tipo === 'recurrente'} class:sale={saleId === o.id} onclick={() => (saleId = saleId === o.id ? null : o.id)}>
            <span class="rdot" style="background:{col(o).c}"></span>
            <span class="rname">{titleOf(o)}</span>
            {#if saleId === o.id}<span class="salebadge">SALE</span>{/if}
          </button>
        {/each}
      </div>
      <div class="roombtns">
        <button class="ghostbtn" onclick={() => { makingRoom = false; saleId = null; }}>Cancelar</button>
        <button class="ambtn" disabled={!saleId || saving} onclick={submitAdd}>{saving ? 'Cambiando…' : 'Hacer el cambio'}</button>
      </div>
    </div>
  {/if}
</Sheet>

<style>
  .indeci {
    isolation: isolate; /* regla 9: los z internos no compiten fuera */
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 210px);
    padding-top: 0.6rem;
  }
  .ihead {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .eyebrow {
    font-family: var(--font-data);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    color: var(--label);
  }
  .ihead h2 {
    font-family: var(--font-display);
    font-weight: 500;
    font-size: 1.7rem;
    color: var(--ink);
    margin: 2px 0 0;
  }
  .ihr { display: flex; gap: 10px; align-items: center; }
  .chip {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    padding: 6px 12px;
    font-family: var(--font-data);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--gold);
    background: var(--surface);
    border: 1px solid rgba(242, 166, 90, 0.3);
  }
  .chip.full { color: var(--accent); border-color: rgba(232, 96, 44, 0.35); }

  .skel { margin-top: 1rem; }
  .err { padding: 2rem 0; color: var(--ink-2); display: flex; flex-direction: column; gap: 0.8rem; align-items: flex-start; }

  /* ── escenario flotante ── */
  .stage {
    position: relative;
    flex: 1;
    min-height: clamp(320px, 48dvh, 560px);
    margin: 0.4rem 0 0.6rem;
  }
  .opt {
    position: absolute;
    width: 132px;
    transition: opacity 0.45s, filter 0.45s;
  }
  .opt.unfit { opacity: 0.26; filter: grayscale(0.7); } /* el tiempo excluye: se atenúa EN VIVO */
  .ocard {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 10px 10px 11px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
    position: relative;
    cursor: pointer;
  }
  .ocard.rec { border-style: dashed; border-color: #3a3327; }
  .recbadge {
    position: absolute;
    top: -9px;
    right: -6px;
    background: #1a1610;
    border: 1px solid #433b30;
    border-radius: 999px;
    padding: 2px 8px;
    font-family: var(--font-data);
    font-size: 7px;
    color: #c9a877;
    letter-spacing: 0.08em;
  }
  .cov {
    position: relative;
    width: 58px;
    height: 82px;
    border-radius: 6px;
    border: 1px solid var(--line-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .cov img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .ini { font-family: var(--font-display); font-size: 26px; }
  .cname {
    font-family: var(--font-display);
    font-weight: 500;
    color: var(--ink);
    font-size: 13px;
    text-align: center;
    line-height: 1.12;
  }
  .tname {
    font-family: var(--font-display);
    font-size: 15px;
    text-align: center;
    line-height: 1.18;
    padding: 10px 2px 4px;
  }
  .cmeta { font-family: var(--font-data); font-size: 7px; letter-spacing: 0.12em; color: var(--ink-3); }
  .qbtn {
    position: absolute;
    bottom: -12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent);
    color: #0b0a08;
    border: none;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }

  /* ── barra de ánimo (sticky al fondo: el ritual queda a mano) ── */
  .moodbar {
    position: sticky;
    bottom: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 12px 4px 14px;
    border-top: 1px solid var(--line);
    background: rgba(11, 10, 8, 0.78);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
  .mlbl {
    font-family: var(--font-data);
    font-size: 0.56rem;
    letter-spacing: 0.12em;
    color: var(--label);
    margin-bottom: 7px;
  }
  .seg {
    display: flex;
    gap: 3px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 3px;
  }
  .sb {
    font-family: var(--font-data);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    padding: 8px 13px;
    border-radius: 999px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: color 0.2s, background 0.2s;
    white-space: nowrap;
  }
  .sb:hover { color: var(--ink-2); }
  .sb.on { background: var(--accent); color: #0b0a08; font-weight: 700; }
  .sb:disabled { cursor: default; opacity: 0.75; }
  /* atribución obligatoria donde se muestran carátulas (TMDB la exige; §11.28) */
  .cred {
    position: absolute;
    right: 2px;
    bottom: 2px;
    font-family: var(--font-data);
    font-size: 7px;
    letter-spacing: 0.12em;
    color: var(--ink-3);
    opacity: 0.8;
    pointer-events: none;
  }
  .ocred {
    font-family: var(--font-data);
    font-size: 7px;
    letter-spacing: 0.12em;
    color: var(--ink-3);
    margin-top: 18px;
    opacity: 0.8;
  }
  .mnote {
    flex: 1;
    font-family: var(--font-display);
    font-style: italic;
    font-size: 14px;
    color: var(--ink-3);
    text-align: right;
    padding-right: 6px;
    line-height: 1.35;
  }
  .spinbtn {
    position: relative;
    background: var(--accent);
    color: #0b0a08;
    border: none;
    border-radius: 999px;
    padding: 0 34px;
    height: 58px;
    font-weight: 800;
    font-size: 17px;
    cursor: pointer;
    box-shadow: 0 10px 30px rgba(232, 96, 44, 0.4);
    transition: transform 0.25s;
    flex: none;
  }
  .spinbtn:hover:not(:disabled) { transform: translateY(-2px); }
  .spinbtn:active:not(:disabled) { transform: scale(0.96); }
  .spinbtn:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
  .spinring {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    border: 2px solid var(--accent);
    animation: pulsering 2.4s ease-out infinite;
    pointer-events: none;
  }
  .spinbtn:disabled .spinring { animation: none; opacity: 0; }
  @keyframes pulsering {
    0% { transform: scale(1); opacity: 0.5; }
    100% { transform: scale(1.7); opacity: 0; }
  }

  /* ── vacío ── */
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 3rem 2rem;
    gap: 0;
  }
  .ecirc {
    width: 130px;
    height: 130px;
    border-radius: 50%;
    border: 1.5px dashed #433b30;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 28px;
    animation: floaty 6s ease-in-out infinite;
  }
  .ecirc span { font-family: var(--font-display); font-size: 44px; color: var(--label); }
  .etit { font-family: var(--font-display); font-weight: 500; font-size: 24px; color: var(--ink); line-height: 1.25; }
  .empty p { font-size: 14px; color: var(--ink-2); line-height: 1.55; margin: 10px 0 0; max-width: 30em; }
  .ecap { font-family: var(--font-data); font-size: 0.62rem; letter-spacing: 0.12em; color: var(--ink-3); margin-top: 14px; }
  .empty .ambtn { margin-top: 24px; }
  @keyframes floaty {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-7px); }
  }

  /* ── revelación ── */
  .ovl {
    position: fixed;
    inset: 0;
    z-index: 50;
    isolation: isolate;
    background: rgba(8, 7, 5, 0.8);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow-y: auto; /* apaisado móvil (844×390): el contenido alto scrollea, no se corta */
    animation: ovlIn 0.4s ease both;
  }
  @keyframes ovlIn { from { opacity: 0; } }
  .ox {
    position: absolute;
    top: 20px;
    right: 22px;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid var(--line-strong);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ink-2);
    cursor: pointer;
  }
  .obody { position: relative; text-align: center; max-width: 420px; padding: 20px; margin: auto; }
  .olbl { font-family: var(--font-data); font-size: 0.68rem; color: var(--label); letter-spacing: 0.24em; }
  .ocov-wrap { position: relative; width: 170px; height: 238px; margin: 26px auto 0; }
  .oglow {
    position: absolute;
    inset: -34px;
    border-radius: 50%;
    animation: auraBreath 4.5s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes auraBreath {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.75; transform: scale(1.08); }
  }
  .ocov {
    position: relative;
    width: 170px;
    height: 238px;
    border-radius: 12px;
    border: 1px solid #433b30;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }
  .ocov img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .oini { font-family: var(--font-display); font-size: 72px; }
  .oname { font-family: var(--font-display); font-weight: 500; font-size: 34px; color: var(--ink); line-height: 1.05; margin-top: 22px; }
  .ometa { font-family: var(--font-data); font-size: 0.62rem; letter-spacing: 0.12em; color: var(--ink-3); margin-top: 9px; }
  .oattrs { font-family: var(--font-data); font-size: 0.56rem; letter-spacing: 0.12em; color: var(--label); margin-top: 6px; }
  .ostay { font-size: 13px; color: var(--ink-2); margin-top: 10px; }
  .ofinal { font-family: var(--font-display); font-style: italic; font-size: 16px; color: var(--gold); margin-top: 14px; }
  .obtns { display: flex; gap: 12px; justify-content: center; margin-top: 22px; flex-wrap: wrap; }

  /* botones compartidos */
  .ghostbtn {
    background: transparent;
    border: 1px solid #433b30;
    color: var(--ink-2);
    border-radius: 999px;
    padding: 11px 20px;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }
  .ghostbtn:hover { border-color: var(--ink-3); color: var(--ink); }
  .ambtn {
    background: var(--accent);
    color: #0b0a08;
    border: none;
    border-radius: 999px;
    padding: 13px 26px;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
  }
  .ambtn:disabled { opacity: 0.5; cursor: default; }

  /* ── sheet de añadir ── */
  .addform { display: flex; flex-direction: column; }
  .addq {
    background: var(--surface);
    border: 1.5px solid var(--accent);
    border-radius: 14px;
    padding: 14px 16px;
    font-family: var(--font-display);
    font-size: 17px;
    color: var(--ink);
    outline: none;
    width: 100%;
  }
  .suglist {
    background: #100e0b;
    border: 1px solid var(--line);
    border-radius: 14px;
    margin-top: 8px;
    overflow: hidden;
  }
  .sugrow {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 14px;
    width: 100%;
    background: transparent;
    border: none;
    border-top: 1px solid var(--line);
    cursor: pointer;
    text-align: left;
  }
  .sugrow:first-child { border-top: none; }
  .sugrow:hover { background: #171410; }
  .sugcov {
    width: 30px;
    height: 42px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: 14px;
  }
  .sugcov { position: relative; }
  .sugcov img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .sugt { font-family: var(--font-display); font-weight: 500; color: var(--ink); font-size: 14px; }
  .sugm { font-family: var(--font-data); font-size: 7px; letter-spacing: 0.12em; color: var(--ink-3); margin-top: 2px; }
  .sugrow.libre { color: var(--ink-2); gap: 11px; font-size: 13px; }
  .sugrow.libre svg { color: var(--label); flex: none; }
  .sugsel { font-size: 13px; color: var(--ink-2); margin: 8px 2px 0; }
  .sugsel .ink, .room .ink { color: var(--ink); }
  .flbl { font-family: var(--font-data); font-size: 0.56rem; letter-spacing: 0.12em; color: var(--label); margin: 18px 0 7px; }
  .seg.wide { width: 100%; }
  .seg.wide .sb { flex: 1; text-align: center; }
  .addgo { width: 100%; margin-top: 22px; padding: 15px; }

  /* hacer sitio */
  .roombanner {
    background: linear-gradient(135deg, #1b1610, #120f0b);
    border: 1px solid rgba(242, 166, 90, 0.25);
    border-radius: 16px;
    padding: 16px;
  }
  .rtit { font-family: var(--font-display); font-weight: 500; font-size: 17px; color: var(--ink); line-height: 1.25; }
  .roombanner p { font-size: 13px; color: var(--ink-2); margin: 6px 0 0; line-height: 1.5; }
  .roomgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 16px; }
  .roomcell {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    text-align: left;
  }
  .roomcell.rec { border-style: dashed; border-color: #3a3327; }
  .roomcell.sale { background: rgba(232, 96, 44, 0.1); border: 1.5px solid var(--accent); }
  .rdot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
  .rname { font-family: var(--font-display); font-weight: 500; color: var(--ink); font-size: 12px; line-height: 1.1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .salebadge {
    position: absolute;
    top: -9px;
    right: 8px;
    background: var(--accent);
    color: #0b0a08;
    border-radius: 999px;
    padding: 2px 8px;
    font-family: var(--font-data);
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .roombtns { display: flex; gap: 10px; margin-top: 18px; }
  .roombtns .ghostbtn { flex: 1; }
  .roombtns .ambtn { flex: 1.4; }

  /* ── móvil ≤700: tarjetas más pequeñas, moodbar apilada, girar a lo ancho ── */
  @media (max-width: 700px) {
    .indeci { min-height: calc(100dvh - 170px); }
    .stage { min-height: clamp(380px, 54dvh, 580px); }
    .opt { width: 104px; }
    .cov { width: 50px; height: 70px; }
    .cname { font-size: 12px; }
    .tname { font-size: 13px; }
    .moodbar { flex-wrap: wrap; gap: 8px; padding: 12px 2px 14px; }
    .mgrp { flex: 1; min-width: 44%; }
    .mgrp.mtime { flex-basis: 100%; }
    .seg { width: 100%; }
    .seg .sb { flex: 1; text-align: center; padding: 8px 6px; }
    .mnote { display: none; }
    .spinbtn { width: 100%; height: 56px; }
    .oname { font-size: 28px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinring, .oglow, .ecirc { animation: none !important; }
    .ovl { animation-duration: 0.01s; }
  }
</style>
