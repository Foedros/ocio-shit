// OO1 adapter implementing the adapter contract used by io.js (Sprint 1) and queries.js
// (Sprint 2), wrapping a sqlite-wasm OO1 `DB`. Same contract as the node adapter -> the
// shared modules run identically in the worker and in the node:sqlite tests.
//
// Contract:
//   exec(sql)                 -> run statements, ignore results
//   all(sql, params=[])       -> Array<Object> rows
//   get(sql, params=[])       -> first row Object or null
//   run(sql, params=[])       -> execute one parametrized statement
//   runMany(sql, rows)        -> prepared statement once per row (rows: Array<Array>)
export function createOo1Adapter(db) {
  return {
    db,
    exec(sql) {
      db.exec(sql);
    },
    all(sql, params = []) {
      return db.selectObjects(sql, params);
    },
    get(sql, params = []) {
      const rows = db.selectObjects(sql, params);
      return rows.length ? rows[0] : null;
    },
    run(sql, params = []) {
      db.exec({ sql, bind: params });
    },
    runMany(sql, rows) {
      const stmt = db.prepare(sql);
      try {
        for (const params of rows) {
          stmt.bind(params).stepReset();
        }
      } finally {
        stmt.finalize();
      }
    }
  };
}
