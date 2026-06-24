// One-off: load the DEPLOYED site and confirm the engine boots on the real origin.
import { chromium } from '@playwright/test';

// ?test=1 installs the test hooks (window.__ocio), now gated out of normal prod use.
const URL = (process.env.LIVE_URL || 'https://foedros.github.io/ocio-shit/') + '?test=1';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 1000 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(
  () => ['needs-setup', 'needs-seed', 'ready', 'reconstructed', 'error'].includes(window.__ocio?.getPhase?.()),
  null,
  { timeout: 60000 }
);
const phase = await page.evaluate(() => window.__ocio.getPhase());
const status = await page.evaluate(() => window.__ocio.status());
const caps = await page.evaluate(() => window.__ocio.getDurability());
await page.waitForTimeout(500);
await page.screenshot({ path: 'live-deploy.png', fullPage: true });

console.log('LIVE', URL);
console.log('  phase   =', phase);
console.log('  vfs     =', status.vfs);
console.log('  durable =', caps.mode);
console.log('  console errors =', errors.length ? errors.join(' | ') : '(none)');
await browser.close();
process.exit(status.vfs === 'opfs-sahpool' ? 0 : 1);
