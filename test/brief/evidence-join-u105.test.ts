import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, itemFacts } from "../../core/index.ts";
import { bindItem, createGraphWorld, type GraphWorld } from "../graph/world.ts";

// Decision 236: `sangsoe evidence record` writes `subject` = the PR and no entity; the item that owns
// that PR (pr_opened.task) reads it as evidence. A lead's item bundles its children and is not counted.
// Owner (2026-11-14, "리뷰만 따로"): an act_on 0 review is not evidence; it is counted apart.

const PR = "acme/api#21";
const HEAD = "a".repeat(40);

function merged(w: GraphWorld, task: string) {
  w.task(task, "run_a");
  bindItem(w, task, "i001");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task } });
  w.complete(task);
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: PR, merge_sha: "b".repeat(40) } });
}

const evidence = (w: GraphWorld, exit: number, subject = PR) =>
  w.store.append({
    type: "evidence",
    source: "evidence record",
    subject,
    actor: "lead-api",
    payload: { kind: "test", head_sha: HEAD, exit_code: exit, not_verified: ["prod"] },
  });

const started = (w: GraphWorld, task: string, kind: string) =>
  w.store.append({
    type: "unit_started",
    source: "mcp:start_unit",
    entity: "task",
    entity_id: task,
    payload: { kind, picked_by: "role", model: "m", effort: "medium", route: "none", budget: 1, budget_per: "day", used: 0 },
  });

const short = async (w: GraphWorld, task: string) => itemFacts(await w.input()).find((f) => f.task === task)?.evidenceShort;

test("passing evidence recorded on the item's PR counts as its evidence", async () => {
  const w = createGraphWorld();
  merged(w, "t_a");
  assert.equal(await short(w, "t_a"), true, "no evidence yet");
  evidence(w, 0);
  assert.equal(await short(w, "t_a"), false);
});

test("failing evidence, or evidence on another PR, leaves the item short", async () => {
  const w = createGraphWorld();
  merged(w, "t_a");
  evidence(w, 1);
  evidence(w, 0, "acme/api#2");
  assert.equal(await short(w, "t_a"), true);
});

const review = (w: GraphWorld, actOn: number, reviewer: string) =>
  w.store.append({
    type: "review_verdict",
    source: "review record",
    actor: reviewer,
    dedupe_key: `review_verdict:acme%2Fapi%2321:${HEAD}:${reviewer}`,
    payload: { pr: PR, head_sha: HEAD, act_on: actOn, reviewer, author: "author" },
  });
const marks = async (w: GraphWorld, task: string) => {
  const f = itemFacts(await w.input()).find((x) => x.task === task);
  return { short: f?.evidenceShort, reviewOnly: f?.reviewOnly };
};

test("an act_on 0 review with no evidence reads 리뷰만 있음, not 근거 부족", async () => {
  const w = createGraphWorld();
  merged(w, "t_a");
  review(w, 2, "first");
  assert.deepEqual(await marks(w, "t_a"), { short: true, reviewOnly: false }, "a review with Act-on left is not one");
  review(w, 0, "second");
  assert.deepEqual(await marks(w, "t_a"), { short: false, reviewOnly: true });
  evidence(w, 0);
  assert.deepEqual(await marks(w, "t_a"), { short: false, reviewOnly: false }, "evidence: neither");
});

test("the overview counts 근거 부족 and 리뷰만 있음 apart", async () => {
  const w = createGraphWorld();
  merged(w, "t_a");
  review(w, 0, "r");
  const b = buildBrief({ ...(await w.input()), runs: [] } as never);
  assert.deepEqual([b.evidenceShort, b.reviewOnly], [0, 1]);
});

test("a lead's item is left out of the count; a worker's item is not", async () => {
  const w = createGraphWorld();
  for (const [task, kind] of [
    ["t_lead", "lead"],
    ["t_work", "worker"],
  ] as const) {
    w.task(task, "run_a");
    bindItem(w, task, task === "t_lead" ? "i001" : "i002");
    started(w, task, kind);
    w.complete(task);
  }
  assert.equal(await short(w, "t_lead"), false);
  assert.equal(await short(w, "t_work"), true);
});
