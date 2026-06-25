// Verificación del SISTEMA DE LOGROS sobre el archivo real (4.241/4.079). Prueba:
//  · evaluación de TODO el catálogo con el COMPILADOR conservado (compileCondition/compileMeasure)
//    → desbloqueado/bloqueado + progreso (valor/umbral);
//  · que la RPC ocio_evaluate_logros (lo que usa la app) DA LO MISMO que el compilador directo;
//  · un compuesto (match:all) LOG_DESPIERTO;
//  · 0 SECURITY DEFINER ejecutable por anon/authenticated.
// La conexión directa BYPASSA RLS (es 1 usuario; solo para probar el SQL y los números).
//   node scripts/supabase-logros-check.mjs
import { compileCondition, compileMeasure, progressRatio } from '../src/lib/predicates/compiler.js';
import { ALL_RPG, LOGROS, TITULOS, MOTIVO } from '../src/lib/predicates/logros-catalog.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';

const pg = await makePgClient();
const run = async ({ sql, params }) => { const { text, values } = toPg({ sql, params }); return (await pg.query(text, values)).rows[0]; };

const pct = (r) => (r == null ? '   —' : (r * 100).toFixed(0).padStart(3) + '%');
const fmtVal = (v) => (v == null ? 'NULL' : (Math.round(v * 100) / 100).toString());

// ── 1) Evaluar todo el catálogo con el compilador directo ──────────────────────
const results = [];
for (const x of ALL_RPG) {
  if (!x.condicion_json) { results.push({ x, evaluable: false }); continue; }
  const meta = compileMeasure(x.condicion_json);
  const ok = Number((await run(compileCondition(x.condicion_json))).ok);
  const valores = [];
  for (const m of meta.measures) valores.push(Number((await run({ sql: m.sql, params: m.params })).v));
  const ratios = meta.measures.map((m, i) => progressRatio(valores[i], m.target, m.op)).filter((n) => n != null);
  let progreso = ratios.length ? (meta.combine === 'max' ? Math.max(...ratios) : Math.min(...ratios)) : null;
  if (ok === 1) progreso = 1;
  results.push({ x, evaluable: true, ok, valores, umbrales: meta.measures.map((m) => m.target), progreso });
}

const printRow = (r) => {
  const tag = r.x.id.startsWith('TIT_') ? 'TÍT' : 'LOG';
  const det = r.evaluable
    ? `${pct(r.progreso)}  [${r.valores.map(fmtVal).join(', ')}] / [${r.umbrales.join(', ')}]`
    : `  —    ${MOTIVO[r.x.bloqueado_por]}`;
  console.log(`    ${tag} ${r.x.id.padEnd(22)} ${r.x.nombre.padEnd(28)} ${det}`);
};

const evalRes = results.filter((r) => r.evaluable);
const unlocked = evalRes.filter((r) => r.ok === 1);
const locked = evalRes.filter((r) => r.ok !== 1);
const notEval = results.filter((r) => !r.evaluable);

console.log(`\nOcio Shit — sistema de LOGROS sobre el archivo real\n`);
console.log(`  Catálogo: ${LOGROS.length} logros + ${TITULOS.length} títulos = ${ALL_RPG.length} ítems.`);
console.log(`  Evaluables ahora: ${evalRes.length}  ·  No evaluables (honesto): ${notEval.length}\n`);

console.log(`  ── DESBLOQUEADOS (${unlocked.length}) ──`);
unlocked.sort((a, b) => a.x.id.localeCompare(b.x.id)).forEach(printRow);
console.log(`\n  ── BLOQUEADOS con progreso (${locked.length}) — metas aspiracionales ──`);
locked.sort((a, b) => (b.progreso ?? 0) - (a.progreso ?? 0)).forEach(printRow);
console.log(`\n  ── NO EVALUABLES aún (${notEval.length}) — por subsistema pendiente ──`);
const buckets = {};
for (const r of notEval) (buckets[r.x.bloqueado_por] ??= []).push(r.x.id);
for (const [k, ids] of Object.entries(buckets)) console.log(`    · ${k.padEnd(13)} (${ids.length}): ${ids.join(', ')}`);

// ── 2) Un compuesto: LOG_DESPIERTO (match:all de 2 métricas) ───────────────────
const desp = results.find((r) => r.x.id === 'LOG_DESPIERTO');
const mPct = await run(toMet('MET_PCT_HABITO'));
const mEle = await run(toMet('MET_HORAS_ELECTIVAS'));
console.log(`\n  ── COMPUESTO LOG_DESPIERTO (match:all) ──`);
console.log(`    MET_PCT_HABITO = ${Number(mPct.v).toFixed(2)}% (umbral < 30)  ·  MET_HORAS_ELECTIVAS = ${Number(mEle.v).toFixed(0)} h (umbral ≥ 1000)`);
console.log(`    → desbloqueado=${desp.ok}  progreso=${pct(desp.progreso)} (mín. de las 2 cláusulas)`);
function toMet(id) {
  // reuse the compiler's metric scalar through a tiny condition probe
  const m = compileMeasure({ match: 'all', filtros: [{ campo: 'metrica:' + id, op: '>=', valor: 0 }] });
  return { sql: m.measures[0].sql, params: m.measures[0].params };
}

// ── 3) La RPC (lo que usa la app) coincide con el compilador directo ───────────
const built = evalRes.map((r) => {
  const meta = compileMeasure(r.x.condicion_json);
  const bool = toPg(compileCondition(r.x.condicion_json));
  return { id: r.x.id, bool: { sql: bool.text, params: bool.values },
           measures: meta.measures.map((m) => { const p = toPg({ sql: m.sql, params: m.params }); return { sql: p.text, params: p.values }; }) };
});
const { rows: rpcRows } = await pg.query('select ocio_evaluate_logros($1::jsonb) AS out', [JSON.stringify(built)]);
const rpc = Object.fromEntries(rpcRows[0].out.map((r) => [r.id, r]));
let mismatches = 0;
for (const r of evalRes) {
  const got = rpc[r.x.id];
  if (!got || got.ok !== r.ok) { mismatches++; console.log(`    ✗ RPC≠compilador en ${r.x.id}: rpc.ok=${got?.ok} dir.ok=${r.ok}`); }
}
console.log(`\n  ── RPC ocio_evaluate_logros vs compilador directo: ${mismatches === 0 ? 'IDÉNTICO ✅' : mismatches + ' discrepancia(s) ❌'} (${evalRes.length} evaluables)`);

// ── 4) Advisor a nivel BD: 0 DEFINER ejecutable por anon/authenticated ─────────
const def = await pg.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and (
    has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
console.log(`\n  ── SECURITY DEFINER ejecutables por anon/authenticated: ${def.rows.length} ${def.rows.length === 0 ? '✅' : '⚠️ ' + def.rows.map((r) => r.proname).join(', ')}`);

await pg.end();
console.log('');
process.exit(mismatches === 0 && def.rows.length === 0 ? 0 : 1);
