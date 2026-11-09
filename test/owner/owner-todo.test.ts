import assert from "node:assert/strict";
import { test } from "node:test";
import { ownerTodoFrom } from "../../core/index.ts";
import { ownerWorld } from "./world.ts";

const T = "task_000000000001";

// U10's LATER: a refused orchestrator start writes escalation{to: owner}; decision 94 (다) and the
// glossary "시작 거부" put it on owner_todo. It counts as that item's one row, not a fifth kind, and
// leaves only when Orca shows the Task moved on.
test("an orchestrator's refused start is the owner's row for that item until the Task moves", () => {
  const w = ownerWorld();
  w.item(T, { who: "lead:api", status: "pending" });
  assert.deepEqual(ownerTodoFrom(w.input(), w.facts()), []);
  w.store.append({ type: "escalation", source: "core:start", payload: { to: "owner", reason: "start_refused:depth_exceeded" }, entity: "task", entity_id: T });
  const rows = ownerTodoFrom(w.input(), w.facts());
  assert.deepEqual(rows.map((r) => [r.kind, r.ref, r.whyOwner]), [["owner_item", "i001", "start_refused:depth_exceeded"]]);

  // A worktree-only refusal names no item: no row (reported as a finding).
  w.store.append({ type: "escalation", source: "core:start", payload: { to: "owner", reason: "start_refused:no_dispatch" }, entity: "task", entity_id: "wt_000000000001" });
  assert.equal(ownerTodoFrom(w.input(), w.facts()).length, 1);

  // Orca shows the Task dispatched: an observed fact, the row leaves.
  const t = w.tasks.get(T);
  assert.ok(t);
  t.status = "dispatched";
  assert.deepEqual(ownerTodoFrom(w.input(), w.facts()), []);
});

test("one item, one row: an owner item that is also refused shows once", () => {
  const w = ownerWorld();
  w.item(T, { status: "ready" });
  w.store.append({ type: "escalation", source: "core:start", payload: { to: "owner", reason: "start_refused:capability_missing" }, entity: "task", entity_id: T });
  assert.equal(ownerTodoFrom(w.input(), w.facts()).length, 1);
});
