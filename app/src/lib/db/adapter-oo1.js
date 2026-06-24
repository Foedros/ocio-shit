// OO1 adapter implementing the 3-method contract from io.js, wrapping a sqlite-wasm
// OO1 `DB` instance (the OPFS-SAH-pool DB in the worker, or an in-memory DB when OPFS
// is unavailable). Same contract as the node adapter -> io.js runs identically in both.
export function createOo1Adapter(db) {
  return {
    db,
    exec(sql) {
      db.exec(sql);
    },
    all(sql) {
      return db.selectObjects(sql);
    },
    runMany(sql, rows) {
      const stmt = db.prepare(sql);
      try {
        for (const params of rows) {
          // bind() takes a positional array (1-indexed); stepReset() executes and
          // resets for the next row. Each row binds all columns, so no stale binds.
          stmt.bind(params).stepReset();
        }
      } finally {
        stmt.finalize();
      }
    }
  };
}
