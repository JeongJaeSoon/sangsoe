import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MONITOR_CONFIG, type InboxMessage, type MonitorDeps, nullChatProvider, type OrcaAdapter, runMonitor, type WorktreePsAgent } from "../../core/index.ts";
import { createWorld } from "../decision/world.ts";

// Decision 245 (roadmap A5): a coordinator holding no Dispatch that stopped without an error. One
// orca-monitor round reads Orca only: the Run's mail (read flag, created_at), the coordinator's
// terminal (run-show, or the pane its own mail to its Dispatches came from) and that pane's agent
// row in `worktree ps` (state, stateStartedAt). It writes one run_stalled and sends one notice to
// the orchestrator's Run; later rounds of the same stall add nothing. No screen text is read.

const LEAD_RUN = "run_000000000001";
const ORCH_RUN = "run_000000000009";
const MIN = 60_000;
const T0 = Date.parse("2026-11-14T09:00:00Z");
const N = DEFAULT_MONITOR_CONFIG.stuckMinutes;
const iso = (ms: number) => new Date(ms).toISOString();
const LEAD_PANE = "tab_l:leaf_l";
const ORCH_PANE = "tab_o:leaf_o";

type Coord = { run: string; handle: string; pane: string; shown: string; state: string; since: number };

function setup(coords: Coord[], o: { dispatchTerminals?: string[]; showFails?: string[]; hiddenPanes?: string[] } = {}) {
  const w = createWorld([]);
  const mail: InboxMessage[] = [];
  const notices = () =>
    w.store.events({ type: "notified" }).map((e, i) => ({
      id: String(e.payload.msg_id),
      type: "status",
      from: "sangsoe",
      to: String(e.payload.to),
      subject: "notice",
      handled: false,
      createdAt: iso(sentAt[i] ?? T0),
      runId: String(e.payload.to).slice("run:".length),
    }));
  const sentAt: number[] = [];
  let clock = T0;
  const ok = <T>(value: T) => ({ ok: true as const, value });
  const rows = <T>(r: T[]) => ok({ rows: r, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false });
  const orca = {
    ...w.orca,
    send: (...a: Parameters<OrcaAdapter["send"]>) => {
      sentAt.push(clock);
      return w.orca.send(...a);
    },
    inbox: async () => ok([...mail, ...notices()]),
    runShow: async (a: { id: string }) =>
      o.showFails?.includes(a.id)
        ? { ok: false as const, error: { code: "x", message: "run-show failed" } }
        : ok({ runId: a.id, objective: a.id, coordinatorHandle: coords.find((c) => c.run === a.id)?.shown }),
    terminalList: async () =>
      rows(coords.map((c) => ({ handle: c.handle, worktreeId: `w_${c.run}`, executionHostId: "local", agentIdentity: "claude", tabId: c.pane.split(":")[0], leafId: c.pane.split(":")[1] }))),
    worktreePs: async () =>
      rows(
        coords.filter((c) => !o.hiddenPanes?.includes(c.pane)).map((c) => ({
          worktreeId: `w_${c.run}`,
          hostId: "local",
          repo: "api",
          path: `/w/${c.run}`,
          branch: "b",
          isMainWorktree: false,
          isArchived: false,
          liveTerminalCount: 1,
          unverifiableTerminalCount: 0,
          status: c.state,
          agents: [{ paneKey: c.pane, state: c.state, agentType: "claude", agentWait: null, stateStartedAt: c.since } satisfies WorktreePsAgent],
        })),
      ),
    workerList: async () =>
      rows((o.dispatchTerminals ?? []).map((t, i) => ({ dispatchId: `ctx_${i}`, taskId: `task_${i}`, state: "ready", liveness: "live", terminal: t, host: "local" }))),
    workerShow: async () => ({ ok: false as const, error: { code: "x", message: "not read here" } }),
  } as unknown as OrcaAdapter;
  const deps = (now: number): MonitorDeps => {
    clock = now;
    return {
      orca,
      exec: async () => ({ code: null, stdout: "", stderr: "", failure: "spawn" }),
      events: (f) => w.store.events(f),
      append: (e) => w.store.append(e),
      core: { store: w.store, orca },
      now: () => now,
      config: DEFAULT_MONITOR_CONFIG,
      chat: nullChatProvider,
      sample: () => ({ cpus: 8 }),
    };
  };
  const send = (to: string, ms: number, more: Partial<InboxMessage> = {}) =>
    mail.push({ id: `msg_in_${mail.length}`, type: "worker_done", from: "term_worker", to, subject: "done", handled: false, createdAt: iso(ms), ...more });
  const stalled = () => w.store.events({ type: "run_stalled" });
  return { w, mail, deps, send, stalled };
}

// The lead's Run keeps a stale coordinator handle in run-show; its own mail to a Dispatch names its
// live pane. Its read report to the orchestrator puts the orchestrator's Run on the page.
const lead = (state = "done", since = T0): Coord => ({ run: LEAD_RUN, handle: "term_lead", pane: LEAD_PANE, shown: "term_gone", state, since });
const orch = (state = "done", since = T0): Coord => ({ run: ORCH_RUN, handle: "term_orch", pane: ORCH_PANE, shown: "term_orch", state, since });
const leadSpoke = (s: ReturnType<typeof setup>) => {
  s.send("dispatch:ctx_w", T0 - 5 * MIN, { from: "term_lead", runId: LEAD_RUN, senderPane: LEAD_PANE, handled: true });
  s.send(`run:${ORCH_RUN}`, T0 - 4 * MIN, { from: "term_lead", runId: ORCH_RUN, senderPane: LEAD_PANE, handled: true });
};

test("a lead that stopped: one run_stalled and one notice to the orchestrator's Run, across rounds", async () => {
  const s = setup([lead(), orch("working", T0)]);
  leadSpoke(s);
  s.send(`run:${LEAD_RUN}`, T0 + 2 * MIN);

  const quiet = await runMonitor("orca", s.deps(T0 + (N + 1) * MIN));
  assert.equal(s.stalled().length, 0, "mail younger than N is not a stall");
  assert.deepEqual(quiet.acts, []);

  const first = await runMonitor("orca", s.deps(T0 + (N + 3) * MIN));
  assert.deepEqual(s.stalled().map((e) => e.payload), [{ run: LEAD_RUN, coordinator: "term_lead" }]);
  assert.deepEqual(
    s.w.sends.map((m) => [m.to, m.type, m.body.split("\n")[0]]),
    [[`run:${ORCH_RUN}`, "status", `run:${LEAD_RUN} coordinator term_lead stalled.`]],
    first.acts.map((a) => `${a.what}: ${a.detail}`).join("\n"),
  );

  s.send(`run:${LEAD_RUN}`, T0 + (N + 4) * MIN);
  await runMonitor("orca", s.deps(T0 + (2 * N + 10) * MIN));
  await runMonitor("orca", s.deps(T0 + (2 * N + 11) * MIN));
  assert.equal(s.stalled().length, 1, "exactly one run_stalled per stall");
  assert.equal(s.w.sends.length, 1, "exactly one notice per stall");
});

test("a lead that takes a turn after the mail, is working, or reads its mail is not stalled", async () => {
  for (const [c, handled] of [
    [lead("done", T0 + 3 * MIN), false],
    [lead("working", T0), false],
    [lead(), true],
  ] as const) {
    const s = setup([c, orch()]);
    leadSpoke(s);
    s.send(`run:${LEAD_RUN}`, T0 + 2 * MIN, { handled });
    await runMonitor("orca", s.deps(T0 + (N + 10) * MIN));
    assert.equal(s.stalled().length, 0, JSON.stringify(c));
    assert.equal(s.w.sends.length, 0);
  }
});

test("a lead holding a Dispatch is left to Orca's stop mail", async () => {
  const s = setup([lead(), orch()], { dispatchTerminals: ["term_lead"] });
  leadSpoke(s);
  s.send(`run:${LEAD_RUN}`, T0 + 2 * MIN);
  await runMonitor("orca", s.deps(T0 + (N + 10) * MIN));
  assert.equal(s.stalled().length, 0);
});

test("a stalled orchestrator is told in its own Run once; its own unread notice, past the wake check, adds nothing", async () => {
  const s = setup([orch()]);
  s.send(`run:${ORCH_RUN}`, T0 + MIN);
  await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  assert.deepEqual(s.w.sends.map((m) => m.to), [`run:${ORCH_RUN}`]);
  await runMonitor("orca", s.deps(T0 + (N + 2 + DEFAULT_MONITOR_CONFIG.wakeMinutes + 1) * MIN));
  await runMonitor("orca", s.deps(T0 + (3 * N + 5) * MIN));
  assert.equal(s.stalled().length, 1);
  assert.equal(s.w.sends.length, 1);
});

test("with two other tops the row is written and no notice goes out", async () => {
  const other: Coord = { run: "run_000000000005", handle: "term_x", pane: "tab_x:leaf_x", shown: "term_x", state: "working", since: T0 };
  const s = setup([lead(), orch("working"), other]);
  leadSpoke(s);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  s.send(`run:${other.run}`, T0 + MIN, { handled: true });
  const r = await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  assert.equal(s.stalled().length, 1);
  assert.equal(s.w.sends.length, 0);
  assert.ok(r.unseen.some((u) => u.includes(LEAD_RUN)), r.unseen.join("\n"));
});

test("an orchestrator Run whose run-show fails or whose live terminal has no pane leaves the lead's stall unnoticed, never told to itself", async () => {
  for (const o of [{ showFails: [ORCH_RUN] }, { hiddenPanes: [ORCH_PANE] }]) {
    const s = setup([lead(), orch()], o);
    leadSpoke(s);
    s.send(`run:${LEAD_RUN}`, T0 + MIN);
    const r = await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
    assert.equal(s.stalled().length, 1, JSON.stringify(o));
    assert.deepEqual(s.w.sends, [], JSON.stringify(o));
    assert.ok(r.unseen.some((u) => u.includes(LEAD_RUN)), r.unseen.join("\n"));
  }
});

test("an orchestrator resumed in a new terminal (run-show names the dead one) leaves the stalled lead untold, never told to itself", async () => {
  const s = setup([lead(), { ...orch(), shown: "term_old" }]);
  leadSpoke(s);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  const r = await runMonitor("orca", s.deps(T0 + (N + 2) * MIN));
  assert.equal(s.stalled().length, 1);
  assert.deepEqual(s.w.sends, []);
  assert.ok(r.unseen.some((u) => u.includes(LEAD_RUN)), r.unseen.join("\n"));
});

test("a dry run judges but sends nothing", async () => {
  const s = setup([lead(), orch()]);
  leadSpoke(s);
  s.send(`run:${LEAD_RUN}`, T0 + MIN);
  const { append: _a, core: _c, ...dry } = s.deps(T0 + (N + 2) * MIN);
  const r = await runMonitor("orca", dry);
  assert.equal(r.planned.filter((e) => e.type === "run_stalled").length, 1);
  assert.equal(s.stalled().length, 0);
  assert.equal(s.w.sends.length, 0);
});
