import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../../contract/index.ts";
import type { LocalRows, WorkerRow, WorkerShow, WorktreePsAgent, WorktreePsRow } from "../../contract/orca.ts";
import { DEFAULT_MONITOR_CONFIG as C, minutes } from "../monitor.ts";
import { judgeOrca, type OrcaReads, sessionActivity } from "./judge.ts";

const NOW = Date.parse("2026-11-10T12:00:00Z");
const ago = (m: number) => NOW - minutes(m);

const rows = <T>(r: T[]): LocalRows<T> => ({ rows: r, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false });
const agent = (a: Partial<WorktreePsAgent>): WorktreePsAgent => ({ paneKey: "p:t", state: "working", agentType: "claude", agentWait: null, ...a });
const ps = (id: string, p: Partial<WorktreePsRow>): WorktreePsRow => ({
  worktreeId: id,
  hostId: "local",
  repo: "api",
  path: `/w/${id}`,
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: 1,
  unverifiableTerminalCount: 0,
  status: "working",
  agents: [],
  ...p,
});
const worker = (n: string, p: Partial<WorkerRow> = {}): WorkerRow => ({
  dispatchId: `ctx_${n}`,
  taskId: `task_${n}`,
  state: "ready",
  liveness: "live",
  workspace: `ws_${n}`,
  host: "local",
  ...p,
});
const show = (n: string, run = "run_a"): WorkerShow => ({ dispatchId: `ctx_${n}`, taskId: `task_${n}`, runId: run, state: "ready" });
const ev = (type: string, payload: unknown, ts: number, target?: string): StoredEvent =>
  ({ seq: 1, ts: new Date(ts).toISOString(), type, source: "t", target: target ?? null, payload }) as unknown as StoredEvent;

function reads(p: Partial<OrcaReads>): OrcaReads {
  return { ps: rows([]), workers: rows([]), shows: {}, gates: {}, inbox: [], events: [], ...p };
}
const types = (r: { planned: { type: string }[] }) => r.planned.map((e) => e.type);

test("one_session_two_terminals: a quiet old tab does not make a working session stuck", () => {
  const row = ps("ws_1", {
    liveTerminalCount: 2,
    lastOutputAt: ago(1),
    agents: [agent({ paneKey: "old:tab", state: "done", stateStartedAt: ago(24 * 60) }), agent({ paneKey: "new:tab", stateStartedAt: ago(90) })],
  });
  const r = judgeOrca(reads({ ps: rows([row]), workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
  assert.deepEqual(types(r), []);
  // One terminal's own clock, judged alone, reads as 90 quiet minutes: only the session-wide view clears it.
  const { lastOutputAt: _, ...rest } = row;
  const oneTab: WorktreePsRow = { ...rest, agents: [agent({ stateStartedAt: ago(90) })] };
  assert.deepEqual(sessionActivity(oneTab, NOW), { kind: "active", lastAt: ago(90) });
  const alone = judgeOrca(reads({ ps: rows([oneTab]), workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
  assert.equal(types(alone)[0], "worker_stuck");
});

test("worker_stuck from ps time fields, keyed by the stall so it re-arms after new activity", () => {
  const quiet = ps("ws_1", { lastOutputAt: ago(45), agents: [agent({ stateStartedAt: ago(50) })] });
  const r = judgeOrca(reads({ ps: rows([quiet]), workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
  assert.deepEqual(types(r), ["worker_stuck", "run_stalled"]);
  assert.equal(r.planned[0]?.dedupe_key, `worker_stuck:ctx_1:${ago(45)}`);
  assert.equal(r.planned[0]?.entity_id, "ctx_1");
  const uiTouched = { ...quiet, lastActivityAt: ago(1) } as WorktreePsRow;
  const still = judgeOrca(reads({ ps: rows([uiTouched]), workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
  assert.equal(types(still)[0], "worker_stuck", "lastActivityAt is not activity evidence (P10)");
});

test("a missing or future time field, a waiting agent and a resting one are zero action", () => {
  const cases: [string, WorktreePsRow][] = [
    ["no time", ps("ws_1", { agents: [agent({})] })],
    ["future", ps("ws_1", { lastOutputAt: NOW + 60_000, agents: [agent({ stateStartedAt: ago(90) })] })],
    ["waiting", ps("ws_1", { lastOutputAt: ago(90), agents: [agent({ agentWait: { state: "waiting" } })] })],
    ["resting", ps("ws_1", { lastOutputAt: ago(90), agents: [agent({ state: "done" })] })],
  ];
  for (const [why, row] of cases) {
    const r = judgeOrca(reads({ ps: rows([row]), workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
    assert.deepEqual(types(r), [], why);
  }
  const blind = judgeOrca(reads({ ps: null, workers: rows([worker("1")]), shows: { ctx_1: show("1") } }), NOW, C);
  assert.deepEqual(types(blind), [], "worktree ps unreadable");
  assert.ok(blind.unseen.includes("worktree ps"));
});

test("worker_dead for an unfinished Dispatch whose terminal is gone; host_restart when many die in one round", () => {
  const one = judgeOrca(
    reads({
      workers: rows([
        worker("1", { liveness: "gone" }),
        worker("2", { state: "settled", liveness: "gone", terminalState: "released" }),
        worker("3", { liveness: "unverifiable" }),
      ]),
      shows: { ctx_1: show("1"), ctx_3: show("3") },
    }),
    NOW,
    C,
  );
  assert.deepEqual(one.planned.map((e) => [e.type, e.entity_id, (e.payload as { reason: string }).reason]), [["worker_dead", "ctx_1", "terminal_gone"]]);
  assert.ok(one.unseen.some((u) => u.startsWith("ctx_3")), "unverifiable liveness is not seen, not dead");
  const three = rows(["1", "2", "3"].map((n) => worker(n, { liveness: "gone" })));
  const many = judgeOrca(reads({ workers: three }), NOW, C);
  assert.deepEqual(new Set(many.planned.filter((e) => e.type === "worker_dead").map((e) => (e.payload as { reason: string }).reason)), new Set(["host_restart"]));
  // Two deaths already recorded rounds ago plus one new one are not "many at once".
  const old = ["1", "2"].map((n) => ({ ...ev("worker_dead", { reason: "terminal_gone" }, ago(300)), entity_id: `ctx_${n}` }) as StoredEvent);
  const later = judgeOrca(reads({ workers: three, events: old }), NOW, C);
  assert.deepEqual(later.planned.filter((e) => e.type === "worker_dead").map((e) => [e.entity_id, (e.payload as { reason: string }).reason]), [["ctx_3", "terminal_gone"]]);
});

test("a settled worker whose terminal lingers is never judged stuck", () => {
  const quiet = ps("ws_1", { lastOutputAt: ago(45), agents: [agent({})] });
  const r = judgeOrca(reads({ ps: rows([quiet]), workers: rows([worker("1", { state: "settled" })]) }), NOW, C);
  assert.deepEqual(types(r), []);
});

test("run_stalled only when every unfinished worker of the Run is dead or stuck, and every one was seen", () => {
  const quiet = ps("ws_1", { lastOutputAt: ago(45), agents: [agent({})] });
  const busy = ps("ws_2", { lastOutputAt: ago(1), agents: [agent({})] });
  const w = rows([worker("1"), worker("2")]);
  const shows = { ctx_1: show("1"), ctx_2: show("2") };
  assert.deepEqual(types(judgeOrca(reads({ ps: rows([quiet, busy]), workers: w, shows }), NOW, C)), ["worker_stuck"]);
  const blindSibling = rows([worker("1"), worker("2", { liveness: "unverifiable" })]);
  assert.deepEqual(types(judgeOrca(reads({ ps: rows([quiet]), workers: blindSibling, shows }), NOW, C)), ["worker_stuck"]);
  const noShow = judgeOrca(reads({ ps: rows([quiet, busy]), workers: w, shows: { ctx_1: show("1"), ctx_2: null } }), NOW, C);
  assert.deepEqual(types(noShow), ["worker_stuck"]);
  assert.ok(noShow.unseen.includes("worker-show ctx_2"));
  const cut = judgeOrca(reads({ ps: rows([quiet]), workers: { ...rows([worker("1")]), truncated: true }, shows: { ctx_1: show("1") } }), NOW, C);
  assert.deepEqual(types(cut), ["worker_stuck"]);
});

test("run_stalled of a Run whose workers all died re-arms when a new set dies", () => {
  const dead = (ns: string[]) => judgeOrca(reads({ workers: rows(ns.map((n) => worker(n, { liveness: "gone" }))), shows: Object.fromEntries(ns.map((n) => [`ctx_${n}`, show(n)])) }), NOW, C);
  const a = dead(["1"]).planned.find((e) => e.type === "run_stalled")?.dedupe_key;
  const b = dead(["2"]).planned.find((e) => e.type === "run_stalled")?.dedupe_key;
  assert.ok(a && b && a !== b);
});

test("decision_untracked for an open gate sangsoe did not open; waiting_decision for an old open one", () => {
  // The real writers: decision_opened has no gate; decision_joined ties the gate to the decision.
  const events = [
    ev("decision_opened", { decision: "d001", decision_key: "k" }, ago(60)),
    ev("decision_joined", { decision: "d001", waiter: "task_1", gate: "gate_t", run: "run_a" }, ago(60)),
  ];
  const gates = {
    run_a: [
      { id: "gate_t", taskId: "task_1", status: "pending" },
      { id: "gate_u", taskId: "task_2", status: "pending" },
      { id: "gate_done", taskId: "task_3", status: "resolved" },
    ],
  };
  const r = judgeOrca(reads({ gates, events }), NOW, C);
  assert.deepEqual(
    r.planned.map((e) => [e.type, e.dedupe_key]),
    [
      ["waiting_decision", "waiting_decision:d001"],
      ["decision_untracked", "decision_untracked:gate_u"],
    ],
  );
  const answered = [...events, ev("decision_answered", { decision: "d001" }, ago(5))];
  assert.deepEqual(types(judgeOrca(reads({ gates, events: answered }), NOW, C)), ["decision_untracked"]);
  // decision_open creates the gate before decision_joined lands: its `dNNN:` question marks it as sangsoe's.
  const racing = { run_a: [{ id: "gate_new", taskId: "task_1", status: "pending", question: "d001: which way?" }] };
  assert.deepEqual(types(judgeOrca(reads({ gates: racing, events: [events[0] as StoredEvent] }), NOW, C)), ["waiting_decision"]);
});

test("wake_unconfirmed reads handled state from inbox and never consumes it; unseen messages are zero action", () => {
  const events = [
    ev("notified", { msg_id: "msg_old", to: "dispatch:ctx_1", msg_type: "decision" }, ago(30), "ctx_1"),
    ev("notified", { msg_id: "msg_read", to: "dispatch:ctx_1", msg_type: "decision" }, ago(30), "ctx_1"),
    ev("notified", { msg_id: "msg_new", to: "dispatch:ctx_1", msg_type: "decision" }, ago(2), "ctx_1"),
    ev("notified", { msg_id: "msg_gone", to: "dispatch:ctx_1", msg_type: "decision" }, ago(30), "ctx_1"),
  ];
  const m = (id: string, handled: boolean) => ({ id, type: "decision", from: "a", to: "b", subject: "s", handled });
  const r = judgeOrca(reads({ events, inbox: [m("msg_old", false), m("msg_read", true), m("msg_new", false)] }), NOW, C);
  assert.deepEqual(r.planned.map((e) => e.dedupe_key), ["wake_unconfirmed:msg_old"]);
  assert.deepEqual(types(judgeOrca(reads({ events, inbox: null }), NOW, C)), []);
});
