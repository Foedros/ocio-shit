// VIDEOCLUB 3D — reparto de las obras en SECCIONES (formato → género). Lógica pura (sin three
// ni DOM): entra el catálogo por formato, sale la lista ordenada de secciones que el motor
// convierte en estanterías.
//
// Regla del género (una obra = UN estuche, aunque tenga varios géneros): va a su género MÁS
// ESPECÍFICO, es decir, el menos numeroso dentro de su formato entre los que alcanzan el mínimo
// para tener estantería propia. Así "Drama" no se lo traga todo y los pasillos quedan repartidos.
//   · géneros por debajo del mínimo → "Otros géneros"; obras sin género → "Sin género"
//   · si menos de la mitad del formato tiene género (libros/cómics sin enriquecer), TODO el
//     formato se ordena por DÉCADA de la obra; las décadas que no llegan al mínimo → "Otras épocas".

export const FORMATOS = [
  { id: 'pelicula', label: 'Cine', plural: 'películas' },
  { id: 'serie', label: 'Series', plural: 'series' },
  { id: 'libro', label: 'Libros', plural: 'libros' },
  { id: 'comic', label: 'Cómics', plural: 'cómics' },
  { id: 'videojuego', label: 'Videojuegos', plural: 'videojuegos' }
];

const MIN_PROPIA = 12; // obras mínimas para que un género tenga sección propia

// los géneros se guardan como slug sin tildes; el rótulo las recupera
const TILDES = {
  accion: 'acción', animacion: 'animación', ficcion: 'ficción', fantasia: 'fantasía', belica: 'bélica',
  musica: 'música', pelicula: 'película', simulacion: 'simulación', biografia: 'biografía',
  policiaco: 'policíaco', comic: 'cómic', historico: 'histórico', historica: 'histórica',
  psicologico: 'psicológico', filosofia: 'filosofía', poesia: 'poesía', clasico: 'clásico', clasicos: 'clásicos'
};
export const bonito = (g) =>
  String(g)
    .replace(/[-_]/g, ' ')
    .replace(/[a-zñ]+/gi, (w) => TILDES[w.toLowerCase()] ?? w)
    .replace(/^./, (c) => c.toUpperCase());
const porTitulo = (a, b) => String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'es', { sensitivity: 'base', numeric: true });

/**
 * @param {Record<string, Array<{id:string,titulo:string,anio_obra:number|null,imagen_url:string|null,nota:number|null,generos:string[]}>>} porFormato
 * @returns {Array<{ id:string, formato:string, formatoLabel:string, label:string, obras:any[] }>}
 */
export function buildSections(porFormato) {
  const out = [];
  for (const f of FORMATOS) {
    const obras = porFormato[f.id] ?? [];
    if (!obras.length) continue;
    const cuenta = new Map();
    let conGenero = 0;
    for (const o of obras) {
      if (o.generos?.length) conGenero++;
      for (const g of o.generos ?? []) cuenta.set(g, (cuenta.get(g) ?? 0) + 1);
    }
    const porDecada = conGenero / obras.length < 0.5;
    const grupos = new Map(); // clave → { label, orden, obras }
    const meter = (clave, label, orden, o) => {
      if (!grupos.has(clave)) grupos.set(clave, { label, orden, obras: [] });
      grupos.get(clave).obras.push(o);
    };
    const porGenero = (o) => {
      if (porDecada) return false;
      const propios = (o.generos ?? []).filter((g) => (cuenta.get(g) ?? 0) >= MIN_PROPIA);
      if (!propios.length) return false;
      propios.sort((a, b) => cuenta.get(a) - cuenta.get(b) || a.localeCompare(b, 'es'));
      meter('g:' + propios[0], bonito(propios[0]), 0, o);
      return true;
    };
    const resto = obras.filter((o) => !porGenero(o));
    if (porDecada) {
      // décadas con estantería propia; las que no llegan al mínimo se juntan en una sola
      const dec = new Map();
      for (const o of resto) {
        const d = o.anio_obra ? Math.floor(o.anio_obra / 10) * 10 : null;
        if (!dec.has(d)) dec.set(d, []);
        dec.get(d).push(o);
      }
      for (const [d, lista] of dec) {
        for (const o of lista) {
          if (d == null) meter('sinfecha', 'Sin fecha', 4, o);
          else if (lista.length >= MIN_PROPIA) meter('d:' + d, 'Años ' + d, 2 + (3000 - d) / 10000, o); // de la más reciente a la más antigua
          else meter('epocas', 'Otras épocas', 3, o);
        }
      }
    } else {
      // géneros minoritarios y obras sin género: un único cajón si alguno de los dos es pequeño
      const otros = resto.filter((o) => o.generos?.length), sin = resto.filter((o) => !o.generos?.length);
      if (otros.length && sin.length && Math.min(otros.length, sin.length) < MIN_PROPIA) {
        for (const o of resto) meter('varios', 'Otros y sin género', 3, o);
      } else {
        for (const o of otros) meter('otros', 'Otros géneros', 1, o);
        for (const o of sin) meter('singenero', 'Sin género', 3, o);
      }
    }
    const lista = [...grupos.entries()]
      .map(([clave, g]) => ({ clave, ...g }))
      // géneros de mayor a menor; después los cajones de sastre en su orden fijo
      .sort((a, b) => a.orden - b.orden || b.obras.length - a.obras.length || a.label.localeCompare(b.label, 'es'));
    for (const g of lista) {
      out.push({
        id: f.id + '/' + g.clave,
        formato: f.id,
        formatoLabel: f.label,
        label: g.label,
        obras: g.obras.sort(porTitulo)
      });
    }
  }
  return out;
}
