// Videoclub 3D — reparto PURO de obras en secciones (formato → género / década).
import { buildSections, bonito } from '../src/lib/videoclub-sections.js';

let failures = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};
const obra = (i, generos, anio = 2000) => ({ id: 'o' + i, titulo: 'T' + String(i).padStart(4, '0'), anio_obra: anio, imagen_url: null, nota: null, generos });
let seq = 0;
const lote = (n, generos, anio) => Array.from({ length: n }, () => obra(seq++, generos, anio));

console.log('Ocio Shit — videoclub (secciones)\n');

// formato con géneros: cada obra va a su género MÁS ESPECÍFICO con estantería propia
{
  const pelis = [...lote(40, ['drama']), ...lote(20, ['drama', 'western']), ...lote(5, ['drama', 'rareza']), ...lote(3, ['rareza']), ...lote(15, [])];
  const s = buildSections({ pelicula: pelis });
  const by = Object.fromEntries(s.map((x) => [x.label, x.obras.length]));
  check('una obra = un solo estuche (no se duplica entre géneros)', s.reduce((n, x) => n + x.obras.length, 0) === pelis.length);
  check('"drama + western" va a Western (el menos numeroso)', by['Western'] === 20);
  check('Drama se queda con los suyos y con los de género minoritario', by['Drama'] === 45);
  check('género bajo el mínimo → "Otros géneros"', by['Otros géneros'] === undefined && by['Otros y sin género'] === 18);
  check('géneros de mayor a menor, cajón de sastre al final', s[0].label === 'Drama' && s[s.length - 1].label === 'Otros y sin género');
  check('obras por título dentro de la sección', s[0].obras.every((o, i, a) => !i || a[i - 1].titulo <= o.titulo));
  check('id estable formato/clave', s[0].id === 'pelicula/g:drama' && s[0].formatoLabel === 'Cine');
}

// formato casi sin géneros → TODO por década; décadas pequeñas juntas
{
  const libros = [...lote(30, [], 1995), ...lote(14, [], 2011), ...lote(2, ['ensayo'], 2015), ...lote(3, [], 1605), ...lote(4, [], null)];
  const s = buildSections({ libro: libros });
  const labels = s.map((x) => x.label);
  const by = Object.fromEntries(s.map((x) => [x.label, x.obras.length]));
  check('sin géneros → secciones por década', by['Años 1990'] === 30 && by['Años 2010'] === 16);
  check('década reciente antes que la antigua', labels.indexOf('Años 2010') < labels.indexOf('Años 1990'));
  check('décadas bajo el mínimo → "Otras épocas"', by['Otras épocas'] === 3);
  check('sin año → "Sin fecha", al final', by['Sin fecha'] === 4 && labels[labels.length - 1] === 'Sin fecha');
}

// orden de formatos y formatos vacíos
{
  const s = buildSections({ videojuego: lote(13, ['rol']), pelicula: lote(13, ['terror']), serie: [] });
  check('formatos en orden fijo (cine antes que videojuegos)', s[0].formato === 'pelicula' && s[1].formato === 'videojuego');
  check('formato vacío no genera secciones', s.length === 2);
  check('catálogo vacío → []', buildSections({}).length === 0);
}

check('bonito recupera tildes ("ciencia-ficcion")', bonito('ciencia-ficcion') === 'Ciencia ficción');
check('bonito respeta lo que no conoce', bonito('western') === 'Western');

console.log(failures ? `\n${failures} FALLO(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
