// Offline proof that the dialect adapter turns the CONSERVED compiler's SQLite output into
// valid Postgres (no `?` left, $n count matches params, strftime→to_char). No DB needed.
import { compileCondition, compileCollectionRule } from '../src/lib/predicates/compiler.js';
import { toPg, translateSql, placeholdersToPg } from '../src/lib/db/pg-dialect.js';

let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
};

console.log('\npg-dialect — compiler (SQLite) → Postgres\n');

// 1) compound condition (LOG_DESPIERTO shape): match:all of two metrics
const desp = compileCondition({
  match: 'all',
  filtros: [
    { campo: 'metrica:MET_PCT_HABITO', op: '<', valor: 30 },
    { campo: 'metrica:MET_HORAS_ELECTIVAS', op: '>=', valor: 1000 }
  ]
});
const despPg = toPg(desp);
check('compuesta: sin `?` tras traducir', !despPg.text.includes('?'));
check('compuesta: nº de $n == nº de params', (despPg.text.match(/\$\d+/g) || []).length === desp.params.length, `(${(despPg.text.match(/\$\d+/g) || []).length} == ${desp.params.length})`);
check('compuesta: $1..$n secuenciales', despPg.text.includes('$1') && despPg.text.includes('$2'));

// 2) collection rule with an IN list (multiple placeholders)
const rule = compileCollectionRule({ match: 'all', filtros: [{ campo: 'obra.categoria', op: 'in', valor: ['pelicula', 'serie'] }] });
const rulePg = toPg(rule);
check('regla IN: 2 placeholders → $1,$2', /\$1.*\$2/s.test(rulePg.text) && !rulePg.text.includes('?'));

// 3) strftime month bucket (the one real function difference) → to_char
const ritmo = compileCondition({
  match: 'all',
  filtros: [
    { op: 'count_where', sobre: 'mes', donde: [{ campo: 'agg.num_entradas_mes', op: '>=', valor: 5 }], comparar: { op: '>=', valor: 3 } }
  ]
});
const ritmoPg = toPg(ritmo);
check('strftime traducido a to_char', ritmoPg.text.includes("to_char(fecha, 'YYYY-MM')"));
check('no queda strftime en el SQL Postgres', !ritmoPg.text.includes('strftime'));

// 4) unit: translateSql / placeholdersToPg in isolation
check('translateSql idempotente sobre SQL sin strftime', translateSql('SELECT 1') === 'SELECT 1');
check('placeholdersToPg: a=? and b=? → $1/$2', placeholdersToPg('a=? and b=?') === 'a=$1 and b=$2');

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}\n`);
process.exit(failures === 0 ? 0 : 1);
