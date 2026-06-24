// Verify the BROWSER export button's data path (data.exportArchive via publishable + auth):
// it must pull ALL 3809 (paginated, not truncated to 1000), strip owner_id, and round-trip
// losslessly back into SQLite — proving the anti-lock-in portability.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as data from '../src/lib/db/supabase-data.js';
import { applySchema, importAll, counts as ioCounts, integrityCheck, foreignKeyViolations } from '../src/lib/db/io.js';
import { CONFIG } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8'); // SQLite v2

let fail = 0;
const ok = (label, cond, extra = '') => { if (!cond) fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`); };

console.log('\nexport (botón de la app) — saca todo + round-trip a SQLite\n');
await data.signIn(CONFIG.authEmail, CONFIG.authPassword);

const exp = await data.exportArchive();
ok('obras 4242 (no truncado a 1000)', exp.obras.length === 4242, `(${exp.obras.length})`);
ok('entradas 3809 (no truncado a 1000)', exp.entradas.length === 3809, `(${exp.entradas.length})`);
ok('personas 2169', exp.personas.length === 2169, `(${exp.personas.length})`);
ok('obra_creador 4200', exp.obra_creador.length === 4200, `(${exp.obra_creador.length})`);
ok('ninguna fila lleva owner_id (artefacto RLS)', !exp.obras.some((o) => 'owner_id' in o) && !exp.entradas.some((e) => 'owner_id' in e));
ok('metadata vuelve a string (formato portable)', exp.entradas.every((e) => e.metadata == null || typeof e.metadata === 'string'));
await data.signOut();

// Round-trip: reload into SQLite (anti-lock-in)
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const A = {
  exec: (s) => db.exec(s),
  all: (s, p = []) => db.prepare(s).all(...p),
  get: (s, p = []) => db.prepare(s).get(...p) ?? null,
  run: (s, p = []) => db.prepare(s).run(...p),
  runMany: (s, rows) => { const st = db.prepare(s); for (const p of rows) st.run(...p); }
};
applySchema(A, schemaSql);
importAll(A, exp);
const c = ioCounts(A);
ok('round-trip SQLite: obras 4242', c.obra === 4242);
ok('round-trip SQLite: entradas 3809', c.entrada === 3809);
ok('round-trip SQLite: integrity ok', integrityCheck(A).ok);
ok('round-trip SQLite: 0 FK', foreignKeyViolations(A) === 0);
ok('round-trip SQLite: origen=sheets 447 (metadata intacta)', A.get("select count(*) n from entrada where json_extract(metadata,'$.origen')='sheets'").n === 447);
db.close();

console.log(`\n${fail === 0 ? '✅ ALL PASS — export completo (3809) y round-trip a SQLite sin pérdida.' : '❌ ' + fail + ' FALLO(S).'}\n`);
process.exit(fail === 0 ? 0 : 1);
