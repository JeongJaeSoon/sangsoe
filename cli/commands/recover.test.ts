import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreateTool } from "../../claude-plugin/mcp/tools/item_create.ts";
import { createOrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { run } from "../main.ts";
import { itemNew } from "./item-new.ts";
import { recover } from "./recover.ts";

test("sangsoe recover prints the table and exits 0", async () => {
  const r = await recover({}, createOrcaAdapter(createFakeOrca().exec));
  assert.ok("lines" in r && r.code === 0);
  assert.match(r.lines.join("\n"), /\| · \| task_000000000001 \| ctx_000000000001/);
});

test("sangsoe recover and item new: the router rejects an unknown option, the command a bad limit", async () => {
  assert.equal((await run(["recover", "--force"])).code, 2);
  assert.equal((await run(["item", "new", "--force"])).code, 2);
  const bad = await recover({ limit: "0" }, createOrcaAdapter(createFakeOrca().exec));
  assert.equal("ok" in bad && !bad.ok && bad.refusal.code, "invalid_input");
  assert.match((await run(["--help"])).out, /recover .*\n.*item new|item new[\s\S]*recover/);
});

test("sangsoe item new and MCP item_create give the same Outcome on the same Orca", async () => {
  const fresh = () => {
    const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
    return { fake, ports: { orca: createOrcaAdapter(fake.exec), store: Store.open({ path: ":memory:" }) } };
  };
  const cli = fresh();
  const missing = await itemNew({ run: "r" }, cli.ports);
  assert.equal(!missing.ok && missing.refusal.code, "invalid_input");
  const viaCli = await itemNew({ run: "r", spec: "s", who: "lead:api", "done-when": "merged", deps: "task_1, task_2" }, cli.ports);
  const mcp = fresh();
  const viaMcp = await itemCreateTool({ runId: "r", spec: "s", who: "lead:api", doneWhen: "merged", deps: ["task_1", "task_2"] }, mcp.ports);
  assert.deepEqual(viaCli, { ok: true, value: { task: "task_7", alias: "i001" } });
  assert.deepEqual(viaMcp, viaCli);
  const call = cli.fake.calls[0] ?? [];
  assert.equal(call[call.indexOf("--deps") + 1], '["task_1","task_2"]');
  assert.deepEqual(mcp.fake.calls, cli.fake.calls);
});
