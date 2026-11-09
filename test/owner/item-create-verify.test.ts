import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreateTool } from "../../claude-plugin/mcp/tools/item_create.ts";
import { itemNew } from "../../cli/commands/item-new.ts";
import { createOrcaAdapter, Store } from "../../core/index.ts";
import { createFakeOrca } from "../fake-orca/index.ts";

const fresh = () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-create": { ok: true, result: { taskId: "task_7" } } } });
  return { fake, ports: { orca: createOrcaAdapter(fake.exec), store: Store.open({ path: ":memory:" }) } };
};
const base = { run: "r", spec: "s", who: "owner", "done-when": "promoted" };
const mcpBase = { runId: "r", spec: "s", who: "owner", doneWhen: "promoted" };
const verify = { kind: "run_ok", repo: "acme/api" };
const extraRows = (s: Store) => s.events().filter((e) => e.type === "item_extra_set").map((e) => e.payload);

test("verify and cmd_hint land as one item_extra_set row through both entrances", async () => {
  const cli = fresh();
  const viaCli = await itemNew({ ...base, verify: JSON.stringify(verify), "cmd-hint": "gh workflow run promote.yml" }, cli.ports);
  const mcp = fresh();
  const viaMcp = await itemCreateTool({ ...mcpBase, verify, cmdHint: "gh workflow run promote.yml" }, mcp.ports);
  assert.deepEqual(viaCli, { ok: true, value: { task: "task_7", alias: "i001" } });
  assert.deepEqual(viaMcp, viaCli);
  const want = [{ task: "task_7", verify, cmd_hint: "gh workflow run promote.yml" }];
  assert.deepEqual(extraRows(cli.ports.store), want);
  assert.deepEqual(extraRows(mcp.ports.store), want);
});

test("without verify or cmd_hint nothing extra is written", async () => {
  const cli = fresh();
  await itemNew(base, cli.ports);
  assert.deepEqual(extraRows(cli.ports.store), []);
});

test("a verify kind outside the five, or one missing its operand, is refused before Orca by both", async () => {
  for (const bad of [{ kind: "mcp_state" }, { kind: "pr_found", repo: "acme/api" }]) {
    const cli = fresh();
    const viaCli = await itemNew({ ...base, verify: JSON.stringify(bad) }, cli.ports);
    const mcp = fresh();
    const viaMcp = await itemCreateTool({ ...mcpBase, verify: bad }, mcp.ports);
    assert.equal(!viaCli.ok && viaCli.refusal.code, "invalid_verify");
    assert.deepEqual(viaMcp, viaCli);
    assert.equal(cli.fake.calls.length + mcp.fake.calls.length, 0);
  }
});
