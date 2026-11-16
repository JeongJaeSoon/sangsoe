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

test("decision 318 (4): a unit that sent worker_done (READY-WAIT included) holds no slot, whatever Orca's row still says", async () => {
  const row = (dispatchId: string, state: string) => ({ dispatchId, taskId: `task_${dispatchId}`, state, liveness: "live", workspace: "w", host: "local" });
  const workers = [row("ctx_a", "ready"), row("ctx_b", "succeeded"), row("ctx_c", "ready")];
  const fake = createFakeOrca({ replies: { "orchestration-worker-list": { ok: true, result: { workers, scope: { source: "flag" } } } } });
  const orca = createOrcaAdapter(fake.exec);
  const store = Store.open({ path: ":memory:" });
  store.append({ type: "worker_done", source: "orca-monitor", payload: { dispatch: "ctx_c", task: "task_ctx_c" }, entity: "dispatch", entity_id: "ctx_c" });
  // Only ctx_a counts: ctx_b is Orca's finished state, ctx_c's worker_done reached the store first.
  assert.equal(await runSlots(orca, "run_1", 2, { load5: 1, cpus: 8 }, store), 1);
  assert.equal(await runSlots(orca, "run_1", 2, { load5: 1, cpus: 8 }), 0, "without the store, ctx_c still counts");
});
