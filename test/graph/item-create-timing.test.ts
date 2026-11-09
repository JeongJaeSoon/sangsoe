import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import { createServer } from "../../claude-plugin/mcp/server.ts";
import { createOrcaAdapter, Store, type ViewInput, why } from "../../core/index.ts";
import { createFakeOrca } from "../fake-orca/index.ts";

// Decision 162: intake's 📅 scheduled and ⏸️ held items get their trigger in the item_create call
// itself, so no lead sees them ready between the Task and the row that holds them back.
const NOW = "2026-11-10T12:00:00.000Z";
const base = { runId: "r", spec: "s", who: "lead:api", doneWhen: "npm test" };

async function created(extra: Record<string, unknown>) {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
  const store = Store.open({ path: ":memory:" });
  const r = await itemCreate({ ...base, ...extra }, { orca: createOrcaAdapter(fake.exec), store });
  assert.ok(r.ok, JSON.stringify(r));
  const input: ViewInput = { orca: { tasks: [{ id: "task_7", runId: "r", status: "pending", deps: [] }], gates: [] }, events: store.events(), now: NOW };
  const rows = store.events().filter((e) => e.type === "item_extra_set").map((e) => e.payload);
  return { report: why(input, "i001"), rows };
}

test("a future date trigger is 📅, not ready, until the date passes", async () => {
  const { report, rows } = await created({ trigger: "2026-11-17", exec_by: "lead" });
  assert.deepEqual(rows, [{ task: "task_7", trigger: "2026-11-17", exec_by: "lead" }]);
  assert.equal(report.readiness, "waiting");
  assert.deepEqual(report.rows.map((r) => [r.kind, r.predState]), [["trigger", "2026-11-17 전"]]);
});

test("hold with a review trigger in words is ⏸️, not ready", async () => {
  const { report, rows } = await created({ hold: true, review_trigger: "after the vendor answers" });
  assert.deepEqual(rows, [{ task: "task_7", hold: true, review_trigger: "after the vendor answers" }]);
  assert.deepEqual(report.rows.map((r) => r.kind), ["hold"]);
});

test("no timing input writes no row and the item is ready", async () => {
  const { report, rows } = await created({});
  assert.deepEqual([rows, report.readiness], [[], "ready"]);
});

test("an empty trigger is refused before the Task exists; verify and timing share one row", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
  const store = Store.open({ path: ":memory:" });
  const ports = { orca: createOrcaAdapter(fake.exec), store };
  for (const bad of [{ hold: true, review_trigger: "" }, { trigger: "" }]) {
    const r = await itemCreate({ ...base, ...bad }, ports);
    assert.equal(r.ok ? "" : r.refusal.code, "invalid_input", JSON.stringify(bad));
  }
  assert.deepEqual([fake.calls.length, store.events().length], [0, 0], "no Task, no row");
  const verify = { kind: "run_ok", repo: "acme/api" };
  assert.ok((await itemCreate({ ...base, verify, trigger: "2026-11-17" }, ports)).ok);
  assert.deepEqual(
    store.events().filter((e) => e.type === "item_extra_set").map((e) => e.payload),
    [{ task: "task_7", verify, trigger: "2026-11-17" }],
  );
});

test("a timing field of the wrong type is refused before Orca is called", async () => {
  const server = await createServer();
  for (const bad of [{ hold: "yes" }, { exec_by: "reviewer" }, { trigger: 20261117 }]) {
    const res = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "item_create", arguments: { ...base, ...bad } } })) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(res.result.isError, true);
    assert.equal(JSON.parse(res.result.content[0]?.text ?? "").code, "invalid_input", JSON.stringify(bad));
  }
});
