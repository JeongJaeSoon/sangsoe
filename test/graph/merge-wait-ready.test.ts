import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, itemFacts, ready, Store, type ViewInput, type ViewTask, why } from "../../core/index.ts";

// Decision 178: a PR author's worker_done completes its Task before the merge (decision 175), and
// Orca releases the dependent then. GRAPH holds the dependent until the PR merges.

const A = "task_000000000021";
const B = "task_000000000022";
const PR = "acme/api#31";
const URL = "https://github.com/acme/api/pull/31";

function world(rows: (store: Store) => void, a: Partial<ViewTask> = {}): ViewInput {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  for (const [task, alias] of [
    [A, "i021"],
    [B, "i022"],
  ] as const) {
    store.append({ type: "item_created", source: "test", payload: { task, alias, who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: task });
  }
  rows(store);
  const tasks: ViewTask[] = [
    { id: A, runId: "run_a", status: "completed", deps: [], ...a },
    { id: B, runId: "run_a", status: "ready", deps: [A] },
  ];
  return { events: store.events(), orca: { tasks, gates: [] }, now: "2026-11-10T12:00:00.000Z" };
}

const opened = (store: Store) => store.append({ type: "pr_opened", source: "test", payload: { pr: PR, task: A } });
const merged = (store: Store) => store.append({ type: "pr_merged", source: "test", payload: { pr: PR, merge_sha: "a".repeat(40) } });
const closed = (store: Store) => store.append({ type: "pr_closed", source: "test", payload: { pr: PR } });
const readyTasks = (input: ViewInput) => ready(input).map((r) => r.task);
const item = (input: ViewInput, task: string) => itemFacts(input).find((f) => f.task === task);

test("A blocks B: A's author sent worker_done with the PR open, so B is not ready", () => {
  const input = world(opened);
  assert.deepEqual(readyTasks(input), []);
  assert.equal(why(input, B).rows[0]?.todo, "선행 PR 머지를 기다린다");
});

test("A blocks B: once A's PR merges, B is ready", () => {
  assert.deepEqual(readyTasks(world((s) => (opened(s), merged(s)))), [B]);
});

test("before pr-monitor binds the PR, the one A's report names holds B as unknown", () => {
  const input = world(() => {}, { report: `U21 landed\nPR: ${URL}` });
  assert.deepEqual(readyTasks(input), []);
  assert.match(why(input, B).rows[0]?.predState ?? "", /^모름/);
  assert.equal(item(input, A)?.state, "unknown");
});

test("A PR closed unmerged leaves B on a dangling predecessor, and A reads pr_closed for the lead", () => {
  const input = world((s) => (opened(s), closed(s)));
  assert.deepEqual(readyTasks(input), []);
  assert.equal(why(input, B).rows[0]?.dangling, true);
  const f = item(input, A);
  assert.equal(f?.state, "pr_closed");
  assert.equal(f?.waitsOn, "lead");
  assert.equal(buildBrief(input).summary.done, 0);
});

test("a completed Task with no PR anywhere still releases B and reads done", () => {
  const input = world(() => {});
  assert.deepEqual(readyTasks(input), [B]);
  assert.equal(item(input, A)?.state, "done");
});

test("S7: a Task closed with no item_transition dates its close from Orca's completed_at", () => {
  const input = world(() => {}, { completedAt: "2026-11-10T10:00:00.000Z" });
  assert.equal(item(input, A)?.closedAt, "2026-11-10T10:00:00.000Z");
  assert.equal(buildBrief(input).summary.done, 1);
});
