import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, dedupeKey, type EdgeKind, EVENTS, graphRead, itemFacts, owner_todo, ownerDone, Store, type ViewInput, type ViewTask, why } from "../../core/index.ts";

// An owner item's state comes from GRAPH readiness, not from Orca's status alone (decision 147).

const NOW = "2026-11-10T12:00:00.000Z";
const PRE = "task_000000000001";
const OWN = "task_000000000002";
const FREE = "task_000000000003";
const LEAD = "task_000000000004";
const GONE = "task_000000000009";

function edge(store: Store, pred: string, succ: string, kind: EdgeKind) {
  const p = `item:${pred}`;
  const s = `item:${succ}`;
  store.append({ type: "edge_added", source: "GRAPH", payload: { pred: p, succ: s, kind }, dedupe_key: dedupeKey(EVENTS.edge_added, p, s, kind) });
}

function world(extra?: (store: Store) => void): ViewInput {
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  const item = (task: string, alias: string, who: string, execBy?: "owner") => {
    store.append({ type: "item_created", source: "test", payload: { task, alias, who, done_when: "done", owner_action: 0 }, entity: "task", entity_id: task });
    if (execBy) store.append({ type: "item_extra_set", source: "test", payload: { task, exec_by: execBy }, entity: "task", entity_id: task });
  };
  item(PRE, "i001", "lead:api");
  item(OWN, "i002", "owner", "owner");
  item(FREE, "i003", "owner", "owner");
  item(LEAD, "i004", "lead:api");
  store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#7", task: PRE } });
  edge(store, PRE, OWN, "deploys_after");
  extra?.(store);
  const task = (id: string, status: ViewTask["status"]): ViewTask => ({ id, runId: "run_a", status, deps: [] });
  return {
    events: store.events(),
    orca: { tasks: [task(PRE, "dispatched"), task(OWN, "ready"), task(FREE, "pending"), task(LEAD, "pending")], gates: [] },
    now: NOW,
  };
}

const stateOf = (input: ViewInput, task: string) => itemFacts(input).find((f) => f.task === task)?.state;

test("an owner item Orca calls ready but GRAPH holds behind deploys_after is 📅 and takes no 완료", async () => {
  const input = world();
  assert.equal(why(input, OWN).readiness, "waiting");
  assert.equal(stateOf(input, OWN), "planned");
  assert.ok(!owner_todo(input).some((r) => r.ref === "i002"), "not on the owner's to-do");
  const row = buildBrief(input).inProgress.rows.find((r) => r.id === "i002");
  assert.equal(row?.cells[0]?.text, "📅");
  const done = await ownerDone(
    { orca: { taskUpdate: async () => assert.fail("no task-update for a 📅 item") }, store: Store.open({ path: ":memory:" }) },
    input,
    itemFacts(input),
    { task: "i002" },
  );
  assert.equal(done.ok ? "ok" : done.refusal.code, "not_ready");
});

test("owner_ready and plain ready items stay 🟢: the owner's on owner_todo, the lead's in progress", () => {
  const input = world();
  assert.deepEqual(
    graphRead.ready(input).map((r) => r.task),
    [FREE, LEAD],
    "the brief's port keeps owner_ready rows",
  );
  assert.equal(stateOf(input, FREE), "ready");
  assert.equal(stateOf(input, LEAD), "ready");
  assert.deepEqual(
    owner_todo(input).map((r) => [r.kind, r.ref]),
    [["owner_item", "i003"]],
  );
});

test("unknown readiness is not ready: an edge from a Task Orca does not list leaves the item 📅", () => {
  const input = world((store) => edge(store, GONE, LEAD, "blocks"));
  assert.equal(why(input, LEAD).readiness, "waiting");
  assert.equal(stateOf(input, LEAD), "planned");
});
