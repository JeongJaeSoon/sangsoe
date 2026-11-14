// Decision 250: the load part carries the last 24 hours of decision 241's samples for the panel's
// card, derived the way the gauges are (load per core, used memory), with the machine's thresholds.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_THRESHOLDS, type LoadThresholds, readResourcePart, type ResourceDeps, Store } from "../../core/index.ts";
import { scratchDir } from "../scratch.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const H = 3_600_000;
const M = 60_000;

function deps(store: Store, o: { thresholds?: LoadThresholds } = {}): ResourceDeps {
  return {
    orca: {
      diagnosticsMemory: async () => ({ ok: true, value: { host: { availableMemory: 25, totalMemory: 100 } } }),
    } as unknown as ResourceDeps["orca"],
    exec: async () => {
      throw new Error("the load part runs no command");
    },
    events: (f) => store.events(f),
    now: () => NOW,
    sample: () => ({ load5: 4, cpus: 8, ...(o.thresholds ? { thresholds: o.thresholds } : {}) }),
    samples: (since) => store.loadSamples(since),
    plan: async () => {
      throw new Error("the load part runs no plan");
    },
    tmpRoot: scratchDir("res250-tmp-"),
    uid: process.getuid?.() ?? 0,
    trashBin: null,
  };
}

function storeAt(): { store: Store; at: (ms: number) => void } {
  let now = NOW;
  const store = Store.open({ path: ":memory:", clock: () => new Date(now).toISOString() });
  return { store, at: (ms) => (now = ms) };
}

test("the load part carries the 24h samples as load per core, used memory and free disk, oldest first", async () => {
  const { store, at } = storeAt();
  at(NOW - 25 * H);
  store.recordLoadSample({ load5: 9, cpus: 8 });
  at(NOW - 10 * M);
  store.recordLoadSample({ load5: 4, cpus: 8, memFreePct: 30, diskFreeGb: 120 });
  at(NOW - 5 * M);
  store.recordLoadSample({ load5: 2, memFreePct: 41.5 });
  const p = await readResourcePart(deps(store), "load");
  assert.ok(p.part === "load" && p.history?.ok);
  const h = p.history.value;
  assert.equal(h.from, new Date(NOW - 24 * H).toISOString());
  assert.equal(h.to, new Date(NOW).toISOString());
  assert.equal(h.stepMs, 5 * M);
  assert.deepEqual(h.thresholds, DEFAULT_THRESHOLDS);
  assert.deepEqual(h.points, [
    { at: NOW - 10 * M, loadPerCpu: 0.5, memUsedPct: 70, diskFreeGb: 120 },
    { at: NOW - 5 * M, memUsedPct: 58.5 },
  ], "a 25-hour-old row is out of the window; load without a CPU count is no load per core");
});

test("the machine's own thresholds travel with the samples", async () => {
  const { store } = storeAt();
  const own: LoadThresholds = { loadPerCpu: [1, 1.5], memFreePct: [30, 15], diskFreeGb: [50, 25] };
  const p = await readResourcePart(deps(store, { thresholds: own }), "load");
  assert.ok(p.part === "load" && p.history?.ok);
  assert.deepEqual(p.history.value.thresholds, own);
  assert.deepEqual(p.history.value.points, [], "an empty store is no samples, not a failure");
});

test("a store read that fails is this card's unread, and the point read still comes", async () => {
  const { store } = storeAt();
  const p = await readResourcePart({ ...deps(store), samples: () => { throw new Error("database is locked"); } }, "load");
  assert.ok(p.part === "load");
  assert.ok(p.load.ok, "the gauges are read");
  assert.deepEqual(p.history, { ok: false, why: "database is locked" });
});

test("deps without a sample reader carry no history at all", async () => {
  const { store } = storeAt();
  const { samples: _, ...without } = deps(store);
  const p = await readResourcePart(without, "load");
  assert.ok(p.part === "load");
  assert.equal("history" in p, false);
});
