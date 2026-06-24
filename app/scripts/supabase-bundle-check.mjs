// Security gate for the frontend bundle: prove the SECRET key / DB password NEVER reach the
// built site, and that the PUBLISHABLE key (which is meant to be public) is the only credential
// present. Run after `npm run build`.  node scripts/supabase-bundle-check.mjs
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { CONFIG } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const buildDir = resolve(here, '..', 'build');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// Forbidden needles (never in the public bundle). Derive the DB password from the URL.
const dbPass = (CONFIG.dbUrl || '').match(/^postgres(?:ql)?:\/\/[^:]+:([^@]*)@/)?.[1] || null;
const forbidden = [
  ['sb_secret_ prefix', 'sb_secret_'],
  ['SECRET key value', CONFIG.secretKey],
  ['DB password', dbPass && dbPass.length >= 6 ? dbPass : null]
].filter(([, v]) => v);

const files = walk(buildDir);
let hits = 0;
console.log(`\nbundle-check — ${files.length} ficheros en build/\n`);
for (const [label, needle] of forbidden) {
  const offenders = files.filter((f) => {
    try {
      return readFileSync(f, 'utf8').includes(needle);
    } catch {
      return false; // binary
    }
  });
  if (offenders.length) {
    hits++;
    console.log(`  ❌ ${label} ENCONTRADO en: ${offenders.map((f) => f.replace(buildDir, 'build')).join(', ')}`);
  } else {
    console.log(`  ✅ ${label}: ausente del bundle`);
  }
}

// The publishable key SHOULD be present (it's public by design).
const pubPresent = files.some((f) => {
  try {
    return readFileSync(f, 'utf8').includes(CONFIG.publishableKey);
  } catch {
    return false;
  }
});
console.log(`  ${pubPresent ? '✅' : '⚠️'} PUBLISHABLE key: ${pubPresent ? 'presente (esperado, es pública)' : 'ausente (¿config sin generar?)'}`);

// Bonus: confirm the old OPFS engine was tree-shaken out (no sqlite wasm/worker shipped here).
const sqliteShipped = files.some((f) => /sqlite3\.wasm$/.test(f)) || files.some((f) => {
  try { return /OpfsSAHPool|sqlite3InitModule/.test(readFileSync(f, 'utf8')); } catch { return false; }
});
console.log(`  ${sqliteShipped ? 'ℹ️' : '✅'} motor SQLite-WASM en el bundle: ${sqliteShipped ? 'presente (static/ aún copia el wasm)' : 'ausente (tree-shaken)'}`);

console.log(hits === 0 ? '\n✅ Ningún secreto en el bundle. Solo la publishable.\n' : `\n❌ ${hits} secreto(s) filtrado(s) al bundle.\n`);
process.exit(hits === 0 ? 0 : 1);
