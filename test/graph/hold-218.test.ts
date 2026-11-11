import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGroup, criticalPath, dedupeKey, EVENTS, graphRead, itemFacts, Store, type ViewGate, type ViewInput, type ViewTask, why } from "../../core/index.ts";

// Decision 218: every item the brief reads 🚧 has a why row naming what it waits on, from the same hold
// item_status reads; a PR predecessor that is a group item's PR is that item on the critical path.

const A = "task_000000000031";
const B = "task_000000000032";
const C = "task_000000000033";
const D = "task_000000000034";
const PR_A = "acme/api#7";
const PR_B = "acme/api#8";
const PR_C = "acme/api#9";
const LEAD = "lead:api";

type Shape = { tasks: ViewTask[]; rows?: (s: Store) => void; gates?: ViewGate[] };

function world({ tasks, rows, gates = [] }: Shape): ViewInput {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  for (const [task, alias] of [
    [A, "i015"],
    [B, "i016"],
    [C, "i017"],
    [D, "i018"],
  ] as const) {
    if (!tasks.some((t) => t.id === task)) continue;
    store.append({ type: "item_created", source: "test", entity: "task", entity_id: task, payload: { task, alias, who: LEAD, done_when: "done", owner_action: 0 } });
    store.append({ type: "item_extra_set", source: "test", payload: { task, lead: LEAD } });
  }
  rows?.(store);
  return { events: store.events(), orca: { tasks, gates }, now: "2026-11-10T12:00:00.000Z" };
}

const pr = (s: Store, p: string, task: string) => s.append({ type: "pr_opened", source: "test", payload: { pr: p, task } });
const edge = (s: Store, pred: string, succ: string, kind: "blocks" | "after" | "stacked_on") => s.append({ type: "edge_added", source: "GRAPH", dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, kind), payload: { pred, succ, kind } });
const task = (id: string, status: string, deps: string[] = []): ViewTask => ({ id, runId: "run_a", status, deps }) as ViewTask;
const blockedAliases = (input: ViewInput) => itemFacts(input).filter((f) => f.state === "blocked" || f.state === "pr_closed").map((f) => f.alias);
const whyIds = (input: ViewInput) => new Set(buildGroup(input, LEAD)?.why.rows.map((r) => r.id));

/** The S6r screen: B and D in progress, C's author done with C's PR stacked on B's PR, D after B. */
const s6r = () =>
  world({
    tasks: [task(B, "dispatched"), task(C, "completed"), task(D, "dispatched")],
    rows: (s) => {
      pr(s, PR_B, B);
      pr(s, PR_C, C);
      edge(s, `pr:${PR_B}`, `item:${C}`, "stacked_on");
      edge(s, `item:${B}`, `item:${D}`, "after");
    },
  });

test("S6r: C reads 🚧 and its why row names what it waits on (B's PR, resolved to B)", () => {
  const input = s6r();
  assert.deepEqual(blockedAliases(input), ["i017"]);
  const r = why(input, C);
  assert.equal(r.readiness, "blocked");
  assert.deepEqual(
    r.rows.map((w) => [w.pred, w.kind, w.todo]),
    [[`pr:${PR_B}`, "stacked_on", "선행 PR 머지를 기다린다"]],
  );
  const g = buildGroup(input, LEAD);
  assert.deepEqual(
    g?.why.rows.map((row) => row.cells.map((c) => c.text).slice(0, 3)),
    [["i017", "i016", "stacked_on"]],
  );
});

test("S6r: the critical path reaches C through B's PR", () => {
  const input = s6r();
  assert.deepEqual(graphRead.criticalPath(input, [B, C, D]), [B, C]);
  assert.deepEqual(
    criticalPath(input, LEAD).path.map((n) => n.item),
    ["i016", "i017"],
  );
  const g = buildGroup(input, LEAD);
  assert.ok(g?.edges.some((e) => e.pred === "i016" && e.succ === "i017" && e.kind === "stacked_on"), "the drawn edge names B, not the PR");
});

test("a C waiting on nothing but its own PR has that PR as its row", () => {
  const input = world({ tasks: [task(C, "completed")], rows: (s) => pr(s, PR_C, C) });
  assert.deepEqual(
    why(input, C).rows.map((w) => [w.pred, w.kind, w.predState]),
    [[`pr:${PR_C}`, "pr", "열림"]],
  );
  assert.deepEqual([...whyIds(input)], ["i017"]);
});

test("a PR closed unmerged reads pr_closed and has its row", () => {
  const input = world({
    tasks: [task(C, "completed")],
    rows: (s) => {
      pr(s, PR_C, C);
      s.append({ type: "pr_closed", source: "test", payload: { pr: PR_C } });
    },
  });
  assert.deepEqual(blockedAliases(input), ["i017"]);
  assert.deepEqual(
    why(input, C).rows.map((w) => [w.pred, w.kind]),
    [[`pr:${PR_C}`, "pr"]],
  );
});

test("an Orca-blocked Task and an open owner gate each have a row", () => {
  const input = world({
    tasks: [task(A, "blocked"), task(B, "dispatched")],
    gates: [{ id: "gate_000000000001", taskId: B, open: true }],
    rows: (s) =>
      s.append({
        type: "decision_opened",
        source: "orchestrator",
        dedupe_key: dedupeKey(EVENTS.decision_opened, "cache-choice"),
        payload: { decision: "d012", decision_key: "cache-choice", task: B, gate: "gate_000000000001" },
      }),
  });
  assert.deepEqual(blockedAliases(input).sort(), ["i015", "i016"]);
  assert.deepEqual(
    why(input, A).rows.map((w) => w.kind),
    ["orca"],
  );
  assert.deepEqual(
    why(input, B).rows.map((w) => [w.pred, w.kind]),
    [["decision:d012", "gate"]],
  );
  assert.deepEqual([...whyIds(input)].sort(), ["i015", "i016"]);
});

test("hold without a review trigger is 🚧, not ⏸️, and still has its row; with one it is ⏸️", () => {
  const held = (extra: Record<string, unknown>) =>
    world({ tasks: [task(A, "blocked")], rows: (s) => s.append({ type: "item_extra_set", source: "test", payload: { task: A, ...extra } }) });
  const bare = held({ hold: true });
  assert.deepEqual(blockedAliases(bare), ["i015"]);
  assert.deepEqual([...whyIds(bare)], ["i015"]);
  const full = held({ hold: true, review_trigger: "2026-12-01" });
  assert.equal(itemFacts(full).find((f) => f.alias === "i015")?.state, "on_hold");
  assert.equal(why(full, A).readiness, "not_waiting");
});

test("a merged PR predecessor stays the PR in the drawing, so its edge reads met from the PR", () => {
  const input = world({
    tasks: [task(B, "dispatched"), task(C, "pending")],
    rows: (s) => {
      pr(s, PR_B, B);
      s.append({ type: "pr_merged", source: "test", payload: { pr: PR_B, merge_sha: "a".repeat(40) } });
      edge(s, `pr:${PR_B}`, `item:${C}`, "stacked_on");
    },
  });
  const g = buildGroup(input, LEAD);
  assert.deepEqual(
    g?.edges.map((e) => e.pred),
    [`pr:${PR_B}`],
  );
});

test("a PR node bound to an item outside the group stays a reference with its own row", () => {
  const input = world({
    tasks: [task(A, "dispatched"), task(C, "completed")],
    rows: (s) => {
      s.append({ type: "item_extra_set", source: "test", payload: { task: A, lead: "lead:docs" } });
      pr(s, PR_A, A);
      pr(s, PR_C, C);
      edge(s, `pr:${PR_A}`, `item:${C}`, "stacked_on");
    },
  });
  const g = buildGroup(input, LEAD);
  assert.deepEqual(
    g?.why.rows.map((r) => r.cells[1]?.text),
    [`pr:${PR_A}`],
  );
  assert.deepEqual(graphRead.criticalPath(input, [C]), [C]);
});

test("a PR edge that would close a cycle is left out of the path, not thrown on", () => {
  const input = world({
    tasks: [task(B, "dispatched", [C]), task(C, "dispatched")],
    rows: (s) => {
      pr(s, PR_B, B);
      edge(s, `pr:${PR_B}`, `item:${C}`, "stacked_on");
    },
  });
  assert.deepEqual(graphRead.criticalPath(input, [B, C]), [C, B]);
});

test("a merged PR predecessor adds no path edge", () => {
  const input = world({
    tasks: [task(B, "dispatched"), task(D, "dispatched")],
    rows: (s) => {
      pr(s, PR_B, B);
      s.append({ type: "pr_merged", source: "test", payload: { pr: PR_B, merge_sha: "a".repeat(40) } });
      edge(s, `pr:${PR_B}`, `item:${D}`, "stacked_on");
    },
  });
  assert.equal(graphRead.criticalPath(input, [B, D]).length, 1);
});
