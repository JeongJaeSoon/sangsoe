// Decision 209: every model and effort start_unit can hand to worker-start is one Orca takes. The
// matrix is the fake's mirror of Orca's own launch check (test/fake-orca), kept apart from the table.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EFFORTS,
  launchModel,
  type ModelChoice,
  MODEL_CATALOG as CATALOG,
  MODEL_KINDS as KINDS,
  MODEL_POLICY as POLICY,
  type ModelKind,
  resolveModel,
} from "../core/index.ts";
import { launchRefusal } from "./fake-orca/index.ts";

const startArgs = (model: string, effort?: string) => [
  "orchestration",
  "worker-start",
  "--agent",
  "claude",
  "--model",
  model,
  ...(effort ? ["--effort", effort] : []),
];

test("each catalog row's orcaEfforts is exactly what Orca's launch check takes for its alias", () => {
  for (const row of CATALOG) {
    for (const effort of EFFORTS) {
      const takes = launchRefusal(startArgs(row.alias, effort)) === null;
      assert.equal(row.orcaEfforts.includes(effort), takes, `${row.tier} ${effort}`);
    }
    assert.equal(launchRefusal(startArgs(row.alias)), null, `${row.tier} without effort`);
  }
});

/** Every choice resolve can return for a kind: its row, each rung of its ladder, and its next tier. */
function choices(kind: ModelKind): ModelChoice[] {
  const row = POLICY[kind];
  const raises = [{}, ...row.raiseEffort.map((effort) => ({ effort, reason: "r" }))];
  const top = row.raiseEffort.at(-1) ?? row.effort;
  if (row.thenTier) raises.push({ effort: top, tier: row.thenTier, reason: "r" });
  return raises.map((raise) => {
    const r = resolveModel(kind, raise);
    assert.ok(r.ok, `${kind} ${JSON.stringify(raise)}: ${r.ok ? "" : r.reason}`);
    return r.value;
  });
}

const PATHS = [
  { orcaFlag: true, ownerSetting: false },
  { orcaFlag: false, ownerSetting: false, worktreeFile: true },
  { orcaFlag: false, ownerSetting: false, worktreeFile: true, spent: true },
  { orcaFlag: false, ownerSetting: true },
  { orcaFlag: false, ownerSetting: false },
  { orcaFlag: false, ownerSetting: true, spent: true },
];

test("every launch start_unit can build, on every advisor path, is a model and effort Orca takes", () => {
  let checked = 0;
  for (const kind of KINDS) {
    for (const choice of choices(kind)) {
      // A pinned dated id is not in Orca's catalog; the effort still follows the tier's row.
      for (const c of [choice, { ...choice, model: "pinned-dated-id" }]) {
        for (const path of PATHS) {
          const plan = launchModel(c, path);
          const refused = launchRefusal(startArgs(plan.model, plan.effort));
          assert.equal(refused, null, `${kind} ${c.model}/${c.effort} ${JSON.stringify(path)}: ${refused}`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > KINDS.length * PATHS.length);
});

test("the fake refuses an effort on a model whose Orca row lists none, as Orca does", () => {
  const without = CATALOG.filter((c) => c.orcaEfforts.length === 0);
  assert.ok(without.length > 0, "the catalog has a model Orca starts without effort");
  for (const row of without) {
    assert.match(launchRefusal(startArgs(row.alias, "low")) ?? "", /does not support effort low/);
  }
  assert.equal(launchRefusal(["orchestration", "worker-start", "--agent", "claude", "--effort", "low"]), "--effort requires --model.");
});
