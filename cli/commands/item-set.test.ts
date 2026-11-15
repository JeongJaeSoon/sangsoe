import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, itemFacts, Store, type ViewInput, type ViewTask, why } from "../../core/index.ts";
import { itemSet } from "./item-set.ts";

// Decision 279: `sangsoe item set` on an in-memory store. The item's facts are sangsoe's own, so no Orca is needed.

const T1 = "task_000000000001";
const NOW = "2026-11-16T00:00:00.000Z";

function world() {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-15T09:00:00.000Z" });
  store.append({ type: "item_created", source: "test", payload: { task: T1, alias: "i001", who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: T1 });
  const input = (): ViewInput => ({ events: store.events(), orca: { tasks: [{ id: T1, runId: "run_a", status: "pending", deps: [] } satisfies ViewTask], gates: [] }, now: NOW });
  const fact = () => itemFacts(input()).find((f) => f.task === T1);
  const next = () => buildBrief(input()).inProgress.rows.find((r) => r.id === "i001")?.cells.map((c) => c.text) ?? [];
  const sets = () => store.events({ type: "item_extra_set" }).map((e) => e.payload);
  return { store, input, fact, next, sets };
}

test("item set moves an item to a lead group, by alias or Task id, with one item_extra_set row each", () => {
  const w = world();
  assert.equal(w.fact()?.lead, "others", "an item with no lead is listed under the rest");
  assert.deepEqual(itemSet({ lead: "api-migration" }, ["i001"], w), { ok: true, value: { task: T1, alias: "i001", set: { lead: "api-migration" } } });
  assert.equal(w.fact()?.lead, "api-migration");
  assert.deepEqual(itemSet({ lead: " app-login " }, [T1], w), { ok: true, value: { task: T1, alias: "i001", set: { lead: "app-login" } } });
  assert.equal(w.fact()?.lead, "app-login", "the latest row wins");
  assert.deepEqual(w.sets(), [
    { task: T1, lead: "api-migration" },
    { task: T1, lead: "app-login" },
  ]);
});

test("item set takes a hold off and puts one on, and the brief says a held item is held, not waiting on a predecessor", () => {
  const w = world();
  assert.ok(w.next().includes("시작"), "ready before the hold");
  assert.ok(itemSet({ hold: "true" }, ["i001"], w).ok);
  assert.deepEqual([w.fact()?.state, w.fact()?.plannedBy], ["planned", "hold"]);
  assert.ok(w.next().includes("⏸️ 보류"));
  assert.ok(!w.next().includes("선행 대기"));
  assert.ok(itemSet({ hold: "false" }, ["i001"], w).ok);
  assert.deepEqual([w.fact()?.state, w.fact()?.plannedBy], ["ready", null]);
});

test("item set takes a date or a PR as the trigger, in any case, and refuses text a script cannot read", () => {
  const w = world();
  assert.ok(itemSet({ trigger: "2026-12-01" }, ["i001"], w).ok);
  assert.deepEqual([w.fact()?.state, w.fact()?.plannedBy, w.next().includes("선행 대기")], ["planned", null, true], "a date still to come is a wait, not an unread trigger");

  const pr = itemSet({ trigger: "Acme/API#12" }, ["i001"], w);
  assert.deepEqual(pr, { ok: true, value: { task: T1, alias: "i001", set: { trigger: "acme/api#12" } } }, "stored in the store's own lower case");
  w.store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#12" } });
  assert.equal(why(w.input(), T1).rows[0]?.predState, "열림");
  w.store.append({ type: "pr_merged", source: "test", payload: { pr: "acme/api#12", merge_sha: "a".repeat(40) } });
  assert.equal(w.fact()?.state, "ready", "the PR's merge is the trigger");

  const before = w.sets().length;
  const text = itemSet({ trigger: "when the vendor answers" }, ["i001"], w);
  assert.equal(!text.ok && text.refusal.code, "invalid_trigger");
  assert.equal(w.sets().length, before, "a refusal writes nothing");
});

test("a trigger written in GitHub's own case is read as a PR, and one no script reads says so in the brief", () => {
  const w = world();
  // Written by an entrance that takes any text (item_create), in the case GitHub spells the repository.
  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T1, trigger: "Acme/API#12" }, entity: "task", entity_id: T1 });
  w.store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#12" } });
  assert.deepEqual(why(w.input(), T1).rows.map((r) => [r.kind, r.predState]), [["trigger", "열림"]], "not 모름: the store's lower-case row is found");
  assert.deepEqual([w.fact()?.plannedBy, w.next().includes("선행 대기")], [null, true]);

  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T1, trigger: "when the vendor answers" }, entity: "task", entity_id: T1 });
  assert.deepEqual([w.fact()?.state, w.fact()?.plannedBy], ["planned", "trigger"]);
  assert.ok(w.next().includes("trigger 확인 필요"));
});

test("item set refuses an unknown item, an empty lead, a hold that is not a boolean, and a call that sets nothing", () => {
  const w = world();
  const code = (r: ReturnType<typeof itemSet>) => (r.ok ? "ok" : r.refusal.code);
  assert.equal(code(itemSet({ lead: "api" }, ["i999"], w)), "not_found");
  assert.equal(code(itemSet({ lead: " " }, ["i001"], w)), "invalid_input");
  assert.equal(code(itemSet({ hold: "yes" }, ["i001"], w)), "invalid_input");
  assert.equal(code(itemSet({}, ["i001"], w)), "invalid_input");
  assert.equal(code(itemSet({ lead: "api" }, [], w)), "not_found");
  assert.deepEqual(w.sets(), []);
});
