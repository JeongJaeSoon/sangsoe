import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createFakeOrca } from "../../../test/fake-orca/index.ts";
import { scratchDir } from "../../../test/scratch.ts";
import type { Exec } from "../../contract/orca.ts";
import type { LoadSample } from "../../capacity/capacity.ts";
import { createOrcaAdapter } from "../../orca/adapter.ts";
import { Store } from "../../store/store.ts";
import { nullChatProvider } from "../chat/provider.ts";
import { DEFAULT_MONITOR_CONFIG as C, type MonitorDeps, minutes } from "../monitor.ts";
import { runMonitor } from "../run.ts";

const tmp = scratchDir("sangsoe-resource-round-");
const T0 = Date.parse("2026-11-14T00:00:00.000Z");
const noDocker: Exec = async () => ({ code: null, stdout: "", stderr: "not found", failure: "spawn" });
let n = 0;

/** A file store and round deps on one fake clock; `sampling` false runs the same round with no store for samples. */
function rig(sampling: boolean) {
  let now = T0;
  let sample: LoadSample = {};
  const path = join(tmp, `r${n++}.db`);
  const store = Store.open({ path, clock: () => new Date(now).toISOString(), fsProbe: () => "apfs" });
  const orca = createOrcaAdapter(createFakeOrca().exec);
  const deps: MonitorDeps = {
    orca,
    exec: noDocker,
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => now,
    config: C,
    chat: nullChatProvider,
    sample: () => sample,
    ...(sampling ? { core: { store, orca } } : {}),
  };
  const count = () => {
    const raw = new DatabaseSync(path, { readOnly: true });
    try {
      return raw.prepare("SELECT count(*) AS n, min(at) AS oldest FROM load_sample").get() as { n: number; oldest: number | null };
    } finally {
      raw.close();
    }
  };
  return { store, deps, count, at: (ms: number) => (now = ms), feed: (s: LoadSample) => (sample = s) };
}

const episodes = (store: Store) =>
  [...store.events({ type: "pressure_high" }), ...store.events({ type: "capacity_free" })]
    .sort((a, b) => a.seq - b.seq)
    .map((e) => [e.type, e.dedupe_key, e.payload]);

test("25h of 5-minute rounds: one sample per round, never more than 288, and the same episodes as without samples", async () => {
  const on = rig(true);
  const off = rig(false);
  const rounds = (25 * 60) / 5;
  for (let i = 0; i < rounds; i++) {
    const t = T0 + i * minutes(5);
    // Loaded for an hour, then calm for an hour: a few pressure_high / capacity_free episodes.
    const s: LoadSample = { load5: Math.floor(i / 12) % 2 === 0 ? 40 : 1, cpus: 4, memFreePct: 50, diskFreeGb: 500 };
    for (const r of [on, off]) {
      r.at(t);
      r.feed(s);
      await runMonitor("resource", r.deps);
    }
    const { n: rows, oldest } = on.count();
    assert.equal(rows, Math.min(i + 1, 288), `round ${i}`);
    assert.ok(oldest !== null && oldest > t - 24 * 60 * 60_000, `round ${i}: nothing 24h old is kept`);
  }
  assert.ok(episodes(on.store).length > 2, "the run crossed several episodes");
  assert.deepEqual(episodes(on.store), episodes(off.store));
  on.store.close();
  off.store.close();
});

test("the stored sample is the one judgeLoad saw: macOS memory filled from diagnostics memory", async () => {
  const r = rig(true);
  r.feed({ load5: 1, cpus: 4 });
  const diagnosticsMemory = async () => ({ ok: true as const, value: { host: { availableMemory: 30, totalMemory: 120 } } });
  const report = await runMonitor("resource", { ...r.deps, orca: { ...r.deps.orca, diagnosticsMemory } });
  assert.ok(!report.unseen.includes("diagnostics memory"));
  r.store.close();
  const raw = new DatabaseSync(join(tmp, `r${n - 1}.db`), { readOnly: true });
  const row = raw.prepare("SELECT load5, cpus, mem_free_pct, disk_free_gb FROM load_sample").get();
  raw.close();
  assert.deepEqual({ ...row }, { load5: 1, cpus: 4, mem_free_pct: 25, disk_free_gb: null });
});

test("a dry run and an aborted round store no sample", async () => {
  const r = rig(true);
  const { append: _a, core: _c, ...dry } = r.deps;
  await runMonitor("resource", dry);
  const ctl = new AbortController();
  ctl.abort();
  await runMonitor("resource", r.deps, ctl.signal);
  assert.equal(r.count().n, 0);
  r.store.close();
});

test("a failed sample write is named in unseen and leaves the planned events as they were", async () => {
  const r = rig(true);
  r.feed({ load5: 40, cpus: 4 });
  const broken = Object.create(r.store) as Store;
  broken.recordLoadSample = () => {
    throw new Error("disk full");
  };
  const report = await runMonitor("resource", { ...r.deps, core: { store: broken, orca: r.deps.orca } });
  assert.deepEqual(report.planned.map((e) => e.type), ["pressure_high"]);
  assert.deepEqual(report.written.map((w) => [w.type, w.inserted]), [["pressure_high", true]]);
  assert.ok(report.unseen.some((u) => u.startsWith("load sample not stored")), report.unseen.join(", "));
  assert.equal(r.count().n, 0);
  r.store.close();
});
