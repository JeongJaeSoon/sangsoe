import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { scratchDir } from "../../../test/scratch.ts";
import type { StoredEvent } from "../../contract/index.ts";
import type { InboxMessage, LocalRows, WorkerRow, WorktreePsRow } from "../../contract/orca.ts";
import { inboxRow } from "../../orca/adapter.ts";
import { DEFAULT_MONITOR_CONFIG as C } from "../monitor.ts";
import { judgeOrca, keepLastRead, type Observed, type OrcaReads, observe } from "./judge.ts";
import { readRefusalHead, refusalHeader, refusalPath, refusalRoots } from "./mail.ts";

const NOW = Date.parse("2026-11-11T12:00:00Z");
const FIXTURE = new URL("../../../test/fixtures/orca-mail.json", import.meta.url);

const rows = <T>(r: T[]): LocalRows<T> => ({ rows: r, nonLocal: { rows: 0, hostIds: [] }, omittedHostIds: [], truncated: false });
const worker = (n: string, p: Partial<WorkerRow> = {}): WorkerRow => ({
  dispatchId: `ctx_${n}`,
  taskId: `task_${n}`,
  state: "running",
  liveness: "live",
  workspace: `ws_${n}`,
  host: "local",
  ...p,
});
const ps = (n: string, p: Partial<WorktreePsRow> = {}): WorktreePsRow => ({
  worktreeId: `ws_${n}`,
  hostId: "local",
  repo: "api",
  path: `/w/${n}`,
  branch: "b",
  isMainWorktree: false,
  isArchived: false,
  liveTerminalCount: 1,
  unverifiableTerminalCount: 0,
  status: "working",
  agents: [{ paneKey: "p:t", state: "working", agentType: "claude", agentWait: null, stateStartedAt: NOW }],
  ...p,
});
const waitingPs = (n: string) => ps(n, { agents: [{ paneKey: "p:t", state: "waiting", agentType: "claude", agentWait: { kind: "permission" } as never }] });

function mail(root = "/nowhere/orch-refusal"): InboxMessage[] {
  const raw = readFileSync(FIXTURE, "utf8").replaceAll("REFUSAL_ROOT", root);
  return (JSON.parse(raw) as { messages: Record<string, unknown>[] }).messages.map(inboxRow);
}

let seq = 0;
const stored = (e: { type: string; payload: unknown; dedupe_key?: string | null; entity?: string; entity_id?: string }): StoredEvent =>
  ({ seq: ++seq, ts: new Date(NOW).toISOString(), source: "t", target: null, entity: null, entity_id: null, dedupe_key: null, ...e }) as unknown as StoredEvent;

function reads(p: Partial<OrcaReads> = {}): OrcaReads {
  const all = ["a", "b", "c", "d", "f"].map((n) => worker(n));
  const done = worker("e", { state: "succeeded", outcome: "succeeded" });
  return { ps: rows([ps("a"), ps("b"), waitingPs("c"), ps("d"), ps("f")]), workers: rows([...all, done]), shows: {}, runs: {}, gates: {}, inbox: mail(), events: [], ...p };
}
const planned = (r: OrcaReads, prev?: ReadonlyMap<string, Observed>) => judgeOrca(r, NOW, C, prev).planned;
const brief = (r: OrcaReads) => planned(r).map((e) => [e.type, e.entity_id, e.payload]);

test("the recorded stops: a usage limit is rate_limited, another error is worker_dead{stop_failure}, a finished turn is nothing", () => {
  const out = brief(reads());
  assert.deepEqual(
    out.filter(([t]) => t === "rate_limited" || t === "worker_dead"),
    [
      ["rate_limited", "ctx_a", { kind: "usage_limit" }],
      ["worker_dead", "ctx_b", { reason: "stop_failure" }],
    ],
  );
  assert.ok(!out.some(([, id]) => id === "ctx_d"), "stopReason finished is a deliberate hold");
});

test("a stop is written once: the next round reads the same mail and writes nothing", () => {
  const first = planned(reads());
  const events = first.map((e) => stored({ type: e.type, payload: e.payload, dedupe_key: e.dedupe_key ?? null, entity: e.entity ?? "", entity_id: e.entity_id ?? "" }));
  const again = planned(reads({ events })).filter((e) => e.type !== "waiting_released");
  assert.deepEqual(again, []);
});

test("old stop mail of a settled Dispatch raises nothing", () => {
  const settled = ["a", "b", "c", "d", "f"].map((n) => worker(n, { state: "succeeded" }));
  const out = brief(reads({ workers: rows(settled), ps: rows([]) }));
  assert.ok(!out.some(([t]) => t === "worker_dead" || t === "rate_limited" || t === "waiting_human"));
});

test("a stop_failure does not hide the terminal's later death", () => {
  const events = [stored({ type: "worker_dead", payload: { reason: "stop_failure" }, entity: "dispatch", entity_id: "ctx_b", dedupe_key: "worker_dead:ctx_b:msg_stop_00000000000000000000000b" })];
  const out = brief(reads({ events, workers: rows([worker("b", { liveness: "gone" })]), inbox: [] }));
  assert.deepEqual(out, [["worker_dead", "ctx_b", { reason: "terminal_gone" }]]);
});

test("needs-input is waiting_human{dispatch} while ps shows the wait; the wait gone releases it, a settled Dispatch makes it moot", () => {
  const out = planned(reads()).filter((e) => e.type === "waiting_human");
  assert.deepEqual(
    out.map((e) => [e.entity, e.entity_id, e.payload]),
    [["task", "task_c", { dispatch: "ctx_c" }]],
  );
  assert.equal(planned(reads({ ps: rows([ps("c")]) })).filter((e) => e.type === "waiting_human").length, 0, "answered before the round: no row");

  const wait = stored({ type: "waiting_human", payload: { dispatch: "ctx_c" }, entity: "task", entity_id: "task_c" });
  const moving = planned(reads({ events: [wait], ps: rows([ps("c")]), inbox: [] }));
  assert.deepEqual(
    moving.map((e) => e.payload),
    [{ ref: String(wait.seq), outcome: "answered", by: "unknown", evidence: "agent_wait_gone" }],
  );
  assert.deepEqual(planned(reads({ events: [wait], inbox: [] })), [], "still waiting: nothing");
  const settled = planned(reads({ events: [wait], workers: rows([worker("c", { state: "succeeded" })]), inbox: [] }));
  assert.deepEqual(
    settled.map((e) => {
      const p = e.payload as { outcome: string; evidence: string };
      return [p.outcome, p.evidence];
    }),
    [["moot", "dispatch_settled"]],
  );
});

test("worker_done mail is a marker row with ids only: no outcome, no body", () => {
  const done = planned(reads()).filter((e) => e.type === "worker_done");
  assert.deepEqual(
    done.map((e) => [e.entity_id, e.payload]),
    [["ctx_e", { dispatch: "ctx_e", task: "task_e", msg_id: "msg_00000000000e" }]],
  );
});

test("refusal_report reads the Act:/Category: header of the file the escalation names, inside the refusal root only", async () => {
  const base = realpathSync(scratchDir("sangsoe-mail-"));
  const root = join(base, "orch-refusal");
  // The reader is built before the root exists, as the plugin worker's is at start.
  const read = readRefusalHead(() => refusalRoots([base]));
  mkdirSync(join(root, "feature-f"), { recursive: true });
  const file = join(root, "feature-f", "20261111-1.txt");
  writeFileSync(file, "Act: find callers of the adapter rows\nCategory: hook (deny pattern)\nCommand:\n  grep -rn x core\n");
  const inbox = mail(root);
  const m = inbox.find((x) => x.id === "msg_00000000000f");
  assert.equal(m && refusalPath(m), file, "the sentence's period is not part of the path");

  const refusals = new Map([[file, await read(file)]]);
  const out = planned(reads({ inbox, refusals })).filter((e) => e.type === "refusal_report");
  assert.deepEqual(
    out.map((e) => [e.entity_id, e.payload]),
    [["ctx_f", { act: "find callers of the adapter rows", category: "hook (deny pattern)", command_file: file }]],
  );

  const outside = join(base, "elsewhere.txt");
  writeFileSync(outside, "Act: x\nCategory: y\n");
  assert.equal(await read(outside), null, "a path outside the root is not read");
  const link = join(root, "feature-f", "link.txt");
  symlinkSync(outside, link);
  assert.equal(await read(link), null, "nor a link that leaves it");
  assert.equal(await read(join(root, "missing.txt")), null);
  assert.equal(await read(join(root, "feature-f")), null, "a directory is not read");
});

test("a refusal file without the header is reported unseen, not guessed", () => {
  assert.equal(refusalHeader("U52 worker: three greps refused.\n1. Act: grep. Category: hook. Command: x"), undefined);
  assert.deepEqual(refusalHeader("Act: merge\nCategory: no verdict\n"), { act: "merge", category: "no verdict" });
  const file = "/nowhere/orch-refusal/feature-f/20261111-1.txt";
  const r = judgeOrca(reads({ refusals: new Map([[file, "free text only"]]) }), NOW, C);
  assert.ok(!r.planned.some((e) => e.type === "refusal_report"));
  assert.ok(r.unseen.some((u) => u.includes("no Act:/Category: header")));
});

test("observed_change: only on a workspace with two live terminals, field names only, from the second round", () => {
  const show = (n: string, stage: string) => ({ dispatchId: `ctx_${n}`, taskId: `task_${n}`, runId: "run_a", state: "running", stage });
  const base = (stage: string, liveness = "live"): OrcaReads =>
    reads({
      inbox: [],
      ps: rows([ps("a", { liveTerminalCount: 2 }), ps("b")]),
      workers: rows([worker("a", { liveness }), worker("b", { liveness })]),
      shows: { ctx_a: show("a", stage), ctx_b: show("b", stage) },
    });
  assert.deepEqual(planned(base("implement")), [], "no previous round: nothing");
  const prev = observe(base("implement"));
  const out = planned(base("review"), prev);
  assert.deepEqual(
    out.map((e) => [e.type, e.entity_id, e.payload]),
    [["observed_change", "ctx_a", { task: "task_a", field: "stage" }]],
  );
  const unread = { ...base("review"), shows: { ctx_a: null, ctx_b: null } };
  assert.deepEqual(planned(unread, prev), [], "a worker-show that failed is not a change");
  const kept = keepLastRead(prev, observe(unread));
  assert.deepEqual(
    planned(base("review"), kept).map((e) => e.payload),
    [{ task: "task_a", field: "stage" }],
    "the change across an unread round is still seen",
  );
});
