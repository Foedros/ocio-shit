<script>
  // Vista GALERÍA del Diario — cover flow 3D (diseno/Ocio Shit - Cover Flow.html): hilera en
  // perspectiva, central de frente y grande, laterales en ángulo con reflejo, caption bajo la
  // central. Consume las MISMAS entradas que la lista ($archiveEntries → respeta filtros activos).
  // VENTANA PEREZOSA: de miles de obras solo viven ±4 del centro (~9 covers montados).
  // Carátulas = obra.imagen_url (Fase 1, URLs hotlinkeadas TMDB/Steam/OpenLibrary) con fallback
  // tipográfico OBLIGATORIO en dos casos: URL NULL y error de carga (onerror) — pueden romperse.
  import { archiveEntries, detail } from '$lib/stores.js';
  import { openEntryDetail } from '$lib/boot-supabase.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { fmtFecha, fmtValoracion } from '$lib/format.js';

  let { resetKey = undefined } = $props();

  const WINDOW = 4; // ±4 del centro
  let idx = $state(0);
  let stageEl = $state(null);
  let mobile = $state(false);
  let broken = $state(new Set()); // entrada_ids cuya imagen falló al cargar → fallback

  let items = $derived($archiveEntries);
  let count = $derived(items.length);
  let cur = $derived(count ? items[Math.min(idx, count - 1)] : null);

  // Al cambiar los filtros del Diario, la galería vuelve al principio (mismo criterio que la lista).
  let lastReset = $state(resetKey);
  $effect(() => {
    if (resetKey === lastReset) return;
    lastReset = resetKey;
    idx = 0;
  });
  // Clamp si la lista encoge (borrado, filtro más estrecho).
  $effect(() => {
    if (count && idx > count - 1) idx = count - 1;
  });

  $effect(() => {
    const mq = window.matchMedia('(max-width: 700px)');
    const upd = () => (mobile = mq.matches);
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  });

  // Geometría del diseño (H fija, ancho variable por forma; spread menor en móvil).
  let H = $derived(mobile ? 220 : 280);
  let SPREAD = $derived(mobile ? 106 : 160);

  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };
  const label = (v) => CATEGORIA_LABELS[v] ?? v ?? '';
  const grp = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Altura fija, ancho variable: header de Steam (460×215) → ancho; póster (TMDB/OpenLibrary) → 2:3.
  const isWide = (it) => (it.imagen_url || '').includes('steamstatic');
  const wOf = (it) => Math.round(isWide(it) ? H * 1.3 : H * 0.667);
  const hasImg = (it) => !!it.imagen_url && !broken.has(it.entrada_id);
  const markBroken = (id) => (broken = new Set(broken).add(id));

  // Ventana perezosa: solo ±WINDOW covers montados.
  let win = $derived.by(() => {
    if (!count) return [];
    const c = Math.min(idx, count - 1);
    const lo = Math.max(0, c - WINDOW);
    const hi = Math.min(count - 1, c + WINDOW);
    const out = [];
    for (let i = lo; i <= hi; i++) out.push({ it: items[i], off: i - c });
    return out;
  });

  // Transforms del diseño: central plana y grande; laterales en ángulo, empujadas atrás.
  function transformFor(off) {
    if (off === 0) return 'translate(-50%,-50%)';
    const abs = Math.abs(off);
    const dir = off < 0 ? 1 : -1;
    const x = off * SPREAD + dir * -30;
    return `translate(-50%,-50%) translateX(${x}px) translateZ(${-160 - abs * 60}px) rotateY(${dir * 52}deg) scale(0.86)`;
  }
  const opacityFor = (off) => (off === 0 ? 1 : Math.max(0.25, 0.8 - Math.abs(off) * 0.16));

  const move = (d) => (idx = Math.max(0, Math.min(count - 1, idx + d)));
  const onCoverClick = (off, it) => (off === 0 ? openEntryDetail(it.entrada_id) : move(off));

  // Navegación: rueda (no pasiva, con lock) + drag/swipe (umbral 60px), como el diseño.
  $effect(() => {
    const el = stageEl;
    if (!el) return;
    let wheelLock = 0;
    const onWheel = (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now - wheelLock < 260) return;
      wheelLock = now;
      move((e.deltaX || e.deltaY) > 0 ? 1 : -1);
    };
    let sx = 0, dragging = false;
    const down = (x) => { dragging = true; sx = x; el.style.cursor = 'grabbing'; };
    const drag = (x) => {
      if (!dragging) return;
      const dx = x - sx;
      if (Math.abs(dx) > 60) { move(dx > 0 ? -1 : 1); dragging = false; el.style.cursor = 'grab'; }
    };
    const up = () => { dragging = false; el.style.cursor = 'grab'; };
    const md = (e) => down(e.clientX);
    const mm = (e) => drag(e.clientX);
    // TÁCTIL (solo móvil) — el CICLO DE VIDA del gesto va por POINTER EVENTS con setPointerCapture
    // en el stage. Motivo (bug real en dispositivo): los touch events se entregan al TARGET ORIGINAL
    // (la carátula bajo el dedo); durante el auto-scroll la ventana ±4 desliza y esa carátula se
    // DESMONTA → touchend/touchcancel disparan sobre el nodo huérfano y no burbujean al stage →
    // el auto-scroll no paraba nunca. La captura de puntero re-dirige move/up/cancel al stage pase
    // lo que pase con los hijos. Se captura SOLO al confirmar gesto horizontal (los taps sobre
    // covers siguen produciendo su click normal). El touchmove passive:false queda únicamente para
    // preventDefault (bloqueo del scroll vertical, decidido en el PRIMER movimiento — iOS pierde la
    // carrera si esperas); el overflow-lock de html/body cubre cualquier hueco.
    // + AUTO-SCROLL por mantenimiento (~300ms quieto en el 20% lateral) con METÁFORA DE ARRASTRE:
    //   sostener en el borde IZQUIERDO = seguir arrastrando hacia la izquierda = AVANZAR (y
    //   viceversa) — continúa el movimiento del arrastre, no es un botón direccional.
    // + INERCIA (flick): la velocidad al soltar (ventana ~120ms) añade 1..8 pasos extra con
    //   desaceleración suave; cada paso es discreto → snap garantizado a una carátula.
    const EDGE = 0.2, HOLD_MS = 300, AUTO_MS = 400, JITTER = 8, STEP_PX = 60;
    const FLICK_MIN = 0.5, FLICK_K = 2.6, FLICK_MAX = 8; // px/ms → pasos (fuerte ~2-3px/ms → 5-8)
    let pid = null, tx = 0, ty = 0, taxis = null, ax = 0;
    let holdTimer = null, autoInt = null, momTimer = null;
    let hist = []; // [{x,t}] últimos ~120ms, para la velocidad del flick
    const lockPage = (on) => {
      document.documentElement.style.overflow = on ? 'hidden' : '';
      document.body.style.overflow = on ? 'hidden' : '';
    };
    const stopAuto = () => {
      clearTimeout(holdTimer); holdTimer = null;
      clearInterval(autoInt); autoInt = null;
    };
    const stopMomentum = () => { clearTimeout(momTimer); momTimer = null; };
    const zoneOf = (x) => {
      const r = el.getBoundingClientRect();
      const rel = (x - r.left) / r.width;
      return rel <= EDGE ? -1 : rel >= 1 - EDGE ? 1 : 0;
    };
    const armHold = (x) => {
      stopAuto();
      const z = zoneOf(x);
      if (!z) return;
      const dir = -z; // metáfora de arrastre: borde izquierdo (−1) = seguir avanzando (+1)
      holdTimer = setTimeout(() => {
        move(dir);
        autoInt = setInterval(() => move(dir), AUTO_MS);
      }, HOLD_MS);
    };
    const pd = (e) => {
      if (e.pointerType !== 'touch') return; // ratón/lápiz: fuera (escritorio intacto)
      stopMomentum(); stopAuto(); // un dedo nuevo corta inercia o restos de auto-scroll
      pid = e.pointerId; taxis = null;
      tx = e.clientX; ty = e.clientY; ax = tx;
      hist = [{ x: tx, t: e.timeStamp }];
    };
    const pm = (e) => {
      if (e.pointerId !== pid) return;
      const x = e.clientX, y = e.clientY;
      const dx = x - tx, dy = y - ty;
      if (taxis === null) {
        if (dx === 0 && dy === 0) return;
        taxis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v'; // PRIMER movimiento decide
        if (taxis === 'h') {
          lockPage(true);
          try { el.setPointerCapture(pid); } catch { /* sin soporte → belt del overflow-lock */ }
        }
      }
      if (taxis === 'v') return;
      hist.push({ x, t: e.timeStamp });
      while (hist.length > 2 && hist[0].t < e.timeStamp - 120) hist.shift();
      if (Math.abs(dx) > STEP_PX) { move(dx > 0 ? -1 : 1); tx = x; ty = y; }
      if (Math.abs(x - ax) > JITTER) { ax = x; armHold(x); }
    };
    const pu = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      // solo cuenta como "venía de auto-scroll" si el interval LLEGÓ a correr; un holdTimer aún
      // pendiente (armado de pasada durante un flick que cruzó la zona de borde) no anula la inercia
      const veniaDeAuto = !!autoInt;
      stopAuto(); // SIEMPRE e inmediato: soltar (o touchcancel) mata el auto-scroll
      if (taxis === 'h' && !veniaDeAuto && hist.length >= 2) {
        // FLICK: velocidad al soltar → pasos extra con desaceleración (lento = solo el paso del drag)
        const a = hist[0], b = hist[hist.length - 1];
        const v = (b.x - a.x) / Math.max(1, b.t - a.t); // px/ms; + = dedo hacia la derecha
        if (Math.abs(v) > FLICK_MIN) {
          const dir = v > 0 ? -1 : 1;
          let steps = Math.min(FLICK_MAX, Math.max(1, Math.round(Math.abs(v) * FLICK_K)));
          let delay = 90;
          const kick = () => {
            move(dir);
            if (--steps > 0) { delay = Math.round(delay * 1.35); momTimer = setTimeout(kick, delay); }
            else momTimer = null;
          };
          momTimer = setTimeout(kick, 0);
        }
      }
      taxis = null; hist = [];
      lockPage(false);
    };
    // bloqueo del scroll de página (los pointer events no pueden cancelar scroll; esto sí)
    const tmBlock = (e) => { if (taxis === 'h' && e.cancelable) e.preventDefault(); };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
    el.addEventListener('pointerdown', pd);
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pu);
    el.addEventListener('touchmove', tmBlock, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      el.removeEventListener('pointerdown', pd);
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pu);
      el.removeEventListener('touchmove', tmBlock);
      stopAuto();
      stopMomentum();
      lockPage(false);
    };
  });

  // Teclado ←→ (escritorio). No roba las flechas si hay un campo enfocado o el detalle abierto.
  function onKey(e) {
    if ($detail) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if count === 0}
  <div class="empty">
    <div class="mark">◇</div>
    <p class="lead">No hay entradas con estos filtros.</p>
    <p class="hint">Ajusta los filtros, o registra una nueva con el botón +.</p>
  </div>
{:else}
  <div class="gwrap" style="height:{mobile ? 430 : 540}px">
    <div class="stage" bind:this={stageEl}>
      {#each win as { it, off } (it.entrada_id)}
        <div
          class="cover"
          class:center={off === 0}
          style="transform:{transformFor(off)}; opacity:{opacityFor(off)}; z-index:{100 - Math.abs(off)}"
          role="button"
          tabindex="-1"
          aria-label={it.titulo}
          onclick={() => onCoverClick(off, it)}
          onkeydown={(e) => e.key === 'Enter' && onCoverClick(off, it)}
        >
          <div class="cover-inner" style="width:{wOf(it)}px;height:{H}px">
            {#if hasImg(it)}
              <img src={it.imagen_url} alt={it.titulo} loading="lazy" draggable="false" onerror={() => markBroken(it.entrada_id)} />
              <span class="sheen"></span>
            {:else}
              <div class="fallback" style="background:{col(it.categoria).c}; padding:{Math.round(H * 0.12)}px">
                <div class="ftitle" style="font-size:{Math.round(H * 0.11)}px">{it.titulo}</div>
                <div class="ftag" style="bottom:{Math.round(H * 0.06)}px">SIN CARÁTULA</div>
              </div>
            {/if}
          </div>
          <div class="reflection" style="width:{wOf(it)}px;height:{Math.round(H * 0.6)}px" aria-hidden="true">
            <div class="cover-inner noframe" style="width:{wOf(it)}px;height:{H}px">
              {#if hasImg(it)}
                <img src={it.imagen_url} alt="" loading="lazy" draggable="false" />
              {:else}
                <div class="fallback" style="background:{col(it.categoria).c}; padding:{Math.round(H * 0.12)}px">
                  <div class="ftitle" style="font-size:{Math.round(H * 0.11)}px">{it.titulo}</div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>

    {#if !mobile}
      <button type="button" class="arrow left" onclick={() => move(-1)} aria-label="Anterior" disabled={idx === 0}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" class="arrow right" onclick={() => move(1)} aria-label="Siguiente" disabled={idx >= count - 1}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    {/if}

    {#if cur}
      <div class="caption">
        <div class="cline">
          <span class="dot" style="background:{col(cur.categoria).c}"></span>
          <span class="mono clab">{label(cur.categoria)}{#if cur.anio_obra}&nbsp;· {cur.anio_obra}{/if}</span>
        </div>
        <div class="ctitle">{cur.titulo}</div>
        <div class="cscore">
          <span class="score">{cur.valoracion != null ? fmtValoracion(cur.valoracion) : '—'}</span>
          <span class="mono cmeta">{fmtFecha(cur.fecha)}</span>
        </div>
      </div>
    {/if}

    <div class="foot">
      <span class="mono pos">{grp(Math.min(idx, count - 1) + 1)} / {grp(count)}</span>
      <!-- Atribución OBLIGATORIA (TMDB la exige; §11.28) — siempre visible en la Galería -->
      <span class="mono attr">IMÁGENES: TMDB · STEAM · OPENLIBRARY</span>
    </div>
  </div>
{/if}

<style>
  .gwrap {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: radial-gradient(120% 80% at 50% 12%, #16120d 0%, var(--bg) 60%);
    overflow: hidden;
    user-select: none;
  }
  .stage {
    position: absolute;
    inset: 0 0 96px 0; /* deja sitio al caption/foot */
    perspective: 1400px;
    overflow: visible;
    cursor: grab;
    touch-action: pan-y; /* swipe horizontal para navegar; el scroll vertical sigue vivo */
  }
  .cover {
    position: absolute;
    top: 46%;
    left: 50%;
    will-change: transform, opacity;
    transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.5s;
    transform-style: preserve-3d;
  }
  .cover.center {
    cursor: pointer;
  }
  .cover-inner {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(242, 235, 221, 0.08);
    background: var(--surface-2);
  }
  .cover-inner.noframe {
    box-shadow: none;
    border: none;
  }
  .cover-inner img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .sheen {
    position: absolute;
    inset: 0;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 40%);
    pointer-events: none;
  }
  /* Fallback tipográfico: tarjeta sólida del color de categoría, título Newsreader como lomo. */
  .fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ftitle {
    font-family: var(--font-display);
    color: #0b0a08;
    font-weight: 500;
    text-align: center;
    line-height: 1.1;
    overflow: hidden;
  }
  .ftag {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    font-family: var(--font-data);
    font-size: 8px;
    letter-spacing: 0.14em;
    color: rgba(11, 10, 8, 0.6);
  }
  .reflection {
    position: absolute;
    left: 0;
    top: 100%;
    transform: scaleY(-1);
    transform-origin: top;
    -webkit-mask-image: linear-gradient(#000, transparent 62%);
    mask-image: linear-gradient(#000, transparent 62%);
    opacity: 0.28;
    pointer-events: none;
    border-radius: 8px;
    overflow: hidden;
  }
  .arrow {
    position: absolute;
    top: calc(46% - 22px);
    z-index: 110;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(20, 17, 13, 0.85);
    border: 1px solid var(--line-strong);
    display: grid;
    place-items: center;
    color: var(--ink);
    cursor: pointer;
    transition: transform 0.2s, background 0.2s;
  }
  .arrow.left { left: 16px; }
  .arrow.right { right: 16px; }
  .arrow:hover:not(:disabled) { background: var(--surface-2); transform: scale(1.06); }
  .arrow:disabled { opacity: 0.35; cursor: default; }
  .caption {
    position: absolute;
    bottom: 40px;
    left: 0;
    right: 0;
    text-align: center;
    z-index: 105;
    padding: 0 24px;
    pointer-events: none;
  }
  .mono { font-family: var(--font-data); }
  .cline { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .clab { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--label); }
  .ctitle {
    font-family: var(--font-display);
    font-size: 1.55rem;
    color: var(--ink);
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cscore { display: inline-flex; align-items: baseline; gap: 9px; margin-top: 5px; }
  .score { font-family: var(--font-display); font-size: 1.35rem; color: var(--gold); font-weight: 500; }
  .cmeta { font-size: 10px; letter-spacing: 0.1em; color: var(--ink-3); text-transform: uppercase; }
  .foot {
    position: absolute;
    bottom: 12px;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    z-index: 105;
    pointer-events: none;
  }
  .pos { font-size: 9px; letter-spacing: 0.12em; color: var(--ink-3); }
  .attr { font-size: 9px; letter-spacing: 0.12em; color: #4a443a; }
  .empty {
    text-align: center;
    color: var(--ink-3);
    padding: 2.6rem 1rem;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius);
  }
  .empty .mark { color: var(--accent); font-size: 1.6rem; margin-bottom: 0.4rem; }
  .empty .lead { font-family: var(--font-display); font-size: 1.1rem; color: var(--ink-2); margin: 0 0 0.3rem; }
  .empty .hint { font-size: 0.85rem; margin: 0; }
  @media (max-width: 700px) {
    .ctitle { font-size: 1.3rem; }
    .caption { bottom: 36px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .cover, .arrow { transition: none; }
  }
</style>
