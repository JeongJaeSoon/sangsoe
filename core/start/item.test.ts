import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { Store } from "../store/store.ts";
import { createItem, runSlots } from "./item.ts";

test("createItem: task-create --deps on the Run, then one item_created row with Orca's ids only (decision 216: its Run)", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { task: { id: "task_9" } } } } });
  const store = Store.open({ path: ":memory:" });
  const r = await createItem(createOrcaAdapter(fake.exec), store, {
    run: "run_1",
    spec: "brief x",
    deps: ["task_1"],
    who: "lead:api",
    doneWhen: "PR merged",
  });
  assert.deepEqual(r, { ok: true, task: "task_9", alias: "i001" });
  const call = fake.calls[0] ?? [];
  assert.equal(call[call.indexOf("--deps") + 1], '["task_1"]');
  const rows = store.events({ type: "item_created" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.payload, { task: "task_9", alias: "i001", who: "lead:api", done_when: "PR merged", owner_action: 0, run: "run_1" });
});

test("createItem: a refused task-create writes nothing", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: false, error: { code: "dep_not_found", message: "x" } } } });
  const store = Store.open({ path: ":memory:" });
  const r = await createItem(createOrcaAdapter(fake.exec), store, { run: "r", spec: "s", who: "w", doneWhen: "d" });
  assert.equal(r.ok, false);
  assert.equal(store.events().length, 0);
});

test("runSlots: live workers against the limit; the recorded Run has one live worker", async () => {
  const orca = createOrcaAdapter(createFakeOrca().exec);
  assert.equal(await runSlots(orca, "run_000000000001", 3, { load5: 1, cpus: 8 }), 2);
  assert.equal(await runSlots(orca, "run_000000000001", 3, { load5: 40, cpus: 8 }), 0);
});
