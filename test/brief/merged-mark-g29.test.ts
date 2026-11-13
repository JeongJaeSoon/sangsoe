import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBrief, expandFlow, itemFacts, loadFlow, planFlow } from "../../core/index.ts";
import { bindItem, createGraphWorld, type GraphWorld } from "../graph/world.ts";

// G29 (decision 212 ⑤): a merged item whose merge sets off a deploy (a deploys_after edge in its flow)
// reads ✅ 🔍 in the brief until the dev stage is recorded and passing dev evidence exists.

const PR = "acme/api#8";
const SHA = "abc1234";

async function shipped(w: GraphWorld) {
  const p = planFlow(loadFlow("ship-change"), { repo: "acme/api" });
  assert.ok(p.ok, JSON.stringify(p));
  const e = await expandFlow(w, { plan: p.value, run: "run_a", who: "lead:api", requestId: "req-1" });
  assert.ok(e.ok, JSON.stringify(e));
  const impl = (e.value.steps as Record<string, string>).impl as string;
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task: impl } });
  w.store.append({ type: "evidence", source: "evidence record", subject: PR, payload: { kind: "test", exit_code: 0, not_verified: ["prod"] } });
  w.complete(impl);
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: PR, merge_sha: SHA } });
  return impl;
}

const short = async (w: GraphWorld, task: string) => itemFacts(await w.input()).find((f) => f.task === task)?.evidenceShort;

test("a merged deploys_after item stays 🔍 until the dev stage and passing dev evidence are both there", async () => {
  const w = createGraphWorld();
  const impl = await shipped(w);
  assert.equal(await short(w, impl), true, "merged, no dev stage: 🔍");
  assert.equal(buildBrief({ ...(await w.input()), runs: [] } as never).evidenceShort > 0, true, "the overview counts it");

  w.store.append({ type: "stage_recorded", source: "lead:api", payload: { pr: PR, stage: "dev", sha: SHA } });
  assert.equal(await short(w, impl), true, "a stage row alone");
  w.store.append({ type: "evidence", source: "lead:api", subject: PR, payload: { kind: "dev", exit_code: 1, not_verified: ["prod"] } });
  assert.equal(await short(w, impl), true, "failing dev evidence");
  w.store.append({ type: "evidence", source: "lead:api", subject: PR, payload: { kind: "dev", exit_code: 0, not_verified: ["prod"] } });
  assert.equal(await short(w, impl), false, "dev stage and passing dev evidence: ✅");
});

test("a merged item with no deploys_after edge reads ✅ on its own evidence", async () => {
  const w = createGraphWorld();
  w.task("t_plain", "run_a");
  bindItem(w, "t_plain", "i001");
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#9", task: "t_plain" } });
  w.store.append({ type: "evidence", source: "evidence record", subject: "acme/api#9", payload: { kind: "test", exit_code: 0, not_verified: ["prod"] } });
  w.complete("t_plain");
  w.store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: "acme/api#9", merge_sha: SHA } });
  assert.equal(await short(w, "t_plain"), false);
});
