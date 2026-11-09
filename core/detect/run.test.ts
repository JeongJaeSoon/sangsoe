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
  ];
  const docker = [
    { kind: "container" as const, id: "abc123def456" },
    { kind: "volume" as const, id: "vol_gone" },
    { kind: "volume" as const, id: "vol_new" },
  ];
  const r = judgeResource(reads({ docker, resources }), C);
  assert.deepEqual(r.planned.map((e) => e.dedupe_key), ["resource_leak:volume:vol_gone", "resource_leak:volume:vol_new"]);
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
    assert.deepEqual(r.unseen, []);
    const reads = ["worktree ps", "orchestration worker-list", "orchestration worker-show", "orchestration gate-list", "orchestration inbox"];
    assert.deepEqual([...new Set(calls)].sort(), [...reads].sort(), "only the read verbs, mail read through inbox");
  } finally {
    store.close();
  }
});
