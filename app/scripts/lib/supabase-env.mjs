// Shared env + client factory for the Supabase admin/verification scripts. Reads the repo-root
// .env (gitignored) so the SECRET key and DB URL stay LOCAL, never in the bundle (tecnico.md
// §3.2.sec). The frontend, by contrast, only ever gets SUPABASE_PUBLISHABLE_KEY.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(here, '..', '..', '..', '.env'); // repo root

function loadDotEnv() {
  const out = {};
  let raw = '';
  try {
    raw = readFileSync(ENV_PATH, 'utf8');
  } catch {
    return out; // no .env yet — values may come from process.env
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const fileEnv = loadDotEnv();
const env = (k) => process.env[k] ?? fileEnv[k];

// Accept BOTH the SvelteKit-style PUBLIC_* names (what the frontend will use in Stage 3) and the
// bare names, so one .env serves scripts now and the client later. The SECRET key is never PUBLIC_.
export const CONFIG = {
  url: env('PUBLIC_SUPABASE_URL') ?? env('SUPABASE_URL'),
  publishableKey: env('PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? env('SUPABASE_PUBLISHABLE_KEY'),
  secretKey: env('SUPABASE_SECRET_KEY'),
  dbUrl: env('SUPABASE_DB_URL'),
  authEmail: env('OCIO_AUTH_EMAIL'),
  authPassword: env('OCIO_AUTH_PASSWORD')
};

export function require_(keys) {
  const missing = keys.filter((k) => !CONFIG[k]);
  if (missing.length) {
    const map = {
      url: 'PUBLIC_SUPABASE_URL',
      publishableKey: 'PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      secretKey: 'SUPABASE_SECRET_KEY',
      dbUrl: 'SUPABASE_DB_URL',
      authEmail: 'OCIO_AUTH_EMAIL',
      authPassword: 'OCIO_AUTH_PASSWORD'
    };
    console.error(`\n❌ Faltan variables en .env: ${missing.map((k) => map[k]).join(', ')}`);
    console.error('   Copia .env.example y rellénalas (ver supabase/README.md).\n');
    process.exit(2);
  }
}

/** node-postgres Client over the DB URL (SSL, as Supabase requires). We parse the URI OURSELVES
 *  and pass discrete fields so a password with URL-special chars (e.g. `/`, `@`) works literally,
 *  without the user having to percent-encode it. */
export async function makePgClient() {
  require_(['dbUrl']);
  const { default: pg } = await import('pg');
  const m = CONFIG.dbUrl.match(/^postgres(?:ql)?:\/\/([^:]+):([^@]*)@([^:/]+):(\d+)\/([^?]+)/);
  const cfg = m
    ? { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] }
    : { connectionString: CONFIG.dbUrl };
  const client = new pg.Client({ ...cfg, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

/** Supabase JS client with the PUBLISHABLE key — what a browser sees (RLS applies). */
export async function makePublishableClient() {
  require_(['url', 'publishableKey']);
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(CONFIG.url, CONFIG.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Supabase JS client with the SECRET key (service_role — BYPASSES RLS). LOCAL admin only. */
export async function makeSecretClient() {
  require_(['url', 'secretKey']);
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(CONFIG.url, CONFIG.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
