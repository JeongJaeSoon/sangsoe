import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import type { StoredEvent } from "../contract/index.ts";
import type { Exec } from "../contract/orca.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { Store } from "../store/store.ts";
import { type ChatProvider, nullChatProvider } from "./chat/provider.ts";
import { DEFAULT_MONITOR_CONFIG as C, type MonitorDeps } from "./monitor.ts";
import { judgeResource, type ResourceReads, withDiagnostics } from "./resource/judge.ts";
import { runMonitor } from "./run.ts";

const ev = (seq: number, type: string, payload: unknown = {}): StoredEvent =>
  ({ seq, ts: "2026-11-10T00:00:00.000Z", type, source: "t", payload }) as unknown as StoredEvent;
const reads = (p: Partial<ResourceReads>): ResourceReads => ({
  sample: { load5: 1, cpus: 8, diskFreeGb: 500 },
  diagnostics: { host: { availableMemory: 40, totalMemory: 100 } },
  liveWorkers: 3,
  lastEpisode: null,
  docker: [],
  resources: [],
  ...p,
});
const types = (r: { planned: { type: string }[] }) => r.planned.map((e) => e.type);

test("macOS memory comes from diagnostics memory's availableMemory, and only fills a missing field", () => {
  assert.equal(withDiagnostics({ cpus: 8 }, { host: { availableMemory: 25, totalMemory: 100 } }).memFreePct, 25);
  assert.equal(withDiagnostics({ memFreePct: 60 }, { host: { availableMemory: 5, totalMemory: 100 } }).memFreePct, 60);
  assert.equal(withDiagnostics({}, null).memFreePct, undefined, "unreadable diagnostics leave memory unmeasured");
});

test("pressure_high once per episode through judgeLoad, capacity_free when it ends", () => {
  const loaded = reads({ sample: { load5: 20, cpus: 8 } });
  const first = judgeResource(loaded, C);
  assert.deepEqual(types(first), ["pressure_high"]);
  assert.equal(first.planned[0]?.dedupe_key, "pressure_high:0");
  assert.deepEqual(types(judgeResource({ ...loaded, lastEpisode: ev(7, "pressure_high") }, C)), [], "same episode, no repeat");
  const freed = judgeResource(reads({ lastEpisode: ev(7, "pressure_high") }), C);
  assert.deepEqual(freed.planned.map((e) => [e.type, e.payload, e.dedupe_key]), [["capacity_free", { slots: 5 }, "capacity_free:7"]]);
  assert.deepEqual(types(judgeResource(reads({ lastEpisode: ev(8, "capacity_free") }), C)), [], "already free");
  const lowMem = judgeResource(reads({ sample: { cpus: 8 }, diagnostics: { host: { availableMemory: 5, totalMemory: 100 } } }), C);
  assert.deepEqual(types(lowMem), ["pressure_high"], "memory from diagnostics reaches the same judgment");
});

test("resource_leak only for Docker objects with no live resource record; no docker is zero action", () => {
  const resources = [
    ev(1, "resource", { action: "created", kind: "container", owner: "x", ref: "abc123" }),
    ev(2, "resource", { action: "created", kind: "volume", owner: "x", ref: "vol_gone" }),
    ev(3, "resource", { action: "released", kind: "volume", owner: "x", ref: "vol_gone" }),
    ev(4, "resource", { action: "created", kind: "volume", owner: "x", ref: "api" }),
    ev(5, "resource_adopted", { kind: "volume", ref: "acme_db", basis: "working_dir" }),
  ];
  const docker = [
    { kind: "container" as const, id: "abc123def456" },
    { kind: "volume" as const, id: "vol_gone" },
    { kind: "volume" as const, id: "vol_new" },
    { kind: "volume" as const, id: "api_cache" },
    { kind: "volume" as const, id: "acme_db" },
  ];
  const r = judgeResource(reads({ docker, resources }), C);
  assert.deepEqual(r.planned.map((e) => e.dedupe_key), [
    "resource_leak:volume:vol_gone",
    "resource_leak:volume:vol_new",
    "resource_leak:volume:api_cache",
  ]);
  const none = judgeResource(reads({ docker: null }), C);
  assert.deepEqual(types(none), []);
  assert.ok(none.unseen.includes("docker"));
});

const noDocker: Exec = async () => ({ code: null, stdout: "", stderr: "not found", failure: "spawn" });

function deps(store: Store, over: Partial<MonitorDeps> = {}): MonitorDeps {
  return {
    orca: createOrcaAdapter(createFakeOrca().exec),
    exec: noDocker,
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    now: () => Date.parse("2026-11-10T12:00:00Z"),
    config: C,
    chat: nullChatProvider,
    sample: () => ({ load5: 40, cpus: 4 }),
    ...over,
  };
}

test("a round writes through the store once; a dry run and an aborted round write nothing", async () => {
  const store = Store.open({ path: ":memory:" });
  try {
    const { append: _, ...readOnly } = deps(store);
    const dry = await runMonitor("resource", readOnly);
    assert.deepEqual(types(dry), ["pressure_high"]);
    assert.deepEqual(dry.written, []);
    assert.equal(store.events({ type: "pressure_high" }).length, 0);

    const ctl = new AbortController();
    ctl.abort();
    const late = await runMonitor("resource", deps(store), ctl.signal);
    assert.equal(late.aborted, true);
    assert.deepEqual(late.written, []);

    const real = await runMonitor("resource", deps(store));
    assert.deepEqual(real.written.map((w) => [w.type, w.inserted]), [["pressure_high", true]]);
    const again = await runMonitor("resource", deps(store));
    assert.deepEqual(again.planned, [], "the stored episode stops a second pressure_high");
  } finally {
    store.close();
  }
});

test("chat-monitor: the null provider yields no mention_new; a provider's repeats land once", async () => {
  const store = Store.open({ path: ":memory:" });
  try {
    assert.deepEqual((await runMonitor("chat", deps(store))).planned, []);
    const chat: ChatProvider = { name: "fake", mentions: async () => [{ url: "https://chat.example/acme/1" }, { url: "https://chat.example/acme/1" }] };
    await runMonitor("chat", deps(store, { chat }));
    await runMonitor("chat", deps(store, { chat }));
    assert.equal(store.events({ type: "mention_new" }).length, 1);
  } finally {
    store.close();
  }
});

test("orca-monitor round over the recorded fake Orca reads without consuming mail and writes nothing odd", async () => {
  const store = Store.open({ path: ":memory:" });
  const calls: string[] = [];
  const fake = createFakeOrca();
  const exec: Exec = (file, args) => {
    calls.push(args.slice(0, 2).join(" "));
    return fake.exec(file, args);
  };
  try {
    const r = await runMonitor("orca", deps(store, { orca: createOrcaAdapter(exec) }));
    // The recording shows 2 of 9 Dispatches and answers every cursor, --run included, with the
    // same page: paging stops on the repeated cursor, so the Run's membership stays unknown.
    assert.deepEqual(r.unseen, ["worker-list truncated", "worker-list --run run_000000000001 truncated"]);
    assert.equal(calls.filter((c) => c === "orchestration worker-list").length, 4);
    assert.ok(!r.planned.some((e) => e.type === "run_stalled"));
    const reads = ["worktree ps", "orchestration worker-list", "orchestration worker-show", "orchestration gate-list", "orchestration inbox"];
    assert.deepEqual([...new Set(calls)].sort(), [...reads].sort(), "only the read verbs, mail read through inbox");
  } finally {
    store.close();
  }
});

test("orca-monitor pages a Run's own list to the end and judges it, whatever the global list's length", async () => {
  const store = Store.open({ path: ":memory:" });
  const base = createOrcaAdapter(createFakeOrca().exec);
  const now = Date.parse("2026-11-10T12:00:00Z");
  const w = (n: string, liveness = "gone") => ({ dispatchId: `ctx_${n}`, taskId: `task_${n}`, state: "ready", liveness, host: "local" });
  const page = (rs: ReturnType<typeof w>[], nextCursor?: string) => ({
    ok: true as const,
    value: { rows: rs, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: nextCursor !== undefined, ...(nextCursor ? { nextCursor } : {}) },
  });
  const asked: string[] = [];
  const orca = {
    ...base,
    workerList: async (a: { run?: string; cursor?: string }) => {
      asked.push(`${a.run ?? "all"}:${a.cursor ?? "-"}`);
      // The global list never ends (long history); run_a's members are split over two pages.
      if (!a.run) return page([w("1")], `g${asked.length}`);
      return a.cursor ? page([w("2")]) : page([w("1")], "r2");
    },
    workerShow: async (a: { dispatch: string }) => ({ ok: true as const, value: { dispatchId: a.dispatch, taskId: "t", runId: "run_a", state: "ready" } }),
    gateList: async () => ({ ok: true as const, value: [] }),
  } as typeof base;
  try {
    const r = await runMonitor("orca", deps(store, { orca, now: () => now }));
    assert.deepEqual(asked, ["all:-", "all:g1", "all:g2", "run_a:-", "run_a:r2"], "three global pages, then run_a to its end");
    assert.deepEqual(
      r.planned.map((e) => e.dedupe_key),
      ["worker_dead:ctx_1", "worker_dead:ctx_2", "run_stalled:run_a:dead-ctx_1%2Cctx_2"],
    );
    assert.ok(r.unseen.includes("worker-list truncated"));
  } finally {
    store.close();
  }
});
