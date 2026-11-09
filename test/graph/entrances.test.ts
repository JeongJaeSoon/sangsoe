import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as edgeAddTool } from "../../claude-plugin/mcp/tools/edge_add.ts";
import { handle as edgeRemoveTool } from "../../claude-plugin/mcp/tools/edge_remove.ts";
import { handle as flowExpandTool } from "../../claude-plugin/mcp/tools/flow_expand.ts";
import { graphAddCommand } from "../../cli/commands/graph-add.ts";
import { graphExpandCommand } from "../../cli/commands/graph-expand.ts";
import { graphReadyCommand } from "../../cli/commands/graph-ready.ts";
import { graphRemoveCommand } from "../../cli/commands/graph-remove.ts";
import { graphWhyCommand } from "../../cli/commands/graph-why.ts";
import { run } from "../../cli/main.ts";
import { expectSameViaBothEntrances } from "../boundaries/both-entrances.ts";
import { bindItem, createGraphWorld, NOW } from "./world.ts";

test("edge_add / graph add and edge_remove / graph remove give the same Outcome", async () => {
  const a = createGraphWorld();
  const b = createGraphWorld();
  for (const w of [a, b]) {
    w.task("t_a", "run_a");
    w.task("t_b", "run_a");
    bindItem(w, "t_a", "i001");
    bindItem(w, "t_b", "i002");
  }
  const tool = await edgeAddTool({ kind: "after", pred: "i001", succ: "i002", runs: ["run_a"] }, a);
  const cli = await graphAddCommand({ kind: "after", pred: "i001", succ: "i002", run: ["run_a"] }, b);
  assert.deepEqual(cli, tool);
  assert.deepEqual(tool, { ok: true, value: { status: "added", pred: "item:t_a", succ: "item:t_b", kind: "after", where: "extra" } });

  const cyc = { kind: "after", pred: "i002", succ: "i001" };
  assert.deepEqual(await graphAddCommand({ ...cyc, run: ["run_a"] }, b), await edgeAddTool({ ...cyc, runs: ["run_a"] }, a));

  const rm = { kind: "after", pred: "i001", succ: "i002", reason: "no longer ordered" };
  const toolRm = await edgeRemoveTool({ ...rm, runs: ["run_a"] }, a);
  assert.deepEqual(await graphRemoveCommand({ ...rm, run: ["run_a"] }, b), toolRm);
  assert.ok(toolRm.ok);
});

test("flow_expand / graph expand --dry-run give the same plan through both wires", async () => {
  const o = await expectSameViaBothEntrances({
    tool: "flow_expand",
    input: { template: "ship-change", vars: { repo: "acme/api" }, dry_run: true },
    argv: ["graph", "expand", "--template", "ship-change", "--var", "repo=acme/api", "--dry-run"],
  });
  assert.ok(o.ok);
  const bad = await expectSameViaBothEntrances({
    tool: "flow_expand",
    input: { template: "no-such-flow", dry_run: true },
    argv: ["graph", "expand", "--template", "no-such-flow", "--dry-run"],
  });
  assert.ok(!bad.ok && bad.refusal.code === "bad_template");
});

test("flow_expand and graph expand write the same flow on two fake Orcas", async () => {
  const a = createGraphWorld();
  const b = createGraphWorld();
  const tool = await flowExpandTool({ template: "ship-change", vars: { repo: "acme/api" }, run: "run_a", who: "lead:api", request_id: "r1" }, a);
  const cli = await graphExpandCommand({ template: "ship-change", var: ["repo=acme/api"], run: "run_a", who: "lead:api", "request-id": "r1" }, b);
  assert.deepEqual(cli, tool);
  assert.ok(tool.ok);
});

test("graph ready and graph why on the fake Orca print the 🟢 list and decision 92④'s table", async () => {
  const w = createGraphWorld();
  w.task("t_pre", "run_a");
  w.task("t_send", "run_a", ["t_pre"]);
  w.task("t_ext", "run_a");
  bindItem(w, "t_pre", "i001");
  bindItem(w, "t_send", "i002");
  bindItem(w, "t_ext", "i003");
  await graphAddCommand({ kind: "stacked_on", pred: "acme/api#4", succ: "i003", run: ["run_a"] }, w);
  const ports = { orca: w.orca, store: w.store, now: () => NOW };
  assert.deepEqual(await graphReadyCommand({ run: ["run_a"] }, ports), { code: 0, lines: ["🟢 i001  t_pre"] });
  assert.deepEqual(await graphWhyCommand({ run: ["run_a"] }, ["i002"], ports), {
    code: 0,
    lines: ["i002: 📅 예정", "| 항목 | 막는 선행 | 간선 종류 | 선행 상태 | 해야 할 일 |", "|---|---|---|---|---|", "| i002 | item:t_pre | blocks | 📅 예정 | 선행 항목 ✅ 완료를 기다린다 |"],
  });
  const unknown = await graphWhyCommand({ run: ["run_a"] }, ["i003"], ports);
  assert.match(unknown.lines[3] ?? "", /\| i003 \| pr:acme\/api#4 \| stacked_on \| 모름: PR 상태를 읽지 못했다 \|/);
});

test("the graph commands refuse bad usage before anything runs", async () => {
  const noRun = await run(["graph", "ready"]);
  assert.equal(noRun.code, 2);
  assert.match(noRun.out, /missing --run/);
  const flag = await run(["graph", "add", "--pred", "i001", "--nope", "x"]);
  assert.equal(flag.code, 2);
});
