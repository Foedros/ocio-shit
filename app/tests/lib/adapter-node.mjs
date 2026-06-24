// node:sqlite adapter implementing the 3-method contract from src/lib/db/io.js.
// Used only by the CI round-trip test; production uses the OO1 adapter in the worker.
import { DatabaseSync } from 'node:sqlite';

export function createNodeAdapter() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    db,
    exec(sql) {
      db.exec(sql);
    },
    all(sql) {
      return db.prepare(sql).all();
    },
    runMany(sql, rows) {
      const stmt = db.prepare(sql);
      for (const params of rows) stmt.run(...params);
    },
    close() {
      db.close();
    }
  };
}
