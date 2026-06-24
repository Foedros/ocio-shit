// Apply supabase/functions.sql (the RPCs the browser uses for atomic writes + aggregate reads)
// and tell PostgREST to reload its schema cache so the new functions are callable immediately.
//   node scripts/supabase-functions.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, '..', '..', 'supabase', 'functions.sql'), 'utf8');

const pg = await makePgClient();
await pg.query(sql);
await pg.query("notify pgrst, 'reload schema'"); // PostgREST cachea el esquema; forzar recarga
const { rows } = await pg.query(
  `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and proname like 'ocio\\_%' order by proname`
);
console.log('RPCs aplicadas:', rows.map((r) => r.proname).join(', '));
console.log('PostgREST: reload schema notificado.');
await pg.end();
