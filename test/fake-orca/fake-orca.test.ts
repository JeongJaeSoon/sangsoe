import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrcaAdapter, runChecks, START_CHECKS } from "../../core/index.ts";
import { createFakeOrca } from "./index.ts";

// Other units use the fake exactly like this: through core/index.ts, with no Orca on the machine.
test("a unit outside the core drives the adapter and the checks on the fake", async () => {
  const fake = createFakeOrca();
  const orca = createOrcaAdapter(fake.exec);
  const workers = await orca.workerList({});
  assert.ok(workers.ok);
  assert.equal(workers.value.rows.length, 2);
  const results = await runChecks(START_CHECKS, { orca, exec: fake.exec, coreVersion: "0.1.0" });
  assert.equal(results.length, START_CHECKS.length);
});

test("a scenario falls back to the local recording for files it does not override", async () => {
  const orca = createOrcaAdapter(createFakeOrca({ scenario: "hooks-off" }).exec);
  const status = await orca.status();
  assert.ok(status.ok && status.value.runtime.reachable);
});

test("commands outside ORCA_COMMANDS are refused, so no test can reach them", async () => {
  const { exec } = createFakeOrca();
  await assert.rejects(exec("orca", ["automations", "list", "--json"]), /not in ORCA_COMMANDS/);
  await assert.rejects(exec("git", ["status"]), /is not faked/);
  await assert.rejects(exec("orca", ["worktree", "rm", "--worktree", "x", "--force", "--json"]), /--force is not in ORCA_COMMANDS/);
  assert.throws(() => createFakeOrca({ scenario: "no-such-scenario" }), /no scenario/);
});

test("writes without a recording answer ok and are recorded as calls", async () => {
  const fake = createFakeOrca();
  const r = await createOrcaAdapter(fake.exec).gateResolve({ id: "gate_1", resolution: "yes" });
  assert.deepEqual(r, { ok: true, value: {} });
  assert.deepEqual(fake.calls[0]?.slice(1, 3), ["orchestration", "gate-resolve"]);
});

test("reads without a recording fail instead of inventing data", async () => {
  const r = await createOrcaAdapter(createFakeOrca().exec).referenceFind({ query: "export" });
  assert.equal(!r.ok && r.error.code, "fake_not_recorded");
});
