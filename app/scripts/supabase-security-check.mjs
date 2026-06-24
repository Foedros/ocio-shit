// Sprint A — GATE DE SEGURIDAD (bloqueante). Con la clave PUBLISHABLE real (lo que ve el
// navegador) y SIN autenticar: SELECT debe dar vacío y un INSERT bien formado debe quedar
// BLOQUEADO por RLS. Luego, AUTENTICADO como el usuario: ve lo suyo. NO se usa el SQL Editor
// (bypassa RLS); esto golpea PostgREST como un cliente real. tecnico.md §3.2.sec.
//
//   node scripts/supabase-security-check.mjs
import { randomUUID } from 'node:crypto';
import { makePublishableClient, makeSecretClient, CONFIG, require_ } from './lib/supabase-env.mjs';

const TABLES = [
  'meta', 'plataforma', 'persona', 'etapa', 'obra', 'entrada', 'etiqueta', 'coleccion', 'logro',
  'logro_desbloqueado', 'momento_canon', 'titulo', 'titulo_desbloqueado', 'perfil_usuario',
  'obra_etiqueta', 'entrada_etiqueta', 'obra_coleccion', 'entrada_acompanante', 'obra_creador'
];

// Minimal WELL-FORMED rows (satisfy NOT NULL/CHECK + owner_id), so the ONLY thing that can
// block the insert is RLS. If one of these SUCCEEDS, RLS is off → the table is world-writable.
const INSERT_PROBES = {
  persona: () => ({ id: 'sec-' + randomUUID(), nombre: 'sec-probe', owner_id: randomUUID() }),
  obra: () => ({ id: 'sec-' + randomUUID(), titulo: 'sec-probe', categoria: 'pelicula', owner_id: randomUUID() }),
  etiqueta: () => ({ id: 'sec-' + randomUUID(), nombre: 'sec-' + randomUUID(), owner_id: randomUUID() }),
  coleccion: () => ({ id: 'sec-' + randomUUID(), nombre: 'sec-probe', tipo: 'manual', owner_id: randomUUID() })
};

async function main() {
  require_(['url', 'publishableKey']);
  // Safety: refuse to run if the "publishable" value is actually a secret key (would bypass RLS
  // and give a false PASS). publishable keys start with sb_publishable_ ; secret with sb_secret_.
  if (/sb_secret_/.test(CONFIG.publishableKey || '')) {
    console.error('\n❌ SUPABASE_PUBLISHABLE_KEY parece una clave SECRET. El gate exige la PUBLISHABLE.\n');
    process.exit(2);
  }
  const anon = await makePublishableClient();
  console.log('\nOcio Shit — GATE de seguridad (clave publishable, SIN autenticar)\n');

  let leaks = 0;
  // 1) SELECT sin auth → debe ser vacío en TODAS las tablas (nunca datos).
  console.log('  [A] SELECT anónimo → debe dar vacío:');
  for (const t of TABLES) {
    const { data, error } = await anon.from(t).select('*').limit(1);
    const rows = data?.length ?? 0;
    const leak = rows > 0;
    if (leak) leaks++;
    console.log(`    ${leak ? 'FUGA' : 'ok  '}  ${t.padEnd(20)} filas=${rows}${error ? `  (err: ${error.code || error.message})` : ''}`);
  }

  // 2) INSERT bien formado sin auth → debe quedar BLOQUEADO (error). Si entra, RLS está off.
  console.log('\n  [B] INSERT anónimo bien formado → debe quedar BLOQUEADO:');
  for (const [t, mk] of Object.entries(INSERT_PROBES)) {
    const { data, error } = await anon.from(t).insert(mk()).select();
    const wrote = !!(data && data.length);
    if (wrote) leaks++;
    console.log(`    ${wrote ? 'ESCRIBIÓ' : 'bloqueado'}  ${t.padEnd(18)}${error ? `  (${error.code || error.message})` : ''}`);
    if (wrote) await (await makeSecretClient()).from(t).delete().eq('id', data[0].id); // limpia la fuga si la hubo
  }

  // 3) AUTENTICADO como el usuario → ve lo suyo (RLS permite al propietario).
  console.log('\n  [C] AUTENTICADO como el usuario → ve sus datos:');
  let authOk = false;
  if (CONFIG.authEmail && CONFIG.authPassword) {
    const { error: sErr } = await anon.auth.signInWithPassword({ email: CONFIG.authEmail, password: CONFIG.authPassword });
    if (sErr) {
      console.log(`    ⚠️ no se pudo autenticar: ${sErr.message}`);
    } else {
      const { count } = await anon.from('obra').select('*', { count: 'exact', head: true });
      authOk = (count ?? 0) > 0;
      console.log(`    ${authOk ? 'ok  ' : 'FAIL'}  obra visible autenticado: ${count} (esperado 4242)`);
      await anon.auth.signOut();
    }
  } else {
    console.log('    (sin OCIO_AUTH_* en .env; omito la prueba autenticada)');
  }

  const pass = leaks === 0 && authOk;
  console.log(
    pass
      ? '\n✅ GATE VERDE: anónimo no lee ni escribe nada; el propietario sí ve lo suyo.\n   Falta adjuntar: Security Advisor de Supabase sin hallazgos.\n'
      : `\n❌ GATE ROJO: ${leaks} fuga(s) anónimas${authOk ? '' : ' / la prueba autenticada no pasó'}.\n`
  );
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('\n❌ security-check falló:', e.message, '\n');
  process.exit(1);
});
