import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreateTool } from "../../claude-plugin/mcp/tools/item_create.ts";
import { createOrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { itemNew } from "./item-new.ts";

// Both wrappers on one fake Orca and an in-memory store. The real handlers open the user's
// sqlite and real Orca, so viaMcp/viaCli cannot drive them without writing outside the test.
const fresh = () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
  return { fake, ports: { orca: createOrcaAdapter(fake.exec), store: Store.open({ path: ":memory:" }) } };
};

test("sangsoe item new and MCP item_create give the same Outcome on the same Orca", async () => {
  const cli = fresh();
  const viaCli = await itemNew({ run: "r", spec: "s", who: "lead:api", "done-when": "merged", deps: "task_1, task_2" }, cli.ports);
  const mcp = fresh();
  const viaMcp = await itemCreateTool({ runId: "r", spec: "s", who: "lead:api", doneWhen: "merged", deps: ["task_1", "task_2"] }, mcp.ports);
  assert.deepEqual(viaCli, { ok: true, value: { task: "task_7", alias: "i001" } });
  assert.deepEqual(viaMcp, viaCli);
  const call = cli.fake.calls[0] ?? [];
  assert.equal(call[call.indexOf("--deps") + 1], '["task_1","task_2"]');
  assert.deepEqual(mcp.fake.calls, cli.fake.calls);
});

test("empty fields are refused the same way through both entrances, before Orca", async () => {
  const cli = fresh();
  const viaCli = await itemNew({ run: "r", spec: "", who: " ", "done-when": "" }, cli.ports);
  const mcp = fresh();
  const viaMcp = await itemCreateTool({ runId: "r", spec: "", who: " ", doneWhen: "" }, mcp.ports);
  assert.equal(!viaCli.ok && viaCli.refusal.code, "invalid_input");
  assert.deepEqual(viaMcp, viaCli);
  assert.equal(cli.fake.calls.length + mcp.fake.calls.length, 0);
});
