// Test E — multi-tab lifecycle (roadmap Sprint 2 risk item), in real Chromium with two
// pages sharing one browser context (shared OPFS / IndexedDB / Web Locks).
//
//   1. exactly one LEADER + read-only FOLLOWERS; follower reads proxy to the leader.
//   2. KILL the leader MID-WRITE -> a follower is promoted -> SQLite rolls back the
//      interrupted transaction on open: integrity ok, committed data survives, the
//      uncommitted write is gone, nothing corrupted. (We do NOT assume Web Locks alone
//      makes this safe — we prove the recovery.)
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.OCIO_EXPORT
  ? resolve(process.env.OCIO_EXPORT)
  : resolve(here, 'fixtures', 'sample.export.json');
const sourceText = readFileSync(DATA, 'utf8');
const source = JSON.parse(sourceText);
const expected = { obra: source.obras.length, entrada: source.entradas.length };

const waitRole = (page, r, timeout = 90_000) =>
  page.waitForFunction((role) => window.__ocio?.getRole?.() === role, r, { timeout });
const waitPhase = (page, phases, timeout = 90_000) =>
  page.waitForFunction((p) => p.includes(window.__ocio?.getPhase?.()), phases, { timeout });
const seed = (page) => page.evaluate((t) => window.__ocio.seedFromText(t), sourceText);

test('one leader + one read-only follower; follower reads proxy to the leader', async ({ context }) => {
  const p1 = await context.newPage();
  await p1.goto('/?durable=idb');
  await waitRole(p1, 'leader');
  await seed(p1);
  await waitPhase(p1, ['ready']);

  const p2 = await context.newPage();
  await p2.goto('/?durable=idb');
  await waitRole(p2, 'follower');

  expect(await p1.evaluate(() => window.__ocio.isLeader())).toBe(true);
  expect(await p2.evaluate(() => window.__ocio.getRole())).toBe('follower');

  // The follower can READ (proxied to the leader over BroadcastChannel).
  const folEntries = await p2.evaluate(() => window.__ocio.listEntries({}));
  expect(folEntries.length, 'follower must see the same data via the leader').toBe(expected.entrada);

  // The follower CANNOT write.
  const writeResult = await p2.evaluate(async () => {
    try {
      await window.__ocio.addEntry({ obra: { titulo: 'no-debe-entrar', categoria: 'pelicula' }, entrada: {} });
      return 'WROTE';
    } catch (e) {
      return 'blocked: ' + e.message;
    }
  });
  expect(writeResult).not.toBe('WROTE');

  // The leader's data is unchanged by the follower's blocked write attempt.
  const leaderStatus = await p1.evaluate(() => window.__ocio.status());
  expect(leaderStatus.counts.entrada).toBe(expected.entrada);

  await p1.close();
  await p2.close();
});

test('kill leader MID-WRITE -> follower promoted -> rollback, no corruption, no data loss', async ({
  context
}) => {
  const p1 = await context.newPage();
  await p1.goto('/?durable=idb');
  await waitRole(p1, 'leader');
  await seed(p1);
  await waitPhase(p1, ['ready']);
  const seeded = await p1.evaluate(() => window.__ocio.status());

  // A REAL alta — like the app, it COMMITS and FLUSHES the durable backup. This is the
  // "must-survive" committed data (present whether the next leader keeps OPFS or rebuilds
  // from durable).
  await p1.evaluate(() =>
    window.__ocio.addEntry({
      obra: { titulo: 'SUPERVIVIENTE_COMMIT', categoria: 'pelicula', anio_obra: 2026 },
      entrada: { fecha: '2026-06-24' }
    })
  );
  const afterAlta = await p1.evaluate(() => window.__ocio.status());
  expect(afterAlta.counts.obra).toBe(seeded.counts.obra + 1);

  const p2 = await context.newPage();
  await p2.goto('/?durable=idb');
  await waitRole(p2, 'follower');

  // Arm an UNCOMMITTED sentinel transaction, then hard-kill the leader mid-write.
  await p1.evaluate(() => window.__ocio.beginUncommitted());
  await p1.close();

  // The follower must be promoted and reopen the DB, recovering cleanly.
  await waitRole(p2, 'leader');
  await waitPhase(p2, ['ready', 'reconstructed']);
  const phase2 = await p2.evaluate(() => window.__ocio.getPhase());

  const probe = await p2.evaluate(() => window.__ocio.probe());
  // No corruption.
  expect(probe.integrity.detail, 'integrity_check ok after a mid-write kill').toBe('ok');
  expect(probe.foreignKeyViolations).toBe(0);
  // The uncommitted write was rolled back / never persisted.
  expect(probe.sentinel, 'the uncommitted write must NOT survive').toBe(0);
  // No data loss: the committed+flushed alta survives, and the seed is intact.
  const survivor = await p2.evaluate(() => window.__ocio.listEntries({ search: 'SUPERVIVIENTE_COMMIT' }));
  expect(survivor.length, 'the committed+flushed alta must survive the kill').toBe(1);
  expect(probe.counts.obra).toBe(seeded.counts.obra + 1);
  expect(probe.counts.entrada).toBe(seeded.counts.entrada + 1);

  console.log(
    `\n  multi-tab kill OK — promoted follower recovered (${phase2}, vfs=${probe.vfs}): committed alta kept, ` +
      `uncommitted rolled back, integrity ${probe.integrity.detail}, obras ${probe.counts.obra}.\n`
  );
  await p2.close();
});
