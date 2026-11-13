import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MONITOR_CONFIG, judgeOrca, type LocalRows, type OrcaReads, ownerTodoFrom, type WorktreePsRow } from "../../core/index.ts";
import { later, ownerWorld, T0 } from "./world.ts";

// Decision 232: a session's wait whose own hooks no longer reach the store (a terminal killed
// without SessionEnd, the plugin turned off) closes when Orca shows its terminal gone, or expires.

const SESSION = "11111111-2222-3333-4444-555555555555";
const INSTANCE = "inst_000000000001";

const rows = (r: WorktreePsRow[], truncated = false): LocalRows<WorktreePsRow> => ({ rows: r, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated });
const tree = (p: Partial<WorktreePsRow> = {}): WorktreePsRow => ({
  worktreeId: "repo_1::/w/api",
  worktreeInstanceId: INSTANCE,
  hostId: "local",
  repo: "api",
  path: "/w/api",
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: 1,
  unverifiableTerminalCount: 0,
  status: "idle",
  agents: [],
  ...p,
});

type World = ReturnType<typeof ownerWorld>;

/** A wait shaped like the hook writes it, escalated to the owner as queue-monitor does after lead_minutes. */
function staleWait(w: World, payload: Record<string, string> = {}) {
  const wait = w.store.append({ type: "waiting_human", source: "Notification", payload: { session: SESSION, excerpt: "Claude is waiting for your input", ...payload } });
  w.store.append({ type: "escalation_stale", source: "monitor:queue", payload: { ref: String(wait.seq), reason: "waiting_unreleased" } });
  return wait;
}

/** One orca-monitor round at the world's clock; its planned rows are written as the monitor writes them. */
function round(w: World, ps: OrcaReads["ps"]) {
  const reads: OrcaReads = { ps, workers: rows([]) as never, shows: {}, runs: {}, gates: {}, inbox: null, events: w.store.events(), refusals: new Map() };
  const planned = judgeOrca(reads, Date.parse(w.now), DEFAULT_MONITOR_CONFIG).planned.filter((e) => e.type === "waiting_released");
  for (const e of planned) w.store.append(e);
  return planned.map((e) => e.payload);
}

const todo = (w: World) => ownerTodoFrom(w.input(), w.facts()).filter((r) => r.kind === "waiting_human");

test("232: the worktree the wait was raised in shows no live terminal: moot terminal_gone, off the owner's list", () => {
  const w = ownerWorld();
  const wait = staleWait(w, { worktree: INSTANCE });
  w.at(later(T0, 20));
  assert.equal(todo(w).length, 1);
  assert.deepEqual(round(w, rows([tree()])), [], "a live terminal there: not gone");
  assert.deepEqual(round(w, rows([tree({ liveTerminalCount: 0 })])), [{ ref: String(wait.seq), outcome: "moot", by: "unknown", evidence: "terminal_gone" }]);
  assert.deepEqual(todo(w), []);
  assert.deepEqual(round(w, rows([tree({ liveTerminalCount: 0 })])), [], "released once");
});

test("232: a worktree no longer in Orca's full list is gone too", () => {
  const w = ownerWorld();
  staleWait(w, { worktree: INSTANCE });
  assert.deepEqual(
    round(w, rows([tree({ worktreeInstanceId: "inst_other" })])).map((p) => p.evidence),
    ["terminal_gone"],
  );
});

test("232: only positive evidence closes by terminal: ps unread, truncated or unverifiable terminals close nothing early", () => {
  const w = ownerWorld();
  staleWait(w, { worktree: INSTANCE });
  w.at(later(T0, 60));
  assert.deepEqual(round(w, null), []);
  assert.deepEqual(round(w, rows([], true)), [], "a truncated list does not prove the worktree gone");
  assert.deepEqual(round(w, rows([tree({ liveTerminalCount: 0, unverifiableTerminalCount: 1 })])), []);
  assert.equal(todo(w).length, 1);
});

test("232: a wait no hook or terminal can close expires show_hours (24h) after it opened, even with ps unread", () => {
  const w = ownerWorld();
  const wait = staleWait(w);
  w.at(later(T0, 24 * 60 - 1));
  assert.deepEqual(round(w, null), [], "younger than 24h stays");
  assert.equal(todo(w).length, 1);
  w.at(later(T0, 28 * 60));
  assert.deepEqual(round(w, null), [{ ref: String(wait.seq), outcome: "moot", by: "unknown", evidence: "expired" }]);
  assert.deepEqual(todo(w), [], "the 28h row the owner saw leaves");
});

test("232: a live terminal does not keep a wait past 24h: the worktree may hold another session", () => {
  const w = ownerWorld();
  staleWait(w, { worktree: INSTANCE });
  w.at(later(T0, 25 * 60));
  assert.deepEqual(round(w, rows([tree()])).map((p) => p.evidence), ["expired"]);
});

test("232: a Dispatch's wait is not this rule's: Orca's mail and ps release it (decision 196)", () => {
  const w = ownerWorld();
  w.store.append({ type: "waiting_human", source: "orca-monitor", payload: { dispatch: "ctx_000000000001" }, entity: "task", entity_id: "task_000000000001" });
  w.at(later(T0, 48 * 60));
  assert.deepEqual(round(w, rows([])), []);
});
