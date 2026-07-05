// ════════════════════════════════════════════════════════════════════════════
// Ocio Shit — Edge Function `buscar_caratula` (Fase 3 de carátulas)
// Proxy de búsqueda de carátulas para ALTAS NUEVAS y REPARACIÓN MANUAL. Existe por dos motivos:
//   1) la clave TMDB vive en los SECRETS de Supabase (TMDB_API_KEY), nunca en el frontend;
//   2) la Steam Store API no manda CORS, así que el navegador no puede llamarla directo.
// Entrada (POST JSON): { titulo, categoria, anio? }
// Salida:              { candidatos: [{ url, titulo, anio, fuente }] }  (top 8, mejor primero)
// Fuentes por categoría: pelicula/serie → TMDB (es-ES, w342) · videojuego → Steam storesearch
// (header.jpg por appid, mismo patrón que el corpus) · libro/comic → OpenLibrary (covers -L).
//
// SEGURIDAD (mismo estándar que las RPC): el gate authenticated-only es la comprobación EN la
// función de que el JWT pertenece a un usuario real (GET /auth/v1/user). Sin usuario → 401.
// DESPLEGAR CON --no-verify-jwt: este proyecto usa las JWT signing keys NUEVAS (ES256, ver el
// JWKS del proyecto) y el verify_jwt de plataforma solo valida el secret HS256 legacy → con él
// activado TODAS las invocaciones darían 401 antes de llegar aquí (docs guides/auth/signing-keys:
// "turn off this setting" y verificar dentro de la función, que es exactamente lo que se hace).
// La función es SOLO LECTURA (no toca la BD).
// ════════════════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const T = 10_000; // ms por fetch a la fuente (lección de infra: SIEMPRE con timeout)

// título normalizado para rankear (minúsculas, sin acentos, sin signos)
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type Cand = { url: string; titulo: string; anio: number | null; fuente: string };

// mejor primero: título exacto > empieza-por > contiene > resto; a igualdad, año más cercano
function rank(cands: Cand[], titulo: string, anio: number | null): Cand[] {
  const q = norm(titulo);
  const score = (c: Cand) => {
    const t = norm(c.titulo);
    let s = t === q ? 300 : t.startsWith(q) || q.startsWith(t) ? 200 : t.includes(q) || q.includes(t) ? 100 : 0;
    if (anio != null && c.anio != null) s += Math.max(0, 50 - Math.abs(c.anio - anio) * 10);
    return s;
  };
  return cands
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c)
    .slice(0, 8);
}

async function tmdb(kind: 'movie' | 'tv', titulo: string, anio: number | null): Promise<Cand[]> {
  const key = Deno.env.get('TMDB_API_KEY');
  if (!key) throw new Error('TMDB_API_KEY no configurada en los secrets');
  const search = async (withYear: boolean) => {
    const u = new URL(`https://api.themoviedb.org/3/search/${kind}`);
    u.searchParams.set('api_key', key);
    u.searchParams.set('query', titulo);
    u.searchParams.set('language', 'es-ES');
    u.searchParams.set('include_adult', 'false');
    if (withYear && anio != null) {
      u.searchParams.set(kind === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(anio));
    }
    // Los TypeError de red de Deno incluyen la URL COMPLETA (con api_key) en el mensaje →
    // jamás propagar el error crudo: se sustituye por uno genérico sin la URL.
    let r: Response;
    try {
      r = await fetch(u, { signal: AbortSignal.timeout(T) });
    } catch {
      throw new Error('TMDB no disponible (red)');
    }
    if (!r.ok) throw new Error(`TMDB ${r.status}`);
    const j = await r.json();
    return (j.results || []) as Record<string, unknown>[];
  };
  let results = await search(true);
  if (!results.length && anio != null) results = await search(false); // año desviado → reintento sin año
  return results
    .filter((m) => m.poster_path)
    .map((m) => ({
      url: `https://image.tmdb.org/t/p/w342${m.poster_path}`,
      titulo: String(kind === 'movie' ? m.title : m.name),
      anio: (() => {
        const d = String((kind === 'movie' ? m.release_date : m.first_air_date) || '');
        return /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null;
      })(),
      fuente: 'tmdb'
    }));
}

async function steam(titulo: string): Promise<Cand[]> {
  const u = new URL('https://store.steampowered.com/api/storesearch/');
  u.searchParams.set('term', titulo);
  u.searchParams.set('l', 'spanish');
  u.searchParams.set('cc', 'ES');
  const r = await fetch(u, { signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`Steam ${r.status}`);
  const j = await r.json();
  // El patrón viejo cdn.cloudflare…/steam/apps/{id}/header.jpg NO existe para juegos recientes
  // (assets bajo rutas con hash de contenido por-asset, no derivables). La URL buena del header
  // la da appdetails (header_image); tiny_image de storesearch (231×87) queda de respaldo —
  // siempre existe, así que NUNCA se devuelve una URL muerta.
  const items = ((j.items || []) as Record<string, unknown>[]).map((it) => ({
    url: String(it.tiny_image ?? ''),
    titulo: String(it.name),
    anio: null as number | null,
    fuente: 'steam',
    _id: it.id as number
  }));
  const top = rank(items as unknown as Cand[], titulo, null).slice(0, 5) as (Cand & { _id: number })[];
  await Promise.all(
    top.map(async (c) => {
      try {
        const ad = await fetch(`https://store.steampowered.com/api/appdetails?appids=${c._id}&filters=basic`, {
          signal: AbortSignal.timeout(T)
        });
        if (!ad.ok) return; // rate limit/…: se queda tiny_image
        const dj = await ad.json();
        const hi = dj?.[String(c._id)]?.data?.header_image;
        if (hi) c.url = String(hi);
      } catch {
        /* red: se queda tiny_image */
      }
    })
  );
  return top.filter((c) => c.url).map(({ _id: _drop, ...c }) => c);
}

async function openlibrary(titulo: string): Promise<Cand[]> {
  const u = new URL('https://openlibrary.org/search.json');
  // q= (no title=): la búsqueda general casa la OBRA aunque el título canónico esté en otro
  // idioma (p. ej. "El nombre del viento" → The Name of the Wind); title= se pierde esos casos.
  u.searchParams.set('q', titulo);
  u.searchParams.set('limit', '20');
  u.searchParams.set('fields', 'title,first_publish_year,cover_i');
  const r = await fetch(u, { signal: AbortSignal.timeout(T) });
  if (!r.ok) throw new Error(`OpenLibrary ${r.status}`);
  const j = await r.json();
  return ((j.docs || []) as Record<string, unknown>[])
    .filter((d) => d.cover_i)
    .map((d) => ({
      url: `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`,
      titulo: String(d.title),
      anio: typeof d.first_publish_year === 'number' ? d.first_publish_year : null,
      fuente: 'openlibrary'
    }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // ── auth: el JWT debe pertenecer a un usuario real (defensa además del verify_jwt) ──
  const authHeader = req.headers.get('Authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  try {
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey },
      signal: AbortSignal.timeout(T)
    });
    if (!who.ok) return json({ error: 'no autenticado' }, 401);
    const u = await who.json();
    if (!u?.id) return json({ error: 'no autenticado' }, 401);
  } catch {
    return json({ error: 'no autenticado' }, 401);
  }

  // ── input ──
  let body: { titulo?: string; categoria?: string; anio?: number | string | null };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body JSON requerido' }, 400);
  }
  const titulo = String(body.titulo ?? '').trim();
  const categoria = String(body.categoria ?? '').trim();
  const anio = body.anio != null && body.anio !== '' && !Number.isNaN(Number(body.anio)) ? Math.trunc(Number(body.anio)) : null;
  if (!titulo) return json({ error: 'titulo requerido' }, 400);
  if (!['pelicula', 'serie', 'videojuego', 'libro', 'comic', 'ocio_libre'].includes(categoria)) {
    return json({ error: `categoria inválida: ${categoria}` }, 400);
  }

  // ── búsqueda por fuente ──
  try {
    let cands: Cand[] = [];
    if (categoria === 'pelicula') cands = await tmdb('movie', titulo, anio);
    else if (categoria === 'serie') cands = await tmdb('tv', titulo, anio);
    else if (categoria === 'videojuego') cands = await steam(titulo);
    else if (categoria === 'libro' || categoria === 'comic') cands = await openlibrary(titulo);
    else return json({ candidatos: [] }); // ocio_libre: sin fuente automática

    return json({ candidatos: rank(cands, titulo, anio) });
  } catch (e) {
    // la fuente falló (timeout/429/…): candidatos vacíos con aviso — el alta NUNCA se bloquea.
    // Cinturón: se recorta cualquier query string por si un mensaje de error arrastra una URL
    // con credenciales (defensa en profundidad además del catch específico de TMDB).
    const msg = String((e as Error)?.message ?? e).replace(/\?[^\s)]*/g, '?…');
    return json({ candidatos: [], warning: msg });
  }
});
