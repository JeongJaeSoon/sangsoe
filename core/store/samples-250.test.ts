// Decision 250: the panel's load card reads decision 241's samples back; the read writes nothing.
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { scratchDir } from "../../test/scratch.ts";
import { SAMPLE_RETENTION_MS } from "./samples.ts";
import { Store } from "./store.ts";

const T0 = Date.parse("2026-11-14T00:00:00.000Z");
const M = 60_000;

function open() {
  let now = T0;
  const path = join(scratchDir("sangsoe-samples250-"), "s.db");
  const store = Store.open({ path, clock: () => new Date(now).toISOString(), fsProbe: () => "apfs" });
  return { path, store, set: (ms: number) => (now = ms) };
}

test("loadSamples returns the rows after `since` in time order, a null column left out", () => {
  const { store, set } = open();
  set(T0 + 10 * M);
  store.recordLoadSample({ load5: 3, cpus: 8, memFreePct: 40, diskFreeGb: 100 });
  set(T0);
  store.recordLoadSample({ load5: 1, cpus: 8 });
  set(T0 + 5 * M);
  store.recordLoadSample({ memFreePct: 50 });
  assert.deepEqual(store.loadSamples(T0), [
    { at: T0 + 5 * M, memFreePct: 50 },
    { at: T0 + 10 * M, load5: 3, cpus: 8, memFreePct: 40, diskFreeGb: 100 },
  ]);
  assert.equal(store.loadSamples(T0 - 1).length, 3, "since is exclusive");
  store.close();
});

test("loadSamples writes nothing: no row added or pruned, even past the retention", () => {
  const { path, store, set } = open();
  store.recordLoadSample({ load5: 1 });
  set(T0 + 2 * SAMPLE_RETENTION_MS);
  assert.equal(store.loadSamples(0).length, 1);
  store.close();
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal((raw.prepare("SELECT count(*) AS n FROM load_sample").get() as { n: number }).n, 1);
  } finally {
    raw.close();
  }
});

test("an empty table reads as no samples", () => {
  const { store } = open();
  assert.deepEqual(store.loadSamples(0), []);
  store.close();
});
