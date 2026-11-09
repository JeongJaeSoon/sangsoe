import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { createOrcaAdapter } from "../orca/adapter.ts";
import { recoverPlan, renderRecover } from "./recover.ts";

const WRITES = new Set(["task-create", "task-update", "worker-start", "worker-release", "send", "run-use", "run-create"]);

test("recover reads worker-list only and writes nothing", async () => {
  const fake = createFakeOrca();
  const plan = await recoverPlan(createOrcaAdapter(fake.exec));
  assert.ok(!("error" in plan));
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(
    fake.calls.map((c) => c.slice(1, 3).join(" ")),
    ["orchestration worker-list"],
  );
  assert.ok(fake.calls.every((c) => !WRITES.has(c[2] ?? "")));
});

test("a worker that is neither live nor settled is marked lost", async () => {
  const fake = createFakeOrca({
    replies: {
      "orchestration-worker-list": {
        ok: true,
        result: {
          workers: [
            { dispatchId: "ctx_a", taskId: "task_a", state: "ready", liveness: "gone", workspace: "w-a", host: "local" },
            { dispatchId: "ctx_b", taskId: "task_b", state: "settled", liveness: "gone", workspace: "w-b", host: "local" },
            // The shape real Orca 1.4.250 printed for a finished worker.
            { dispatchId: "ctx_c", taskId: "task_c", state: "succeeded", liveness: "exited", terminalState: "released", host: "local" },
          ],
        },
      },
    },
  });
  const plan = await recoverPlan(createOrcaAdapter(fake.exec));
  assert.ok(!("error" in plan));
  assert.deepEqual(
    plan.rows.map((r) => r.lost),
    [true, false, false],
  );
  const out = renderRecover(plan).join("\n");
  assert.match(out, /\| ⚠️ \| task_a \| ctx_a/);
  assert.match(out, /잃었을 수 있는 것 1개/);
});

test("an unreadable worker-list is one error line, not an empty table", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-worker-list": { ok: false, error: { code: "runtime_unavailable", message: "x" } } } });
  const lines = renderRecover(await recoverPlan(createOrcaAdapter(fake.exec)));
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /runtime_unavailable/);
});
