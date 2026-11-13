import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxMessage, LocalRows, WorkerRow, WorktreePsRow } from "../../contract/orca.ts";
import { DEFAULT_MONITOR_CONFIG as C } from "../monitor.ts";
import { judgeOrca, type OrcaReads } from "./judge.ts";

// Decision 237: a session stopped on a lost login is told apart from other stops by the last turn line
// of Orca's stop mail, so the owner's row names the recovery (/login once, then claude --continue).

const NOW = Date.parse("2026-11-13T10:50:00Z");
const rows = <T>(r: T[]): LocalRows<T> => ({ rows: r, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false });
const worker: WorkerRow = { dispatchId: "ctx_a", taskId: "task_a", state: "running", liveness: "live", workspace: "ws_a", host: "local" };
const waitingPs: WorktreePsRow = {
  worktreeId: "ws_a",
  hostId: "local",
  repo: "api",
  path: "/w/a",
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: 1,
  unverifiableTerminalCount: 0,
  status: "waiting",
  agents: [{ paneKey: "p:t", state: "waiting", agentType: "claude", agentWait: { kind: "input" } as never }],
};

const BOX = "────────────────────────────────────────";
const body = (...last: string[]) =>
  [
    'Worker term_a is stopped at a prompt that needs a person (approval or a question) while running task "api" (task_a).',
    "The Dispatch is still open.",
    "Last output:",
    ...last,
    BOX,
    "❯",
    BOX,
    "  /w/a ⎇ b | Opus | 185k/1.0M (19%)",
  ].join("\n");
const AUTH_LAST = ["⏺ Goal check-in: background work still running", "⏺ Please run /login · API Error: 403 Forbidden", "✻ Cooked for 1s · done 7:52 PM"];

const msg = (id: string, stopReason: string, text: string): InboxMessage => ({
  id,
  type: "escalation",
  from: "term_a",
  to: "run:run_1",
  subject: "stopped",
  handled: false,
  body: text,
  payload: { taskId: "task_a", dispatchId: "ctx_a", stopReason } as never,
});
const reads = (inbox: InboxMessage[]): OrcaReads => ({
  ps: rows([waitingPs]),
  workers: rows([worker]),
  shows: {},
  runs: {},
  gates: {},
  inbox,
  events: [],
});
const stops = (inbox: InboxMessage[]) =>
  judgeOrca(reads(inbox), NOW, C)
    .planned.filter((e) => e.type === "worker_dead" || e.type === "waiting_human" || e.type === "rate_limited")
    .map((e) => [e.type, e.payload]);

test("237: an errored stop whose last turn line is a lost login is worker_dead{stop_failure, cause auth}", () => {
  assert.deepEqual(stops([msg("m1", "errored", body(...AUTH_LAST))]), [["worker_dead", { reason: "stop_failure", cause: "auth" }]]);
});

test("237: a needs-input stop on a lost login is waiting_human{dispatch, cause auth}", () => {
  assert.deepEqual(stops([msg("m1", "needs-input", body(...AUTH_LAST))]), [["waiting_human", { dispatch: "ctx_a", cause: "auth" }]]);
});

test("237: the other login messages Claude Code prints count too", () => {
  for (const line of ["⏺ OAuth token revoked · Please run /login", "⏺ Goal cleared after an unrecoverable error (authentication failed): \"api\""]) {
    assert.deepEqual(stops([msg("m1", "errored", body(line))]), [["worker_dead", { reason: "stop_failure", cause: "auth" }]], line);
  }
});

test("237: an old 403 above a later turn is not this stop's cause", () => {
  const later = ["⏺ Please run /login · API Error: 403 Forbidden", "⏺ CI is green; waiting on the review.", "  ⎿  API Error: 500 Internal server error"];
  assert.deepEqual(stops([msg("m1", "errored", body(...later))]), [["worker_dead", { reason: "stop_failure" }]]);
  assert.deepEqual(stops([msg("m2", "needs-input", body("⏺ Please run /login · API Error: 403 Forbidden", "⏺ Allow this command?"))]), [
    ["waiting_human", { dispatch: "ctx_a" }],
  ]);
});

test("237: a turn that only quotes the message mid-sentence is not a lost login", () => {
  assert.deepEqual(stops([msg("m1", "errored", body('⏺ The lead saw "Please run /login" on another card earlier.'))]), [["worker_dead", { reason: "stop_failure" }]]);
});
