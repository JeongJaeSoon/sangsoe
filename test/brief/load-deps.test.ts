import assert from "node:assert/strict";
import { test } from "node:test";
import { type OrcaAdapter, readSnapshot, ready, Store } from "../../core/index.ts";

// Decision 178: the brief and the `ready` resource read the same Orca deps start_unit reads, so a
// dependent of a completed Task with its PR open is not listed as ready.

const fake = (rows: unknown[]) =>
  ({
    taskList: async () => ({ ok: true, value: rows }),
    gateList: async () => ({ ok: true, value: [] }),
  }) as unknown as OrcaAdapter;

test("the brief's snapshot keeps Orca deps: the dependent waits while its predecessor's PR is open", async () => {
  const snap = await readSnapshot(
    fake([
      { id: "task_a", status: "completed", title: "a", deps: "[]" },
      { id: "task_b", status: "ready", title: "b", deps: JSON.stringify(["task_a"]) },
    ]),
    ["run_x"],
  );
  assert.ok(snap.ok);
  assert.deepEqual(snap.value.tasks.find((t) => t.id === "task_b")?.deps, ["task_a"]);
  const store = Store.open({ path: ":memory:", clock: () => "2026-11-10T09:00:00.000Z" });
  store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#31", task: "task_a" } });
  const input = { events: store.events(), orca: snap.value, now: "2026-11-10T12:00:00.000Z" };
  assert.deepEqual(
    ready(input).map((r) => r.task),
    [],
  );
});

test("an unreadable deps value does not fail the brief; that Task reads as having none", async () => {
  const snap = await readSnapshot(fake([{ id: "task_c", status: "ready", title: "c", deps: "not json" }]), ["run_x"]);
  assert.ok(snap.ok);
  assert.deepEqual(snap.value.tasks[0]?.deps, []);
});
