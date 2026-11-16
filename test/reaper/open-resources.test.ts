// Decision 308: `openResources` hands the store's sample history to the load part (open.ts `samples`).
// `readResourcePart` tests pass deps by hand, so a dropped wiring line would leave the panel without
// history and every other test green. The Orca side of the load part is not asserted: it passes with or
// without `orca` on PATH.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { openResources, Store } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";

test("openResources' load part carries the stored samples as history, oldest first", async () => {
  const dir = scratchDir("open-resources-");
  const dbPath = join(dir, "sangsoe.db");
  const now = Date.now();
  let at = now;
  const store = Store.open({ path: dbPath, clock: () => new Date(at).toISOString() });
  at = now - 10 * 60_000;
  store.recordLoadSample({ load5: 4, cpus: 8, memFreePct: 30, diskFreeGb: 120 });
  at = now - 5 * 60_000;
  store.recordLoadSample({ load5: 2, cpus: 4, memFreePct: 40, diskFreeGb: 110 });
  store.close();

  const p = await openResources({ dbPath, home: dir }).part("load");
  assert.ok(p.part === "load");
  assert.ok(p.history?.ok, "the history is read from the store, not absent");
  assert.deepEqual(p.history.value.points, [
    { at: now - 10 * 60_000, loadPerCpu: 0.5, memUsedPct: 70, diskFreeGb: 120 },
    { at: now - 5 * 60_000, loadPerCpu: 0.5, memUsedPct: 60, diskFreeGb: 110 },
  ]);
});
