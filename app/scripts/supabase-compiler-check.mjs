// Sprint A — deliverable (c): the CONSERVED predicate compiler evaluates against Postgres.
// Compiles real Tanda-1 rules + the compound LOG_DESPIERTO condicion_json, runs them through
// the dialect adapter (toPg) against the live DB, and checks the counts match the SQLite truth.
// (Runs via the direct DB connection — RLS-bypassing — purely to prove the SQL is valid PG and
//  returns the right numbers; in-app the same SQL runs RLS-scoped to the single owner.)
//
//   node scripts/supabase-compiler-check.mjs
import { compileCollectionRule, compileCondition } from '../src/lib/predicates/compiler.js';
import { metricScalar } from '../src/lib/predicates/metrics.js';
import { buildTanda1, DEMO_CONDICIONES } from '../src/lib/predicates/tanda1.js';
import { toPg } from '../src/lib/db/pg-dialect.js';
import { makePgClient } from './lib/supabase-env.mjs';

async function main() {
  const pg = await makePgClient();
  console.log('\nOcio Shit — compilador (conservado) → Postgres\n');
  let fail = 0;
  const expect = (label, got, want) => {
    const ok = got === want;
    if (!ok) fail++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (esperado ${want})`}`);
  };

  // Collection rules (set mode) — count obras matched.
  const defs = buildTanda1({ year: 2026 });
  const ruleOf = (key) => defs.find((d) => d.key === key)?.regla_json;
  const countRule = async (key) => {
    const { sql, params } = compileCollectionRule(ruleOf(key));
    const { text, values } = toPg({ sql, params });
    const { rows } = await pg.query(text, values);
    return rows.length;
  };
  expect('regla "Cómics" (obra.categoria=comic)', await countRule('comics'), 31);
  expect('regla "Revisitadas" (agg.num_reconsumos>0)', await countRule('revisitadas'), 1);

  // Compound condition (bool mode) — LOG_DESPIERTO = match:all of 2 metrics → 0/1.
  const evalCond = async (cond) => {
    const { sql, params } = compileCondition(cond);
    const { text, values } = toPg({ sql, params });
    const { rows } = await pg.query(text, values);
    return Number(rows[0].ok);
  };
  // Context for LOG_DESPIERTO: MET_PCT_HABITO ≈ 53.9 (> 30) → la condición compuesta debe dar 0.
  const mPct = metricScalar('MET_PCT_HABITO');
  const pctSql = toPg({ sql: `SELECT ${mPct.sql} AS v`, params: mPct.params });
  const { rows: pr } = await pg.query(pctSql.text, pctSql.values);
  console.log(`  · MET_PCT_HABITO = ${Number(pr[0].v).toFixed(1)}%  (>30 ⇒ LOG_DESPIERTO debe ser 0)`);
  expect('condicion COMPUESTA LOG_DESPIERTO (match:all, 2 métricas)', await evalCond(DEMO_CONDICIONES.LOG_DESPIERTO), 0);

  // LOG_RITMO_FIRME ejercita el único punto de dialecto real (strftime→to_char).
  const ritmo = await evalCond(DEMO_CONDICIONES.LOG_RITMO_FIRME);
  console.log(`  · LOG_RITMO_FIRME (count_where sobre mes, usa to_char) evalúa → ${ritmo} (0/1, sin error de dialecto)`);
  expect('LOG_AUTOR_CABECERA (existe creador ≥10 obras)', await evalCond(DEMO_CONDICIONES.LOG_AUTOR_CABECERA), 1);

  await pg.end();
  console.log(fail === 0 ? '\n✅ El compilador conservado evalúa correctamente contra Postgres.\n' : `\n❌ ${fail} discrepancia(s).\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ compiler-check falló:', e.message, '\n');
  process.exit(1);
});
