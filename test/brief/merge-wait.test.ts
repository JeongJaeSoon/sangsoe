import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, itemFacts, Store, type ViewInput, type ViewTask } from "../../core/index.ts";

// Decision 175: a PR author ends with one worker_done, which completes its Task in Orca. Until
// pr-monitor confirms the merge, the item reads 🚧 blocked on the reviewer, not ✅ done.

const PR_ITEM = "task_000000000011";
const PLAIN = "task_000000000012";

function world(after?: (store: Store) => void): ViewInput {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  for (const [task, alias] of [
    [PR_ITEM, "i011"],
    [PLAIN, "i012"],
  ] as const) {
    store.append({ type: "item_created", source: "test", payload: { task, alias, who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: task });
  }
  store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#21", task: PR_ITEM } });
  after?.(store);
  const task = (id: string): ViewTask => ({ id, runId: "run_a", status: "completed", deps: [] });
  return { events: store.events(), orca: { tasks: [task(PR_ITEM), task(PLAIN)], gates: [] }, now: "2026-11-10T12:00:00.000Z" };
}

const facts = (input: ViewInput, task: string) => itemFacts(input).find((f) => f.task === task);

test("a completed Task whose PR is still open reads blocked on the reviewer", () => {
  const f = facts(world(), PR_ITEM);
  assert.equal(f?.state, "blocked");
  assert.equal(f?.waitsOn, "reviewer");
  assert.equal(f?.pr, "acme/api#21");
  assert.equal(f?.closedAt, null);
});

test("the same item reads done once pr-monitor records the merge, closed at the merge", () => {
  const input = world((store) => store.append({ type: "pr_merged", source: "test", payload: { pr: "acme/api#21", merge_sha: "a".repeat(40) } }));
  const f = facts(input, PR_ITEM);
  assert.equal(f?.state, "done");
  assert.equal(f?.waitsOn, null);
  assert.equal(f?.closedAt, "2026-11-10T09:00:00.000Z", "no item_transition is written; the merge row dates the close");
  assert.equal(buildBrief(input).summary.done, 1);
});

test("while it waits on the merge, only the PR's own alarms stand", () => {
  const input = world((store) => {
    store.append({ type: "worker_stuck", source: "test", payload: { reason: "no_output" }, entity: "task", entity_id: PR_ITEM });
    store.append({ type: "ci_failed", source: "test", payload: { pr: "acme/api#21", head_sha: "b".repeat(40), run_id: "1" } });
  });
  assert.deepEqual(facts(input, PR_ITEM)?.alarms, ["ci_failed"]);
});

test("a completed Task with no PR reads done", () => {
  assert.equal(facts(world(), PLAIN)?.state, "done");
});
