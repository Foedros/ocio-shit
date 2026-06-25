// Test — sistema de LOGROS con el MISMO compilador (offline, node:sqlite, sin red). Compila TODO
// el catálogo (logros-catalog.js): cada condicion_json evaluable → booleano 0/1 + medidas de
// progreso, todo bajo node:sqlite (prueba además que la entropía del Índice de Diversidad usa ln()
// y ejecuta en ambos motores). No comprueba números concretos (la verdad sobre el corpus real va
// en scripts/supabase-logros-check.mjs); aquí: compila, ejecuta, da 0/1, progreso numérico y
// los no-evaluables tienen motivo. Una sola gramática (importa de compiler.js).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applySchema, importAll } from '../src/lib/db/io.js';
import { compileCondition, compileMeasure, progressRatio } from '../src/lib/predicates/compiler.js';
import { LOGROS, TITULOS, ALL_RPG, MOTIVO } from '../src/lib/predicates/logros-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8');
const dataPath = process.env.OCIO_EXPORT ? resolve(process.env.OCIO_EXPORT) : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(dataPath, 'utf8'));

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const A = {
  exec: (s) => db.exec(s),
  all: (s, p = []) => db.prepare(s).all(...p),
  get: (s, p = []) => db.prepare(s).get(...p) ?? null,
  run: (s, p = []) => db.prepare(s).run(...p),
  runMany: (s, rows) => { const st = db.prepare(s); for (const r of rows) st.run(...r); }
};
applySchema(A, schemaSql);
importAll(A, source);

let failures = 0;
const check = (label, ok, extra = '') => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };
const qmarks = (sql) => (sql.match(/\?/g) || []).length;

console.log(`\nOcio Shit — sistema de logros (compilador único)\ndata: ${dataPath}\n`);
console.log(`[A] catálogo: ${LOGROS.length} logros + ${TITULOS.length} títulos = ${ALL_RPG.length}`);
check('25 logros + 20 títulos', LOGROS.length === 25 && TITULOS.length === 20);

console.log('\n[B] cada ítem EVALUABLE compila + ejecuta (booleano 0/1 + medidas numéricas):');
let evaluables = 0;
for (const x of ALL_RPG) {
  if (!x.condicion_json) {
    check(`${x.id} no-evaluable trae motivo`, !!MOTIVO[x.bloqueado_por], `(${x.bloqueado_por})`);
    continue;
  }
  evaluables++;
  try {
    const cond = compileCondition(x.condicion_json);
    if (qmarks(cond.sql) !== cond.params.length) throw new Error('param mismatch (bool)');
    const ok = A.get(cond.sql, cond.params).ok;
    const meta = compileMeasure(x.condicion_json);
    const valores = meta.measures.map((m) => {
      if (qmarks(m.sql) !== m.params.length) throw new Error('param mismatch (measure)');
      const v = A.get(m.sql, m.params).v;
      return v == null ? null : Number(v);
    });
    const ratios = meta.measures.map((m, i) => progressRatio(valores[i], m.target, m.op)).filter((n) => n != null);
    const progreso = ratios.length ? (meta.combine === 'max' ? Math.max(...ratios) : Math.min(...ratios)) : null;
    const okBool = ok === 0 || ok === 1;
    const progNum = progreso === null || (progreso >= 0 && progreso <= 1);
    check(`${x.id}`, okBool && progNum, `→ ${ok ? 'CUMPLE' : 'no'} · progreso ${progreso == null ? '—' : (progreso * 100).toFixed(0) + '%'}`);
  } catch (err) {
    check(`${x.id}`, false, `ERROR: ${err.message}`);
  }
}
check(`hay ítems evaluables (${evaluables})`, evaluables >= 25);

console.log('\n[C] Índice de Diversidad por entropía ejecuta bajo node:sqlite (ln) y queda en 0–100:');
{
  const cond = compileCondition({ match: 'all', filtros: [{ campo: 'metrica:MET_INDICE_DIVERSIDAD', op: '>=', valor: 0 }] });
  const ok = A.get(cond.sql, cond.params).ok;
  const m = compileMeasure({ match: 'all', filtros: [{ campo: 'metrica:MET_INDICE_DIVERSIDAD', op: '>=', valor: 0 }] });
  const v = Number(A.get(m.measures[0].sql, m.measures[0].params).v);
  check('MET_INDICE_DIVERSIDAD evalúa (≥0 → 1) y el valor es 0–100', ok === 1 && v >= 0 && v <= 100, `(índice fixture = ${v.toFixed(2)})`);
}

console.log('\n[D] el COMPUESTO LOG_DESPIERTO (match:all de 2 métricas) evalúa coherente:');
{
  const desp = LOGROS.find((x) => x.id === 'LOG_DESPIERTO');
  const c = compileCondition(desp.condicion_json);
  const ok = A.get(c.sql, c.params).ok;
  const pct = A.get("SELECT CASE WHEN SUM(duracion_min)>0 THEN 100.0*SUM(CASE WHEN clase_tiempo='habito' THEN duracion_min ELSE 0 END)/SUM(duracion_min) ELSE 0 END v FROM entrada").v;
  const ele = A.get("SELECT COALESCE(SUM(duracion_min),0)/60.0 v FROM entrada WHERE clase_tiempo='electivo'").v;
  check('LOG_DESPIERTO = (pct<30 ∧ electivas≥1000)', ok === (pct < 30 && ele >= 1000 ? 1 : 0), `(pct=${pct?.toFixed(1)} ele=${ele?.toFixed(0)} → ${ok})`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
db.close();
process.exit(failures === 0 ? 0 : 1);
