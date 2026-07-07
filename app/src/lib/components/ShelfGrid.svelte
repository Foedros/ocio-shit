<script>
  // Vista ESTANTERÍA-VIDEOCLUB del Diario (§11.55) · diseño: diseno/Ocio Shit - Estanteria
  // Videoclub.html. DVDs de canto sobre baldas de madera: se ven los LOMOS (título vertical +
  // color de categoría + nota); la carátula asoma en escorzo ~40° (giro 3D real del lomo a 90°).
  // Hover/dedo-quieto = la caja DESLIZA en el eje del lomo (translateX, sin rotar) mostrando más
  // carátula; clic = extrae+gira a frontal → View Transition a la carátula del detalle (§11.39).
  // Recibe items YA deduplicados por obra (ArchiveList). VIRTUALIZADO por filas (baldas): de
  // ~4.500 obras solo montan ~pocas baldas. Solo transform → 60fps. Carátula = imagen_url con
  // tratamiento estuche (relleno borroso + arte contain); fallback tipográfico (NULL/onerror).
  import { base } from '$app/paths';
  import { CAT_COLOR } from '$lib/theme.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';
  import { openEntryDetail } from '$lib/boot-supabase.js';
  import { detail } from '$lib/stores.js';
  import { fmtValoracion } from '$lib/format.js';
  import { prefersReducedMotion } from '$lib/motion.js';

  let { items = [], resetKey = undefined } = $props();

  const GAP = 0;
  const OVERSCAN = 1; // §11.58: 1 fila de colchón (con 8-12 lomos 3D por fila, menos montaje = más fluido)
  let viewport = $state(null);
  let width = $state(360);
  let height = $state(480);
  let scrollTop = $state(0);
  const reduced = prefersReducedMotion();

  // URLs cuya imagen falló (onerror) → fallback tipográfico (lomo sin arte). Clave por URL.
  let broken = $state(new Set());
  const markBroken = (url) => (broken = new Set(broken).add(url));

  // DVD extraído (queda en modo "pulling" mientras el detalle está abierto; vuelve al cerrarse).
  // El efecto SOLO depende de $detail: al abrirse marca sawDetail; al cerrarse (tras haber estado
  // abierto) devuelve la caja. Si dependiera de takenKey, se limpiaría durante los 430ms del pull
  // (el detalle aún no está abierto) y el "pulling" no llegaría a verse.
  let takenKey = $state(null);
  let sawDetail = false;
  $effect(() => {
    if ($detail) sawDetail = true;
    else if (sawDetail) { sawDetail = false; takenKey = null; }
  });

  $effect(() => {
    if (!viewport) return;
    const ro = new ResizeObserver(() => {
      width = viewport.clientWidth;
      height = viewport.clientHeight;
    });
    ro.observe(viewport);
    width = viewport.clientWidth;
    height = viewport.clientHeight;
    return () => ro.disconnect();
  });

  // Al cambiar filtros, vuelve al principio (mismo criterio que la lista).
  let lastReset = $state(resetKey);
  $effect(() => {
    if (resetKey === lastReset) return;
    lastReset = resetKey;
    scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
  });

  // ── geometría DINÁMICA (§11.58): las cajas por fila salen del ancho (slot constante, NO
  // hardcodeado por breakpoint) y H se DESPEJA para llenar el ancho exacto — sin hueco muerto.
  // Cada DVD avanza (CW − SP·0.5) = 0.592H; el último añade su carátula (0.075H). A la DERECHA se
  // reserva RES·H para que el ÚLTIMO lomo, al deslizarse en hover (tx=0.22H), NO se salga de la
  // balda. Ecuación: (0.592·cols + 0.075 + RES)·H + 2·PAD = ancho → se despeja H con la reserva
  // ya incluida (la reserva queda como espacio a la derecha, no como hueco muerto). ──
  const PAD = 14;
  const SLOT = 88; // avance objetivo por caja → nº de cajas ≈ ancho/SLOT (tamaño ~constante: móvil 4)
  const RES = 0.24; // reserva de deslizamiento a la derecha (≈ tx=0.22H + cojín del lomo del último)
  let cols = $derived(Math.max(3, Math.min(10, Math.round((width - 2 * PAD) / SLOT))));
  let H = $derived(Math.max(118, Math.min(196, Math.floor((width - 2 * PAD) / (0.592 * cols + 0.075 + RES)))));
  let SP = $derived(Math.round(H * 0.15)); // grosor de la caja (lomo)
  let CW = $derived(Math.round(H * 0.667)); // ancho UNIFORME de carátula (2:3)
  let overlap = $derived(Math.round(-SP * 0.5)); // solape (canto) — DVDs apretados
  let tx = $derived(Math.round(H * 0.22)); // deslizamiento en hover (cabe en la reserva RES·H)
  let txPull = $derived(Math.round(H * 0.42)); // extracción al clicar
  // FONDO del estante (§11.56): tres capas para que el escorzo 3D apoye DENTRO, no fuera —
  //   · superficie (z1): madera que RECEDE por detrás de la base de las cajas (les da suelo)
  //   · cajas (z2): su base se hunde SEAT dentro del estante
  //   · lip frontal (z3): el canto de la balda va DELANTE y tapa la base → "metidas en la balda"
  let LIP = $derived(Math.round(H * 0.12)); // alto del canto frontal
  let DEPTH = $derived(Math.round(H * 0.34)); // cuánto sube la superficie tras la caja
  let SEAT = $derived(Math.round(H * 0.06)); // cuánto se hunde la base de la caja en el estante
  // la NOTA vive al fondo del lomo y el lip la tapaba (§11.58): se sube con padding-bottom del
  // lomo = alto del lip + margen → queda POR ENCIMA del borde del lip, visible en todas. No se
  // reduce el lip (que sigue tapando el sangrado de la base del escorzo).
  let scoreLift = $derived(LIP + Math.round(H * 0.05));
  let rowH = $derived(LIP - SEAT + H + 22); // base hundida + caja + respiro de la balda de abajo

  let rows = $derived(Math.ceil(items.length / cols));
  let total = $derived(Math.max(0, rows * rowH));
  let startRow = $derived(Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN));
  let visRows = $derived(Math.ceil(height / rowH) + OVERSCAN * 2);
  let slice = $derived(
    Array.from({ length: Math.min(visRows, rows - startRow) }, (_, i) => {
      const r = startRow + i;
      return { r, items: items.slice(r * cols, r * cols + cols) };
    })
  );

  $effect(() => {
    const maxTop = Math.max(0, total - height);
    if (scrollTop > maxTop) {
      scrollTop = maxTop;
      if (viewport) viewport.scrollTop = maxTop;
    }
  });

  const col = (cat) => CAT_COLOR[cat] ?? { c: 'var(--ink-3)', tint: 'var(--ink-2)' };
  const catLabel = (cat) => CATEGORIA_LABELS[cat] ?? cat;
  const hasImg = (it) => it.imagen_url && !broken.has(it.imagen_url);

  function onScroll(e) {
    scrollTop = e.currentTarget.scrollTop;
  }

  // clic = extraer (gira a frontal) → tras la animación, View Transition al detalle desde la
  // carátula NÍTIDA (img:not(.bg); el estuche pone un .bg borroso delante). Reduced: directo.
  function pull(it, cardEl) {
    takenKey = it.entrada_id;
    const go = () => openEntryDetail(it.entrada_id, { fromEl: cardEl?.querySelector('.cover img:not(.bg), .cover .fb') ?? null });
    if (reduced) { go(); return; }
    setTimeout(go, 430);
  }
</script>

<div class="viewport" bind:this={viewport} onscroll={onScroll} style="--wood:url({base}/wood.jpg)">
  <div class="spacer" style="height:{total}px">
    {#each slice as { r, items: rowItems } (r)}
      <div class="row" style="transform: translateY({r * rowH}px); height:{rowH}px">
        <!-- FONDO del estante (§11.56): superficie que RECEDE tras las cajas (z1), cajas (z2),
             lip frontal DELANTE que tapa la base (z3) → las cajas apoyan DENTRO, no fuera -->
        <div class="surface" style="bottom:{LIP}px; height:{DEPTH}px"></div>
        <div class="balda" style="--sp:{SP}px; --cw:{CW}px; --h:{H}px; --tx:{tx}px; --txp:{txPull}px; bottom:{LIP - SEAT}px; padding:0 {PAD}px">
          {#each rowItems as it, i (it.entrada_id)}
            <button
              class="dvd"
              class:pulling={takenKey === it.entrada_id}
              style="width:{CW}px; height:{H}px; margin-right:{overlap}px; z-index:{cols - i}"
              onclick={(e) => pull(it, e.currentTarget)}
              aria-label={it.titulo}
              title={it.titulo}
            >
              <span class="cover" style="width:{CW}px; height:{H}px">
                {#if hasImg(it)}
                  <img class="bg" src={it.imagen_url} alt="" aria-hidden="true" loading="lazy" draggable="false" />
                  <img src={it.imagen_url} alt="" loading="lazy" draggable="false" onerror={() => markBroken(it.imagen_url)} />
                {:else}
                  <span class="fb" style="background:{col(it.categoria).c}; padding:{Math.round(H * 0.1)}px">
                    <span class="fb-t" style="font-size:{Math.round(H * 0.09)}px">{it.titulo}</span>
                  </span>
                {/if}
                <span class="cglow"></span>
              </span>
              <span class="spine" style="width:{SP}px; padding-bottom:{scoreLift}px">
                <span class="stripe" style="background:{col(it.categoria).c}"></span>
                <span class="sdot" style="width:{Math.round(SP * 0.4)}px; height:{Math.round(SP * 0.4)}px; background:{col(it.categoria).c}"></span>
                <span class="vtitle" style="font-size:{Math.min(SP * 0.5, 15)}px; max-height:{H - SP * 1.6}px">{it.titulo}</span>
                <span class="sscore" style="font-size:{Math.round(SP * 0.3)}px">{it.valoracion != null ? fmtValoracion(it.valoracion) : ''}</span>
              </span>
            </button>
          {/each}
        </div>
        <div class="plank" style="height:{LIP}px"></div>
      </div>
    {/each}
  </div>
  <div class="credits lbl">IMÁGENES: TMDB · STEAM · OPENLIBRARY · TEXTURAS: textures4photoshop.com</div>
</div>

<style>
  .viewport {
    position: relative;
    overflow-y: auto;
    overflow-x: hidden;
    height: min(66vh, 620px);
    border: 1px solid #24170d;
    border-radius: var(--radius);
    /* balda de madera: textura tileada (420px) + vignette oscura para que la UI lea */
    background:
      radial-gradient(120% 90% at 50% 0%, rgba(8, 7, 5, 0.2), rgba(8, 7, 5, 0.72)),
      linear-gradient(rgba(11, 10, 8, 0.18), rgba(11, 10, 8, 0.18)),
      var(--wood);
    background-size: cover, auto, 420px auto;
    background-repeat: no-repeat, repeat, repeat;
    box-shadow: inset 0 0 90px rgba(0, 0, 0, 0.6);
    overscroll-behavior: contain;
  }
  .spacer {
    position: relative;
    width: 100%;
  }
  .row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }
  /* superficie del estante (z1): madera que se aleja del usuario → oscura al FONDO (arriba),
     cálida al FRENTE (abajo, donde apoyan las cajas). Da profundidad: el escorzo apoya dentro. */
  .surface {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 1;
    background:
      linear-gradient(180deg, rgba(8, 7, 5, 0.92) 0%, rgba(8, 7, 5, 0.5) 48%, rgba(28, 20, 11, 0.1) 100%),
      var(--wood);
    background-size: auto, 300px auto;
    background-repeat: repeat, repeat;
    box-shadow: inset 0 16px 22px -12px rgba(0, 0, 0, 0.8);
  }
  /* balda (z2): absoluta, base hundida SEAT en el estante; lomos apretados en escorzo */
  .balda {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 2;
    display: flex;
    align-items: flex-end;
    width: max-content;
    max-width: 100%;
  }

  /* la carátula mira al usuario en escorzo ~40°; el lomo es el grosor en el lado que se aleja */
  .dvd {
    position: relative;
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    transform-style: preserve-3d;
    transform-origin: center center;
    transform: perspective(1400px) rotateY(-40deg);
    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s;
    will-change: transform;
    backface-visibility: hidden;
  }
  /* sombra de CONTACTO: ancla la caja al suelo del estante (más ancha y profunda que antes,
     desbordando por el lado del lomo donde el escorzo recede). El lip (z3) tapa su parte baja. */
  .dvd::after {
    content: '';
    position: absolute;
    left: -8%;
    right: -20%;
    bottom: -8px;
    height: 24px;
    border-radius: 50%;
    background: radial-gradient(ellipse, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.26) 55%, transparent 78%);
    pointer-events: none;
  }
  .cover {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 3px;
    overflow: hidden;
    box-shadow: 0 22px 38px rgba(0, 0, 0, 0.55);
    background: var(--surface-2);
    backface-visibility: hidden;
  }
  /* estuche: arte CONTAIN sobre su propio relleno borroso (§11.50) — poster llena, header letterbox */
  .cover img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .cover img.bg {
    object-fit: cover;
    filter: blur(14px) brightness(0.55) saturate(1.1);
    transform: scale(1.3) translateZ(0);
  }
  .fb {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  .fb-t {
    font-family: var(--font-display);
    color: #0b0a08;
    font-weight: 500;
    line-height: 1.12;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 6;
    -webkit-box-orient: vertical;
  }
  .cglow {
    position: absolute;
    inset: 0;
    background: linear-gradient(105deg, rgba(255, 255, 255, 0.16), transparent 48%);
    opacity: 0.35;
    transition: opacity 0.4s;
    pointer-events: none;
  }
  /* lomo: bisagra en el borde derecho de la carátula, plegándose atrás → grosor visible */
  .spine {
    position: absolute;
    top: 0;
    left: 100%;
    height: 100%;
    transform-origin: left center;
    transform: rotateY(90deg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    background: linear-gradient(90deg, #1c1811, #16130e 55%, #0d0b08);
    border-radius: 0 2px 2px 0;
    box-shadow: inset 5px 0 9px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    backface-visibility: hidden;
  }
  .stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
  }
  .sdot {
    border-radius: 50%;
    opacity: 0.85;
    flex: none;
  }
  .vtitle {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: var(--font-display);
    color: #ede4d3;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sscore {
    font-family: var(--font-data);
    color: var(--gold);
    flex: none;
  }

  /* hover/foco: DESLIZA a la derecha en el sentido del lomo, SIN rotar (transform no aplana el
     3D). El brillo va en los HIJOS (un filter sobre .dvd aplanaría el preserve-3d). */
  .dvd:hover,
  .dvd:focus-visible {
    transform: perspective(1400px) translateX(var(--tx)) rotateY(-40deg);
    z-index: 60 !important;
  }
  .dvd:hover .cover,
  .dvd:focus-visible .cover {
    filter: brightness(1.15) saturate(1.05);
  }
  .dvd:hover .spine,
  .dvd:focus-visible .spine {
    filter: brightness(1.3);
  }
  .dvd:hover .cglow,
  .dvd:focus-visible .cglow {
    opacity: 1;
  }
  /* extracción: sale a la derecha, gira a frontal, se ilumina (queda "en tus manos" = el detalle) */
  .dvd.pulling {
    transition: transform 0.6s cubic-bezier(0.4, 1, 0.4, 1), opacity 0.4s;
    transform: perspective(1400px) translateX(var(--txp)) scale(1.05) rotateY(-12deg) !important;
    z-index: 80 !important;
  }
  .dvd.pulling .cover {
    filter: brightness(1.15);
  }

  /* lip frontal (z3): canto de la balda DELANTE de las cajas → tapa su base (metidas dentro).
     Madera más cálida que la superficie, luz ámbar arriba (borde de apoyo) + sombra proyectada. */
  .plank {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 3;
    border-radius: 0 0 3px 3px;
    background:
      linear-gradient(rgba(30, 20, 10, 0.05), rgba(11, 10, 8, 0.32)),
      var(--wood);
    background-size: auto, 420px auto;
    background-repeat: repeat, repeat;
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.55), inset 0 2px 0 rgba(242, 166, 90, 0.2), inset 0 -3px 6px rgba(0, 0, 0, 0.5);
  }
  .credits {
    position: sticky;
    bottom: 0;
    left: 0;
    display: block;
    text-align: center;
    font-size: 8px;
    color: #5a4a36;
    padding: 6px 0 4px;
    background: linear-gradient(rgba(8, 7, 5, 0), rgba(8, 7, 5, 0.75) 60%);
    pointer-events: none;
    letter-spacing: 0.1em;
  }

  @media (prefers-reduced-motion: reduce) {
    .dvd {
      transition: opacity 0.3s !important;
      transform: perspective(1400px) rotateY(-24deg);
    }
    .dvd:hover,
    .dvd:focus-visible {
      transform: perspective(1400px) rotateY(-24deg);
    }
    .dvd:hover .cover,
    .dvd:hover .spine {
      filter: none;
    }
    .dvd.pulling {
      transform: perspective(1400px) rotateY(-24deg) !important;
    }
  }
</style>
