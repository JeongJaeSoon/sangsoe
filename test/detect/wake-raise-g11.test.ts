import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MONITOR_CONFIG, type MonitorDeps, notify, nullChatProvider, type OrcaAdapter, runMonitor, type Store } from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";

// G11 (decision 212 ②): an unread wake goes one tier up the receiving order (design N3), as a
// `status` message, once per tier; the orchestrator, top of the order, gets the row only.

const RUN = "run_000000000001";
const ORCH_RUN = "run_000000000009";
const T1 = "task_000000000001";
const D1 = "ctx_000000000001";
const MIN = 60_000;

function deps(store: Store, orca: OrcaAdapter, now: number): MonitorDeps {
  return {
    orca,
    exec: async () => ({ code: null, stdout: "", stderr: "", failure: "spawn" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    core: { store, orca },
    now: () => now,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
  };
}

/** The world's Orca with an inbox where every message sent so far is still unhandled. */
function unread(w: ReturnType<typeof createWorld>, handled: Set<string> = new Set()): OrcaAdapter {
  return {
    ...w.orca,
    worktreePs: async () => ({ ok: false, error: { code: "x", message: "not read here" } }),
    inbox: async () => ({
      ok: true,
      value: w.store.events({ type: "notified" }).map((e) => {
        const id = String(e.payload.msg_id);
        return { id, type: "status", from: "sangsoe", to: String(e.payload.to), subject: "s", handled: handled.has(id) };
      }),
    }),
    workerShow: async (a: { dispatch: string }) =>
      a.dispatch === D1 ? { ok: true, value: { dispatchId: D1, taskId: T1, runId: RUN, state: "ready" } } : w.orca.workerShow(a),
  } as OrcaAdapter;
}

const later = () => Date.now() + (DEFAULT_MONITOR_CONFIG.wakeMinutes + 1) * MIN;

test("an unread wake to a worker goes to its lead, then to the orchestrator, then nowhere", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }], { above: { [RUN]: ORCH_RUN } });
  const sent = await notify(w, { key: { target: T1, dedupe_key: `notify:${T1}:ping` }, to: "worker", chain: { dispatch: D1, leadRun: RUN }, subject: "ping", body: "b" });
  assert.ok(sent.ok, JSON.stringify(sent));
  assert.deepEqual(w.sends.map((s) => s.to), [`dispatch:${D1}`]);

  const first = await runMonitor("orca", deps(w.store, unread(w), later()));
  assert.ok(first.planned.some((e) => e.type === "wake_unconfirmed"), JSON.stringify(first.planned));
  assert.deepEqual(w.sends.slice(1).map((s) => [s.to, s.type]), [[`run:${RUN}`, "status"]], first.acts.map((a) => `${a.what}: ${a.detail}`).join("\n"));

  // Round two: the worker's message and the lead's raise are both unread; the lead's goes up once.
  await runMonitor("orca", deps(w.store, unread(w), later() + MIN));
  assert.deepEqual(w.sends.slice(1).map((s) => s.to), [`run:${RUN}`, `run:${ORCH_RUN}`]);

  // Round three: everything still unread, but each tier was told once and the orchestrator is the top.
  const third = await runMonitor("orca", deps(w.store, unread(w), later() + 2 * MIN));
  assert.equal(w.sends.length, 3, "no tier is woken twice");
  assert.deepEqual(third.acts, [], "nothing left to raise");
});

test("a read wake is not raised", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }], { above: { [RUN]: ORCH_RUN } });
  await notify(w, { key: { target: T1, dedupe_key: `notify:${T1}:ping` }, to: "lead", chain: { leadRun: RUN }, subject: "ping", body: "b" });
  const msg = String(w.store.events({ type: "notified" })[0]?.payload.msg_id);
  await runMonitor("orca", deps(w.store, unread(w, new Set([msg])), later()));
  assert.equal(w.sends.length, 1);
});
