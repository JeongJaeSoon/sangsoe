import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as skipTool } from "../../claude-plugin/mcp/tools/flow_step_skip.ts";
import { graphSkipCommand } from "../../cli/commands/graph-skip.ts";
import { doneBlockers, expandFlow, loadFlow, planFlow } from "../../core/index.ts";
import { bindItem, createGraphWorld, type GraphWorld } from "./world.ts";

const RUN = "run_a";

/** ship-change cut short before deploy_prod: the root item's ✅ waits on flow_gap. */
async function cutFlow(): Promise<{ w: GraphWorld; root: string }> {
  const w = createGraphWorld();
  const p = planFlow(loadFlow("ship-change"), { repo: "acme/api" });
  assert.ok(p.ok);
  w.failCreateAfter(6);
  await expandFlow(w, { plan: p.value, run: RUN, who: "lead:api", requestId: "req-gap" });
  const root = [...w.tasks.values()].find((t) => t.parent === null)?.id as string;
  for (const t of w.tasks.values()) if (t.parent === root) w.complete(t.id);
  bindItem(w, root, "i001");
  return { w, root };
}

test("flow_step_skip / graph skip: a reasoned skip clears flow_gap, through the root's alias, once", async () => {
  const { w, root } = await cutFlow();
  assert.deepEqual(doneBlockers(await w.input(), root), ["flow_gap: deploy_prod"]);

  const r = await skipTool({ root: "i001", step: "deploy_prod", reason: "internal tool, no prod" }, w);
  assert.deepEqual(r, { ok: true, value: { status: "skipped", root: `item:${root}`, step: "deploy_prod" } });
  assert.deepEqual(doneBlockers(await w.input(), root), []);
  const rows = w.store.events({ type: "flow_step_skipped" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.subject, `item:${root}`);
  assert.deepEqual(rows[0]?.payload, { step: "deploy_prod", reason: "internal tool, no prod" });

  const again = await graphSkipCommand({ root: `item:${root}`, step: "deploy_prod", reason: "same" }, w);
  assert.deepEqual(again, { ok: true, value: { status: "already", root: `item:${root}`, step: "deploy_prod" } });
  assert.equal(w.store.events({ type: "flow_step_skipped" }).length, 1);
});

test("flow_step_skip / graph skip refuse a skip with no reason, and a root or step the flow does not have, writing nothing", async () => {
  const { w, root } = await cutFlow();
  for (const reason of ["", "   "]) {
    const tool = await skipTool({ root: "i001", step: "deploy_prod", reason }, w);
    const cli = await graphSkipCommand({ root: "i001", step: "deploy_prod", reason }, w);
    assert.deepEqual(cli, tool);
    assert.ok(!tool.ok && tool.refusal.code === "invalid_input", JSON.stringify(tool));
  }
  const step = await skipTool({ root: "i001", step: "deploy_moon", reason: "r" }, w);
  assert.ok(!step.ok && step.refusal.code === "unknown_step" && step.refusal.fix.includes("deploy_prod"), JSON.stringify(step));
  const child = [...w.tasks.values()].find((t) => t.parent === root)?.id as string;
  const noFlow = await skipTool({ root: `item:${child}`, step: "deploy_prod", reason: "r" }, w);
  assert.ok(!noFlow.ok && noFlow.refusal.code === "no_flow", JSON.stringify(noFlow));
  const notItem = await skipTool({ root: "acme/api#3", step: "deploy_prod", reason: "r" }, w);
  assert.ok(!notItem.ok && notItem.refusal.code === "invalid_input", JSON.stringify(notItem));
  assert.equal(w.store.events({ type: "flow_step_skipped" }).length, 0);
  assert.deepEqual(doneBlockers(await w.input(), root), ["flow_gap: deploy_prod"]);
});
