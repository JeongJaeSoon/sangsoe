import assert from "node:assert/strict";
import { test } from "node:test";
import { addEdgeTo, notifyReady, ready, why } from "../../core/index.ts";
import { bindItem, createGraphWorld, type GraphWorld } from "./world.ts";

// The dependency regressions of appendix #dependencies-detail that GRAPH owns (split §4, 8 of 12).
// Each runs events and a stateful fake Orca through the ready view and why; none stores readiness.

const readyIds = async (w: GraphWorld) => ready(await w.input()).map((r) => r.task);
const add = async (w: GraphWorld, pred: string, succ: string, kind: string) => {
  const r = addEdgeTo(w, await w.snapshot(), { pred, succ, kind });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const prOpened = (w: GraphWorld, pr: string, task?: string) =>
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr, ...(task ? { task } : {}) } });
const prMerged = (w: GraphWorld, pr: string) => w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr, merge_sha: "abc1234" } });
const leadOf = (run: string) => () => ({ leadRun: run });

test("stack_order: feature→main is ready only after both stacked PRs merge, and its lead is told once", async () => {
  const w = createGraphWorld();
  w.task("t_feat", "run_a");
  bindItem(w, "t_feat", "i010");
  prOpened(w, "acme/api#1");
  prOpened(w, "acme/api#2");
  await add(w, "acme/api#1", "i010", "stacked_on");
  await add(w, "acme/api#2", "i010", "stacked_on");

  prMerged(w, "acme/api#1");
  assert.deepEqual(await readyIds(w), [], "one of two stacked PRs merged: still 📅");
  assert.deepEqual(await notifyReady(w, await w.input(), leadOf("run_a")), []);

  prMerged(w, "acme/api#2");
  assert.deepEqual(await readyIds(w), ["t_feat"]);
  const first = await notifyReady(w, await w.input(), leadOf("run_a"));
  const again = await notifyReady(w, await w.input(), leadOf("run_a"));
  assert.deepEqual([first[0]?.status, again[0]?.status], ["sent", "already"]);
  assert.equal(w.sends.length, 1);
  assert.equal(w.store.events({ type: "notified" }).length, 1, "exactly one notified row");
});

test("review_timing: the review step cannot be ready before the base PR merges, then opens exactly once", async () => {
  const w = createGraphWorld();
  w.task("t_impl", "run_a");
  w.task("t_review", "run_a", ["t_impl"]);
  bindItem(w, "t_impl", "i020");
  bindItem(w, "t_review", "i021");
  prOpened(w, "acme/api#10");
  prOpened(w, "acme/api#11", "t_impl");
  await add(w, "acme/api#10", "i020", "stacked_on");

  assert.deepEqual(await readyIds(w), [], "base PR open: neither impl nor review is ready");
  assert.equal((await notifyReady(w, await w.input(), leadOf("run_a"))).length, 0);
  prMerged(w, "acme/api#10");
  assert.deepEqual(await readyIds(w), ["t_impl"], "impl opens; review still waits on impl (Orca deps)");
  w.complete("t_impl");
  assert.deepEqual(await readyIds(w), ["t_review"]);
  await notifyReady(w, await w.input(), leadOf("run_a"));
  await notifyReady(w, await w.input(), leadOf("run_a"));
  assert.equal(w.sends.filter((s) => s.subject.includes("i021")).length, 1, "the review step opens once");
});

test("cross_lead: B's item waits on A's item across Runs and B's lead is told once when A is done", async () => {
  const w = createGraphWorld();
  w.task("t_a", "run_lead_a");
  w.task("t_b", "run_lead_b");
  bindItem(w, "t_a", "i030", { lead: "lead:a" });
  bindItem(w, "t_b", "i031", { lead: "lead:b" });
  await add(w, "i030", "i031", "blocks");

  const before = why(await w.input(), "i031");
  assert.equal(before.readiness, "waiting");
  assert.deepEqual(before.rows.map((r) => [r.pred, r.kind, r.predState]), [["item:t_a", "blocks", "📅 예정"]]);
  assert.deepEqual(await readyIds(w), ["t_a"]);

  w.complete("t_a");
  assert.deepEqual(await readyIds(w), ["t_b"]);
  const chain = (task: string) => ({ leadRun: task === "t_b" ? "run_lead_b" : "run_lead_a" });
  await notifyReady(w, await w.input(), chain);
  await notifyReady(w, await w.input(), chain);
  assert.deepEqual(w.sends.map((s) => s.to), ["run:run_lead_b"]);
  assert.equal(w.store.events({ type: "notified" }).length, 1);
});

test("overlap_order: the later of two `after`-ordered items is not ready until the earlier ends", async () => {
  const w = createGraphWorld();
  w.task("t_x", "run_a");
  w.task("t_y", "run_a");
  bindItem(w, "t_x", "i040");
  bindItem(w, "t_y", "i041");
  await add(w, "i040", "i041", "after");
  assert.deepEqual(await readyIds(w), ["t_x"]);
  w.complete("t_x");
  assert.deepEqual(await readyIds(w), ["t_y"]);

  const v = createGraphWorld();
  v.task("t_x", "run_a");
  v.task("t_y", "run_a");
  bindItem(v, "t_x", "i040");
  bindItem(v, "t_y", "i041");
  await add(v, "i040", "i041", "after");
  v.cancel("t_x");
  assert.deepEqual(await readyIds(v), ["t_y"], "after takes a cancel as done");
});

test("unknown_is_not_ready: an unread predecessor is 모름, never absent, and why says so", async () => {
  const w = createGraphWorld();
  w.task("t_u", "run_a");
  bindItem(w, "t_u", "i050");
  await add(w, "acme/api#5", "i050", "stacked_on");
  assert.deepEqual(await readyIds(w), []);
  const r = why(await w.input(), "i050");
  assert.equal(r.readiness, "waiting");
  assert.match(r.rows[0]?.predState ?? "", /^모름: PR 상태를 읽지 못했다/);

  w.task("t_far", "run_b");
  bindItem(w, "t_far", "i051");
  await add(w, "i051", "i050", "blocks");
  prOpened(w, "acme/api#5");
  prMerged(w, "acme/api#5");
  w.failRun("run_b");
  const unread = why(await w.input(), "i050");
  assert.deepEqual(unread.rows.map((x) => x.predState), ["모름: Orca 에서 이 Task 를 읽지 못했다"]);
  assert.deepEqual(await readyIds(w), [], "the PR merged, but the other Run could not be read");
});

test("precheck_blocks_send: the send item stays 📅 until the precheck is ✅; a cancelled precheck dangles", async () => {
  const w = createGraphWorld();
  w.task("t_pre", "run_a");
  w.task("t_send", "run_a", ["t_pre"]);
  bindItem(w, "t_pre", "i060");
  bindItem(w, "t_send", "i061");
  assert.deepEqual(await readyIds(w), ["t_pre"]);
  w.dispatch("t_pre");
  assert.deepEqual(await readyIds(w), []);
  w.cancel("t_pre");
  const r = why(await w.input(), "i061");
  assert.deepEqual(
    r.rows.map((x) => [x.pred, x.kind, x.predState, x.dangling]),
    [["item:t_pre", "blocks", "🗑️ 취소 (끊긴 선행)", true]],
  );
  assert.deepEqual(await readyIds(w), [], "a cancelled precheck never releases the send");

  const v = createGraphWorld();
  v.task("t_pre", "run_a");
  v.task("t_send", "run_a", ["t_pre"]);
  v.complete("t_pre");
  assert.deepEqual(await readyIds(v), ["t_send"]);
});
