// Test B — the headline durability test, in REAL headless Chromium against the production
// build. It exercises the exact reconstruction code path users rely on:
//
//   load -> seed export.json -> OPFS has data + durable backup written
//   -> WIPE ALL OPFS -> RELOAD -> app reconstructs from the durable export
//   -> integrity_check ok AND counts identical (no data lost)
//
// The durable backend in the test is IndexedDB (?durable=idb): it survives a reload
// independently of the OPFS-SAH-pool cache, simulating the real on-disk durable file.
// Only the backend differs from production's FsaDurableStore — the code path is identical.
//
// Data: OCIO_EXPORT env (point at the real archive) or the bundled synthetic fixture (CI).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const source = JSON.parse(readFileSync(DATA, 'utf8'));
const expected = {
  obra: source.obras.length,
  entrada: source.entradas.length,
  persona: source.personas.length,
  obra_creador: source.obra_creador.length
};

async function waitForPhase(page, phases, timeout = 90_000) {
  await page.waitForFunction(
    (wanted) => wanted.includes(window.__ocio?.getPhase?.()),
    phases,
    { timeout }
  );
  return page.evaluate(() => window.__ocio.getPhase());
}
const status = (page) => page.evaluate(() => window.__ocio.status());

test('OPFS loss -> reload -> reconstruction from durable export with zero data loss', async ({
  page
}) => {
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // --- 1. First load (test durable backend = IndexedDB, initially empty) ----------------
  await page.goto('/?durable=idb');
  await waitForPhase(page, ['needs-setup', 'needs-seed', 'ready', 'reconstructed']);

  const boot = await status(page);
  expect(boot.vfs, 'OPFS-SAH-pool engine must be active (not in-memory fallback)').toBe(
    'opfs-sahpool'
  );

  // --- 2. Seed the archive from export.json via the real file input ---------------------
  await page.setInputFiles('input[type="file"]', DATA);
  await waitForPhase(page, ['ready']);

  const seeded = await status(page);
  expect(seeded.integrity.detail).toBe('ok');
  expect(seeded.counts).toMatchObject(expected);
  expect(seeded.foreignKeyViolations).toBe(0);

  // A durable backup must now exist (written to the IndexedDB durable store).
  const dur = await page.evaluate(() => window.__ocio.getDurability());
  expect(dur.lastBackupAt, 'durable backup timestamp must be set after seeding').toBeTruthy();

  // --- 3. THE TEST: wipe ALL OPFS, then reload -----------------------------------------
  const wipe = await page.evaluate(() => window.__ocio.wipeOpfsHard());
  expect(wipe.before.length, 'OPFS must have held the SAH-pool before the wipe').toBeGreaterThan(0);
  expect(wipe.remaining, 'OPFS must be empty after the wipe').toEqual([]);

  await page.reload();

  // --- 4. The app must reconstruct from the durable export, with no loss -----------------
  const phaseAfter = await waitForPhase(page, ['reconstructed', 'ready', 'error']);
  expect(phaseAfter, 'must reconstruct, not error').toBe('reconstructed');

  const rebuilt = await status(page);
  expect(rebuilt.vfs).toBe('opfs-sahpool');
  expect(rebuilt.integrity.detail, 'integrity_check must be ok after rebuild').toBe('ok');
  expect(rebuilt.foreignKeyViolations).toBe(0);
  expect(rebuilt.counts, 'counts must be identical to before the wipe').toMatchObject(expected);

  // --- 5. Re-export after rebuild must still round-trip (durable artifact stays valid) ---
  const reexport = await page.evaluate(() => window.__ocio.exportJson());
  const parsed = JSON.parse(reexport);
  expect(parsed.obras.length).toBe(expected.obra);
  expect(parsed.entradas.length).toBe(expected.entrada);
  expect(parsed.personas.length).toBe(expected.persona);
  expect(parsed.obra_creador.length).toBe(expected.obra_creador);

  expect(consoleErrors, `unexpected console errors: ${consoleErrors.join(' | ')}`).toEqual([]);

  console.log(
    `\n  durability OK — reconstructed ${rebuilt.counts.obra} obras / ${rebuilt.counts.entrada} entradas ` +
      `from durable export after full OPFS wipe + reload (integrity ${rebuilt.integrity.detail}).\n`
  );
});

test('in-app "simulate OPFS loss" button reconstructs without reload', async ({ page }) => {
  await page.goto('/?durable=idb');
  await waitForPhase(page, ['needs-setup', 'needs-seed', 'ready']);
  await page.setInputFiles('input[type="file"]', DATA);
  await waitForPhase(page, ['ready']);

  await page.evaluate(() => window.__ocio.simulateOpfsLoss());
  const phaseAfter = await waitForPhase(page, ['reconstructed', 'error']);
  expect(phaseAfter).toBe('reconstructed');

  const st = await status(page);
  expect(st.integrity.detail).toBe('ok');
  expect(st.counts).toMatchObject(expected);
});
