// VIDEOCLUB 3D — la tienda completa (three.js). Motor puro (sin Svelte): planta, cámara,
// controles, atlas de carátulas con carga por proximidad y selección de estuches.
//
// PLANTA: un pasillo central (eje −Z desde la entrada) y pasillos laterales perpendiculares a
// ambos lados. Cada FORMATO ocupa uno o varios pasillos seguidos; dentro, cada GÉNERO ocupa los
// MÓDULOS de estantería que necesita (1 módulo = 8 columnas × 5 baldas = 40 estuches) y el
// módulo lleva su rótulo. El recorrido de cada pasillo es en U y se lee de izquierda a derecha:
// la pared de tu izquierda al entrar avanza hacia el fondo y la de la derecha vuelve.
//
// RENDIMIENTO (validado en el prototipo):
//  · Un módulo = una malla fusionada + un ATLAS (canvas → CanvasTexture): 1 draw call por módulo.
//  · Dos niveles de detalle por módulo: LO (atlas 512) a media distancia y HI (1024) de cerca;
//    fuera de radio se libera. Los cuerpos de TODOS los estuches son una sola malla instanciada,
//    igual que el mobiliario.
//  · Las imágenes se piden con fetch(mode:'cors') + createImageBitmap: no son peticiones de
//    destino 'image', así que el service worker NO las intercepta (no llenan su caché de 500 ni
//    reciben una respuesta opaca) y el canvas no queda "tainted" (regla §11.61). Si un servidor
//    no da CORS o la imagen falla, el estuche conserva su portada TIPOGRÁFICA.
//  · Se renderiza bajo demanda (flag dirty), no a 60 fps con la escena quieta.
import {
  Scene, PerspectiveCamera, WebGLRenderer, Fog, Color, BufferGeometry, BufferAttribute, Mesh,
  MeshBasicMaterial, MeshLambertMaterial, InstancedMesh, BoxGeometry, PlaneGeometry, CanvasTexture,
  TextureLoader, Raycaster, Vector2, Vector3, Matrix4, Quaternion, Euler, Object3D, Group,
  HemisphereLight, DirectionalLight, SRGBColorSpace, RepeatWrapping, LinearFilter,
  LinearMipmapLinearFilter
} from 'three';

// ── geometría (metros) ──────────────────────────────────────────────────────
const CW = 2.8; // ancho del pasillo central
const X0 = CW / 2 + 0.15; // donde arrancan las estanterías a cada lado
const AISLE_W = 2.1; // pasillo lateral: de trasera a trasera
const SHELF_D = 0.17; // fondo de la balda
const ROW_GAP = 0.1; // hueco entre dos estanterías espalda con espalda
const ROW_PITCH_Z = AISLE_W + ROW_GAP; // distancia entre ejes de pasillos consecutivos
const Z_FIRST = AISLE_W / 2 + 0.7; // eje del primer pasillo
const Z_MAX = 2.4, Z_FRONT = 3.0; // vestíbulo
const CEIL = 2.9;
const CASE_W = 0.135, CASE_H = 0.19;
const TILT = 0.21; // ~12°: el estuche descansa recostado en la balda
const COL_PITCH = 0.155;
const ROWS = 5;
const ROW_PITCH = 0.265;
const ROW0_Y = 0.42; // balda inferior
const TOP_Y = ROW0_Y + ROWS * ROW_PITCH; // 1,745
const HEAD_H = 0.12; // rótulo del módulo
const EYE = 1.42;
const COLS = 8;
const PER_PAGE = COLS * ROWS; // 40
const PAGE_LEN = COLS * COL_PITCH; // 1,24 m
const MAX_BAYS_AISLE = 12; // 6 módulos por pared
const HALF_CLEAR = 0.55; // medio ancho transitable de un pasillo lateral
// atlas: 8×5 celdas 2:3 sobre un cuadrado (se usa 1 × 0,9375 de la textura)
const CELL_U = 1 / 8, CELL_V = 0.9375 / 5;
const SIZES = { lo: 512, hi: 1024 };

// aspecto del estuche por formato: grosor (m) y color del canto
const CASE_STYLE = {
  pelicula: { d: 0.015, color: 0x17151a },
  serie: { d: 0.024, color: 0x1a1d26 },
  videojuego: { d: 0.014, color: 0x16263a },
  libro: { d: 0.032, color: 0xd9cfbd },
  comic: { d: 0.007, color: 0xe9e4d8 }
};
const STYLE_DEF = { d: 0.015, color: 0x17151a };

const SIN_CORS = /\/\/pics\.filmaffinity\.com\//; // no envía cabeceras CORS: no vale como textura

/** URL de miniatura adecuada al nivel de detalle (solo reescribe los CDN que lo permiten). */
export function thumbUrl(url, tier) {
  if (!url || SIN_CORS.test(url)) return null;
  if (/\/\/(image|media)\.(tmdb|themoviedb)\.org\/t\/p\//.test(url)) {
    return url.replace(/\/t\/p\/[^/]+\//, tier === 'hi' ? '/t/p/w154/' : '/t/p/w92/');
  }
  if (/covers\.openlibrary\.org/.test(url)) return url.replace(/-[SML]\.jpg/, tier === 'hi' ? '-M.jpg' : '-S.jpg');
  return url;
}

/** Steam: la carátula guardada es la cabecera HORIZONTAL (460×215); para un estuche vale mucho
 *  más la cápsula vertical de biblioteca (600×900) del mismo juego, si existe. */
export function verticalUrl(url) {
  const m = /^(https:\/\/cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/\d+\/)header\.jpg/.exec(url ?? '');
  return m ? m[1] + 'library_600x900.jpg' : null;
}

/** Hueco k de un módulo, en coordenadas LOCALES del módulo (x → derecha del que mira, y ↑,
 *  z → hacia el pasillo): centro del canto inferior DELANTERO del estuche. */
function slotLocal(k) {
  const c = Math.floor(k / ROWS), r = k % ROWS; // r = 0 → balda superior
  return { x: (c + 0.5) * COL_PITCH, y: ROW0_Y + (ROWS - 1 - r) * ROW_PITCH + 0.011, z: SHELF_D - 0.035 };
}
const UP_Y = Math.cos(TILT), UP_Z = -Math.sin(TILT); // "arriba" del estuche recostado
const N_Y = Math.sin(TILT), N_Z = Math.cos(TILT); // normal de su portada

function wrapText(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}
function fitFont(ctx, text, maxW, size, min, face) {
  let fs = size;
  ctx.font = face(fs);
  while (ctx.measureText(text).width > maxW && fs > min) ctx.font = face((fs -= 2));
  return fs;
}

const fmtNota = (n) => (n == null ? '—' : String(n).replace('.', ','));
const fmtMiles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * @param {HTMLElement} wrap  contenedor (se mide ÉL, no la ventana)
 * @param {{ woodUrl?: string, reduced?: boolean, coarse?: boolean, colors?: Record<string,string>,
 *           onSelect?: (o: any|null) => void, onStats?: (s: any) => void }} opts
 */
export function createVideoclub(wrap, opts = {}) {
  const reduced = !!opts.reduced;
  const coarse = !!opts.coarse;
  const colorOf = (formato) => opts.colors?.[formato] ?? '#C75D52';
  // radios (m) con histéresis: [cargar, liberar]
  const R = coarse
    ? { hi: [3.2, 4.6], lo: [10, 12.5], keep: 5, fog: [5, 14] }
    : { hi: [4.8, 6.4], lo: [15, 18], keep: 7, fog: [8, 21] };

  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  canvas.tabIndex = 0;
  wrap.appendChild(canvas);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const BG = 0x130f10;
  const scene = new Scene();
  scene.background = new Color(BG);
  scene.fog = new Fog(BG, R.fog[0], R.fog[1]);
  const camera = new PerspectiveCamera(68, 1, 0.05, 80);
  camera.rotation.order = 'YXZ';

  scene.add(new HemisphereLight(0xfff1dd, 0x3a2a24, 2.6));
  const sun = new DirectionalLight(0xffe2bd, 1.1);
  sun.position.set(0.5, 3, 0.8);
  scene.add(sun);

  // ── estado ────────────────────────────────────────────────────────────────
  let dirty = true;
  let disposed = false;
  let raf = 0;
  let store = null; // { group, pages[], aisles[], sections, zEnd, disposables[], bodies, floor, blockers[] }
  let selected = null;
  const pos = { x: 0, z: 1.9, yaw: 0, pitch: -0.03 };
  let tween = null;
  let path = []; // tramos pendientes del desplazamiento guiado
  const keys = new Set();
  let walk = 0; // botones táctiles ▲▼
  const stats = { pages: 0, lo: 0, hi: 0, imgs: 0, fallos: 0, pend: 0, fps: 0, draw: 0, n: 0, here: '' };
  const invalidate = () => (dirty = true);

  // ── cola global de carga de imágenes ─────────────────────────────────────
  const queue = [];
  let inflight = 0;
  const MAX_INFLIGHT = coarse ? 6 : 10;
  async function fetchBitmap(url, signal) {
    let res;
    try {
      res = await fetch(url, { mode: 'cors', credentials: 'omit', signal });
    } catch (e) {
      if (signal.aborted) throw e;
      // el caché HTTP puede guardar una respuesta sin cabeceras CORS de un <img> previo → reintento limpio
      res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'reload', signal });
    }
    if (!res.ok) throw new Error('http ' + res.status);
    return createImageBitmap(await res.blob());
  }
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      const job = queue.shift();
      const { page, tier, k } = job;
      const layer = page[tier];
      if (!layer || layer.gen !== job.gen) continue; // el módulo se liberó entretanto
      const url = thumbUrl(page.obras[k].imagen_url, tier);
      inflight++;
      const vert = verticalUrl(url);
      (vert ? fetchBitmap(vert, layer.abort.signal).catch(() => fetchBitmap(url, layer.abort.signal)) : fetchBitmap(url, layer.abort.signal))
        .then((bmp) => {
          if (page[tier] === layer && !disposed) {
            drawCover(layer, k, bmp);
            layer.dirty = true;
            stats.imgs++;
            invalidate();
          }
          bmp.close?.();
        })
        .catch(() => {
          if (page[tier] === layer) stats.fallos++;
        })
        .finally(() => {
          inflight--;
          pump();
        });
    }
    stats.pend = queue.length + inflight;
  }

  // ── atlas ────────────────────────────────────────────────────────────────
  function cellRect(size, k) {
    const cw = size / 8, ch = (size * 0.9375) / 5;
    return { x: (k % 8) * cw, y: Math.floor(k / 8) * ch, w: cw, h: ch };
  }
  function drawFallback(ctx, size, k, obra, accent) {
    const { x, y, w, h } = cellRect(size, k);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = '#17131a';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, h * 0.045);
    ctx.globalAlpha = 1;
    const fs = Math.max(7, Math.round(w * 0.105));
    ctx.font = `700 ${fs}px Georgia, 'Times New Roman', serif`;
    ctx.fillStyle = '#efe6da';
    ctx.textBaseline = 'top';
    const lines = wrapText(ctx, obra.titulo ?? '', w * 0.84, 6);
    lines.forEach((ln, i) => ctx.fillText(ln, x + w * 0.08, y + h * 0.12 + i * fs * 1.18));
    if (obra.anio_obra) {
      ctx.font = `600 ${Math.max(6, Math.round(w * 0.085))}px system-ui, sans-serif`;
      ctx.fillStyle = accent;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String(obra.anio_obra), x + w * 0.08, y + h * 0.93);
    }
    ctx.restore();
  }
  function drawCover(layer, k, bmp) {
    const ctx = layer.ctx;
    const { x, y, w, h } = cellRect(layer.size, k);
    const ar = bmp.width / bmp.height, cell = w / h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    // relleno: la propia imagen a sangre (cover)
    const s = Math.max(w / bmp.width, h / bmp.height);
    const fw = bmp.width * s, fh = bmp.height * s;
    ctx.drawImage(bmp, x + (w - fw) / 2, y + (h - fh) / 2, fw, fh);
    if (Math.abs(ar - cell) / cell > 0.12) {
      // proporción ajena al estuche (p. ej. cabecera horizontal de Steam): fondo atenuado + imagen entera
      ctx.fillStyle = 'rgba(8,7,9,0.72)';
      ctx.fillRect(x, y, w, h);
      const c = Math.min(w / bmp.width, h / bmp.height);
      const iw = bmp.width * c, ih = bmp.height * c;
      ctx.drawImage(bmp, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    }
    ctx.restore();
  }
  let genSeq = 0;
  function loadLayer(page, tier) {
    const size = SIZES[tier];
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0c0a0b';
    ctx.fillRect(0, 0, size, size);
    if (tier === 'hi' && page.lo) ctx.drawImage(page.lo.cv, 0, 0, size, size); // arranca del LO ampliado: sin parpadeo
    else page.obras.forEach((o, k) => drawFallback(ctx, size, k, o, page.accent));
    const tex = new CanvasTexture(cv);
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = Math.min(8, maxAniso);
    const layer = { size, cv, ctx, tex, dirty: false, gen: ++genSeq, abort: new AbortController() };
    page[tier] = layer;
    // en HI las obras sin carátula se redibujan nítidas (el LO ampliado se ve borroso)
    if (tier === 'hi') page.obras.forEach((o, k) => !thumbUrl(o.imagen_url, tier) && drawFallback(ctx, size, k, o, page.accent));
    const jobs = [];
    page.obras.forEach((o, k) => thumbUrl(o.imagen_url, tier) && jobs.push({ page, tier, k, gen: layer.gen }));
    if (tier === 'hi') queue.unshift(...jobs); // lo cercano y nítido va antes que las miniaturas lejanas
    else queue.push(...jobs);
    stats[tier]++;
    applyMap(page);
    pump();
  }
  function freeLayer(page, tier) {
    const layer = page[tier];
    if (!layer) return;
    layer.abort.abort();
    layer.tex.dispose();
    layer.cv.width = layer.cv.height = 0; // iOS: liberar la memoria del canvas ya
    page[tier] = null;
    stats[tier]--;
    applyMap(page);
  }
  function applyMap(page) {
    const tex = page.hi?.tex ?? page.lo?.tex ?? null;
    if (page.mat.map !== tex) {
      page.mat.map = tex;
      page.mat.color.set(tex ? 0xffffff : 0x1b161a);
      page.mat.needsUpdate = true;
      invalidate();
    }
  }
  /** ¿Se ve este módulo desde donde está la cámara? Las estanterías tapan los demás pasillos:
   *  dentro de un pasillo solo se ven sus dos paredes (y el de enfrente a través de la boca);
   *  desde el central, el pasillo con el que estás alineado y la boca de los vecinos. */
  function visible(page) {
    const A = page.aisle;
    const dz = Math.abs(pos.z - A.zc);
    if (Math.abs(pos.x) > CW / 2) return dz < AISLE_W / 2 + 0.2; // mismo pasillo o el de enfrente
    if (dz < AISLE_W / 2 + 0.35) return true; // alineado con la boca: se ve hasta el fondo
    return page.depth < 2 * PAGE_LEN + 0.2 * dz; // de refilón: solo los primeros módulos
  }
  function updateLod() {
    if (!store) return;
    const near = [];
    let best = null;
    for (const page of store.pages) {
      const d = Math.hypot(page.cx - pos.x, page.cz - pos.z);
      page.dist = d;
      if (!best || d < best.dist) best = page;
      const vis = visible(page);
      if (!page.lo && vis && d < R.lo[0]) near.push(page);
      else if (page.lo && (d > R.lo[1] || (!vis && d > R.keep))) freeLayer(page, 'lo');
      if (page.hi && (d > R.hi[1] || !page.lo)) freeLayer(page, 'hi');
    }
    near.sort((a, b) => a.dist - b.dist).forEach((p) => loadLayer(p, 'lo'));
    store.pages
      .filter((p) => p.lo && !p.hi && p.dist < R.hi[0])
      .sort((a, b) => a.dist - b.dist)
      .forEach((p) => loadLayer(p, 'hi'));
    // la cola se reordena con cada movimiento: primero lo nítido y lo más cercano a la cámara
    // (sin esto, tras cruzar la tienda se atenderían antes los pasillos que ya quedaron atrás)
    if (queue.length > 1) {
      const vivos = queue.filter((j) => j.page[j.tier]?.gen === j.gen);
      vivos.sort((a, b) => (a.tier === b.tier ? a.page.dist - b.page.dist : a.tier === 'hi' ? -1 : 1));
      queue.length = 0;
      queue.push(...vivos);
    }
    stats.here = best && best.dist < 3.2 ? `${best.sec.formatoLabel} · ${best.sec.label}` : 'Pasillo central';
  }

  // ── texturas de rótulos y suelo ──────────────────────────────────────────
  const mkTex = (cv) => {
    const t = new CanvasTexture(cv);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = Math.min(8, maxAniso);
    return t;
  };
  /** Banderola de pasillo: formato + géneros que arrancan en él + flecha hacia el pasillo. */
  function aisleSignTexture(aisle, flecha) {
    const cv = document.createElement('canvas');
    cv.width = 640;
    cv.height = 288;
    const c = cv.getContext('2d');
    c.fillStyle = '#120e10';
    c.fillRect(0, 0, 640, 288);
    c.fillStyle = aisle.color;
    c.fillRect(0, 0, 640, 12);
    c.fillRect(0, 276, 640, 12);
    c.textAlign = 'center';
    c.fillStyle = '#f3e9dc';
    const titulo = flecha === '◀' ? `◀  ${aisle.formatoLabel.toUpperCase()}` : `${aisle.formatoLabel.toUpperCase()}  ▶`;
    fitFont(c, titulo, 590, 76, 40, (s) => `700 ${s}px Georgia, serif`);
    c.fillText(titulo, 320, 96);
    c.fillStyle = aisle.color;
    c.fillRect(200, 118, 240, 3);
    c.fillStyle = '#cdbfb1';
    c.font = '500 30px system-ui, sans-serif';
    const nombres = aisle.labels.slice(0, 4);
    if (aisle.labels.length > 4) nombres[3] = `y ${aisle.labels.length - 3} más`;
    nombres.forEach((n, i) => {
      fitFont(c, n, 580, 30, 20, (s) => `500 ${s}px system-ui, sans-serif`);
      c.fillText(n, 320, 160 + i * 34);
    });
    return mkTex(cv);
  }
  /** Atlas de rótulos de módulo: una fila 512×48 por sección, en dos columnas. */
  function labelAtlas(sections) {
    const rows = Math.ceil(sections.length / 2);
    let h = 64;
    while (h < rows * 48) h *= 2;
    const cv = document.createElement('canvas');
    cv.width = 1024;
    cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#17120f';
    c.fillRect(0, 0, 1024, h);
    sections.forEach((s, i) => {
      const x = (i % 2) * 512, y = Math.floor(i / 2) * 48;
      c.fillStyle = '#1d1613';
      c.fillRect(x, y, 512, 48);
      c.fillStyle = colorOf(s.formato);
      c.fillRect(x, y, 10, 48);
      c.fillRect(x, y + 44, 512, 4);
      c.textBaseline = 'middle';
      c.textAlign = 'right';
      c.font = '600 22px system-ui, sans-serif';
      c.fillStyle = '#a89a8c';
      const n = fmtMiles(s.obras.length);
      c.fillText(n, x + 500, y + 23);
      c.textAlign = 'left';
      c.fillStyle = '#f3e9dc';
      fitFont(c, s.label.toUpperCase(), 500 - 34 - c.measureText(n).width - 16, 28, 16, (z) => `700 ${z}px Georgia, serif`);
      c.fillText(s.label.toUpperCase(), x + 24, y + 23);
      s._uv = { u0: x / 1024, u1: (x + 512) / 1024, v1: 1 - y / h, v0: 1 - (y + 48) / h };
    });
    return mkTex(cv);
  }
  function floorTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = '#2b2225';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#382c30';
    c.fillRect(0, 0, 64, 64);
    c.fillRect(64, 64, 64, 64);
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(255,240,220,${Math.random() * 0.035})`;
      c.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5);
    }
    const t = mkTex(cv);
    t.wrapS = t.wrapT = RepeatWrapping;
    return t;
  }

  function clearStore() {
    select(null);
    queue.length = 0;
    tween = null;
    path = [];
    if (!store) return;
    for (const p of store.pages) {
      freeLayer(p, 'hi');
      freeLayer(p, 'lo');
    }
    scene.remove(store.group);
    store.disposables.forEach((d) => d.dispose());
    store = null;
  }

  /**
   * (Re)construye la tienda. sections = [{ id, formato, formatoLabel, label, obras[] }] YA
   * ordenadas (formato → género); obras = [{ id, titulo, anio_obra, imagen_url, nota }].
   */
  function setStore(sections) {
    clearStore();
    const group = new Group();
    const disposables = [];
    const keep = (x) => (disposables.push(x), x);

    // 1) módulos por sección → pasillos por formato
    const aisles = [];
    let i = 0;
    while (i < sections.length) {
      const formato = sections[i].formato;
      const bays = [];
      let j = i;
      for (; j < sections.length && sections[j].formato === formato; j++) {
        const sec = sections[j];
        for (let p0 = 0; p0 < Math.max(1, sec.obras.length); p0 += PER_PAGE) {
          bays.push({ sec, obras: sec.obras.slice(p0, p0 + PER_PAGE), first: p0 === 0 });
        }
      }
      const nA = Math.ceil(bays.length / MAX_BAYS_AISLE);
      const per = Math.ceil(bays.length / nA);
      for (let a = 0; a < nA; a++) {
        const mine = bays.slice(a * per, (a + 1) * per);
        aisles.push({
          formato,
          formatoLabel: sections[i].formatoLabel,
          color: colorOf(formato),
          bays: mine,
          labels: [...new Set(mine.map((b) => b.sec.label))]
        });
      }
      i = j;
    }
    aisles.forEach((A, k) => {
      A.side = k % 2 ? 1 : -1; // izquierda, derecha, izquierda…
      A.row = k >> 1;
      A.zc = -(Z_FIRST + A.row * ROW_PITCH_Z);
      A.bw = Math.ceil(A.bays.length / 2); // módulos por pared
      A.xEnd = X0 + A.bw * PAGE_LEN + 0.35; // testero
    });
    const rows = Math.max(1, Math.ceil(aisles.length / 2));
    const zEnd = -(Z_FIRST + (rows - 1) * ROW_PITCH_Z + AISLE_W / 2 + 0.25);
    const maxX = Math.max(X0 + 2, ...aisles.map((A) => A.xEnd)) + 0.3;

    // 2) acumuladores de mobiliario instanciado (cajas unidad escaladas)
    const boxes = { wood: [], dark: [], wall: [], tube: [] };
    const strips = []; // { m, color }
    const mTmp = new Matrix4(), q = new Quaternion(), e = new Euler(), v1 = new Vector3(), v2 = new Vector3();
    const local = (x, y, z, sx, sy, sz, rx = 0) => {
      e.set(rx, 0, 0);
      q.setFromEuler(e);
      return new Matrix4().compose(v1.set(x, y, z), q, v2.set(sx, sy, sz));
    };
    const world = (x, y, z, sx, sy, sz) => local(x, y, z, sx, sy, sz);
    const bodyMats = [], bodyCols = [];
    const headP = [], headU = [], headI = [];
    const labelTex = keep(labelAtlas(sections));
    const pages = [];

    const furnish = (M) => {
      boxes.dark.push(M.clone().multiply(local(PAGE_LEN / 2, TOP_Y / 2 + HEAD_H / 2, 0.01, PAGE_LEN, TOP_Y + HEAD_H, 0.02)));
      for (let r = 0; r <= ROWS; r++) {
        const y = ROW0_Y + r * ROW_PITCH;
        boxes.wood.push(M.clone().multiply(local(PAGE_LEN / 2, y, SHELF_D / 2, PAGE_LEN, 0.022, SHELF_D)));
        if (r < ROWS) boxes.wood.push(M.clone().multiply(local(PAGE_LEN / 2, y + 0.019, SHELF_D - 0.004, PAGE_LEN, 0.016, 0.008)));
      }
      boxes.dark.push(M.clone().multiply(local(PAGE_LEN / 2, (ROW0_Y - 0.011) / 2, SHELF_D / 2, PAGE_LEN, ROW0_Y - 0.011, SHELF_D)));
      for (const x of [0, PAGE_LEN]) {
        boxes.wood.push(M.clone().multiply(local(x, (TOP_Y + HEAD_H) / 2, SHELF_D / 2, 0.016, TOP_Y + HEAD_H, SHELF_D + 0.004)));
      }
      boxes.wood.push(M.clone().multiply(local(PAGE_LEN / 2, TOP_Y + HEAD_H / 2, SHELF_D - 0.012, PAGE_LEN, HEAD_H, 0.02)));
    };

    for (const A of aisles) {
      const s = A.side;
      const slotsTotal = A.bw * 2;
      const m2 = A.bays.length - A.bw; // módulos de la pared de vuelta (≤ bw)
      for (let j = 0; j < slotsTotal; j++) {
        const firstWall = j < A.bw;
        const b = firstWall ? j : j - A.bw;
        // pared de vuelta: sus módulos se pegan al pasillo central; si sobra hueco, queda al FONDO
        const bay = firstWall ? A.bays[j] : b < m2 ? A.bays[A.bw + b] : null;
        const zWall = firstWall ? A.zc - (s * AISLE_W) / 2 : A.zc + (s * AISLE_W) / 2;
        const theta = zWall > A.zc ? Math.PI : 0;
        const ox = firstWall ? s * (X0 + b * PAGE_LEN) : b < m2 ? s * (X0 + (m2 - b) * PAGE_LEN) : s * (X0 + (b + 1) * PAGE_LEN);
        const holder = new Object3D();
        holder.position.set(ox, 0, zWall);
        holder.rotation.y = theta;
        holder.updateMatrix();
        const M = holder.matrix.clone();
        furnish(M);
        if (!bay) continue; // módulo vacío al final de la U: solo mueble
        const style = CASE_STYLE[A.formato] ?? STYLE_DEF;
        const n = bay.obras.length;
        const P = new Float32Array(n * 12), U = new Float32Array(n * 8), I = [];
        bay.obras.forEach((o, k) => {
          const O = slotLocal(k);
          // cuerpo (caja W×H×D recostada)
          const cy = O.y + (CASE_H / 2) * UP_Y - (style.d / 2) * N_Y;
          const cz = O.z + (CASE_H / 2) * UP_Z - (style.d / 2) * N_Z;
          o._bi = bodyMats.length;
          bodyMats.push(M.clone().multiply(local(O.x, cy, cz, CASE_W, CASE_H, style.d, -TILT)));
          bodyCols.push(style.color);
          // portada: quad sobre la cara delantera (CCW vista de frente)
          const fy = O.y + 0.0008 * N_Y, fz = O.z + 0.0008 * N_Z;
          const xl = O.x - CASE_W / 2, xr = O.x + CASE_W / 2;
          const ty = fy + CASE_H * UP_Y, tz = fz + CASE_H * UP_Z;
          P.set([xl, fy, fz, xr, fy, fz, xr, ty, tz, xl, ty, tz], k * 12);
          const u0 = (k % 8) * CELL_U, vt = 1 - Math.floor(k / 8) * CELL_V;
          U.set([u0, vt - CELL_V, u0 + CELL_U, vt - CELL_V, u0 + CELL_U, vt, u0, vt], k * 8);
          const bb = k * 4;
          I.push(bb, bb + 1, bb + 2, bb, bb + 2, bb + 3);
        });
        const geo = keep(new BufferGeometry());
        geo.setAttribute('position', new BufferAttribute(P, 3));
        geo.setAttribute('uv', new BufferAttribute(U, 2));
        geo.setIndex(I);
        geo.computeBoundingSphere();
        const mat = keep(new MeshBasicMaterial({ color: 0x1b161a }));
        const mesh = new Mesh(geo, mat);
        mesh.position.copy(holder.position);
        mesh.rotation.y = theta;
        const cos = Math.cos(theta), sin = Math.sin(theta);
        const page = {
          mesh, mat, geo, obras: bay.obras, sec: bay.sec, aisle: A, theta, ox, oz: zWall, style,
          accent: A.color, lo: null, hi: null, dist: 1e9, depth: Math.abs(ox + (PAGE_LEN / 2) * cos) - X0,
          cx: ox + (PAGE_LEN / 2) * cos, cz: zWall - (PAGE_LEN / 2) * sin
        };
        mesh.userData.page = page;
        group.add(mesh);
        pages.push(page);
        if (bay.first) bay.sec._page = page;
        // rótulo del módulo (un quad sobre la cenefa, UV de su sección en el atlas)
        const uv = bay.sec._uv;
        const hb = headP.length / 3;
        for (const [lx, ly] of [[0.01, TOP_Y + 0.004], [PAGE_LEN - 0.01, TOP_Y + 0.004], [PAGE_LEN - 0.01, TOP_Y + HEAD_H - 0.004], [0.01, TOP_Y + HEAD_H - 0.004]]) {
          v1.set(lx, ly, SHELF_D - 0.0005).applyMatrix4(M);
          headP.push(v1.x, v1.y, v1.z);
        }
        headU.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
        headI.push(hb, hb + 1, hb + 2, hb, hb + 2, hb + 3);
      }
      // testero del pasillo + cabecera de góndola hacia el pasillo central
      boxes.wall.push(world(s * (A.xEnd + 0.025), CEIL / 2, A.zc, 0.05, CEIL, AISLE_W + ROW_GAP));
      strips.push({ m: world(s * (CW / 2 + 0.02), 0.004, A.zc, 0.14, 0.006, AISLE_W - 0.5), color: A.color });
      const nt = Math.max(1, Math.round((A.xEnd - CW / 2) / 2.6));
      for (let t = 0; t < nt; t++) {
        boxes.tube.push(world(s * (CW / 2 + ((t + 0.5) * (A.xEnd - CW / 2)) / nt), CEIL - 0.03, A.zc, 1.1, 0.03, 0.09));
      }
    }
    // cabeceras de góndola y tabiques donde un lado no tiene pasillo
    for (const s of [-1, 1]) {
      for (let r = 0; r <= rows; r++) {
        const zc = -(Z_FIRST + r * ROW_PITCH_Z);
        // entre el pasillo r-1 y el r (o contra el vestíbulo / el fondo)
        boxes.wood.push(world(s * (X0 - 0.02), (TOP_Y + HEAD_H) / 2, zc + AISLE_W / 2 + ROW_GAP / 2, 0.03, TOP_Y + HEAD_H, ROW_GAP + 2 * SHELF_D + 0.02));
        if (r < rows && !aisles.some((A) => A.side === s && A.row === r)) {
          boxes.wall.push(world(s * (X0 - 0.03), CEIL / 2, zc, 0.05, CEIL, ROW_PITCH_Z));
        }
      }
      // vestíbulo
      boxes.wall.push(world(s * (X0 - 0.03), CEIL / 2, (Z_FRONT - Z_FIRST + AISLE_W / 2) / 2, 0.05, CEIL, Z_FRONT + Z_FIRST - AISLE_W / 2));
    }
    boxes.wall.push(world(0, CEIL / 2, Z_FRONT, CW + 1, CEIL, 0.05));
    boxes.wall.push(world(0, CEIL / 2, zEnd - 0.025, 2 * maxX, CEIL, 0.05));
    const corrLen = Z_MAX - zEnd;
    const ntc = Math.max(1, Math.round(corrLen / 2.4));
    for (let t = 0; t < ntc; t++) boxes.tube.push(world(0, CEIL - 0.03, Z_MAX - ((t + 0.5) * corrLen) / ntc, 0.09, 0.03, 1.1));

    // 3) materiales y mallas instanciadas
    const wood = keep(new TextureLoader().load(opts.woodUrl ?? 'wood.jpg', invalidate));
    wood.colorSpace = SRGBColorSpace;
    wood.wrapS = wood.wrapT = RepeatWrapping;
    const unit = keep(new BoxGeometry(1, 1, 1));
    const mats = {
      wood: keep(new MeshLambertMaterial({ map: wood, color: 0xd9b48c })),
      dark: keep(new MeshLambertMaterial({ map: wood, color: 0x7a5d47 })),
      wall: keep(new MeshLambertMaterial({ color: 0x3b2d2f })),
      tube: keep(new MeshBasicMaterial({ color: 0xfff0d6 }))
    };
    const inst = {};
    for (const kind of Object.keys(boxes)) {
      const list = boxes[kind];
      const im = new InstancedMesh(unit, mats[kind], Math.max(1, list.length));
      list.forEach((m, n) => im.setMatrixAt(n, m));
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      group.add(im);
      inst[kind] = im;
    }
    const stripMesh = new InstancedMesh(unit, keep(new MeshBasicMaterial({ color: 0xffffff })), Math.max(1, strips.length));
    const col = new Color();
    strips.forEach((st, n) => {
      stripMesh.setMatrixAt(n, st.m);
      stripMesh.setColorAt(n, col.set(st.color));
    });
    stripMesh.count = strips.length;
    group.add(stripMesh);
    // cuerpos de los estuches
    const bodies = new InstancedMesh(unit, keep(new MeshLambertMaterial({ color: 0xffffff })), Math.max(1, bodyMats.length));
    bodyMats.forEach((m, n) => {
      bodies.setMatrixAt(n, m);
      bodies.setColorAt(n, col.set(bodyCols[n]));
    });
    bodies.count = bodyMats.length;
    bodies.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    bodies.frustumCulled = false;
    group.add(bodies);
    // rótulos de módulo: una sola malla
    if (headP.length) {
      const hg = keep(new BufferGeometry());
      hg.setAttribute('position', new BufferAttribute(new Float32Array(headP), 3));
      hg.setAttribute('uv', new BufferAttribute(new Float32Array(headU), 2));
      hg.setIndex(headI);
      const hm = new Mesh(hg, keep(new MeshBasicMaterial({ map: labelTex })));
      hm.frustumCulled = false;
      group.add(hm);
    }
    // banderolas de pasillo (dos caras, cada una con su flecha)
    const signGeo = keep(new PlaneGeometry(1.12, 0.504));
    for (const A of aisles) {
      for (const dir of [1, -1]) {
        // dir=+1: cara que mira a +Z (la ves al avanzar hacia el fondo)
        const flecha = A.side * dir < 0 ? '◀' : '▶';
        const m = new Mesh(signGeo, keep(new MeshBasicMaterial({ map: keep(aisleSignTexture(A, flecha)) })));
        m.position.set(A.side * 0.76, 2.36, A.zc + dir * 0.012);
        m.rotation.y = dir > 0 ? 0 : Math.PI;
        group.add(m);
      }
    }
    // suelo y techo
    const ft = keep(floorTexture());
    const fw = 2 * maxX + 1, fl = Z_FRONT - zEnd + 1;
    ft.repeat.set(fw, fl);
    const floor = new Mesh(keep(new PlaneGeometry(fw, fl)), keep(new MeshLambertMaterial({ map: ft })));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, (Z_FRONT + zEnd) / 2);
    floor.userData.floor = true;
    group.add(floor);
    const ceil = new Mesh(keep(new PlaneGeometry(fw, fl)), keep(new MeshLambertMaterial({ color: 0x4a3a3c })));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, CEIL, (Z_FRONT + zEnd) / 2);
    group.add(ceil);

    scene.add(group);
    store = { group, pages, aisles, sections, zEnd, disposables, bodies, floor, blockers: [inst.dark, inst.wall] };
    stats.pages = pages.length;
    stats.n = bodyMats.length;
    Object.assign(pos, { x: 0, z: 1.9, yaw: 0, pitch: -0.03 });
    updateLod();
    invalidate();
  }

  // ── por dónde se puede andar ─────────────────────────────────────────────
  function walkable(x, z) {
    if (!store) return false;
    if (Math.abs(x) <= CW / 2 - 0.35 && z <= Z_MAX && z >= store.zEnd + 0.45) return true;
    for (const A of store.aisles) {
      if (Math.abs(z - A.zc) <= HALF_CLEAR) {
        const ax = x * A.side;
        if (ax >= 0 && ax <= A.xEnd - 0.4) return true;
      }
    }
    return false;
  }
  function tryMove(dx, dz) {
    if (walkable(pos.x + dx, pos.z + dz)) {
      pos.x += dx;
      pos.z += dz;
    } else if (walkable(pos.x + dx, pos.z)) pos.x += dx; // deslizar a lo largo del obstáculo
    else if (walkable(pos.x, pos.z + dz)) pos.z += dz;
  }
  const clampLook = () => (pos.pitch = Math.max(-1.0, Math.min(0.75, pos.pitch)));
  const regionOf = (x, z) => {
    if (Math.abs(x) <= CW / 2) return 'c';
    let best = 'c', bd = 1e9;
    store.aisles.forEach((A, n) => {
      const d = Math.abs(z - A.zc);
      if (A.side * x > 0 && d < bd) {
        bd = d;
        best = n;
      }
    });
    return best;
  };

  // ── desplazamiento guiado (por el pasillo central, nunca a través de una estantería) ──
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  function startSeg() {
    const to = path.shift();
    if (!to) return (tween = null);
    const from = { ...pos };
    let dy = to.yaw - from.yaw;
    dy = ((dy + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; // giro por el camino corto
    const dist = Math.hypot(to.x - from.x, to.z - from.z);
    tween = { from, to: { ...to, yaw: from.yaw + dy }, t0: performance.now(),
      dur: Math.min(1500, 380 + dist * 150), ease: to.last && !to.multi ? easeOutExpo : easeInOut };
  }
  function glideTo(target) {
    if (!store) return;
    const t = { yaw: pos.yaw, pitch: pos.pitch, ...target };
    if (reduced) {
      Object.assign(pos, t);
      tween = null;
      path = [];
      updateLod();
      return invalidate();
    }
    const a = regionOf(pos.x, pos.z), b = regionOf(t.x, t.z);
    const pts = [];
    if (a !== b) {
      if (a !== 'c') pts.push({ x: 0, z: store.aisles[a].zc });
      if (b !== 'c') pts.push({ x: 0, z: store.aisles[b].zc });
    }
    // de paso se mira hacia donde se camina
    let px = pos.x, pz = pos.z;
    path = [];
    for (const p of pts) {
      if (Math.hypot(p.x - px, p.z - pz) < 0.3) continue;
      path.push({ x: p.x, z: p.z, yaw: Math.atan2(-(p.x - px), -(p.z - pz)), pitch: -0.03 });
      px = p.x;
      pz = p.z;
    }
    path.push({ ...t, last: true, multi: path.length > 0 });
    startSeg();
    invalidate();
  }

  // ── selección: el estuche sale de la balda; segundo toque = girarlo (nota al dorso) ──
  function backTexture(o, accent) {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 384;
    const c = cv.getContext('2d');
    c.fillStyle = '#15121a';
    c.fillRect(0, 0, 256, 384);
    c.fillStyle = accent;
    c.fillRect(0, 0, 256, 10);
    c.textAlign = 'center';
    c.fillStyle = '#b9aca0';
    c.font = '600 20px system-ui, sans-serif';
    c.fillText('TU NOTA', 128, 96);
    c.fillStyle = '#f3e9dc';
    c.font = '700 120px Georgia, serif';
    c.fillText(fmtNota(o.nota), 128, 220);
    c.font = '600 19px Georgia, serif';
    c.fillStyle = '#d8ccbf';
    wrapText(c, o.titulo ?? '', 216, 3).forEach((ln, n) => c.fillText(ln, 128, 286 + n * 24));
    if (o.anio_obra) {
      c.fillStyle = accent;
      c.font = '600 18px system-ui, sans-serif';
      c.fillText(String(o.anio_obra), 128, 366);
    }
    return mkTex(cv);
  }
  const hideM = new Matrix4(), hp = new Vector3(), hq = new Quaternion(), hs = new Vector3();
  function setSlotHidden(page, k, hidden) {
    // el original se colapsa mientras su copia "héroe" está fuera de la balda
    const o = page.obras[k];
    if (hidden) {
      store.bodies.getMatrixAt(o._bi, hideM);
      page._savedM = hideM.clone();
      hideM.decompose(hp, hq, hs);
      hideM.compose(hp, hq, hs.setScalar(0.0001));
      store.bodies.setMatrixAt(o._bi, hideM);
    } else if (page._savedM) {
      store.bodies.setMatrixAt(o._bi, page._savedM);
      page._savedM = null;
    }
    store.bodies.instanceMatrix.needsUpdate = true;
    const P = page.geo.attributes.position;
    if (hidden) {
      page._saved = Array.from(P.array.slice(k * 12, k * 12 + 12));
      for (let n = 0; n < 4; n++) P.setXYZ(k * 4 + n, page._saved[0], page._saved[1], page._saved[2]);
    } else if (page._saved) {
      P.array.set(page._saved, k * 12);
      page._saved = null;
    }
    P.needsUpdate = true;
  }
  /** punto local del módulo → mundo */
  const toWorld = (page, lx, lz) => {
    const c = Math.cos(page.theta), s = Math.sin(page.theta);
    return { x: page.ox + lx * c + lz * s, z: page.oz - lx * s + lz * c };
  };
  function select(sel) {
    if (selected) {
      setSlotHidden(selected.page, selected.k, false);
      selected.page.mesh.remove(selected.hero);
      selected.dispose.forEach((d) => d.dispose());
      selected = null;
    }
    if (sel && store) {
      const { page, k } = sel;
      const o = page.obras[k];
      const O = slotLocal(k);
      const D = page.style.d;
      const dispose = [];
      const keep = (x) => (dispose.push(x), x);
      // héroe (hijo del módulo → coordenadas locales): posición → recostado → giro sobre su eje
      const hero = new Group();
      const tiltG = new Group();
      const flipG = new Group();
      hero.add(tiltG);
      tiltG.add(flipG);
      flipG.position.set(0, CASE_H / 2, -D / 2);
      flipG.add(new Mesh(keep(new BoxGeometry(CASE_W, CASE_H, D)), keep(new MeshLambertMaterial({ color: page.style.color }))));
      const front = new Mesh(keep(new PlaneGeometry(CASE_W, CASE_H)), keep(new MeshBasicMaterial({ map: page.hi?.tex ?? page.lo?.tex ?? null })));
      front.position.z = D / 2 + 0.0008;
      const u0 = (k % 8) * CELL_U, vt = 1 - Math.floor(k / 8) * CELL_V;
      front.geometry.attributes.uv.array.set([u0, vt, u0 + CELL_U, vt, u0, vt - CELL_V, u0 + CELL_U, vt - CELL_V]);
      flipG.add(front);
      const back = new Mesh(keep(new PlaneGeometry(CASE_W, CASE_H)), keep(new MeshBasicMaterial({ map: keep(backTexture(o, page.accent)) })));
      back.position.z = -D / 2 - 0.0008;
      back.rotation.y = Math.PI;
      flipG.add(back);
      hero.position.set(O.x, O.y, O.z);
      tiltG.rotation.x = -TILT;
      page.mesh.add(hero);
      setSlotHidden(page, k, true);
      selected = { obra: o, page, k, hero, tiltG, flipG, front, O, dispose, out: 0, outTo: 1, flip: 0, flipTo: 0 };
      // la cámara se coloca enfrente, en el eje del pasillo
      const VIEW_Z = 0.84; // a ~45 cm del estuche ya fuera de la balda
      const w = toWorld(page, O.x, VIEW_Z);
      glideTo({ x: w.x, z: w.z, yaw: page.theta, pitch: Math.atan2(O.y + CASE_H / 2 + 0.03 - EYE, VIEW_Z - O.z - 0.26) });
    }
    opts.onSelect?.(selected ? { ...selected.obra, formato: selected.page.sec.formato, seccion: selected.page.sec.label } : null);
    invalidate();
  }
  function flipSelected() {
    if (!selected) return;
    selected.flipTo = selected.flipTo ? 0 : 1;
    invalidate();
  }

  // ── picado ───────────────────────────────────────────────────────────────
  const ray = new Raycaster();
  const ndc = new Vector2();
  function pick(clientX, clientY) {
    if (!store) return null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    // la cámara se sincroniza AQUÍ (no se depende de que ya se haya pintado el último frame)
    camera.position.set(pos.x, EYE, pos.z);
    camera.rotation.set(pos.pitch, pos.yaw, 0);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    ray.far = 12;
    const targets = store.pages.filter((p) => p.dist < 13).map((p) => p.mesh);
    targets.push(store.floor, ...store.blockers);
    const hit = ray.intersectObjects(targets, true)[0];
    if (!hit) return null;
    let obj = hit.object;
    if (selected) for (let p = obj; p; p = p.parent) if (p === selected.hero) return { type: 'hero' };
    if (obj.userData.page) return { type: 'case', page: obj.userData.page, k: Math.floor(hit.faceIndex / 2) };
    if (obj.userData.floor) return { type: 'floor', point: hit.point };
    return null; // trasera o pared: tapa lo que haya detrás
  }
  /** Para E2E/depuración: ¿qué hay bajo este punto de pantalla? */
  const hitAt = (x, y) => {
    const h = pick(x, y);
    return h ? { type: h.type, titulo: h.page ? h.page.obras[h.k]?.titulo : undefined } : null;
  };
  function tap(x, y) {
    const h = pick(x, y);
    if (!h) return select(null);
    if (h.type === 'hero') return flipSelected();
    if (h.type === 'case') return select({ page: h.page, k: h.k });
    if (h.type === 'floor') {
      select(null);
      // el destino se ajusta a la zona transitable más cercana
      let { x: tx, z: tz } = h.point;
      if (!walkable(tx, tz)) {
        const reg = regionOf(tx, tz);
        if (reg === 'c') {
          tx = Math.max(-(CW / 2 - 0.4), Math.min(CW / 2 - 0.4, tx));
          tz = Math.max(store.zEnd + 0.5, Math.min(Z_MAX, tz));
        } else {
          const A = store.aisles[reg];
          tz = Math.max(A.zc - HALF_CLEAR + 0.05, Math.min(A.zc + HALF_CLEAR - 0.05, tz));
          tx = A.side * Math.max(0, Math.min(A.xEnd - 0.45, A.side * tx));
        }
      }
      if (walkable(tx, tz)) glideTo({ x: tx, z: tz });
    }
  }

  // ── controles ────────────────────────────────────────────────────────────
  const stopGlide = () => {
    tween = null;
    path = [];
  };
  let ptr = null; // { id, x0, y0, x, y, moved, type }
  const onDown = (e) => {
    if (ptr) return;
    canvas.focus({ preventScroll: true });
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* puntero ya liberado o sintético: el gesto sigue funcionando sin captura */
    }
    ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, type: e.pointerType };
  };
  const onMove = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const slop = ptr.type === 'touch' ? 16 : 8;
    if (!ptr.moved && Math.hypot(e.clientX - ptr.x0, e.clientY - ptr.y0) > slop) {
      ptr.moved = true;
      stopGlide();
    }
    if (ptr.moved) {
      const k = (camera.fov * Math.PI) / 180 / canvas.clientHeight; // arrastre 1:1 con la escena
      pos.yaw += (e.clientX - ptr.x) * k;
      pos.pitch += (e.clientY - ptr.y) * k;
      clampLook();
      invalidate();
    }
    ptr.x = e.clientX;
    ptr.y = e.clientY;
  };
  const onUp = (e) => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const p = ptr;
    ptr = null;
    if (!p.moved && e.type === 'pointerup') tap(e.clientX, e.clientY);
  };
  const onWheel = (e) => {
    e.preventDefault();
    stopGlide();
    const d = -Math.max(-240, Math.min(240, e.deltaY)) * 0.004;
    tryMove(-Math.sin(pos.yaw) * d, -Math.cos(pos.yaw) * d);
    invalidate();
  };
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift']);
  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (e.type === 'keydown' && k === 'escape' && selected) {
      e.stopPropagation();
      return select(null);
    }
    if (!MOVE_KEYS.has(k) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (k !== 'shift') e.preventDefault();
    if (e.type === 'keydown') {
      keys.add(k);
      if (k !== 'shift') stopGlide();
    } else keys.delete(k);
    invalidate();
  };
  const onBlur = () => keys.clear();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('keyup', onKey);
  canvas.addEventListener('blur', onBlur);

  // ── tamaño: se mide el CONTENEDOR real (no window.innerWidth, §11.61) ──
  function resize() {
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 78 : 66; // vertical (móvil): más angular para ver las dos paredes
    camera.updateProjectionMatrix();
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);
  resize();

  // ── bucle ────────────────────────────────────────────────────────────────
  let last = performance.now();
  let lodAt = 0;
  let fpsN = 0, fpsT = last, statsAt = 0;
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    let moving = false;
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) + walk;
    const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const turn = (keys.has('arrowleft') ? 1 : 0) - (keys.has('arrowright') ? 1 : 0);
    if (f || s || turn) {
      const v = (keys.has('shift') ? 4.4 : 2.2) * dt;
      tryMove((-Math.sin(pos.yaw) * f + Math.cos(pos.yaw) * s) * v, (-Math.cos(pos.yaw) * f - Math.sin(pos.yaw) * s) * v);
      pos.yaw += turn * 1.9 * dt;
      moving = true;
    }
    if (tween) {
      const u = Math.min(1, (now - tween.t0) / tween.dur);
      const t = tween.ease(u);
      for (const key of ['x', 'z', 'yaw', 'pitch']) pos[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * t;
      clampLook();
      if (u >= 1) startSeg();
      moving = true;
    }
    if (selected) {
      const sel = selected;
      const step = reduced ? 1 : Math.min(1, dt * 9);
      const a = sel.out + (sel.outTo - sel.out) * step, b = sel.flip + (sel.flipTo - sel.flip) * step;
      if (Math.abs(a - sel.out) > 1e-4 || Math.abs(b - sel.flip) > 1e-4) moving = true;
      sel.out = a;
      sel.flip = b;
      sel.hero.position.set(sel.O.x, sel.O.y + 0.03 * a, sel.O.z + 0.26 * a);
      sel.tiltG.rotation.x = -TILT * (1 - a); // al salir se pone derecho
      sel.flipG.rotation.y = Math.PI * b;
      const tex = sel.page.hi?.tex ?? sel.page.lo?.tex ?? null; // la portada sigue al mejor atlas disponible
      if (sel.front.material.map !== tex) {
        sel.front.material.map = tex;
        sel.front.material.needsUpdate = true;
      }
    }
    if (moving) dirty = true;
    if (moving && now - lodAt > 200) {
      lodAt = now;
      updateLod();
    }
    // subida de atlas: como mucho DOS módulos por frame (evita tirones mientras llegan imágenes)
    if (store) {
      // (con la pestaña en segundo plano los frames llegan a ~1/s: ahí se sube todo de golpe)
      const maxUp = rawDt > 0.25 ? Infinity : 2;
      let pend = 0;
      for (const p of store.pages) {
        const layer = p.hi?.dirty ? p.hi : p.lo?.dirty ? p.lo : null;
        if (!layer) continue;
        if (pend < maxUp) {
          layer.dirty = false;
          layer.tex.needsUpdate = true;
        }
        pend++;
      }
      if (pend) dirty = true;
    }
    if (dirty) {
      dirty = false;
      camera.position.set(pos.x, EYE, pos.z);
      camera.rotation.set(pos.pitch, pos.yaw, 0);
      renderer.render(scene, camera);
      stats.draw = renderer.info.render.calls;
      fpsN++;
    }
    if (now - fpsT >= 1000) {
      stats.fps = Math.round((fpsN * 1000) / (now - fpsT));
      fpsN = 0;
      fpsT = now;
    }
    if (now - statsAt > 400) {
      statsAt = now;
      stats.pend = queue.length + inflight;
      opts.onStats?.({ ...stats, tex: renderer.info.memory.textures });
    }
  }
  raf = requestAnimationFrame(frame);

  function dispose() {
    if (disposed) return;
    clearStore();
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('keydown', onKey);
    canvas.removeEventListener('keyup', onKey);
    canvas.removeEventListener('blur', onBlur);
    renderer.dispose();
    renderer.forceContextLoss(); // libera el contexto WebGL ya (WEBGL_lose_context, §11.61)
    canvas.remove();
  }

  return {
    setStore,
    dispose,
    deselect: () => select(null),
    flip: flipSelected,
    setWalk: (v) => {
      walk = v;
      if (v) stopGlide();
      invalidate();
    },
    /** lleva la cámara al primer módulo de una sección (formato/género) */
    goToSection: (id) => {
      const page = store?.sections.find((s) => s.id === id)?._page;
      if (!page) return;
      select(null);
      const w = toWorld(page, PAGE_LEN / 2, AISLE_W / 2);
      glideTo({ x: w.x, z: w.z, yaw: page.theta, pitch: 0.02 });
    },
    goEntrance: () => {
      select(null);
      glideTo({ x: 0, z: 1.9, yaw: 0, pitch: -0.03 });
    },
    focus: () => canvas.focus({ preventScroll: true }),
    hitAt,
    getState: () => ({ ...pos, ...stats, selected: selected?.obra?.titulo ?? null, aisles: store?.aisles.length ?? 0, moving: !!tween })
  };
}
