import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { itemNew } from "./item-new.ts";
import { recover } from "./recover.ts";

test("sangsoe recover prints the table and exits 0", async () => {
  const r = await recover([], createOrcaAdapter(createFakeOrca().exec));
  assert.equal(r.code, 0);
  assert.match(r.out, /\| · \| task_000000000001 \| ctx_000000000001/);
});

test("sangsoe recover rejects an unknown option and a bad limit", async () => {
  const orca = createOrcaAdapter(createFakeOrca().exec);
  assert.equal((await recover(["--force"], orca)).code, 2);
  assert.equal((await recover(["--limit", "0"], orca)).code, 2);
});

test("sangsoe item new needs its four fields and prints alias and Task", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
  const store = Store.open({ path: ":memory:" });
  const ports = { orca: createOrcaAdapter(fake.exec), store };
  assert.equal((await itemNew(["--run", "r"], ports)).code, 2);
  const r = await itemNew(["--run", "r", "--spec", "s", "--who", "lead:api", "--done-when", "merged", "--deps", "task_1, task_2"], ports);
  assert.deepEqual(r, { code: 0, out: "i001 task_7" });
  const call = fake.calls[0] ?? [];
  assert.equal(call[call.indexOf("--deps") + 1], '["task_1","task_2"]');
});
