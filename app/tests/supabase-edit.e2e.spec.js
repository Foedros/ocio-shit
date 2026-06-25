// E2E de EDICIÓN en la app real contra Supabase: abrir el detalle → "Editar" → guardar persiste;
// → "Cancelar" NO guarda. Re-consulta Postgres para cada aserción.
import { test, expect } from '@playwright/test';
import { makePgClient, CONFIG } from '../scripts/lib/supabase-env.mjs';

const TITLE = '__E2E_EDIT__';
let pg;
test.beforeAll(async () => { pg = await makePgClient(); await pg.query('delete from obra where titulo=$1', [TITLE]); });
test.afterAll(async () => { await pg.query('delete from obra where titulo=$1', [TITLE]); await pg.end(); });
const notaOf = async (id) => (await pg.query('select nota from entrada where id=$1', [id])).rows[0]?.nota ?? null;

test('editar una entrada desde la app: Guardar persiste, Cancelar no guarda', async ({ page }) => {
  await page.goto('/?test=1');
  await page.fill('input[type=email]', CONFIG.authEmail);
  await page.fill('input[type=password]', CONFIG.authPassword);
  await page.click('button:has-text("Entrar")');
  await page.waitForFunction(() => window.__ocio?.getCounts?.()?.entrada > 0, null, { timeout: 60_000 });

  // crear una entrada de prueba y abrir su detalle (vía la acción real de la app)
  const eid = await page.evaluate(async () => {
    const r = await window.__ocio.addEntry({ obra: { titulo: '__E2E_EDIT__', categoria: 'libro', anio_obra: 2015 }, entrada: { estado: 'terminado', fecha: '2026-06-25' } });
    await window.__ocio.openDetail(r.entradaId);
    return r.entradaId;
  });
  await expect.poll(() => notaOf(eid)).toBeNull(); // sin nota al crearse

  // ── GUARDAR: Editar → nota → Guardar → persiste ──
  await page.click('button:has-text("Editar")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/edit-mode.png' }); // modo edición con campos precargados
  await page.fill('input[aria-label="Nota personal"]', 'guardado-ok');
  await page.click('button:has-text("Guardar")');
  await expect.poll(() => notaOf(eid), { timeout: 20_000 }).toBe('guardado-ok');

  // ── CANCELAR: Editar → cambio la nota → Cancelar → NO se guarda ──
  await page.evaluate((id) => window.__ocio.openDetail(id), eid); // reabrir detalle (con la nota guardada)
  await page.click('button:has-text("Editar")');
  await page.fill('input[aria-label="Nota personal"]', 'ESTO-NO-DEBE-GUARDARSE');
  await page.click('button:has-text("Cancelar")');
  await page.waitForTimeout(800);
  expect(await notaOf(eid)).toBe('guardado-ok'); // la nota sigue siendo la guardada, NO la cancelada

  console.log('  E2E edición OK — Guardar persiste en Postgres; Cancelar no escribe.');
});
