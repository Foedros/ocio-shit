// Test C — the regression that the mock could NOT catch. Runs the production
// FsaDurableStore against REAL File System Access handles (OPFS) in real Chromium, doing
// several writes and asserting the on-disk contract the manual test exposed as broken:
//
//   1. zero orphan .tmp after ANY write
//   2. final state is EXACTLY [ocioshit.export.json, ocioshit.export.prev.json]
//   3. .prev holds the previous generation; target holds the latest
//
// Both promotion paths are covered:
//   - 'rename'  : move() works (as on OPFS) — the fast path
//   - 'copy'    : forceCopy simulates a filesystem whose move() is unreliable (the real
//                 local/Windows folder where the original bug appeared)
import { test, expect } from '@playwright/test';

const TARGET = 'ocioshit.export.json';
const PREV = 'ocioshit.export.prev.json';
const TMP = 'ocioshit.export.json.tmp';

// Regression for the adversarial-review finding: two durable writes firing at once (an
// alta's flush racing a visibilitychange/pagehide flush) must NOT interleave. The store is
// single-flight, so N concurrent writes all succeed and the folder ends clean.
for (const forceCopy of [false, true]) {
  test(`FsaDurableStore CONCURRENT writes serialize (single-flight) — ${forceCopy ? 'copy' : 'rename'}: no orphan .tmp, no rejects`, async ({
    page
  }) => {
    await page.goto('/?test=1');
    await page.waitForFunction(() => !!window.__ocioFsa, null, { timeout: 30_000 });
    const res = await page.evaluate((o) => window.__ocioFsa.run(o), { writes: 6, forceCopy, concurrent: true });

    expect(res.settled.rejected, 'no concurrent write should reject').toBe(0);
    expect(res.settled.fulfilled).toBe(6);
    expect(res.finalFiles, 'folder must be exactly target + prev after concurrent writes').toEqual([
      TARGET,
      PREV
    ]);
    expect(res.finalFiles).not.toContain(TMP);
    // The target holds a coherent, fully-written generation (valid JSON, one of v1..v6).
    const v = JSON.parse(res.target).v;
    expect(v).toBeGreaterThanOrEqual(1);
    expect(v).toBeLessThanOrEqual(6);
    console.log(`\n  concurrent ${forceCopy ? 'copy' : 'rename'} OK — 6 fired at once, 6 ok, folder=[${res.finalFiles.join(', ')}], target=v${v}\n`);
  });
}

for (const forceCopy of [false, true]) {
  const pathName = forceCopy ? 'copy fallback (move() unreliable — the local-FS bug path)' : 'rename fast path';
  test(`FsaDurableStore over real OPFS handles — ${pathName}: N writes leave only target+prev, zero .tmp`, async ({
    page
  }) => {
    const consoleErrors = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

    await page.goto('/?test=1');
    await page.waitForFunction(() => !!window.__ocioFsa, null, { timeout: 30_000 });

    const res = await page.evaluate((o) => window.__ocioFsa.run(o), { writes: 4, forceCopy });

    // (1) No orphan .tmp after ANY individual write.
    for (const s of res.steps) {
      expect(s.files, `orphan .tmp after write ${s.i}: ${JSON.stringify(s.files)}`).not.toContain(TMP);
    }

    // (2) Final on-disk state is exactly target + prev.
    expect(res.finalFiles).toEqual([TARGET, PREV]);

    // (3) Rotation correct: target = latest (v4), prev = previous (v3).
    expect(JSON.parse(res.target).v).toBe(4);
    expect(JSON.parse(res.prev).v).toBe(3);
    expect(JSON.parse(res.viaReadExport).v).toBe(4);

    // First write has no prior target, so no .prev yet; from write 2 on, .prev must exist.
    expect(res.steps[0].files).toEqual([TARGET]);
    expect(res.steps[1].files).toEqual([TARGET, PREV]);

    // Method used matches the path under test.
    const methods = new Set(res.steps.map((s) => s.method));
    if (forceCopy) {
      expect(methods).toEqual(new Set(['copy']));
    } else {
      // OPFS move() works, so the fast path must actually be exercised here.
      expect(methods.has('rename')).toBe(true);
    }

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);

    console.log(
      `\n  FSA write OK (${forceCopy ? 'copy' : 'rename'}) — final = [${res.finalFiles.join(', ')}], zero .tmp, prev=v${JSON.parse(res.prev).v}, target=v${JSON.parse(res.target).v}\n`
    );
  });
}
