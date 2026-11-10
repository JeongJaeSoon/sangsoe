import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, itemFacts, ownerDone, ownerTodoFrom, probeRound, probeTargets, type VerifySpec, type ViewInput, why } from "../../core/index.ts";
import { later, type OwnerWorld, ownerWorld, T0 } from "./world.ts";

// Decision 181 (the owner's answer to Q1): a to-do closes on verification. The owner's 완료 on an
// item with a verify reads pending verification, its own state, until a probe sees the effect.

const T = "task_000000000001";
const D = "task_000000000002";
const MERGED: VerifySpec = { kind: "pr_merged", pr: "acme/api#40" };
const ports = (w: OwnerWorld) => ({ orca: w.orca, gh: w.ghClient });
const factOf = (input: ViewInput, task = T) => itemFacts(input).find((f) => f.task === task);
const probe = (w: OwnerWorld) => probeRound(ports(w), w.store, w.input(), itemFacts(w.input()));

/** D waits on T through an Orca dep (blocks). */
function withDep(input: ViewInput): ViewInput {
  return { ...input, orca: { ...input.orca, tasks: input.orca.tasks.map((t) => (t.id === D ? { ...t, deps: [T] } : t)) } };
}

test("Q1: the owner's 완료 on a to-do with a verify is pending verification, not done, until the probe passes", async () => {
  const w = ownerWorld();
  w.item(T, { verify: MERGED });
  const r = await ownerDone({ orca: w.orca, store: w.store }, w.input(), itemFacts(w.input()), { task: T });
  assert.ok(r.ok && r.value.pendingVerify, "the button reports pending verification");

  const f = factOf(w.input());
  assert.equal(f?.state, "pending_verify");
  assert.equal(f?.closedAt, null, "not closed: no done-window count");
  assert.equal(f?.evidenceShort, false, "no ✅ 🔍: pending is a state, not a flagged done");
  const b = buildBrief(w.input());
  assert.equal(b.summary.done, 0);
  assert.equal(b.summary.doing, 1, "counted as 진행 중 while the probe waits");
  assert.deepEqual(ownerTodoFrom(w.input(), itemFacts(w.input())), [], "the owner has nothing left to press");

  // A day later the merge is seen: past the old grace window the probe still reads a pending item.
  w.gh.set("repos/acme/api/pulls/40", { merged: true, merge_commit_sha: "abc1234" });
  w.at(later(T0, 26 * 60));
  const round = await probe(w);
  assert.deepEqual(round.passed, [T]);
  assert.equal(w.store.events({ type: "close_suggested" }).length, 0, "nothing to suggest: the owner already pressed");
  const g = factOf(w.input());
  assert.equal(g?.state, "done");
  assert.equal(g?.closedAt, w.now, "closed when verified, not when pressed");
  assert.equal(buildBrief(w.input()).summary.done, 1);
});

test("Q1: every entrance that completes the Task reads the same; a to-do with no verify closes on the button", async () => {
  // A lead's task-update or pr-monitor's merge close completes the Task with no button at all.
  const w = ownerWorld();
  w.item(T, { verify: MERGED });
  const t = w.tasks.get(T);
  if (t) t.status = "completed";
  assert.equal(factOf(w.input())?.state, "pending_verify");

  // A worker's item with a verify is not a to-do: Orca's completed stands.
  const k = ownerWorld();
  k.item(T, { who: "lead:api", verify: MERGED });
  const kt = k.tasks.get(T);
  if (kt) kt.status = "completed";
  assert.equal(factOf(k.input())?.state, "done");

  // No verify: nothing to wait for, the button is the evidence.
  const n = ownerWorld();
  n.item(T, {});
  const r = await ownerDone({ orca: n.orca, store: n.store }, n.input(), itemFacts(n.input()), { task: T });
  assert.ok(r.ok && !r.value.pendingVerify);
  assert.equal(factOf(n.input())?.state, "done");
});

test("Q1: a dependent waits for the verification, not for the press", async () => {
  const w = ownerWorld();
  w.item(T, { verify: MERGED });
  w.item(D, { who: "lead:api" });
  await ownerDone({ orca: w.orca, store: w.store }, w.input(), itemFacts(w.input()), { task: T });
  const held = why(withDep(w.input()), D);
  assert.equal(held.readiness, "waiting");
  assert.match(held.rows[0]?.predState ?? "", /검증 대기/);

  w.gh.set("repos/acme/api/pulls/40", { merged: true, merge_commit_sha: "abc1234" });
  await probe(w);
  assert.equal(why(withDep(w.input()), D).readiness, "ready");
});

test("Q1: a pending item is probed without a mark; run_ok with no run id stays pending and calls nothing", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_found", repo: "acme/api", search: "promote" } });
  await ownerDone({ orca: w.orca, store: w.store }, w.input(), itemFacts(w.input()), { task: T });
  assert.deepEqual(
    probeTargets(w.input(), itemFacts(w.input())).map((x) => [x.task, x.open]),
    [[T, false]],
    "pr_found is read once the owner pressed 완료",
  );

  const r = ownerWorld();
  r.item(T, { verify: { kind: "run_ok", repo: "acme/api" } });
  await ownerDone({ orca: r.orca, store: r.store }, r.input(), itemFacts(r.input()), { task: T });
  await probe(r);
  assert.deepEqual(r.ghCalls, [], "no run id: unreadable, nothing called");
  assert.equal(factOf(r.input())?.state, "pending_verify");
});
