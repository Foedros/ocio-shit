// Lógica de CASADO TMDB compartida por el fetch y el dry-run (una sola fuente de verdad,
// para que la clasificación que se prueba sea la misma que decide qué se baja/aplica).
// Conservador a propósito (sprint delicado): ALTA CONFIANZA solo con match ÚNICO de
// título exacto (normalizado) + año ±1. Todo lo demás → DUDOSO (revisión del usuario).

// Normaliza para comparar títulos: sin acentos, sin paréntesis, sin puntuación, minúsculas.
export function norm(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Limpia el título para el QUERY de búsqueda: quita paréntesis y, en series, "season/temporada N".
export function cleanQuery(titulo, isTv) {
  let t = String(titulo).replace(/\([^)]*\)/g, ' ');
  if (isTv) t = t.replace(/\b(season|temporada)\s*\d+\b/ig, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

export const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) : null);

// Aplana resultados de /search/{movie,tv} a candidatos comparables.
export function candidatesFrom(results, isTv) {
  return (results || []).map((c) => ({
    id: c.id,
    t: isTv ? c.name : c.title,
    ot: isTv ? c.original_name : c.original_title,
    y: yearOf(isTv ? c.first_air_date : c.release_date),
    pop: c.popularity
  }));
}

// Clasifica una obra contra sus candidatos TMDB → {clase, motivo?, best?, cands}.
//   clase: 'alta' | 'dudoso' | 'sin_match'
//   Regla (conservadora): sin candidatos → sin_match; sin anio_obra → dudoso SIEMPRE;
//   con año → 'alta' SOLO si hay exactamente UN candidato con título normalizado idéntico
//   (vs título es-ES u original) Y año dentro de ±1; cualquier otra cosa → dudoso.
export function classify(obra, cands) {
  if (!cands || cands.length === 0) return { clase: 'sin_match', cands: [] };
  if (obra.anio_obra == null) return { clase: 'dudoso', motivo: 'sin_anio', cands };
  const nfa = norm(obra.titulo);
  const strong = cands.filter((c) =>
    c.y != null && Math.abs(c.y - obra.anio_obra) <= 1 && (norm(c.t) === nfa || norm(c.ot) === nfa));
  if (strong.length === 1) return { clase: 'alta', best: strong[0], cands };
  return { clase: 'dudoso', motivo: strong.length > 1 ? 'varios_titulo_anio' : 'sin_titulo_anio_exacto', cands };
}

// ── Casado DIFUSO (fuzzy) — fase 1 de dudosos: los 408 con año pero sin título exacto ───────
const NUMW = { cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', diez: '10', once: '11', doce: '12', trece: '13', catorce: '14', quince: '15', dieciseis: '16', diecisiete: '17', dieciocho: '18', diecinueve: '19', veinte: '20', treinta: '30', cuarenta: '40', cincuenta: '50', cien: '100', ciento: '100', mil: '1000' };
const ART = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'the', 'a', 'an']);
// normaliza para fuzzy: minúsculas, sin acentos, puntuación→espacio (CONSERVA contenido entre
// paréntesis, a diferencia de norm()), números-palabra→dígito, sin artículos.
export function normFuzzy(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ').filter(Boolean).map((w) => NUMW[w] || w).filter((w) => !ART.has(w)).join(' ').trim();
}
function lev(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => { const r = new Array(n + 1).fill(0); r[0] = i; return r; });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) { const c = a[i - 1] === b[j - 1] ? 0 : 1; d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c); }
  return d[m][n];
}
// score 0..1: máximo de Jaccard de tokens, ratio Levenshtein y contención GUARDADA.
export function fuzzyScore(a, b) {
  const A = normFuzzy(a), B = normFuzzy(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const ta = new Set(A.split(' ')), tb = new Set(B.split(' '));
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const jacc = inter / new Set([...ta, ...tb]).size;
  const levr = 1 - lev(A, B) / Math.max(A.length, B.length);
  // Contención guardada: evita que un título corto ("After") case dentro de uno largo no
  // relacionado ("Shrek Forever After"). Exige ≥2 tokens en el menor, ≥80% del menor
  // compartido y que lo compartido sea ≥60% del mayor (no un token suelto en un título largo).
  const small = ta.size <= tb.size ? ta : tb, large = ta.size <= tb.size ? tb : ta;
  let contain = 0;
  if (small.size >= 2 && inter / small.size >= 0.8 && inter / large.size >= 0.6) contain = 0.95;
  return Math.max(jacc, levr, contain);
}
// clasifica fuzzy contra candidatos ya filtrados por año (±1). ALTA-FUZZY = ganador ≥0.82 y claro.
export function classifyFuzzy(faTitle, faYear, cands) {
  const yc = (cands || []).filter((c) => c.y != null && Math.abs(c.y - faYear) <= 1);
  if (!yc.length) return { clase: 'dudoso', motivo: 'sin_candidato_en_anio' };
  const scored = yc.map((c) => ({ c, s: Math.max(fuzzyScore(faTitle, c.t), fuzzyScore(faTitle, c.ot || '')) })).sort((a, b) => b.s - a.s);
  const win = scored[0], second = scored[1];
  const clear = scored.length === 1 || (win.s - second.s >= 0.12);
  if (win.s >= 0.82 && clear) return { clase: 'alta_fuzzy', best: win.c, score: win.s };
  return { clase: 'dudoso', motivo: 'fuzzy_insuficiente', best: win.c, score: win.s, segundo: second?.s };
}
