// One-off: drive the real app through seed -> wipe OPFS -> reload -> reconstruct with the
// REAL archive, and screenshot the reconstructed dashboard. Not part of the test suite.
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';

const DATA = resolve(process.env.OCIO_EXPORT || '../data/ocioshit.export.json');
const URL = 'http://localhost:4173/?durable=idb';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1100 } });
const waitPhase = (phases) =>
  page.waitForFunction((w) => w.includes(window.__ocio?.getPhase?.()), phases, { timeout: 90000 });

await page.goto(URL);
await waitPhase(['needs-setup', 'needs-seed', 'ready']);
await page.setInputFiles('input[type="file"]', DATA);
await waitPhase(['ready']);
await page.evaluate(() => window.__ocio.wipeOpfsHard());
await page.reload();
await waitPhase(['reconstructed', 'error']);
await page.waitForTimeout(800);

await page.screenshot({ path: 'durability-dashboard.png', fullPage: true });
const st = await page.evaluate(() => window.__ocio.status());
console.log('phase reconstructed; counts =', JSON.stringify(st.counts), 'integrity =', st.integrity.detail);
await browser.close();
