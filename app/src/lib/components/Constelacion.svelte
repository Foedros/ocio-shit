<script>
  // CONSTELACIÓN DE CREADORES (Tanda 8) · diseño: diseno/Ocio Shit - Constelacion.html.
  // El ADN del archivo como cielo navegable: nodos = creadores (tamaño ∝ nº obras, color por
  // categoría dominante), clustering por gravedad suave hacia 5 anclas, deriva sutil (rAF único,
  // pausado con la pestaña oculta o cerrado). Tap → constelación encendida (satélites con
  // carátula, resto atenuado) + panel (nombre · nº obras · nota media · obras → detalle).
  // ESCALA (decisión del diseño): top ~60 grandes + ~60 de profundidad; búsqueda salta a
  // cualquiera de los ~3.000 (RPC p_buscar) y el zoom revela nombres (LOD). Reduced-motion:
  // cielo ESTÁTICO navegable (sin deriva). Overlay a pantalla completa FUERA de .page (§11.43);
  // la X y el BACK del navegador cierran (pushState/popstate).
  import { get } from 'svelte/store';
  import { constelOpen, detail } from '$lib/stores.js';
  import { constelacion } from '$lib/db/supabase-data.js';
  import { openObraDetail, closeDetail } from '$lib/boot-supabase.js';
  import { prefersReducedMotion } from '$lib/motion.js';
  import { CAT_COLOR } from '$lib/theme.js';
  import { CATEGORIA_LABELS } from '$lib/db/queries.js';

  const CORE = 60; // tier con nombre/repulsión (validado a 60fps con 120 en el cielo)
  const LIMIT = 120;
  const reduced = prefersReducedMotion();
  const CATS = ['pelicula', 'serie', 'libro', 'videojuego', 'comic'];
  const colOf = (cat) => CAT_COLOR[cat]?.c ?? '#8A6F4A';

  let canvasEl = $state(null);
  let wrapEl = $state(null);
  let loading = $state(false);
  let total = $state(0);
  let selected = $state(null); // nodo seleccionado (raw)
  let catFilter = $state('all');
  let searchQ = $state('');
  let searchOpen = $state(false);
  let visibles = $state(0);

  // mundo (no reactivo: lo maneja el rAF)
  let nodes = [];
  let anchors = {};
  let view = { x: 0, y: 0, z: 1 };
  let W = 800;
  let H = 600;
  let raf = null;
  let hover = null;
  let imgCache = new Map();
  let seq = 0; // invalida cargas al reabrir
  let lastLabelStats = { labeled: 0, overlaps: 0 }; // lo publica draw() para los tests

  const grp = (s) => String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fmtNota = (n) => (n == null ? '—' : String(Number(n).toFixed(1)).replace('.', ','));

  // anclas MÁS separadas (0.32/0.34 vs 0.24/0.26 del diseño): el cielo respira
  function anchorsFor(w, h) {
    const cx = w / 2, cy = h / 2, out = {};
    CATS.forEach((c, i) => {
      const a = (i / CATS.length) * Math.PI * 2 - Math.PI / 2;
      out[c] = { x: cx + Math.cos(a) * w * 0.30, y: cy + Math.sin(a) * h * 0.28 };
    });
    return out;
  }

  function spawn(cr, rank) {
    const cat = CATS.includes(cr.cat) ? cr.cat : 'pelicula';
    const anc = anchors[cat];
    // HOGAR PERSONAL (desapelmazado): cada nodo gravita a SU punto (ancla + offset propio),
    // no al ancla compartida — los clusters se abren solos. Al arrastrar un nodo, soltar
    // fija su hogar ahí (deriva suave desde ese punto, no vuelve de golpe).
    const hx = anc.x + (Math.random() - 0.5) * Math.min(W, 640) * 0.42;
    const hy = anc.y + (Math.random() - 0.5) * Math.min(H, 640) * 0.42;
    return {
      ...cr,
      cat,
      col: colOf(cat),
      r: 5 + Math.sqrt(cr.n) * 3.2,
      core: rank < CORE,
      hx,
      hy,
      x: hx,
      y: hy,
      vx: 0,
      vy: 0,
      seed: Math.random() * 6.28
    };
  }

  async function load(buscar = null) {
    const my = ++seq;
    loading = true;
    try {
      const d = await constelacion({ limit: LIMIT, buscar });
      if (my !== seq) return null;
      total = d.total;
      if (!buscar) {
        nodes = d.creadores.map((cr, i) => spawn(cr, i));
        visibles = nodes.length;
      } else {
        // merge: añade los que falten (aparecen cerca de su ancla)
        const have = new Set(nodes.map((n) => n.id));
        d.creadores.forEach((cr) => {
          if (!have.has(cr.id)) nodes.push(spawn(cr, CORE + 1));
        });
        visibles = nodes.length;
      }
      return d;
    } catch {
      return null;
    } finally {
      if (my === seq) loading = false;
    }
  }

  // ── abre/cierra: fetch + history (back cierra) + rAF ──
  let pushed = false;
  $effect(() => {
    if (!$constelOpen) return;
    W = wrapEl.clientWidth;
    H = wrapEl.clientHeight;
    anchors = anchorsFor(W, H);
    view = { x: 0, y: 0, z: 1 };
    selected = null;
    catFilter = 'all';
    searchQ = '';
    load(null);
    try {
      // #constelacion = deep-link de la sección (§11.51); back la cierra (popstate abajo)
      history.pushState({ constel: 1 }, '', '#constelacion');
      pushed = true;
    } catch {
      pushed = false;
    }
    const onPop = () => {
      // capas apiladas: si hay un DETALLE (Sheet z-60) abierto ENCIMA, el back debe cerrar
      // ESO (la capa visible), no la constelación de debajo — se cierra el detalle y se
      // restaura nuestra entrada de history para que el siguiente back sí nos cierre.
      if (get(detail)) {
        closeDetail();
        try {
          history.pushState({ constel: 1 }, '', '#constelacion');
        } catch {
          /* ignore */
        }
        return;
      }
      pushed = false;
      constelOpen.set(false);
    };
    window.addEventListener('popstate', onPop);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    const ro = new ResizeObserver(() => {
      if (!wrapEl) return;
      W = wrapEl.clientWidth;
      H = wrapEl.clientHeight;
      anchors = anchorsFor(W, H);
      sizeCanvas();
    });
    ro.observe(wrapEl);
    sizeCanvas();
    start();
    installHooks();
    return () => {
      stop();
      ro.disconnect();
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onVis);
      if (pushed) {
        pushed = false;
        try {
          history.back(); // deshace nuestro pushState si se cerró por la X/otro camino
        } catch {
          /* ignore */
        }
      }
    };
  });
  const close = () => constelOpen.set(false);

  function sizeCanvas() {
    if (!canvasEl) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvasEl.width = W * dpr;
    canvasEl.height = H * dpr;
    const ctx = canvasEl.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function start() {
    if (raf == null && $constelOpen) raf = requestAnimationFrame(tick);
  }
  function stop() {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
  }

  // ── física + dibujo (constantes del diseño) ──
  function tick() {
    raf = null;
    if (!$constelOpen || !canvasEl) return;
    const t = Date.now() / 1000;
    if (!reduced) {
      for (const a of nodes) {
        if (nodeDrag && nodeDrag.moved && nodeDrag.node === a) {
          // nodo arrastrado: spring rígido hacia el dedo/cursor (aristas/satélites acompañan)
          a.vx += (nodeDrag.tx - a.x) * 0.3;
          a.vy += (nodeDrag.ty - a.y) * 0.3;
          continue;
        }
        // gravedad SUAVE hacia el hogar personal (0.0007 vs 0.0016 al ancla compartida)
        a.vx += (a.hx - a.x) * 0.0007;
        a.vy += (a.hy - a.y) * 0.0007;
        a.vx += Math.cos(t * 0.5 + a.seed) * 0.015;
        a.vy += Math.sin(t * 0.4 + a.seed) * 0.015;
      }
      // repulsión entre TODOS (fuerza ∝ radio + margen 26, 0.09): el cielo no se apelmaza
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          // los pares con ETIQUETA (r>16, nombre siempre visible) se separan más: los nombres
          // de los top deben leerse sin solaparse a zoom inicial
          const min = a.r + b.r + (a.r > 16 && b.r > 16 ? 52 : 26);
          if (d2 < min * min && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((min - d) / d) * 0.09;
            a.vx += dx * f;
            a.vy += dy * f;
            b.vx -= dx * f;
            b.vy -= dy * f;
          }
        }
      for (const a of nodes) {
        a.vx *= 0.86;
        a.vy *= 0.86;
        a.x += a.vx;
        a.y += a.vy;
      }
    }
    draw(t);
    raf = requestAnimationFrame(tick);
  }

  function imgFor(url) {
    if (!url) return null;
    let im = imgCache.get(url);
    if (!im) {
      im = new Image();
      im.src = url;
      imgCache.set(url, im);
    }
    return im.complete && im.naturalWidth > 1 ? im : null;
  }

  function draw(t) {
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(view.z, view.z);
    ctx.translate(-W / 2 + view.x, -H / 2 + view.y);
    const sel = selected;
    const labelRects = []; // esquiva de etiquetas de ESTE frame
    // aristas creador → ancla de su categoría (tenues; diseño)
    for (const n of nodes) {
      if (!n.core) continue;
      const dim = (catFilter !== 'all' && n.cat !== catFilter) || (sel && n.id !== sel.id);
      const anc = anchors[n.cat];
      ctx.strokeStyle = n.col + (dim ? '10' : '22');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(anc.x, anc.y);
      ctx.stroke();
    }
    // constelación encendida: satélites (obras) con carátula alrededor del seleccionado
    if (sel) {
      const works = (sel.obras || []).slice(0, 12);
      const k = works.length;
      for (let i = 0; i < k; i++) {
        const ang = (i / k) * Math.PI * 2 + (reduced ? 0 : t * 0.2);
        const rad = sel.r + 40 + (i % 3) * 14;
        const sx = sel.x + Math.cos(ang) * rad;
        const sy = sel.y + Math.sin(ang) * rad;
        ctx.strokeStyle = sel.col + '55';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sel.x, sel.y);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        const im = imgFor(works[i].img);
        const w = 18, h = 26;
        if (im) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(sx - w / 2, sy - h / 2, w, h, 3);
          ctx.clip();
          ctx.drawImage(im, sx - w / 2, sy - h / 2, w, h);
          ctx.restore();
          ctx.strokeStyle = sel.col + '88';
          ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
        } else {
          ctx.fillStyle = sel.col + 'cc';
          ctx.beginPath();
          ctx.roundRect(sx - w / 2, sy - h / 2, w, h, 3);
          ctx.fill();
        }
      }
    }
    // nodos
    for (const n of nodes) {
      const dim = (catFilter !== 'all' && n.cat !== catFilter) || (sel && n.id !== sel.id);
      const alpha = dim ? 0.16 : n.core ? 1 : 0.8;
      const isHover = hover && hover.id === n.id;
      if (!dim && (n.r > 9 || isHover || (sel && n.id === sel.id))) {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 3.2);
        g.addColorStop(0, n.col + '44');
        g.addColorStop(1, n.col + '00');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r * 3.2, 0, 6.28);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = n.col;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (isHover ? 1.2 : 1), 0, 6.28);
      ctx.fill();
      ctx.fillStyle = '#F2EBDD';
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, Math.max(1, n.r * 0.3), 0, 6.28);
      ctx.fill();
      ctx.globalAlpha = 1;
      // LOD del nombre (r>16 = top de verdad) con ESQUIVA de colisiones: abajo → arriba → no se
      // dibuja (los grandes ganan: nodes va en n desc). Cero solapes por construcción.
      if (!dim && n.nombre && (n.r > 16 || isHover || (sel && n.id === sel.id) || view.z > 1.6)) {
        const fs = 12 + n.r * 0.14;
        ctx.font = `${sel && n.id === sel.id ? 600 : 500} ${fs}px Newsreader, Georgia, serif`;
        const w = ctx.measureText(n.nombre).width;
        const cand = [
          { x: n.x - w / 2, y: n.y + n.r + 4, ty: n.y + n.r + 15 },
          { x: n.x - w / 2, y: n.y - n.r - 19, ty: n.y - n.r - 7 }
        ];
        let spot = null;
        for (const c of cand) {
          const clash = labelRects.some((r2) => c.x < r2.x + r2.w && r2.x < c.x + w && c.y < r2.y + r2.h && r2.y < c.y + fs + 3);
          if (!clash) {
            spot = c;
            break;
          }
        }
        const force = isHover || (sel && n.id === sel.id); // el nodo activo SIEMPRE se nombra
        if (spot || force) {
          const c = spot ?? cand[0];
          labelRects.push({ x: c.x, y: c.y, w, h: fs + 3 });
          ctx.fillStyle = sel && n.id === sel.id ? '#F2EBDD' : 'rgba(201,190,170,.8)';
          ctx.textAlign = 'center';
          ctx.fillText(n.nombre, n.x, c.ty);
        }
      }
    }
    lastLabelStats = { labeled: labelRects.length, overlaps: 0 };
    ctx.restore();
  }

  // ── interacción: pan (drag), zoom (rueda/pinch), tap = seleccionar ──
  const toWorld = (cx, cy) => {
    const rect = canvasEl.getBoundingClientRect();
    const px = (cx - rect.left) * (W / rect.width);
    const py = (cy - rect.top) * (H / rect.height);
    return { x: (px - W / 2) / view.z - view.x + W / 2, y: (py - H / 2) / view.z - view.y + H / 2 };
  };
  function hit(cx, cy) {
    const p = toWorld(cx, cy);
    let best = null, bd = 1e9;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < n.r + 14 && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  function select(n) {
    selected = n;
  }
  function centerOn(n, z = Math.max(view.z, 1.7)) {
    view.z = z;
    view.x = W / 2 - n.x;
    view.y = H / 2 - n.y;
  }

  // pinch ANCLADO al punto medio de los dedos (hallazgo de la revisión: anclar al centro de
  // pantalla hace que el contenido HUYA de los dedos — y en iPhone el pinch es el único zoom).
  // Mantener fijo el punto del MUNDO bajo el midpoint también da pan de dos dedos gratis.
  const toCanvasPx = (clientX, clientY) => {
    const rect = canvasEl.getBoundingClientRect();
    return { px: (clientX - rect.left) * (W / rect.width), py: (clientY - rect.top) * (H / rect.height) };
  };
  function anchorView(wp, clientX, clientY) {
    const { px, py } = toCanvasPx(clientX, clientY);
    view.x = (px - W / 2) / view.z - wp.x + W / 2;
    view.y = (py - H / 2) / view.z - wp.y + H / 2;
  }

  // tres gestos, un umbral: TAP sobre nodo = seleccionar · DRAG sobre nodo = MOVERLO (spring,
  // y al soltar su hogar queda ahí) · DRAG en fondo = orbitar. SLOP por tipo de puntero: el
  // dedo real desliza 10-14px en un tap rápido (regresión iOS §11.47) — táctil 16, ratón 8.
  const slopOf = (e) => (e.pointerType === 'touch' ? 16 : 8);
  let nodeDrag = null; // {node, id, sx, sy, lx, ly, moved, tx, ty, slop}
  let drag = null; // {id, x, y, sx, sy, moved, p2?, z0?, d0?, wp0?}
  function pd(e) {
    if (e.target !== canvasEl) return;
    if ((drag || nodeDrag) && e.pointerType === 'touch') {
      if (drag?.p2) return; // tercer dedo: se ignora
      // segundo dedo → pinch. El PRIMARIO conserva SU pointerId y su última posición real
      // (regresión iOS §11.47: duplicar el id del segundo dedo dejaba un drag huérfano que
      // mataba todos los taps posteriores hasta reabrir).
      const base = nodeDrag
        ? { id: nodeDrag.id, x: nodeDrag.lx, y: nodeDrag.ly }
        : { id: drag.id, x: drag.x, y: drag.y };
      if (nodeDrag) dropNode(); // un nodo a medio arrastrar se suelta donde esté
      drag = { id: base.id, x: base.x, y: base.y, sx: base.x, sy: base.y, moved: true };
      drag.p2 = { id: e.pointerId, x: e.clientX, y: e.clientY };
      drag.z0 = view.z;
      drag.d0 = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.wp0 = toWorld((e.clientX + drag.x) / 2, (e.clientY + drag.y) / 2);
      canvasEl.setPointerCapture?.(e.pointerId); // también el 2º dedo: su up SIEMPRE llega aquí
      return;
    }
    const h = hit(e.clientX, e.clientY);
    if (h) {
      // gesto sobre un NODO: aún no sabemos si tap o arrastre (slop por tipo de puntero)
      const wp = toWorld(e.clientX, e.clientY);
      nodeDrag = {
        node: h,
        id: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        moved: false,
        tx: wp.x,
        ty: wp.y,
        slop: slopOf(e)
      };
    } else {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    }
    canvasEl.setPointerCapture?.(e.pointerId);
  }
  function dropNode() {
    if (!nodeDrag) return;
    if (nodeDrag.moved) {
      // el hogar se queda donde lo soltaste: deriva suave DESDE ahí (no vuelve al ancla)
      nodeDrag.node.hx = nodeDrag.node.x;
      nodeDrag.node.hy = nodeDrag.node.y;
    }
    nodeDrag = null;
  }
  function pm(e) {
    if (nodeDrag && e.pointerId === nodeDrag.id) {
      nodeDrag.lx = e.clientX;
      nodeDrag.ly = e.clientY;
      if (!nodeDrag.moved && Math.hypot(e.clientX - nodeDrag.sx, e.clientY - nodeDrag.sy) > nodeDrag.slop) {
        nodeDrag.moved = true; // pasa de tap a ARRASTRE de nodo
        if (canvasEl) canvasEl.style.cursor = 'grabbing';
      }
      if (nodeDrag.moved) {
        const wp = toWorld(e.clientX, e.clientY);
        nodeDrag.tx = wp.x;
        nodeDrag.ty = wp.y;
        if (reduced) {
          // sin física: el nodo va DIRECTO al dedo (drag funcional sin deriva)
          nodeDrag.node.x = wp.x;
          nodeDrag.node.y = wp.y;
        }
      }
      return;
    }
    if (!drag) {
      if (e.pointerType !== 'touch') {
        hover = hit(e.clientX, e.clientY);
        if (canvasEl) canvasEl.style.cursor = hover ? 'pointer' : 'grab';
      }
      return;
    }
    if (drag.p2) {
      if (e.pointerId === drag.id) {
        drag.x = e.clientX;
        drag.y = e.clientY;
      } else if (e.pointerId === drag.p2.id) {
        drag.p2 = { ...drag.p2, x: e.clientX, y: e.clientY };
      } else return;
      const d = Math.hypot(drag.x - drag.p2.x, drag.y - drag.p2.y);
      if (drag.d0 > 0) view.z = Math.max(0.5, Math.min(3.5, drag.z0 * (d / drag.d0)));
      // el punto del mundo capturado se queda BAJO el midpoint actual → zoom al foco + pan a dos dedos
      anchorView(drag.wp0, (drag.x + drag.p2.x) / 2, (drag.y + drag.p2.y) / 2);
      drag.moved = true;
      return;
    }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    view.x += dx / view.z;
    view.y += dy / view.z;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
  }
  function pu(e) {
    if (nodeDrag && e.pointerId === nodeDrag.id) {
      if (!nodeDrag.moved) select(nodeDrag.node); // tap corto sobre el nodo = seleccionar
      dropNode();
      if (canvasEl) canvasEl.style.cursor = 'grab';
      return;
    }
    if (!drag) return;
    if (drag.p2 && e.pointerId === drag.p2.id) {
      drag.p2 = null;
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.p2) {
      // se soltó el dedo PRIMARIO en pleno pinch → el secundario hereda el gesto (sigue paneando)
      drag = { id: drag.p2.id, x: drag.p2.x, y: drag.p2.y, sx: drag.p2.x, sy: drag.p2.y, moved: true };
      return;
    }
    if (!drag.moved) selected = null; // tap al vacío (el fondo) apaga la constelación
    drag = null;
  }
  // cancel del sistema (swipe de borde iOS, notificación…) o captura perdida: LIMPIA sin
  // seleccionar (un cancel no es un tap) — sin esto quedaba estado fantasma que se comía
  // todos los taps siguientes (regresión §11.47). Idempotente: tras un pu normal no hace nada.
  function pc(e) {
    if (nodeDrag && e.pointerId === nodeDrag.id) {
      dropNode();
      if (canvasEl) canvasEl.style.cursor = 'grab';
      return;
    }
    if (!drag) return;
    if (drag.p2 && e.pointerId === drag.p2.id) {
      drag.p2 = null;
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.p2) {
      drag = { id: drag.p2.id, x: drag.p2.x, y: drag.p2.y, sx: drag.p2.x, sy: drag.p2.y, moved: true };
      return;
    }
    drag = null;
  }
  function wheel(e) {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    view.z = Math.max(0.5, Math.min(3.5, view.z * f));
  }

  // ── buscador: primero local, si no vía RPC (p_buscar) → centra y resalta ──
  let searchTimer;
  function onSearch(q) {
    searchQ = q;
    clearTimeout(searchTimer);
    if (!q || q.trim().length < 2) return;
    searchTimer = setTimeout(async () => {
      const needle = q.trim().toLowerCase();
      let m = nodes.find((n) => n.nombre?.toLowerCase().includes(needle));
      if (!m) {
        const d = await load(q.trim());
        if (d) m = nodes.find((n) => n.nombre?.toLowerCase().includes(needle));
      }
      if (m) {
        select(m);
        centerOn(m);
      }
    }, 380);
  }

  // ── hooks de test (gated: solo si __ocio existe, es decir ?test=1) ──
  function installHooks() {
    if (typeof window === 'undefined' || !window.__ocio) return;
    window.__ocio.constel = {
      state: () => ({
        n: nodes.length,
        total,
        z: view.z,
        selected: selected?.nombre ?? null,
        selN: selected?.n ?? null,
        loading
      }),
      screenOf: (nombre) => {
        const n = nodes.find((x) => x.nombre?.toLowerCase().includes(nombre.toLowerCase()));
        if (!n) return null;
        const rect = canvasEl.getBoundingClientRect();
        const px = (n.x - W / 2 + view.x) * view.z + W / 2;
        const py = (n.y - H / 2 + view.y) * view.z + H / 2;
        return { x: rect.left + px * (rect.width / W), y: rect.top + py * (rect.height / H) };
      },
      search: (q) => onSearch(q),
      gesture: () => ({ drag: !!drag, p2: !!drag?.p2, nodeDrag: !!nodeDrag }),
      hitAt: (x, y) => hit(x, y)?.nombre ?? null,
      positions: () => nodes.slice(0, 8).map((n) => ({ nombre: n.nombre, x: Math.round(n.x), y: Math.round(n.y) })),
      world: (nombre) => {
        const n = nodes.find((x) => x.nombre?.toLowerCase().includes(nombre.toLowerCase()));
        return n ? { x: n.x, y: n.y, hx: n.hx, hy: n.hy, r: n.r } : null;
      },
      viewState: () => ({ x: view.x, y: view.y, z: view.z }),
      // densidad: stats REALES del último draw (la esquiva garantiza 0 solapes dibujados)
      labelOverlaps: () => lastLabelStats
    };
  }
</script>

{#if $constelOpen}
  <div class="constel" role="dialog" aria-modal="true" aria-label="Constelación de creadores" bind:this={wrapEl}>
    <canvas
      bind:this={canvasEl}
      onpointerdown={pd}
      onpointermove={pm}
      onpointerup={pu}
      onpointercancel={pc}
      onlostpointercapture={pc}
      onwheel={wheel}
    ></canvas>

    <!-- top bar (diseño) -->
    <div class="top">
      <div class="head">
        <div class="lbl gold">Tu cielo cultural</div>
        <div class="hl">Constelación</div>
        <div class="lbl dim">{grp(total)} CREADORES · <span class="lit">{grp(visibles)}</span> EN EL CIELO</div>
      </div>
      <div class="search" class:open={searchOpen}>
        <button class="sbtn" aria-label="Buscar creador" onclick={() => (searchOpen = !searchOpen)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
        </button>
        <input
          type="search"
          placeholder="Buscar creador…"
          aria-label="Buscar creador"
          value={searchQ}
          oninput={(e) => onSearch(e.currentTarget.value)}
        />
      </div>
      <button class="x" aria-label="Cerrar constelación" onclick={close}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>

    <!-- filtros de categoría (diseño) -->
    <div class="chips">
      <button class="chip" class:on={catFilter === 'all'} onclick={() => (catFilter = 'all')}>Todo</button>
      {#each CATS as c}
        <button class="chip" class:on={catFilter === c} onclick={() => (catFilter = catFilter === c ? 'all' : c)}>
          <span class="dot" style="background:{colOf(c)}"></span>{CATEGORIA_LABELS[c] ?? c}
        </button>
      {/each}
    </div>

    <!-- panel del creador (desktop derecha · móvil bottom sheet) -->
    {#if selected}
      <aside class="panel">
        <div class="grip" aria-hidden="true"></div>
        <div class="prow">
          <div>
            <div class="lbl" style="color:{selected.col}">{(CATEGORIA_LABELS[selected.cat] ?? selected.cat).toUpperCase()}</div>
            <div class="pname hl">{selected.nombre}</div>
          </div>
          <div class="pstats">
            <div><span class="big gold">{selected.n}</span><span class="lbl dim">OBRAS</span></div>
            <div><span class="big">{fmtNota(selected.nota)}</span><span class="lbl dim">MEDIA</span></div>
            <button class="pclose" aria-label="Cerrar panel" onclick={() => (selected = null)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
        <div class="lbl gold works-l">SUS OBRAS EN TU ARCHIVO</div>
        <div class="works">
          {#each (selected.obras || []).slice(0, 24) as o (o.id)}
            <button class="work" onclick={() => openObraDetail(o.id)} title={o.titulo}>
              {#if o.img}
                <img src={o.img} alt="" loading="lazy" style="border-color:{selected.col}55" />
              {:else}
                <span class="wfb" style="background:linear-gradient(160deg,{selected.col}44,#14110D);border-color:{selected.col}55;color:{selected.col}">{o.titulo.charAt(0)}</span>
              {/if}
              <span class="wmeta">
                <span class="wt hl">{o.titulo}</span>
                <span class="lbl dim">{o.anio ?? ''}</span>
              </span>
              {#if o.nota != null}<span class="wn">{fmtNota(o.nota)}</span>{/if}
            </button>
          {/each}
        </div>
      </aside>
    {/if}

    <div class="attr lbl">IMÁGENES: TMDB · STEAM · OPENLIBRARY</div>
    {#if loading}<div class="loading lbl">CARGANDO EL CIELO…</div>{/if}
  </div>
{/if}

<style>
  .constel {
    position: fixed;
    inset: 0;
    z-index: 50; /* bajo los sheets (60): el detalle de obra abre ENCIMA */
    background: radial-gradient(130% 90% at 50% 0%, #12100b 0%, #080705 60%);
    overflow: hidden;
    touch-action: none; /* el gesto es del cielo (pan/pinch); nada scrollea debajo */
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  .lbl {
    font-family: var(--font-data);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 10px;
  }
  .lbl.gold { color: #8a6f4a; }
  .lbl.dim { color: #6e665a; }
  .lit { color: #a89f8f; }
  .hl {
    font-family: var(--font-display);
    color: #f2ebdd;
    font-weight: 500;
  }
  .top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 20;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 18px 18px 0;
    pointer-events: none;
  }
  .head { flex: 1; min-width: 0; pointer-events: none; } /* informativo: los nodos de debajo se pueden tocar */
  .head .hl { font-size: 24px; margin-top: 2px; }
  .head .lbl.dim { margin-top: 4px; }
  .search {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(20, 17, 13, 0.8);
    backdrop-filter: blur(10px);
    border: 1px solid #2e2820;
    border-radius: 999px;
    padding: 8px 12px;
  }
  .search input {
    background: none;
    border: none;
    color: var(--ink);
    font: inherit;
    font-size: 14px;
    width: 170px;
    outline: none;
  }
  .sbtn {
    background: none;
    border: none;
    color: #6e665a;
    cursor: pointer;
    display: grid;
    place-items: center;
    padding: 0;
  }
  .x {
    pointer-events: auto;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    border: 1px solid #2e2820;
    background: rgba(20, 17, 13, 0.6);
    backdrop-filter: blur(8px);
    color: #f2ebdd;
    cursor: pointer;
    display: grid;
    place-items: center;
    flex: none;
  }
  @media (max-width: 700px) {
    .search input { width: 0; padding: 0; transition: width var(--dur-base) var(--ease); }
    .search.open input { width: 150px; }
  }
  .chips {
    position: absolute;
    bottom: 16px;
    left: 12px;
    right: 12px;
    z-index: 20;
    display: flex;
    gap: 7px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  @media (min-width: 701px) {
    .chips { bottom: 20px; left: 24px; right: auto; max-width: 560px; flex-wrap: wrap; overflow: visible; }
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border-radius: 999px;
    padding: 7px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid #2e2820;
    color: #a89f8f;
    background: rgba(20, 17, 13, 0.7);
    backdrop-filter: blur(6px);
    flex: none;
    transition: transform var(--dur-fast), border-color 0.2s;
    font-family: var(--font-text);
  }
  .chip:active { transform: scale(0.94); }
  .chip.on { border-color: #f2a65a; color: #f2a65a; }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; }
  /* panel del creador — desktop flotante derecha · móvil bottom sheet (diseño) */
  .panel {
    position: absolute;
    z-index: 22;
    background: rgba(14, 12, 9, 0.9);
    backdrop-filter: blur(16px);
    border: 1px solid #2e2820;
    border-radius: 18px;
    padding: 16px 18px;
    animation: panel-in var(--dur-base) var(--ease) both;
  }
  @media (min-width: 701px) {
    .panel { top: 86px; right: 20px; width: 300px; max-height: calc(100% - 170px); overflow-y: auto; }
    .panel .grip { display: none; }
    @keyframes panel-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
  }
  @media (max-width: 700px) {
    .panel { left: 10px; right: 10px; bottom: 58px; max-height: 46%; overflow-y: auto; }
    @keyframes panel-in { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: none; } }
  }
  .panel .grip { width: 36px; height: 4px; border-radius: 2px; background: #2e2820; margin: 0 auto 12px; }
  .prow { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .pname { font-size: 24px; line-height: 1.05; margin-top: 4px; }
  .pstats { display: flex; gap: 14px; align-items: flex-start; text-align: right; }
  .pstats > div { display: flex; flex-direction: column; }
  .big { font-family: var(--font-display); font-size: 26px; color: #f2ebdd; line-height: 1; }
  .big.gold { color: #f2a65a; }
  .pclose {
    width: 28px; height: 28px; border-radius: 50%; border: 1px solid #2e2820;
    background: none; color: #a89f8f; cursor: pointer; display: grid; place-items: center; flex: none;
  }
  .works-l { margin: 14px 0 8px; }
  .works { display: flex; flex-direction: column; gap: 7px; }
  .work {
    display: flex; align-items: center; gap: 10px; background: none; border: none;
    padding: 2px 0; cursor: pointer; text-align: left; color: inherit; font: inherit; width: 100%;
  }
  .work img, .work .wfb {
    width: 26px; height: 37px; border-radius: 4px; flex: none; object-fit: cover;
    border: 1px solid; display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display); font-size: 13px;
  }
  .wmeta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .wt { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wn { font-family: var(--font-data); font-size: 12px; color: #f2a65a; flex: none; }
  .attr {
    position: absolute; bottom: 4px; right: 12px; z-index: 15; color: #4a443a; font-size: 8px; pointer-events: none;
  }
  @media (min-width: 701px) { .attr { bottom: 22px; right: 24px; font-size: 9px; } }
  .loading {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    color: #6e665a; z-index: 5; pointer-events: none;
  }
</style>
