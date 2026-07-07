// PASAR PÁGINA — malla WebGL deformable (§11.61) · diseño: diseno/Ocio Shit - Pagina WebGL.html
// El folio SALIENTE se textura sobre una malla 61×41 que pivota en el lomo izquierdo (giro de 72°
// con leve overshoot elástico) mientras se comba hacia el usuario: arco +Z por columnas (u²,
// más fuerte abajo) y pliegue diagonal en la esquina inferior derecha (u^2.4·v^2.4) con sombra
// de arruga localizada (vertex shade). Dorso de papel cálido (#8f7f5c, BackSide a −4 en local)
// = grosor físico. Cámara casi ortográfica (fov 12°, dist = (H/2)/tan(6°)) → el folio llena el
// viewport EXACTO en reposo. ~1000ms lineales (la elasticidad va en las fórmulas); el canvas se
// funde en el último 20% para que no quede la tira del canto.
//
// TEXTURA = stand-in rasterizado del .page saliente (la propia pieza de diseño lo hace así:
// "html2canvas-free, draw a faithful stand-in"): fondo + cajas (background-color/border/radius),
// texto real vía Range.getClientRects() (posición por línea exacta), <img>/background-image SOLO
// same-origin (madera, iconos), <canvas> de la app si está limpio. Las carátulas remotas se
// pintan como bloques con degradado — NUNCA drawImage cross-origin: mancharía el canvas 2D y
// texImage2D lanzaría SecurityError (regla WebGL). Cualquier fallo (sin WebGL, canvas manchado)
// → devuelve 0 SIN hacer el swap y el llamador cae al fundido.

const BG = '#0b0a08';
const D = 1000; // duración del pase (lineal; el overshoot vive en θ y la comba en su rampa)

const VERT = `
attribute vec2 aUV;
uniform vec2 uSize;    // W,H del viewport (px CSS)
uniform float uBow;    // amplitud de la comba en px (rampa incluida)
uniform float uBowN;   // rampa normalizada 0..1 (para la sombra del pliegue)
uniform float uTheta;  // giro del lomo (radianes, positivo = saliendo)
uniform float uZoff;   // 0 = cara impresa · -4 = dorso de papel
uniform mat4 uProj;    // perspectiva * vista (cámara en +Z mirando al origen)
varying vec2 vUV;
varying float vShade;
void main() {
  float u = aUV.x, v = aUV.y;          // u: 0 lomo -> 1 borde libre · v: 0 arriba -> 1 abajo
  float rf = 0.2 + v;                  // la deformación se concentra ABAJO
  float x = u * uSize.x;
  float y = uSize.y * 0.5 - v * uSize.y;
  float z = uBow * u * u * rf;         // comba +Z hacia el usuario (borde libre + abajo)
  float cd = pow(u, 2.4) * pow(v, 2.4);
  x -= uBow * 0.85 * cd;               // el pliegue dobla la punta HACIA DENTRO…
  y += uBow * 0.85 * cd;               // …y HACIA ARRIBA: arruga diagonal de la esquina
  vShade = 1.0 - 0.55 * cd * uBowN;    // sombra de arruga SOLO en la punta doblada
  z += uZoff;
  float c = cos(uTheta), s = sin(uTheta);
  float xr = x * c - z * s;            // R_y(-θ): el borde libre gana +Z (viene hacia la cámara)
  float zr = x * s + z * c;
  xr -= uSize.x * 0.5;                 // pivote: el lomo queda clavado en el borde izquierdo
  gl_Position = uProj * vec4(xr, y, zr, 1.0);
  vUV = aUV;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform float uBack;   // 1 = dorso de papel cálido plano · 0 = cara impresa sombreada
varying vec2 vUV;
varying float vShade;
void main() {
  vec3 paper = vec3(0.561, 0.498, 0.361); // #8f7f5c
  vec3 col = uBack > 0.5 ? paper : texture2D(uTex, vUV).rgb * vShade;
  gl_FragColor = vec4(col, 1.0);
}`;

// caché de imágenes de background same-origin (la madera del videoclub): el primer pase las
// dispara en async y las usa el siguiente — nunca se bloquea el arranque de la transición
const bgImgs = new Map();
function bgImage(url) {
  let img = bgImgs.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    bgImgs.set(url, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

const sameOrigin = (url) => {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
};

function rr(x, l, t, w, h, r) {
  const rad = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  x.beginPath();
  if (x.roundRect) {
    x.roundRect(l, t, w, h, rad);
  } else {
    x.moveTo(l + rad, t);
    x.arcTo(l + w, t, l + w, t + h, rad);
    x.arcTo(l + w, t + h, l, t + h, rad);
    x.arcTo(l, t + h, l, t, rad);
    x.arcTo(l, t, l + w, t, rad);
    x.closePath();
  }
}

const invisible = (c) => !c || c === 'transparent' || /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(c);

// texto real por nodo de texto: Range.getClientRects() da UN rect POR LÍNEA → la primera línea
// (y las sueltas: etiquetas, títulos, cifras — la inmensa mayoría) cae con posición exacta,
// centrados incluidos; las multilínea se re-envuelven midiendo (misma fuente ≈ mismos cortes)
function drawTextNode(x, node, cs, W, H) {
  let txt = node.textContent.replace(/\s+/g, ' ').trim();
  if (!txt) return;
  if (cs.textTransform === 'uppercase') txt = txt.toUpperCase();
  const range = document.createRange();
  range.selectNode(node);
  const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0 && q.height > 0 && q.bottom > 0 && q.top < H && q.left < W);
  if (!rects.length) return;
  const size = parseFloat(cs.fontSize) || 14;
  x.font = `${cs.fontStyle === 'italic' ? 'italic ' : ''}${cs.fontWeight} ${size}px ${cs.fontFamily}`;
  x.fillStyle = cs.color;
  try {
    x.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
  } catch {
    /* Safari viejo: sin letterSpacing en canvas */
  }
  x.textBaseline = 'middle';
  if (rects.length === 1) {
    const q = rects[0];
    x.fillText(txt, q.left, q.top + q.height / 2, q.width + 2);
  } else {
    const words = txt.split(' ');
    let i = 0;
    for (const q of rects) {
      if (i >= words.length) break;
      let line = words[i++];
      while (i < words.length && x.measureText(line + ' ' + words[i]).width <= q.width + 4) line += ' ' + words[i++];
      x.fillText(line, q.left, q.top + q.height / 2, q.width + 2);
    }
  }
}

// intersección de rects {l,t,r,b}; a=null significa "sin recorte"
function intersect(a, q) {
  const b = { l: q.left, t: q.top, r: q.right, b: q.bottom };
  if (!a) return b;
  return { l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) };
}

// stand-in del .page saliente sobre un canvas 2D LIMPIO (apto como textura WebGL).
// Devuelve { canvas, painted }: si no se pintó (casi) nada — página vacía o presupuesto
// agotado en un DOM monstruoso — el llamador cae al fundido en vez de mostrar un folio negro.
function rasterizePage(W, H, dpr) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const x = c.getContext('2d');
  x.scale(dpr, dpr);
  x.fillStyle = BG;
  x.fillRect(0, 0, W, H);
  const page = document.querySelector('.page');
  if (!page) return { canvas: c, painted: 0 };
  const els = [page, ...page.querySelectorAll('*')];
  // el walk es en PRE-ORDEN (el padre siempre antes que sus hijos) → el clip acumulado de los
  // ancestros con overflow≠visible y la opacidad EFECTIVA se memoizan sobre la marcha. Sin esto,
  // la Galería pintaría carátulas fantasma fuera de su marco (.gwrap overflow:hidden) y las
  // laterales atenuadas saldrían a brillo completo.
  const inh = new Map(); // el -> { clip, alpha } que APLICA a sus hijos
  const ROOT = { clip: null, alpha: 1 };
  let painted = 0;
  let scanned = 0;
  for (const el of els) {
    // presupuesto: 1200 elementos PINTADOS (no descartados — un Timeline scrolleado a fondo
    // tiene miles de nodos por encima del viewport) + tope duro de escaneo por si acaso
    if (painted >= 1200 || ++scanned > 30000) break;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || (el.namespaceURI && el.namespaceURI.includes('svg'))) continue;
    const r = el.getBoundingClientRect();
    const par = inh.get(el.parentElement) ?? ROOT;
    if (r.bottom < 0 || r.top > H || r.right < 0 || r.left > W) {
      inh.set(el, par); // fuera del viewport: barato, sin getComputedStyle (hereda clip/alpha)
      continue;
    }
    const cs = getComputedStyle(el);
    const own = cs.opacity === '' ? 1 : parseFloat(cs.opacity);
    const alpha = par.alpha * (Number.isNaN(own) ? 1 : own);
    let childClip = par.clip;
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') childClip = intersect(par.clip, r);
    inh.set(el, { clip: childClip, alpha });
    if (cs.display === 'none' || cs.visibility === 'hidden' || alpha < 0.12) continue;
    if (r.width < 1 || r.height < 1) continue;
    const k = par.clip;
    if (k && (r.right <= k.l || r.left >= k.r || r.bottom <= k.t || r.top >= k.b)) continue; // recortado por su contenedor
    painted++;
    x.save();
    x.globalAlpha = Math.min(1, alpha);
    if (k) {
      x.beginPath();
      x.rect(k.l, k.t, k.r - k.l, k.b - k.t);
      x.clip();
    }
    paintEl(x, el, tag, cs, r, W, H);
    x.restore();
  }
  return { canvas: c, painted };
}

function paintEl(x, el, tag, cs, r, W, H) {
  const rad = parseFloat(cs.borderTopLeftRadius) || 0;
  if (!invisible(cs.backgroundColor)) {
    x.fillStyle = cs.backgroundColor;
    rr(x, r.left, r.top, r.width, r.height, rad);
    x.fill();
  }
  const bgi = cs.backgroundImage;
  if (bgi && bgi.includes('url(')) {
    const m = bgi.match(/url\(["']?([^"')]+)/);
    if (m && sameOrigin(m[1])) {
      const img = bgImage(m[1]);
      if (img) {
        x.save();
        rr(x, r.left, r.top, r.width, r.height, rad);
        x.clip();
        x.drawImage(img, r.left, r.top, r.width, r.height);
        x.restore();
      }
    }
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && !invisible(cs.borderTopColor)) {
    x.strokeStyle = cs.borderTopColor;
    x.lineWidth = bw;
    rr(x, r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw, rad);
    x.stroke();
  }
  if (tag === 'IMG') {
    const src = el.currentSrc || el.src || '';
    if (sameOrigin(src) && el.complete && el.naturalWidth > 0) {
      x.save();
      rr(x, r.left, r.top, r.width, r.height, rad);
      x.clip();
      x.drawImage(el, r.left, r.top, r.width, r.height);
      x.restore();
    } else {
      // carátula remota → bloque con degradado (jamás drawImage cross-origin: taint)
      x.save();
      rr(x, r.left, r.top, r.width, r.height, rad);
      x.clip();
      x.fillStyle = '#191410';
      x.fillRect(r.left, r.top, r.width, r.height);
      const g = x.createLinearGradient(0, r.top, 0, r.bottom);
      g.addColorStop(0, 'rgba(255,244,224,0.10)');
      g.addColorStop(0.5, 'rgba(255,244,224,0.02)');
      g.addColorStop(1, 'rgba(0,0,0,0.18)');
      x.fillStyle = g;
      x.fillRect(r.left, r.top, r.width, r.height);
      x.strokeStyle = 'rgba(255,255,255,0.07)';
      x.lineWidth = 1;
      x.strokeRect(r.left + 0.5, r.top + 0.5, r.width - 1, r.height - 1);
      x.restore();
    }
    return;
  }
  if (tag === 'CANVAS') {
    try {
      // canvas de la app (charts): si estuviera manchado, el taint se propagaría y AFLORARÍA
      // en texImage2D (SecurityError) → catch de pageTurn → fundido. Hoy no hay ninguno sucio.
      x.drawImage(el, r.left, r.top, r.width, r.height);
    } catch {
      /* se queda el fondo */
    }
    return;
  }
  if (cs.writingMode && cs.writingMode !== 'horizontal-tb') return; // lomos verticales: solo caja
  for (const node of el.childNodes) {
    if (node.nodeType === 3) drawTextNode(x, node, cs, W, H);
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
  return sh;
}

/**
 * Monta el pase de página WebGL dentro de `wrap` (overlay fijo) y ejecuta `swap()` con el folio
 * ya cubriendo la pantalla. Devuelve la duración en ms; 0 = WebGL no disponible o textura
 * inviable (NO se hizo el swap — el llamador cae al fundido); -1 = congelada para captura
 * (hook de test __ocio.tabTxFreeze; el overlay se queda montado).
 */
export function pageTurn(wrap, swap) {
  // medir el OVERLAY real, no window.innerWidth: con la scrollbar clásica de Windows el
  // innerWidth la incluye pero el fixed inset:0 no → el stand-in saldría comprimido ~1%
  // con salto lateral visible en el frame 0 (donde el folio debe CALCAR la página viva)
  const wr = wrap.getBoundingClientRect();
  const W = Math.round(wr.width) || window.innerWidth;
  const H = Math.round(wr.height) || window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  // pointer-events:auto (el wrap es none): el folio opaco COME los taps durante el pase — la
  // página entrante es invisible debajo ~1s y un tap ciego abriría cosas sin querer. La nav
  // (topbar 20 · mhead 30 · FAB 40) queda por ENCIMA del overlay z-15 y sigue clicable.
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:auto;';
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, premultipliedAlpha: true }) ||
    canvas.getContext('experimental-webgl', { alpha: true, antialias: true, depth: true, premultipliedAlpha: true });
  if (!gl) return 0;

  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  const texDpr = Math.min(dpr, maxTex / Math.max(W, H));
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return 0;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return 0;

  // textura del folio saliente (ANTES del swap: el DOM aún es la página vieja)
  const raster = rasterizePage(W, H, texDpr);
  if (raster.painted < 3) return 0; // página vacía / presupuesto agotado → fundido, no folio negro
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster.canvas);
  } catch {
    return 0; // canvas manchado (no debería: solo same-origin) → fundido
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // malla 61×41 en UV; las posiciones se calculan en el vertex shader (2 uniforms por frame)
  const SX = 60, SY = 40;
  const uv = new Float32Array((SX + 1) * (SY + 1) * 2);
  for (let iy = 0; iy <= SY; iy++)
    for (let ix = 0; ix <= SX; ix++) {
      const k = (iy * (SX + 1) + ix) * 2;
      uv[k] = ix / SX;
      uv[k + 1] = iy / SY;
    }
  const idx = new Uint16Array(SX * SY * 6);
  let p = 0;
  for (let iy = 0; iy < SY; iy++)
    for (let ix = 0; ix < SX; ix++) {
      const a = iy * (SX + 1) + ix, b = a + SX + 1, c = a + 1, d = b + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.useProgram(prog);
  const aUV = gl.getAttribLocation(prog, 'aUV');
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['uSize', 'uBow', 'uBowN', 'uTheta', 'uZoff', 'uProj', 'uBack', 'uTex']) U[n] = gl.getUniformLocation(prog, n);

  // cámara casi ortográfica: el folio W×H llena el frame EXACTO en reposo
  const fov = (12 * Math.PI) / 180;
  const dist = H / 2 / Math.tan(fov / 2);
  const near = dist / 20, far = dist + 2 * W + 100;
  const f = 1 / Math.tan(fov / 2), aspect = W / H, nf = 1 / (near - far);
  const A = (far + near) * nf, B = 2 * far * near * nf;
  // uProj = perspectiva · T(0,0,-dist) compuesta a mano (column-major)
  const proj = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, A, -1,
    0, 0, B - A * dist, dist
  ]);

  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);
  gl.uniformMatrix4fv(U.uProj, false, proj);
  gl.uniform2f(U.uSize, W, H);
  gl.uniform1i(U.uTex, 0);
  wrap.appendChild(canvas);

  const BOW = 0.38 * Math.min(W, 1.6 * H); // 340px en el stage 900×560 del bundle, proporcional aquí
  const render = (t) => {
    const q = Math.min(1, t);
    const theta = (Math.PI / 180) * 72 * (q + 0.05 * Math.sin(q * Math.PI)); // salida a 72° con overshoot
    const bowN = Math.sin(Math.min(1, t / 0.8) * Math.PI * 0.5); // la comba entra en el primer 40% y AGUANTA
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(U.uTheta, theta);
    gl.uniform1f(U.uBow, BOW * bowN);
    gl.uniform1f(U.uBowN, bowN);
    // dorso de papel (grosor): solo caras traseras, a -4 en local
    gl.uniform1f(U.uZoff, -4);
    gl.uniform1f(U.uBack, 1);
    gl.cullFace(gl.FRONT);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    // cara impresa
    gl.uniform1f(U.uZoff, 0);
    gl.uniform1f(U.uBack, 0);
    gl.cullFace(gl.BACK);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
    // el folio se funde en el último 20% (que no quede la tira del canto)
    canvas.style.opacity = t < 0.8 ? '1' : String(Math.max(0, 1 - (t - 0.8) / 0.2));
  };

  render(0); // primer frame ANTES del swap: el folio ya cubre cuando entra lo nuevo
  swap();

  const freeze = typeof window.__ocio?.tabTxFreeze === 'number' ? window.__ocio.tabTxFreeze : null;
  if (freeze !== null) {
    render(freeze); // captura congelada (test): el overlay se queda montado
    return -1;
  }
  // al terminar (o si el overlay desaparece) se SUELTA el contexto explícitamente: los
  // navegadores limitan los contextos WebGL vivos (~8-16) y el GC puede tardar en recoger
  // el canvas retirado — con transiciones seguidas no queremos acercarnos al tope.
  const release = () => {
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      /* ignore */
    }
  };
  const t0 = performance.now();
  const step = (now) => {
    if (!wrap.isConnected) return release();
    const t = Math.min(1, (now - t0) / D);
    render(t);
    if (t < 1) requestAnimationFrame(step);
    else release(); // a t=1 el canvas ya está fundido (opacity 0): soltar aquí es invisible
  };
  requestAnimationFrame(step);
  return D;
}
