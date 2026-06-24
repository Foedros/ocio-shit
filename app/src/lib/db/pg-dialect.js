// Dialect adapter: translate the predicate compiler's SQLite output to PostgreSQL — WITHOUT
// touching the compiler (it stays the single, conserved grammar, per the Sprint A directive
// and tecnico.md §4). The compiler emits portable SQL with `?` placeholders; only two things
// differ for Postgres, both handled here at the DB boundary:
//
//   1. Placeholders: `?` (SQLite/node:sqlite) → `$1..$n` (node-postgres, positional).
//   2. Month bucket: strftime('%Y-%m', X) (SQLite) → to_char(X, 'YYYY-MM') (Postgres).
//
// Everything else the compiler/metrics emit (lower, ||, coalesce, AVG/SUM/COUNT/MIN/MAX,
// CASE, BETWEEN, IN, IS NULL, LIKE, EXISTS, `/60.0`/`100.0*` numeric division) is identical
// in both dialects, so no other translation is needed.

const STRFTIME_MONTH = /strftime\(\s*'%Y-%m'\s*,\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\)/g;

/** Translate strftime month buckets to Postgres to_char. */
export function translateSql(sql) {
  return sql.replace(STRFTIME_MONTH, "to_char($1, 'YYYY-MM')");
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
