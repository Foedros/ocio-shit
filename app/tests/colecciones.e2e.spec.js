// Test I — Sprint 3 in the browser: Tanda 1 auto-materializes, collection writes flush the
// durable export, and the durability invariant holds (folder = export.json + .prev, zero .tmp).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const sourceText = readFileSync(DATA, 'utf8');

const waitRole = (page, r, t = 90_000) => page.waitForFunction((role) => window.__ocio?.getRole?.() === role, r, { timeout: t });
const waitPhase = (page, ps, t = 90_000) => page.waitForFunction((w) => w.includes(window.__ocio?.getPhase?.()), ps, { timeout: t });

test('Tanda 1 materializes and collection writes keep durability intact', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  await page.goto('/?durable=fsa-opfs');
  await waitRole(page, 'leader');
  await page.evaluate((t) => window.__ocio.seedFromText(t), sourceText);
  await waitPhase(page, ['ready']);

  // Tanda 1 auto-seeds + materializes after the data loads.
  await page.waitForFunction(async () => (await window.__ocio.listColecciones()).length === 25, null, { timeout: 60_000 });
  const cols = await page.evaluate(() => window.__ocio.listColecciones());
  expect(cols.length, '25 colecciones de Tanda 1').toBe(25);

  // An inteligente collection materialized to a concrete membership.
  const comics = cols.find((c) => c.nombre.startsWith('Cómics'));
  expect(comics, 'la colección Cómics existe').toBeTruthy();
  const det = await page.evaluate((id) => window.__ocio.getColeccion(id), comics.id);
  expect(det.obras.length, 'getColeccion devuelve las obras materializadas').toBe(comics.n_obras);

  // After auto-seeding (a write), the durable folder is exactly target + prev, zero .tmp.
  let files = await page.evaluate(() => window.__ocio.listDurableFolder());
  expect(files).toEqual(['ocioshit.export.json', 'ocioshit.export.prev.json']);

  // Create a manual collection -> durable flush.
  await page.evaluate(() => window.__ocio.createColeccion({ nombre: 'Test Manual ZZZ', tipo: 'manual' }));
  await page.waitForFunction(async () => (await window.__ocio.listColecciones()).length === 26, null, { timeout: 30_000 });

  // Recalculate all inteligente collections -> durable flush.
  await page.evaluate(() => window.__ocio.rematerialize());

  // THE INVARIANT after several collection writes.
  files = await page.evaluate(() => window.__ocio.listDurableFolder());
  expect(files, 'durable folder clean after collection writes').toEqual(['ocioshit.export.json', 'ocioshit.export.prev.json']);
  expect(files).not.toContain('ocioshit.export.json.tmp');

  const st = await page.evaluate(() => window.__ocio.status());
  expect(st.integrity.detail, 'integrity ok after collection writes').toBe('ok');

  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  console.log(`\n  colecciones OK — Tanda 1 = ${cols.length}, Cómics = ${comics.n_obras} obras, durable folder=[${files.join(', ')}], zero .tmp\n`);
});
