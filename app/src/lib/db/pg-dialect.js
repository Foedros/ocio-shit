// Dialect adapter: translate the predicate compiler's SQLite output to PostgreSQL — WITHOUT
// touching the compiler (it stays the single, conserved grammar, per the Sprint A directive
// and tecnico.md §4). The compiler emits portable SQL with `?` placeholders; only two things
// differ for Postgres, both handled here at the DB boundary:
//
//   1. Placeholders: `?` (SQLite/node:sqlite) → `$1..$n` (node-postgres, positional).
//   2. Month bucket: strftime('%Y-%m', X) (SQLite) → to_char(X, 'YYYY-MM') (Postgres).
//   3. Year bucket:  strftime('%Y', X)   (SQLite) → to_char(X, 'YYYY')    (antigüedad).
//   4. Día-número:   julianday(X)        (SQLite) → (X::date - DATE '2000-01-01') (racha:
//      gaps-and-islands sobre días consecutivos; el offset constante cancela en el grupo).
//
// Everything else the compiler/metrics emit (lower, ||, coalesce, AVG/SUM/COUNT/MIN/MAX, CASE,
// BETWEEN, IN, IS NULL, LIKE, EXISTS, `power`, `round`, `ROW_NUMBER() OVER`, `WITH RECURSIVE`,
// `/60.0`/`100.0*` numeric division) es idéntico en ambos dialectos.

const STRFTIME_MONTH = /strftime\(\s*'%Y-%m'\s*,\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/g;
const STRFTIME_YEAR = /strftime\(\s*'%Y'\s*,\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/g;
const JULIANDAY = /julianday\(\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/g;

/** Translate the SQLite-only date functions the metrics emit to their Postgres equivalents. */
export function translateSql(sql) {
  return sql
    .replace(STRFTIME_MONTH, "to_char($1, 'YYYY-MM')")
    .replace(STRFTIME_YEAR, "to_char($1, 'YYYY')")
    .replace(JULIANDAY, "($1::date - DATE '2000-01-01')");
}

/** Convert ordered `?` placeholders to `$1..$n`. Safe: the compiler parametrizes every value,
 *  so no `?` ever appears inside a string literal. */
export function placeholdersToPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Adapt a compiled `{ sql, params }` (SQLite dialect) to a Postgres `{ text, values }`
 * ready for node-postgres `client.query(text, values)`.
 */
export function toPg({ sql, params }) {
  return { text: placeholdersToPg(translateSql(sql)), values: params };
}
