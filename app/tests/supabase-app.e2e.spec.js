// Stage 3 step-2 evidence: the REAL built app, against the REAL Supabase project, in headless
// Chromium. Logs in via the form, shows 4242/3809 from Supabase, registers an entry via the
// real QuickAddForm (re-queried in Postgres), filters, reads collections, deletes (re-queried).
import { test, expect } from '@playwright/test';
import { makePgClient, CONFIG } from '../scripts/lib/supabase-env.mjs';

const TITLE = '__E2E_APP_TEST__';
const SHOTS = 'test-results';

let pg;
test.beforeAll(async () => {
  pg = await makePgClient();
  await pg.query('delete from obra where titulo = $1', [TITLE]); // clean any leftover
});
test.afterAll(async () => {
  await pg.query('delete from obra where titulo = $1', [TITLE]);
  await pg.end();
});

const n = async (sql, p = []) => Number((await pg.query(sql, p)).rows[0].n);

test('app funciona contra Supabase: carga, alta, filtros, colecciones, borrado', async ({ page }) => {
  // ── login (real form) ──
  await page.goto('/?test=1');
  await page.fill('input[type=email]', CONFIG.authEmail);
  await page.fill('input[type=password]', CONFIG.authPassword);
  await page.click('button:has-text("Entrar")');

  // ── (1) carga 4242/3809 desde Supabase ──
  await page.waitForFunction(() => window.__ocio?.getCounts?.()?.entrada === 3809, null, { timeout: 60_000 });
  const counts = await page.evaluate(() => window.__ocio.getCounts());
  expect(counts).toMatchObject({ obra: 4242, entrada: 3809, persona: 2169, obra_creador: 4200 });
  await page.waitForSelector('nav.tabs button:has-text("Colecciones")');
  // wait until the diario list has actually RENDERED all 3809 (paginated load finished)
  await page.waitForFunction(() => window.__ocio?.getArchiveCount?.() === 3809, null, { timeout: 60_000 });
  await page.waitForTimeout(400); // let the virtual list paint
  await page.screenshot({ path: `${SHOTS}/e2e-1-diario.png`, fullPage: false });

  // ── (2) alta DESDE la app (QuickAddForm real) ──
  await page.click('button[aria-label="Registrar entrada"]');
  await page.fill('input[aria-label="Nombre de la obra"]', TITLE);
  await page.click('button:has-text("Guardar entrada")');
  // re-consulta Postgres: la entrada existe con origen=sheets
  await expect.poll(async () => n("select count(*)::int n from obra where titulo=$1", [TITLE]), { timeout: 30_000 }).toBe(1);
  const row = (await pg.query(
    "select e.metadata->>'origen' origen, o.categoria, e.owner_id from entrada e join obra o on o.id=e.obra_id where o.titulo=$1", [TITLE]
  )).rows[0];
  expect(row.origen).toBe('sheets');
  expect(row.categoria).toBe('pelicula');
  const ownerId = (await pg.query('select id from auth.users where email=$1', [CONFIG.authEmail])).rows[0].id;
  expect(row.owner_id).toBe(ownerId); // RLS owner sellado por la sesión

  // ── (3) filtros (leyendo de Postgres) ──
  const comicReal = await n("select count(*)::int n from entrada e join obra o on o.id=e.obra_id where o.categoria='comic'");
  const comicViaApp = await page.evaluate(() => window.__ocio.listEntries({ categoria: 'comic' }).then((r) => r.length));
  expect(comicViaApp).toBe(comicReal);
  const faViaApp = await page.evaluate(() => window.__ocio.listEntries({ origen: 'filmaffinity' }).then((r) => r.length));
  expect(faViaApp).toBe(3362); // prueba la paginación >1000

  // ── (4) colecciones (navegación real + lectura de Postgres) ──
  await page.click('nav.tabs button:has-text("Colecciones")');
  await page.waitForTimeout(800);
  const cols = await page.evaluate(() => window.__ocio.listColecciones());
  expect(cols.length).toBe(25);
  const comics = cols.find((c) => c.nombre === 'Cómics');
  expect(comics.n_obras).toBe(31);
  await page.screenshot({ path: `${SHOTS}/e2e-2-colecciones.png`, fullPage: false });

  // ── (5) borrado (acción de la app) + re-consulta Postgres ──
  const eid = (await pg.query('select e.id from entrada e join obra o on o.id=e.obra_id where o.titulo=$1', [TITLE])).rows[0].id;
  const del = await page.evaluate((id) => window.__ocio.deleteEntry(id), eid);
  expect(del.deleted).toBe(true);
  await expect.poll(async () => n('select count(*)::int n from obra where titulo=$1', [TITLE]), { timeout: 30_000 }).toBe(0);

  // counts vuelven a 3809
  const finalCounts = await page.evaluate(() => window.__ocio.getCounts());
  expect(finalCounts.entrada).toBe(3809);

  console.log('  E2E OK — alta+borrado re-consultados en Postgres, filtros y colecciones leyendo de Supabase.');
});
