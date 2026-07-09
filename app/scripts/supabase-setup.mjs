// Sprint A — step 1: apply schema.sql + rls.sql to the Supabase Postgres (direct DB URL) and
// ensure the single Auth user exists (so auth.uid() matches the owner_id we stamp at load).
// Idempotent-ish: `--reset` drops our tables first for a clean re-run.
//
//   node scripts/supabase-setup.mjs [--reset]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient, makeSecretClient, CONFIG, require_ } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SUPA_DIR = resolve(here, '..', '..', 'supabase');
const schemaSql = readFileSync(resolve(SUPA_DIR, 'schema.sql'), 'utf8');
const rlsSql = readFileSync(resolve(SUPA_DIR, 'rls.sql'), 'utf8');

// All tables we own (drop order = children before parents for --reset).
const TABLES = [
  'obra_creador', 'entrada_acompanante', 'obra_coleccion', 'entrada_etiqueta', 'obra_etiqueta',
  'titulo_desbloqueado', 'logro_desbloqueado', 'momento_canon', 'perfil_usuario', 'pool_ocio',
  'entrada', 'obra', 'titulo', 'logro', 'coleccion', 'etiqueta', 'etapa', 'persona', 'plataforma', 'meta'
];

async function main() {
  require_(['dbUrl', 'url', 'secretKey', 'authEmail', 'authPassword']);
  const reset = process.argv.includes('--reset');
  const pg = await makePgClient();
  console.log('\nOcio Shit — Supabase setup\n');

  if (reset) {
    console.log('  --reset: drop de tablas existentes…');
    for (const t of TABLES) await pg.query(`drop table if exists ${t} cascade`);
    await pg.query('drop function if exists set_actualizado_en() cascade');
    await pg.query('drop function if exists pool_ocio_limite() cascade');
  }

  console.log('  Aplicando schema.sql…');
  await pg.query(schemaSql);
  console.log('  Aplicando rls.sql…');
  await pg.query(rlsSql);

  // Confirm RLS is ENABLED on every one of our tables (the gate's structural half).
  const { rows: rls } = await pg.query(
    `select c.relname, c.relrowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname='public' and c.relname = any($1) order by c.relname`,
    [TABLES]
  );
  const withRls = rls.filter((r) => r.relrowsecurity).length;
  const noRls = rls.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  console.log(`  RLS ENABLE: ${withRls}/${TABLES.length} tablas` + (noRls.length ? `  ⚠️ SIN RLS: ${noRls.join(', ')}` : '  ✅'));

  const { rows: pol } = await pg.query(
    `select count(*)::int n from pg_policies where schemaname='public'`
  );
  console.log(`  Políticas creadas: ${pol[0].n} (esperado 80 = 20 tablas × 4 comandos)`);

  await pg.end();

  // Ensure the single Auth user (email+password), so login → auth.uid() == owner_id.
  const supa = await makeSecretClient();
  const { data: list, error } = await supa.auth.admin.listUsers();
  if (error) throw error;
  let user = list.users.find((u) => u.email === CONFIG.authEmail);
  if (!user) {
    const { data: created, error: cErr } = await supa.auth.admin.createUser({
      email: CONFIG.authEmail,
      password: CONFIG.authPassword,
      email_confirm: true
    });
    if (cErr) throw cErr;
    user = created.user;
    console.log(`  Usuario Auth creado: ${user.email}`);
  } else {
    console.log(`  Usuario Auth ya existe: ${user.email}`);
  }
  console.log(`  owner uid: ${user.id}`);
  console.log('\n✅ Setup completo. Siguiente: node scripts/supabase-load.mjs\n');
}

main().catch((e) => {
  console.error('\n❌ setup falló:', e.message, '\n');
  process.exit(1);
});
