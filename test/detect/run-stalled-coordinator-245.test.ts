import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MONITOR_CONFIG, type InboxMessage, type MonitorDeps, nullChatProvider, type OrcaAdapter, runMonitor, Store } from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";

// Decision 245 (roadmap A5): a coordinator holding no Dispatch that stopped without an error. One
// orca-monitor round reads its Run's mail (Orca's read flag and created_at) and the store's
// session_started and turn_ended rows, writes one run_stalled and sends one notice to the
// orchestrator's Run; later rounds of the same stall add nothing. No screen text is read.

const LEAD_RUN = "run_000000000001";
const ORCH_RUN = "run_000000000009";
const MIN = 60_000;
const T0 = Date.parse("2026-11-14T09:00:00Z");
const N = DEFAULT_MONITOR_CONFIG.stuckMinutes;
const iso = (ms: number) => new Date(ms).toISOString();

function setup() {
  const w = createWorld([]);
  let clock = T0;
  const store = Store.open({ path: ":memory:", clock: () => iso(clock) });
  const mail: InboxMessage[] = [];
  const orca = {
    ...w.orca,
    worktreePs: async () => ({ ok: false, error: { code: "x", message: "not read here" } }),
    inbox: async () => ({ ok: true, value: mail }),
  } as OrcaAdapter;
  const at = (ms: number) => {
    clock = ms;
  };
  const deps = (now: number): MonitorDeps => ({
    orca,
    exec: async () => ({ code: null, stdout: "", stderr: "", failure: "spawn" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    core: { store, orca },
    now: () => now,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
  });
  const start = (session: string, role: "orchestrator" | "lead", run: string) =>
    store.append({ type: "session_started", source: "SessionStart", target: `run:${run}`, dedupe_key: `session_started:${session}:startup`, payload: { session, role, model: "m" } });
  const turn = (session: string, n: number) =>
    store.append({ type: "turn_ended", source: "Stop", dedupe_key: `turn_ended:${session}:p${n}`, payload: { session } });
  const send = (to: string, ms: number, handled = false) => mail.push({ id: `msg_in_${mail.length}`, type: "worker_done", from: "dispatch:ctx_000000000001", to, subject: "done", handled, createdAt: iso(ms) });
  const stalled = () => store.events({ type: "run_stalled" });
  return { w, store, mail, at, deps, start, turn, send, stalled };
}

test("a lead that stopped: one run_stalled and one notice to the orchestrator's Run, across rounds", async () => {
  const s = setup();
  s.start("s_orch", "orchestrator", ORCH_RUN);
  s.start("s_lead", "lead", LEAD_RUN);
  s.at(T0 + MIN);
  s.turn("s_lead", 1);
  s.send(`run:${LEAD_RUN}`, T0 + 2 * MIN);

  const quiet = await runMonitor("orca", s.deps(T0 + (N + 1) * MIN));
  assert.equal(s.stalled().length, 0, "mail younger than N is not a stall");
  assert.deepEqual(quiet.acts, []);

  const first = await runMonitor("orca", s.deps(T0 + (N + 3) * MIN));
  assert.deepEqual(s.stalled().map((e) => e.payload), [{ run: LEAD_RUN, session: "s_lead" }]);
  assert.deepEqual(
    s.w.sends.map((m) => [m.to, m.type]),
    [[`run:${ORCH_RUN}`, "status"]],
    first.acts.map((a) => `${a.what}: ${a.detail}`).join("\n"),
  );

  s.send(`run:${LEAD_RUN}`, T0 + (N + 4) * MIN);
  await runMonitor("orca", s.deps(T0 + (2 * N + 10) * MIN));
  await runMonitor("orca", s.deps(T0 + (2 * N + 11) * MIN));
  assert.equal(s.stalled().length, 1, "exactly one run_stalled per stall");
  assert.equal(s.w.sends.length, 1, "exactly one notice per stall");
});

test("a lead that takes a turn after the mail, or reads it, is not stalled", async () => {
  const turned = setup();
  turned.start("s_orch", "orchestrator", ORCH_RUN);
  turned.start("s_lead", "lead", LEAD_RUN);
  turned.send(`run:${LEAD_RUN}`, T0 + MIN);
  turned.at(T0 + 2 * MIN);
  turned.turn("s_lead", 1);
  await runMonitor("orca", turned.deps(T0 + (N + 10) * MIN));
  assert.equal(turned.stalled().length, 0);
  assert.equal(turned.w.sends.length, 0);

  const read = setup();
  read.start("s_orch", "orchestrator", ORCH_RUN);
  read.start("s_lead", "lead", LEAD_RUN);
  read.send(`run:${LEAD_RUN}`, T0 + MIN, true);
  await runMonitor("orca", read.deps(T0 + (N + 10) * MIN));
  assert.equal(read.stalled().length, 0);
  assert.equal(read.w.sends.length, 0);
});

test("the next turn ends the stall; a new stall after it is reported once more", async () => {
  const s = setup();
  s.start("s_orch", "orchestrator", ORCH_RUN);
  s.start("s_lead", "lead", LEAD_RUN);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  s.at(T0 + (N + 5) * MIN);
  s.turn("s_lead", 1);
  s.mail[0] = { ...(s.mail[0] as InboxMessage), handled: true };
  await runMonitor("orca", s.deps(T0 + (N + 6) * MIN));
  assert.equal(s.stalled().length, 1, "cleared by the turn, nothing new");
  s.send(`run:${LEAD_RUN}`, T0 + (N + 7) * MIN);
  await runMonitor("orca", s.deps(T0 + (2 * N + 8) * MIN));
  assert.equal(s.stalled().length, 2);
  assert.equal(s.w.sends.length, 2);
});

test("a stalled orchestrator is told in its own Run, once; its own unread notice is the same stall", async () => {
  const s = setup();
  s.start("s_orch", "orchestrator", ORCH_RUN);
  s.send(`run:${ORCH_RUN}`, T0 + MIN);
  await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  assert.deepEqual(s.w.sends.map((m) => m.to), [`run:${ORCH_RUN}`]);
  s.send(`run:${ORCH_RUN}`, T0 + (N + 2) * MIN);
  await runMonitor("orca", s.deps(T0 + (2 * N + 5) * MIN));
  assert.equal(s.stalled().length, 1);
  assert.equal(s.w.sends.length, 1);
});

test("with no orchestrator session on record the row is written and no notice goes out", async () => {
  const s = setup();
  s.start("s_lead", "lead", LEAD_RUN);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  const r = await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  assert.equal(s.stalled().length, 1);
  assert.equal(s.w.sends.length, 0);
  assert.ok(r.unseen.some((u) => u.includes(LEAD_RUN)), r.unseen.join("\n"));
});

test("a dry run judges but sends nothing", async () => {
  const s = setup();
  s.start("s_orch", "orchestrator", ORCH_RUN);
  s.start("s_lead", "lead", LEAD_RUN);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  const { append: _a, core: _c, ...dry } = s.deps(T0 + (N + 2) * MIN);
  const r = await runMonitor("orca", dry);
  assert.deepEqual(r.planned.filter((e) => e.type === "run_stalled").length, 1);
  assert.equal(s.stalled().length, 0);
  assert.equal(s.w.sends.length, 0);
});
