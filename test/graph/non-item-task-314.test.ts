import assert from "node:assert/strict";
import { test } from "node:test";
import { graphRead, readiness, Store, type ViewInput, type ViewTask } from "../../core/index.ts";
import { readyKeys } from "../../core/graph/notify-ready.ts";
import { readyText } from "../../claude-plugin/mcp/resources/ready.ts";
import { itemFacts } from "../../core/index.ts";

// Decision 314: an Orca Task with no item_created row is not a sangsoe item. ready, the waiting list
// and the item_ready keys read items only, as the brief does.

const ITEM = "task_000000000001";
const OTHER = "task_000000000002";
const OTHER_BLOCKED = "task_000000000003";
const OTHER_AFTER = "task_000000000004";

function world(): ViewInput {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  store.append({ type: "item_created", source: "test", payload: { task: ITEM, alias: "i001", who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: ITEM });
  const tasks: ViewTask[] = [
    { id: ITEM, runId: "run_a", status: "ready", deps: [] },
    { id: OTHER, runId: "run_a", status: "ready", deps: [] },
    { id: OTHER_BLOCKED, runId: "run_a", status: "blocked", deps: [] },
    { id: OTHER_AFTER, runId: "run_a", status: "pending", deps: [OTHER] },
  ];
  return { events: store.events(), orca: { tasks, gates: [] }, now: "2026-11-10T12:00:00.000Z" };
}

test("readiness leaves a Task without item_created out", () => {
  assert.deepEqual(readiness(world()).map((r) => r.task), [ITEM]);
});

test("the ready start list, the waiting list and the item_ready keys hold the item only", () => {
  const input = world();
  assert.deepEqual(graphRead.ready(input).map((r) => r.task), [ITEM]);
  assert.deepEqual([...readyKeys(input).keys()], [ITEM]);
  const text = readyText(input);
  assert.match(text, /i001/);
  for (const t of [OTHER, OTHER_BLOCKED, OTHER_AFTER]) assert.doesNotMatch(text, new RegExp(t));
});

test("resource ready and the brief count the same 🟢 items", () => {
  const input = world();
  const greens = (readyText(input).match(/^🟢 /gm) ?? []).length;
  assert.equal(greens, itemFacts(input).filter((f) => f.state === "ready").length);
  assert.equal(greens, 1);
});
