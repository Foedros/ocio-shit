// node:sqlite adapter implementing the same contract as adapter-oo1.js. Used by the CI
// tests; production uses the OO1 adapter in the worker.
import { DatabaseSync } from 'node:sqlite';

export function createNodeAdapter() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    db,
    exec(sql) {
      db.exec(sql);
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    run(sql, params = []) {
      db.prepare(sql).run(...params);
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
