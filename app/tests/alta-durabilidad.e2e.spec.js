// Test F — the non-negotiable Sprint 2 invariant: a new alta must NOT break the durability
// proven in Sprint 1. Uses ?durable=fsa-opfs, where the durable backend is a real
// FsaDurableStore over a real OPFS directory handle (the exact production atomic-write code,
// same File System Access API as a user-picked folder). After seeding + several altas, the
// durable folder must hold exactly export.json + .prev, with ZERO orphan .tmp.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const sourceText = readFileSync(DATA, 'utf8');

const waitRole = (page, r, timeout = 90_000) =>
  page.waitForFunction((role) => window.__ocio?.getRole?.() === role, r, { timeout });
const waitPhase = (page, phases, timeout = 90_000) =>
  page.waitForFunction((p) => p.includes(window.__ocio?.getPhase?.()), phases, { timeout });

test('altas keep durability intact: durable folder stays export.json + .prev, zero .tmp', async ({
  page
}) => {
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

  await page.goto('/?durable=fsa-opfs');
  await waitRole(page, 'leader');
  await page.evaluate((t) => window.__ocio.seedFromText(t), sourceText);
  await waitPhase(page, ['ready']);
  const before = await page.evaluate(() => window.__ocio.status());

  // After the seed, the durable folder holds the export and never an orphan .tmp.
  let files = await page.evaluate(() => window.__ocio.listDurableFolder());
  expect(files).toContain('ocioshit.export.json');
  expect(files).not.toContain('ocioshit.export.json.tmp');

  // Three quick altas, each of which triggers an atomic durable flush.
  for (let i = 0; i < 3; i++) {
    const res = await page.evaluate(
      (n) =>
        window.__ocio.addEntry({
          obra: { titulo: 'Alta De Prueba ' + n, categoria: 'pelicula', anio_obra: 2026 },
          entrada: { fecha: '2026-06-24', valoracion: 7, nota: 'alta ' + n }
        }),
      i
    );
    expect(res.obraCreated).toBe(true);
  }

  const after = await page.evaluate(() => window.__ocio.status());
  expect(after.counts.obra, '+3 obras').toBe(before.counts.obra + 3);
  expect(after.counts.entrada, '+3 entradas').toBe(before.counts.entrada + 3);
  expect(after.integrity.detail, 'integrity ok after altas').toBe('ok');
  expect(after.foreignKeyViolations).toBe(0);

  // The new altas appear in the filterable list.
  const list = await page.evaluate(() => window.__ocio.listEntries({ search: 'Alta De Prueba' }));
  expect(list.length).toBe(3);

  // THE INVARIANT: after N writes the durable folder is exactly export.json + .prev, zero .tmp.
  files = await page.evaluate(() => window.__ocio.listDurableFolder());
  expect(files).toEqual(['ocioshit.export.json', 'ocioshit.export.prev.json']);
  expect(files).not.toContain('ocioshit.export.json.tmp');

  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  console.log(
    `\n  alta-durabilidad OK — 3 altas, integrity ${after.integrity.detail}, durable folder = [${files.join(', ')}], zero .tmp\n`
  );
});
