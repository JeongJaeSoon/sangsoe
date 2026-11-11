import assert from "node:assert/strict";
import { test } from "node:test";
import { addEdgeTo, DEFAULT_MONITOR_CONFIG, foldFacts, type MonitorDeps, nullChatProvider, removeEdgeFrom, runMonitor, type Store, VERSION } from "../../core/index.ts";
import { createWorld, type World } from "../decision/world.ts";

// G22 (decision 212 ③): the queue round adds stacked_on from pr-monitor's own rows: an open PR whose
// base is the head branch of one other open PR in the same repository. A removed edge stays removed.

const RUN = "run_000000000001";
const T1 = "task_000000000001";
const T2 = "task_000000000002";
const T3 = "task_000000000003";

function deps(store: Store, w: World): MonitorDeps {
  return {
    orca: w.orca,
    exec: async () => ({ code: null, stdout: "", stderr: "", failure: "spawn" }),
    events: (f) => store.events(f),
    append: (e) => store.append(e),
    core: { store, orca: w.orca },
    now: () => Date.now(),
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
    coreVersion: VERSION,
  };
}

function world(): World {
  const w = createWorld(
    [T1, T2, T3].map((id) => ({ id, run: RUN, status: "dispatched" })),
    { currentRun: RUN },
  );
  for (const [i, task] of [T1, T2, T3].entries()) {
    w.store.append({ type: "item_created", source: "core:item", entity: "task", entity_id: task, payload: { task, alias: `i00${i + 1}`, who: "lead:api", done_when: "d", owner_action: 0 } });
  }
  return w;
}

const opened = (w: World, pr: string, task: string, base: string, head?: string) =>
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr, task, base, ...(head ? { head } : {}) } });
const stacked = (w: World) => foldFacts(w.store.events()).edges.filter((e) => e.kind === "stacked_on").map((e) => `${e.pred} → ${e.succ}`);

test("a PR based on another open PR's head gets stacked_on without a --stack; removing it keeps it removed", async () => {
  const w = world();
  opened(w, "acme/api#1", T1, "main", "feat-a");
  opened(w, "acme/api#2", T2, "feat-a", "feat-b");
  const r = await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), [`pr:acme/api#1 → item:${T2}`], (r.calls ?? []).join("\n"));

  const snap = { tasks: [...w.tasks.values()].map((t) => ({ id: t.id, runId: RUN, status: t.status, deps: [] })), gates: [] };
  const removed = removeEdgeFrom(w, snap as never, { pred: "pr:acme/api#1", succ: `item:${T2}`, kind: "stacked_on", reason: "not stacked after all" });
  assert.ok(removed.ok, JSON.stringify(removed));
  await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), [], "the next round does not put a removed edge back");
});

test("a base branch that moved onto a PR's head stacks it; a fork head, a shared head or a merged base does not", async () => {
  const w = world();
  opened(w, "acme/api#1", T1, "main", "feat-a");
  opened(w, "acme/api#2", T2, "main", "feat-b");
  w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: "acme/api#2", from: "main", to: "feat-a" } });
  opened(w, "acme/api#3", T3, "feat-x");
  opened(w, "acme/web#4", T3, "feat-a", "feat-c");
  await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), [`pr:acme/api#1 → item:${T2}`], "another repository's same-named branch is not a stack");

  const shared = world();
  opened(shared, "acme/api#1", T1, "main", "dup");
  opened(shared, "acme/api#5", T3, "main", "dup");
  opened(shared, "acme/api#2", T2, "dup", "feat-b");
  await runMonitor("queue", deps(shared.store, shared));
  assert.deepEqual(stacked(shared), []);

  const merged = world();
  opened(merged, "acme/api#1", T1, "main", "feat-a");
  merged.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#1", merge_sha: "abc1234" } });
  opened(merged, "acme/api#2", T2, "feat-a", "feat-b");
  await runMonitor("queue", deps(merged.store, merged));
  assert.deepEqual(stacked(merged), []);
});

test("two stacked PRs of one task add no edge, so the lower one is not made to wait on itself", async () => {
  const w = world();
  opened(w, "acme/api#10", T1, "main", "part1");
  opened(w, "acme/api#11", T1, "part1", "part2");
  await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), []);
});

test("decision 215 ⑦: a base that left a PR's head drops that stack edge; an ordering edge to a PR never its base stays", async () => {
  const w = world();
  opened(w, "acme/api#1", T1, "main", "feat-a");
  opened(w, "acme/api#2", T2, "feat-a", "feat-b");
  opened(w, "acme/api#3", T3, "main", "feat-c");
  await runMonitor("queue", deps(w.store, w));
  const snap = { tasks: [...w.tasks.values()].map((t) => ({ id: t.id, runId: RUN, status: t.status, deps: [] })), gates: [] };
  assert.ok(addEdgeTo(w, snap as never, { pred: "pr:acme/api#3", succ: `item:${T2}`, kind: "stacked_on" }).ok);
  assert.deepEqual(stacked(w), [`pr:acme/api#1 → item:${T2}`, `pr:acme/api#3 → item:${T2}`]);

  opened(w, "acme/api#4", T2, "feat-a", "feat-d");
  w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: "acme/api#2", from: "feat-a", to: "main" } });
  await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), [`pr:acme/api#1 → item:${T2}`, `pr:acme/api#3 → item:${T2}`], "#4 of the same item still sits on feat-a");

  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#4" } });
  await runMonitor("queue", deps(w.store, w));
  assert.deepEqual(stacked(w), [`pr:acme/api#3 → item:${T2}`]);
});
