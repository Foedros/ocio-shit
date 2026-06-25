// Fetch RESUMIBLE de la Steam Store API (appdetails) por appid, para los 446 videojuegos
// de Steam. Trae release_date (→ año de estreno), publishers, genres. NO escribe en Supabase:
// solo descarga a data/_steamtmp/<appid>.json (gitignored, sobrevive a reinicios).
//
// Resumible: si data/_steamtmp/<appid>.json ya existe y es válido, lo salta.
// Lento y educado: ~1,3 s entre peticiones; backoff ante rate-limit (body null = límite, NO
// es success=false). success=false = appid retirado (se guarda como tal, sus 3 campos NULL).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { makePgClient } from './lib/supabase-env.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TMP = resolve(here, '..', '..', 'data', '_steamtmp');
mkdirSync(TMP, { recursive: true });
const APPIDS_FILE = resolve(TMP, '_appids.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 1300;          // ~1,3 s entre peticiones
const RL_BACKOFF_MS = 60_000; // espera ante rate-limit (body null)
const MAX_RL_RETRY = 6;

// ── 1) lista de appids (cacheada para resumir sin re-consultar la BD) ────────
let appids;
if (existsSync(APPIDS_FILE)) {
  appids = JSON.parse(readFileSync(APPIDS_FILE, 'utf8'));
  console.log(`appids desde cache: ${appids.length}`);
} else {
  const pg = await makePgClient();
  const { rows } = await pg.query(
    `select id, titulo, fuente_externa from obra
     where categoria='videojuego' and fuente_externa like 'steam:%' order by titulo`
  );
  await pg.end();
  appids = rows.map((r) => ({ obraId: r.id, titulo: r.titulo, appid: String(r.fuente_externa).replace(/^steam:/, '').trim() }))
    .filter((r) => /^\d+$/.test(r.appid));
  writeFileSync(APPIDS_FILE, JSON.stringify(appids, null, 2));
  console.log(`appids desde Supabase: ${appids.length} (cacheados en ${APPIDS_FILE})`);
}

const fileFor = (appid) => resolve(TMP, `${appid}.json`);
const isFetched = (appid) => {
  if (!existsSync(fileFor(appid))) return false;
  try { JSON.parse(readFileSync(fileFor(appid), 'utf8')); return true; } catch { return false; }
};
const save = (appid, obj) => {
  const tmp = fileFor(appid) + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj));
  renameSync(tmp, fileFor(appid));
};

// ── 2) bucle de descarga ─────────────────────────────────────────────────────
const pending = appids.filter((a) => !isFetched(a.appid));
console.log(`ya bajados: ${appids.length - pending.length} · pendientes: ${pending.length}\n`);

let done = 0, ok = 0, retired = 0, neterr = 0;
for (const { appid, titulo } of pending) {
  let attempt = 0, settled = false;
  while (!settled) {
    attempt++;
    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en', 'User-Agent': 'ocioshit-archive/1.0' } });
      if (res.status === 429) { // rate-limited explícito
        if (attempt > MAX_RL_RETRY) { console.log(`  [429] ${appid} agota reintentos; se deja pendiente`); break; }
        console.log(`  [429] ${appid} — backoff ${RL_BACKOFF_MS / 1000}s (intento ${attempt})`);
        await sleep(RL_BACKOFF_MS); continue;
      }
      const j = await res.json().catch(() => null);
      const node = j ? j[appid] : null;
      if (node == null) { // body null = rate-limit encubierto (NO es retirado)
        if (attempt > MAX_RL_RETRY) { console.log(`  [null] ${appid} agota reintentos; se deja pendiente`); break; }
        console.log(`  [null] ${appid} — posible rate-limit, backoff ${RL_BACKOFF_MS / 1000}s (intento ${attempt})`);
        await sleep(RL_BACKOFF_MS); continue;
      }
      if (node.success === false) {
        save(appid, { appid, success: false, fetched_at: new Date().toISOString() });
        retired++; settled = true;
      } else {
        const d = node.data || {};
        save(appid, {
          appid, success: true, fetched_at: new Date().toISOString(),
          name: d.name ?? null, type: d.type ?? null,
          release_date: d.release_date ?? null,
          publishers: d.publishers ?? null, developers: d.developers ?? null,
          genres: (d.genres || []).map((g) => ({ id: g.id, description: g.description }))
        });
        ok++; settled = true;
      }
    } catch (e) {
      if (attempt > MAX_RL_RETRY) { console.log(`  [neterr] ${appid} ${e.message} — agota reintentos; pendiente`); neterr++; break; }
      console.log(`  [neterr] ${appid} ${e.message} — retry en 5s (intento ${attempt})`);
      await sleep(5000); continue;
    }
  }
  done++;
  if (done % 25 === 0) console.log(`… ${done}/${pending.length} (ok=${ok} retirados=${retired} neterr=${neterr}) — "${String(titulo).slice(0, 30)}"`);
  await sleep(GAP_MS);
}

// ── 3) resumen ───────────────────────────────────────────────────────────────
const haveFiles = readdirSync(TMP).filter((f) => /^\d+\.json$/.test(f)).length;
const missing = appids.filter((a) => !isFetched(a.appid));
console.log(`\n══ Fetch terminado ══`);
console.log(`  appids totales      : ${appids.length}`);
console.log(`  ficheros guardados  : ${haveFiles}`);
console.log(`  esta tanda: ok=${ok} retirados=${retired} neterr=${neterr}`);
console.log(`  aún pendientes      : ${missing.length}${missing.length ? ' → re-ejecuta el script para reanudar' : ' ✅'}`);
if (missing.length) console.log(`     ${missing.slice(0, 20).map((m) => m.appid).join(', ')}${missing.length > 20 ? ' …' : ''}`);
