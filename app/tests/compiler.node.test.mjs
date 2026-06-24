// Test G — the predicate compiler, proven against the REAL DB (not toy examples). Compiles
// every Tanda 1 collection rule + the logro/Wrapped demo conditions and runs them. Evidence
// that ONE compiler serves collections (set) and logros (boolean).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applySchema, importAll } from '../src/lib/db/io.js';
import { compileCollectionRule, compileCondition } from '../src/lib/predicates/compiler.js';
import { buildTanda1, DEMO_CONDICIONES } from '../src/lib/predicates/tanda1.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const A = {
  exec: (s) => db.exec(s),
  all: (s, p = []) => db.prepare(s).all(...p),
  get: (s, p = []) => db.prepare(s).get(...p) ?? null,
  run: (s, p = []) => db.prepare(s).run(...p),
  runMany: (s, rows) => {
    const st = db.prepare(s);
    for (const r of rows) st.run(...r);
  }
};
applySchema(A, schemaSql);
importAll(A, source);

let failures = 0;
const check = (label, cond, extra = '') => {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};
const qmarks = (sql) => (sql.match(/\?/g) || []).length;

console.log(`\nOcio Shit — compilador de predicados\ndata: ${dataPath}\n`);

// Favourite creator (most obras) for collection #10.
const fav = A.get('SELECT persona_id, COUNT(DISTINCT obra_id) c FROM obra_creador GROUP BY persona_id ORDER BY c DESC LIMIT 1');
const tanda1 = buildTanda1({ year: 2026, favoritoPersonaId: fav?.persona_id });

// ---- Collections: compile each inteligente rule -> SQL -> run -> count obras ----------
console.log('[A] TANDA 1 — colecciones inteligentes materializadas:');
let compiledOk = 0;
const counts = {};
for (const c of tanda1) {
  if (c.tipo !== 'inteligente') {
    console.log(`  · #${String(c.n).padStart(2)} ${c.nombre.padEnd(28)} (${c.tipo} — diferida a Sprint 9)`);
    continue;
  }
  try {
    const { sql, params } = compileCollectionRule(c.regla_json, { idiomaBase: 'es' });
    if (qmarks(sql) !== params.length) throw new Error(`param mismatch: ${qmarks(sql)} ? vs ${params.length} params`);
    const rows = A.all(sql, params);
    counts[c.key] = rows.length;
    compiledOk++;
    console.log(`  · #${String(c.n).padStart(2)} ${c.nombre.padEnd(28)} → ${String(rows.length).padStart(5)} obras`);
  } catch (err) {
    failures++;
    console.log(`  · #${String(c.n).padStart(2)} ${c.nombre.padEnd(28)} → ERROR: ${err.message}`);
  }
}
const intCount = tanda1.filter((c) => c.tipo === 'inteligente').length;
check(`las ${intCount} colecciones inteligentes compilan y ejecutan sin error`, compiledOk === intCount, `(${compiledOk}/${intCount})`);

// ---- Edge cases the audit flagged --------------------------------------------------
console.log('\n[B] casos límite de la auditoría:');
check('#1 El Canon (momento_canon tiene destacado) materializa', counts['el-canon'] !== undefined, `→ ${counts['el-canon']} obras`);
check('#20 Maratones (agg.max_entradas_por_dia >= 3) materializa', counts['maratones'] !== undefined, `→ ${counts['maratones']} obras`);
// sanity: cómics collection size must equal the real comic obra count
const comicObras = A.get("SELECT COUNT(*) n FROM obra WHERE categoria='comic'").n;
check('#17 Cómics = nº real de obras cómic', counts['comics'] === comicObras, `(${counts['comics']} == ${comicObras})`);

// ---- A compound collection rule (match:all + agg + obra) ----------------------------
console.log('\n[C] regla_json COMPUESTA de colección (cine de los 90 con nota media ≥ 7):');
{
  const rule = { match: 'all', filtros: [
    { campo: 'obra.categoria', op: '=', valor: 'pelicula' },
    { campo: 'obra.decada', op: '=', valor: 1990 },
    { campo: 'agg.valoracion_media', op: '>=', valor: 7 }
  ] };
  const { sql, params } = compileCollectionRule(rule);
  const n = A.all(sql, params).length;
  check('compuesta (categoria + decada + agg) ejecuta', typeof n === 'number', `→ ${n} obras`);
  check('compuesta parametrizada (sin valores en el SQL)', qmarks(sql) === params.length && /\bpelicula\b/.test(sql) === false, `(${params.length} params)`);
}

// ---- Logros/Wrapped: the SAME compiler in boolean mode -----------------------------
console.log('\n[D] condicion_json (logros) con el MISMO compilador → 0/1:');
const evalCond = (cond) => {
  const { sql, params } = compileCondition(cond);
  if (qmarks(sql) !== params.length) throw new Error('param mismatch');
  return A.get(sql, params).ok;
};
const pct = A.get("SELECT CASE WHEN SUM(duracion_min)>0 THEN 100.0*SUM(CASE WHEN clase_tiempo='habito' THEN duracion_min ELSE 0 END)/SUM(duracion_min) ELSE 0 END v FROM entrada").v;
const horasElec = A.get("SELECT COALESCE(SUM(duracion_min),0)/60.0 v FROM entrada WHERE clase_tiempo='electivo'").v;
console.log(`  (contexto real: MET_PCT_HABITO=${pct?.toFixed(1)}%, MET_HORAS_ELECTIVAS=${horasElec?.toFixed(0)} h)`);
for (const [id, cond] of Object.entries(DEMO_CONDICIONES)) {
  try {
    const ok = evalCond(cond);
    console.log(`  · ${id.padEnd(22)} → ${ok ? 'CUMPLE (1)' : 'no cumple (0)'}`);
    check(`${id} evalúa a 0/1 sin error`, ok === 0 || ok === 1);
  } catch (err) {
    failures++;
    console.log(`  · ${id.padEnd(22)} → ERROR: ${err.message}`);
  }
}
// LOG_DESPIERTO is the headline COMPOUND condition (match:all of two métricas):
const despierto = evalCond(DEMO_CONDICIONES.LOG_DESPIERTO);
check('LOG_DESPIERTO (match:all de 2 métricas) evalúa coherente con el corpus', despierto === (pct < 30 && horasElec >= 1000 ? 1 : 0), `(esperado ${pct < 30 && horasElec >= 1000 ? 1 : 0})`);

// ---- Injection guard: a malicious value stays a bound param ------------------------
console.log('\n[E] seguridad (sin inyección):');
{
  const rule = { match: 'all', filtros: [{ campo: 'obra.titulo', op: '=', valor: "x'; DROP TABLE obra;--" }] };
  const { sql, params } = compileCollectionRule(rule);
  const before = A.get('SELECT COUNT(*) n FROM obra').n;
  A.all(sql, params); // must run harmlessly
  const after = A.get('SELECT COUNT(*) n FROM obra').n;
  check('valor malicioso queda como parámetro (tabla intacta)', after === before && !sql.includes('DROP'));
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
db.close();
process.exit(failures === 0 ? 0 : 1);
