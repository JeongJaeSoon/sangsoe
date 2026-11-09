import assert from "node:assert/strict";
import { test } from "node:test";
import { answerNotifiedKey, notify, reportAddress } from "../../core/index.ts";
import { createWorld } from "./world.ts";

const base = { subject: "d001 answered", body: "d001: go with B", msgType: "decision_gate" };

test("notify sends once to dispatch:<id> and records notified with the Task as target", async () => {
  const w = createWorld([]);
  const key = answerNotifiedKey("d001", "task_000000000001");
  const input = { ...base, key, to: "worker" as const, chain: { dispatch: "ctx_000000000001", leadRun: "run_000000000001" } };
  const first = await notify(w, input);
  assert.ok(first.ok);
  assert.equal(first.value.status, "sent");
  assert.equal(first.value.address, "dispatch:ctx_000000000001");
  const again = await notify(w, input);
  assert.ok(again.ok);
  assert.equal(again.value.status, "already");
  assert.equal(w.sends.length, 1);
  assert.equal(w.sends[0]?.to, "dispatch:ctx_000000000001");
  const rows = w.store.events({ type: "notified" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.target, "task_000000000001");
  assert.equal(rows[0]?.dedupe_key, "notify:task_000000000001:d001");
  assert.deepEqual(rows[0]?.payload, { msg_id: "msg_000000000001", to: "dispatch:ctx_000000000001", msg_type: "decision_gate" });
});

test("notify refuses term_ ids and pre-built addresses before calling Orca", async () => {
  const w = createWorld([]);
  const key = answerNotifiedKey("d001", "task_000000000001");
  for (const chain of [{ dispatch: "term_00000000-0000-4000-8000-000000000001" }, { leadRun: "run:run_000000000001" }]) {
    const to = "dispatch" in chain ? ("worker" as const) : ("lead" as const);
    const r = await notify(w, { ...base, key, to, chain });
    assert.ok(!r.ok);
    assert.equal(r.refusal.code, "address_form");
  }
  assert.equal(w.calls().length, 0);
  assert.equal(w.store.events({ type: "notified" }).length, 0);
});

test("notify refuses a send that skips the worker, then allows it once the worker was told", async () => {
  const w = createWorld([]);
  const key = answerNotifiedKey("d001", "task_000000000001");
  const chain = { dispatch: "ctx_000000000001", leadRun: "run_000000000001", orchestratorRun: "run_000000000009" };
  const early = await notify(w, { ...base, key, to: "lead", chain });
  assert.ok(!early.ok);
  assert.equal(early.refusal.code, "out_of_order");
  const skip = await notify(w, { ...base, key, to: "orchestrator", chain });
  assert.ok(!skip.ok);
  assert.equal(skip.refusal.code, "out_of_order");
  assert.equal(w.sends.length, 0);

  assert.ok((await notify(w, { ...base, key, to: "worker", chain })).ok);
  const lead = await notify(w, { ...base, key, to: "lead", chain });
  assert.ok(lead.ok);
  assert.equal(lead.value.address, "run:run_000000000001");
  const orch = await notify(w, { ...base, key, to: "orchestrator", chain });
  assert.ok(orch.ok);
  assert.equal(orch.value.address, "run:run_000000000009");
  assert.deepEqual(
    w.store.events({ type: "notified" }).map((e) => e.dedupe_key),
    ["notify:task_000000000001:d001", "notify:task_000000000001:d001:lead", "notify:task_000000000001:d001:orchestrator"],
  );
});

test("with no worker in the chain the owning lead is first and takes the base key", async () => {
  const w = createWorld([]);
  const key = answerNotifiedKey("d001", "task_000000000002");
  const r = await notify(w, { ...base, key, to: "lead", chain: { leadRun: "run_000000000001" } });
  assert.ok(r.ok);
  assert.equal(w.store.events({ type: "notified" })[0]?.dedupe_key, "notify:task_000000000002:d001");
});

test("notify refuses a tier with no id, and a failed send writes no notified", async () => {
  const w = createWorld([]);
  const key = answerNotifiedKey("d001", "task_000000000001");
  const none = await notify(w, { ...base, key, to: "worker", chain: { leadRun: "run_000000000001" } });
  assert.ok(!none.ok);
  assert.equal(none.refusal.code, "no_recipient");

  const down = createWorld([], { failSend: true });
  const failed = await notify(down, { ...base, key, to: "lead", chain: { leadRun: "run_000000000001" } });
  assert.ok(!failed.ok);
  assert.equal(failed.refusal.code, "send_failed");
  assert.equal(down.store.events({ type: "notified" }).length, 0);
});

test("reportAddress takes run: and dispatch: addresses and refuses a terminal handle", () => {
  assert.ok(reportAddress("run:run_000000000001").ok);
  assert.ok(reportAddress("dispatch:ctx_000000000001").ok);
  const term = reportAddress("term_00000000-0000-4000-8000-000000000001");
  assert.ok(!term.ok);
  assert.equal(term.refusal.code, "term_address");
  assert.ok(!reportAddress("lead").ok);
});
