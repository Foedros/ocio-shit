// Sprint A — deliverable (d) + §3.4: export.json vuelve a su rol de CAPA PORTABLE. Saca TODO
// desde Supabase al MISMO formato export.json (anti-lock-in) y prueba el ROUND-TRIP recargándolo
// en SQLite (node:sqlite + io.js) → integrity ok + counts 4.242/3.809: se puede exportar y
// marcharse a otro motor sin pérdida.
//
//   node scripts/supabase-export.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLE_MANIFEST, EXPORT_ORDER, applySchema, importAll, counts, integrityCheck, foreignKeyViolations } from '../src/lib/db/io.js';
import { makePgClient } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(resolve(here, '..', '..', 'esquema', 'schema.sql'), 'utf8'); // SQLite v2
const OUT = resolve(here, '..', '..', 'data', 'ocioshit.export.from-supabase.json'); // data/ gitignored

const KEY_TO_TABLE = Object.fromEntries(TABLE_MANIFEST.map((m) => [m.key, m.table]));
const META_TABLES = new Set(['obra', 'entrada']); // metadata stored as STRING in the portable format

async function main() {
  const pg = await makePgClient();
  console.log('\nOcio Shit — export portable desde Supabase\n');

  const out = { schema_version: 2, exportado_en: null };
  for (const key of EXPORT_ORDER) {
    const table = KEY_TO_TABLE[key];
    const { rows } = await pg.query(`select * from ${table}`);
    out[key] = rows.map((r) => {
      const { owner_id, ...rest } = r; // owner_id es artefacto de RLS, no del modelo portable
      // metadata jsonb (objeto) → string JSON, para round-trip idéntico al formato canónico/SQLite
      if (META_TABLES.has(table) && rest.metadata != null && typeof rest.metadata === 'object') {
        rest.metadata = JSON.stringify(rest.metadata);
      }
      // fechas/timestamps → ISO string portable
      for (const k of ['fecha', 'creado_en', 'actualizado_en']) {
        if (rest[k] instanceof Date) rest[k] = rest[k].toISOString();
      }
      return rest;
    });
  }
  await pg.end();

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`  Escrito: ${OUT}`);
  console.log(`  obras ${out.obras.length} · entradas ${out.entradas.length} · personas ${out.personas.length} · obra_creador ${out.obra_creador.length}`);

  // ── ROUND-TRIP: recargar en SQLite y verificar (propiedad del dato, independiente del motor) ──
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
  importAll(A, out);
  const c = counts(A);
  const integ = integrityCheck(A);
  const fk = foreignKeyViolations(A);

  let fail = 0;
  const expect = (label, got, want) => { const ok = got === want; if (!ok) fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: ${got}${ok ? '' : ` (esperado ${want})`}`); };
  console.log('\n  Round-trip Supabase → export.json → SQLite:');
  expect('obras', c.obra, 4242);
  expect('entradas', c.entrada, 3809);
  expect('personas', c.persona, 2169);
  expect('obra_creador', c.obra_creador, 4200);
  expect('integrity_check', integ.ok, true);
  expect('FK violations', fk, 0);
  expect('origen=sheets (tras round-trip)', A.get("select count(*) n from entrada where json_extract(metadata,'$.origen')='sheets'").n, 447);
  db.close();

  console.log(fail === 0 ? '\n✅ Export portable verificado (round-trip a SQLite sin pérdida).\n' : `\n❌ ${fail} fallo(s) en el round-trip.\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ export falló:', e.message, '\n');
  process.exit(1);
});
