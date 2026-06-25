// APLICACIÓN fase 1 dudosos: los near-miss ALTA-FUZZY MENOS los ambiguos (patrón "FA más corto
// + palabra extra significativa DELANTE"). Requiere --apply. Solo añade GÉNEROS (origen='tmdb',
// reusando etiquetas existentes). NO toca anio_obra/director/categoria → clave_dedup intacta.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';
import { classify, classifyFuzzy, normFuzzy, fuzzyScore } from './lib/tmdb-match.mjs';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_tmdbtmp');
const DATA = resolve(here, '..', '..', 'data');
const SEARCH = resolve(TMP, 'search'), FZDET = resolve(TMP, 'fuzzydetail');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// AMBIGUA = título FA subconjunto ESTRICTO del candidato ganador y NO es su prefijo (palabra
// extra DELANTE). Los subtítulos por detrás (FA es prefijo) y FA-superset (saga: episodio) NO.
function isAmbiguous(faTitle, best) {
  const cand = fuzzyScore(faTitle, best.t) >= fuzzyScore(faTitle, best.ot || '') ? best.t : (best.ot || best.t);
  const f = normFuzzy(faTitle), t = normFuzzy(cand);
  if (!f || f === t) return false;
  const ft = f.split(' '), tset = new Set(t.split(' '));
  const faStrictSubset = ft.every((x) => tset.has(x)) && new Set(ft).size < tset.size;
  if (!faStrictSubset) return false;
  return !t.startsWith(f); // riesgo si FA no es prefijo (extra significativo por delante)
}

const obras = readJson(resolve(TMP, '_obras.json'));
// near-miss → fuzzy → alta_fuzzy
const altaFz = [];
for (const o of obras) {
  const s = readJson(resolve(SEARCH, `${o.id}.json`));
  if (!s) continue;
  const c = classify(o, s.cands);
  if (!(c.clase === 'dudoso' && c.motivo === 'sin_titulo_anio_exacto')) continue;
  const r = classifyFuzzy(o.titulo, o.anio_obra, s.cands);
  if (r.clase === 'alta_fuzzy') altaFz.push({ o, best: r.best, score: r.score });
}
const excluidas = altaFz.filter((a) => isAmbiguous(a.o.titulo, a.best));
const aplicar = altaFz.filter((a) => !isAmbiguous(a.o.titulo, a.best));

console.log(`\n══════ Fuzzy fase 1 — APPLY géneros — ${APPLY ? 'APPLY' : 'DRY'} ══════\n`);
console.log(`ALTA-FUZZY: ${altaFz.length} · EXCLUIDAS por ambiguas: ${excluidas.length} · A APLICAR: ${aplicar.length}`);
console.log('\nExcluidas por patrón "palabra extra DELANTE" (→ SIGUE-DUDOSO):');
for (const a of excluidas) console.log(`  · "${a.o.titulo}" (${a.o.anio_obra}) → "${a.best.t}"`);

// genres por obra a aplicar (desde fuzzydetail)
const links = [];
for (const a of aplicar) { const d = readJson(resolve(FZDET, `${a.o.id}.json`)); for (const g of [...new Set((d?.genres || []).map(slug).filter(Boolean))]) links.push({ o: a.o.id, slug: g }); }

const pg = await makePgClient();
const rows = async (s, p = []) => (await pg.query(s, p)).rows;
const one = async (s, p = []) => (await pg.query(s, p)).rows[0];
const n = async (s, p = []) => Number((await one(s, p)).n);
const collCounts = async () => Object.fromEntries((await rows(`select c.nombre, (select count(*) from obra_coleccion oc where oc.coleccion_id=c.id)::int n from coleccion c order by c.nombre`)).map((r) => [r.nombre, r.n]));

if (!APPLY) { console.log(`\nDRY — ${aplicar.length} obras / ${links.length} vínculos. Usa --apply.\n`); await pg.end(); process.exit(0); }

// guard anti doble-apply
const ya = await n(`select count(*) n from obra_etiqueta oe join etiqueta e on e.id=oe.etiqueta_id where e.taxonomia='genero' and oe.obra_id = any($1)`, [aplicar.map((a) => a.o.id)]);
if (ya > 0) { console.log(`\n⛔ ${ya} de las obras a aplicar ya tienen género. Parece aplicado. Abortando.`); await pg.end(); process.exit(1); }

const base = { obras: await n('select count(*) n from obra'), entradas: await n('select count(*) n from entrada'), pelis: await n(`select count(*) n from obra where categoria='pelicula'`), series: await n(`select count(*) n from obra where categoria='serie'`), conAnio: await n(`select count(*) n from obra where categoria in ('pelicula','serie') and anio_obra is not null`), conCreador: await n(`select count(*) n from obra where categoria in ('pelicula','serie') and creador is not null`) };
const collBefore = await collCounts();
const ownerId = (await one('select id from auth.users limit 1')).id;

console.log('\n→ Backup pre-write…');
const KEYS = ['obras', 'entradas', 'personas', 'obra_creador', 'plataformas', 'etapas', 'etiquetas', 'colecciones', 'logros', 'titulos', 'momentos_canon', 'obra_etiqueta', 'entrada_etiqueta', 'obra_coleccion', 'entrada_acompanante', 'logros_desbloqueados', 'titulos_desbloqueados'];
const K2T = { obras: 'obra', entradas: 'entrada', personas: 'persona', obra_creador: 'obra_creador', plataformas: 'plataforma', etapas: 'etapa', etiquetas: 'etiqueta', colecciones: 'coleccion', logros: 'logro', titulos: 'titulo', momentos_canon: 'momento_canon', obra_etiqueta: 'obra_etiqueta', entrada_etiqueta: 'entrada_etiqueta', obra_coleccion: 'obra_coleccion', entrada_acompanante: 'entrada_acompanante', logros_desbloqueados: 'logro_desbloqueado', titulos_desbloqueados: 'titulo_desbloqueado' };
const dump = { schema_version: 2, exportado_en: null };
for (const k of KEYS) dump[k] = (await rows(`select * from ${K2T[k]}`)).map((r) => { const { owner_id, ...rest } = r; if ((K2T[k] === 'obra' || K2T[k] === 'entrada') && rest.metadata && typeof rest.metadata === 'object') rest.metadata = JSON.stringify(rest.metadata); return rest; });
writeFileSync(resolve(DATA, 'ocioshit.export.pre-fuzzy1.json'), JSON.stringify(dump));
console.log(`  backup: data/ocioshit.export.pre-fuzzy1.json`);

console.log('→ Transacción (solo géneros)…');
await pg.query('begin');
try {
  // asegurar etiquetas (todas deberían existir ya; crear si faltara, origen='tmdb')
  const slugs = [...new Set(links.map((l) => l.slug))];
  const ex = new Map((await rows(`select id, nombre from etiqueta where nombre = any($1)`, [slugs])).map((r) => [r.nombre, r.id]));
  const nuevas = slugs.filter((s) => !ex.has(s));
  const nIds = nuevas.map(() => randomUUID());
  if (nuevas.length) await pg.query(`insert into etiqueta (id,nombre,taxonomia,origen,owner_id) select a,b,'genero','tmdb',c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c)`, [nIds, nuevas, nuevas.map(() => ownerId)]);
  nuevas.forEach((s, i) => ex.set(s, nIds[i]));
  const ins = await pg.query(`insert into obra_etiqueta (obra_id, etiqueta_id, owner_id) select a,b,c from unnest($1::text[],$2::text[],$3::uuid[]) as t(a,b,c) on conflict do nothing`, [links.map((l) => l.o), links.map((l) => ex.get(l.slug)), links.map(() => ownerId)]);
  let rem = 0;
  for (const c of await rows(`select id, regla_json from coleccion where tipo='inteligente' and regla_json is not null`)) {
    const { sql, params } = compileCollectionRule(JSON.parse(c.regla_json), { idiomaBase: 'es' });
    const { text, values } = toPg({ sql, params });
    const ids = (await pg.query(text, values)).rows.map((r) => r.id);
    await pg.query('delete from obra_coleccion where coleccion_id=$1', [c.id]);
    if (ids.length) { await pg.query(`insert into obra_coleccion (obra_id, coleccion_id, owner_id) select a,$2,$3 from unnest($1::text[]) as t(a) on conflict do nothing`, [ids, c.id, ownerId]); rem += ids.length; }
  }
  await pg.query('commit');
  console.log(`  etiquetas nuevas: ${nuevas.length} · vínculos insertados: ${ins.rowCount} · colecciones rematerializadas (${rem})`);
} catch (e) { await pg.query('rollback'); console.error('  ⛔ ROLLBACK:', e.message); await pg.end(); process.exit(1); }

// verificación
console.log('\n— Verificación (re-consultado) —');
let fail = 0; const chk = (l, c, x = '') => { if (!c) fail++; console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  ' + x : ''}`); };
const obrasConGen = await n(`select count(distinct oe.obra_id) n from obra_etiqueta oe join etiqueta e on e.id=oe.etiqueta_id where e.taxonomia='genero' and oe.obra_id = any($1)`, [aplicar.map((a) => a.o.id)]);
chk(`obras del lote que recibieron género = ${aplicar.length}`, obrasConGen === aplicar.length, `(${obrasConGen})`);
console.log(`         vínculos de género añadidos en el lote: ${links.length}`);
chk('año/categoria intactos (pelicula/serie counts == baseline)', await n(`select count(*) n from obra where categoria='pelicula'`) === base.pelis && await n(`select count(*) n from obra where categoria='serie'`) === base.series);
chk('director FA intacto (con creador == baseline)', await n(`select count(*) n from obra where categoria in ('pelicula','serie') and creador is not null`) === base.conCreador);
chk('anio_obra intacto (con año == baseline)', await n(`select count(*) n from obra where categoria in ('pelicula','serie') and anio_obra is not null`) === base.conAnio);
chk('entradas intactas (4079)', await n('select count(*) n from entrada') === base.entradas, `(${await n('select count(*) n from entrada')})`);
chk('obras intactas (4241)', await n('select count(*) n from obra') === base.obras, `(${await n('select count(*) n from obra')})`);
chk('FK obra_etiqueta = 0', (await n(`select count(*) n from obra_etiqueta oe left join obra o on o.id=oe.obra_id where o.id is null`)) + (await n(`select count(*) n from obra_etiqueta oe left join etiqueta e on e.id=oe.etiqueta_id where e.id is null`)) === 0);
chk('clave_dedup 0 colisiones (no tocamos año)', (await one(`select (count(*)-count(distinct clave_dedup))::int b, count(*) filter (where clave_dedup is null)::int a from obra`)).b === 0);
const collAfter = await collCounts();
console.log('\n— Delta colecciones —');
let ch = 0; for (const k of Object.keys(collAfter)) if (collAfter[k] !== (collBefore[k] ?? 0)) { ch++; console.log(`  ${k}: ${collBefore[k] ?? 0} → ${collAfter[k]} (${collAfter[k] - (collBefore[k] ?? 0)})`); }
if (!ch) console.log('  (ninguna cambió)');
await pg.end();
console.log(`\n${fail === 0 ? '✅ Aplicado y verificado.' : '❌ ' + fail + ' fallo(s).'}\n`);
process.exit(fail === 0 ? 0 : 1);
