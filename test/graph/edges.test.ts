import assert from "node:assert/strict";
import { test } from "node:test";
import { addEdge, addEdgeTo, removeEdgeFrom, snapshotTasks, syncGraph } from "../../core/index.ts";
import { bindItem, createGraphWorld } from "./world.ts";

test("snapshot rows: deps as Orca prints them (a JSON string), run_id, a cancel kept in result", () => {
  const rows = snapshotTasks(
    [
      { id: "t1", status: "pending", title: "a", deps: '["t0"]', run_id: "run_x" },
      { id: "t2", status: "failed", title: "b", deps: [], result: "cancelled" },
      { id: "t3", status: "paused", title: "c" },
    ],
    "run_y",
  );
  assert.deepEqual(rows, [
    { id: "t1", runId: "run_x", status: "pending", deps: ["t0"] },
    { id: "t2", runId: "run_y", status: "failed", deps: [], result: "cancelled" },
    { id: "t3", runId: "run_y", status: "blocked", deps: [] },
  ]);
  assert.throws(() => snapshotTasks([{ id: "t", status: "pending", title: "x", deps: '{"a":1}' }], "r"), /string array/);
});

test("graph add refuses a cycle through Orca deps and extra edges, naming the nodes that close it", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.task("t_b", "run_a", ["t_a"]);
  w.task("t_c", "run_a");
  bindItem(w, "t_a", "i001");
  bindItem(w, "t_b", "i002");
  bindItem(w, "t_c", "i003");
  const ok = await addEdge(w, { pred: "i002", succ: "i003", kind: "after", runs: ["run_a"] });
  assert.ok(ok.ok && ok.value.status === "added" && ok.value.where === "extra");
  const cyc = await addEdge(w, { pred: "i003", succ: "i001", kind: "blocks", runs: ["run_a"] });
  assert.ok(!cyc.ok);
  assert.equal(cyc.refusal.code, "cycle");
  assert.match(cyc.refusal.reason, /item:t_a → item:t_b → item:t_c → item:t_a/);
  const self = await addEdge(w, { pred: "i001", succ: "i001", kind: "after", runs: ["run_a"] });
  assert.ok(!self.ok && self.refusal.code === "cycle");
  assert.equal(w.store.events({ type: "edge_added" }).length, 1, "a refused edge writes nothing");
});

test("graph add: same edge merges, an Orca dep is already there, unknown items and non-item successors are refused", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.task("t_b", "run_a", ["t_a"]);
  bindItem(w, "t_a", "i001");
  const snap = await w.snapshot();
  const again = (kind: string) => addEdgeTo(w, snap, { pred: "acme/api#3", succ: "i001", kind });
  assert.ok(again("stacked_on").ok);
  const second = again("stacked_on");
  assert.ok(second.ok && second.value.status === "already");
  const orcaDep = addEdgeTo(w, snap, { pred: "item:t_a", succ: "item:t_b", kind: "blocks" });
  assert.ok(orcaDep.ok && orcaDep.value.status === "already" && orcaDep.value.where === "orca", "one edge lives in one place");
  const unknown = addEdgeTo(w, snap, { pred: "i404", succ: "i001", kind: "blocks" });
  assert.ok(!unknown.ok && unknown.refusal.code === "unknown_item");
  const toPr = addEdgeTo(w, snap, { pred: "i001", succ: "acme/api#3", kind: "blocks" });
  assert.ok(!toPr.ok && toPr.refusal.code === "succ_not_item");
  const decAfter = addEdgeTo(w, snap, { pred: "d001", succ: "i001", kind: "after" });
  assert.ok(!decAfter.ok && /decision predecessor cannot take a after/.test(decAfter.refusal.reason));
  const badKind = addEdgeTo(w, snap, { pred: "i001", succ: "item:t_b", kind: "related" });
  assert.ok(!badKind.ok && badKind.refusal.code === "invalid_input");
  assert.equal(w.store.events({ type: "edge_added" }).length, 1);
});

test("graph remove needs a reason, refuses an Orca dep, and a removed edge can be added again", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.task("t_b", "run_a", ["t_a"]);
  w.task("t_c", "run_a");
  const snap = await w.snapshot();
  const e = { pred: "item:t_a", succ: "item:t_c", kind: "after" };
  assert.ok(addEdgeTo(w, snap, e).ok);
  const noReason = removeEdgeFrom(w, snap, { ...e, reason: " " });
  assert.ok(!noReason.ok && noReason.refusal.code === "invalid_input");
  assert.ok(removeEdgeFrom(w, snap, { ...e, reason: "order no longer matters" }).ok);
  const gone = removeEdgeFrom(w, snap, { ...e, reason: "again" });
  assert.ok(!gone.ok && gone.refusal.code === "no_edge");
  const readd = addEdgeTo(w, snap, e);
  assert.ok(readd.ok && readd.value.status === "added", "re-adding after a removal is a new row");
  const orca = removeEdgeFrom(w, snap, { pred: "item:t_a", succ: "item:t_b", kind: "blocks", reason: "r" });
  assert.ok(!orca.ok && orca.refusal.code === "orca_dep");
});

test("graph add refuses when a Run cannot be read, instead of judging on a partial graph", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_a");
  w.failRun("run_a");
  const r = await addEdge(w, { pred: "acme/api#1", succ: "item:t_a", kind: "stacked_on", runs: ["run_a"] });
  assert.ok(!r.ok && r.refusal.code === "orca_unreadable");
});

test("graph sync: a stacked PR gets its stacked_on edge; base changes, closes and merges are reported", async () => {
  const w = createGraphWorld();
  w.task("t_top", "run_a");
  w.task("t_mid", "run_a");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#2", task: "t_top" } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#1", task: "t_mid" } });
  const snap = await w.snapshot();
  const first = syncGraph(w, snap, [{ pr: "acme/api#2", base: "acme/api#1" }]);
  assert.deepEqual(first.added, ["pr:acme/api#1 → item:t_top"]);
  assert.deepEqual(syncGraph(w, snap, [{ pr: "acme/api#2", base: "acme/api#1" }]).added, [], "sync is idempotent");

  w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: "acme/api#2", from: "feature", to: "main" } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#1" } });
  const later = syncGraph(w, snap);
  assert.deepEqual(later.relandPrs, ["acme/api#2"]);
  assert.deepEqual(later.dangling, ["pr:acme/api#1 → item:t_top (stacked_on)"]);
});
