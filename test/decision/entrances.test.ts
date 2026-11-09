import assert from "node:assert/strict";
import { test } from "node:test";
import decisionCommand from "../../cli/commands/decision.ts";
import decisionAnswerTool from "../../claude-plugin/mcp/tools/decision_answer.ts";
import decisionOpenTool from "../../claude-plugin/mcp/tools/decision_open.ts";
import { decisionAnswerFrom, decisionOpenFrom, parseDecisionAnswer, parseDecisionOpen } from "../../core/index.ts";
import { createWorld, ownerSays } from "./world.ts";

const RUN = "run_000000000001";
const T1 = "task_000000000001";

test("the tool files are named after their file and require what the parser requires", () => {
  assert.equal(decisionOpenTool.name, "decision_open");
  assert.equal(decisionAnswerTool.name, "decision_answer");
  assert.deepEqual(decisionOpenTool.inputSchema.required, ["subject", "question"]);
  assert.deepEqual(decisionAnswerTool.inputSchema.required, ["decision", "answer", "owner_action"]);
  assert.equal(decisionCommand.name, "decision");
});

test("the parsers refuse malformed input before anything runs", async () => {
  const w = createWorld([]);
  for (const raw of [
    { subject: "i012", question: "q" },
    { subject: "item:i012", question: "" },
    { subject: "item:i012", question: "q", waiters: [{ task: T1 }] },
    { subject: "item:i012", question: "q", options: [1] },
  ]) {
    const r = parseDecisionOpen(raw);
    assert.ok(!r.ok, JSON.stringify(raw));
    assert.equal(r.refusal.code, "bad_input");
  }
  for (const raw of [
    { decision: "1", answer: "a", owner_action: 1, run: RUN },
    { decision: "d001", answer: "a", owner_action: 0, run: RUN },
    { decision: "d001", answer: "a", owner_action: 1, linked_by: "chat", run: RUN },
  ]) {
    const r = await parseDecisionAnswer(raw, w.orca);
    assert.ok(!r.ok, JSON.stringify(raw));
    assert.equal(r.refusal.code, "bad_input");
  }
  assert.equal(w.calls().length, 0);
});

test("decision_answer without a run reads this session's Run from Orca", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }], { currentRun: RUN });
  const none = await decisionAnswerFrom({ decision: "d001", answer: "a", owner_action: 1 }, createWorld([]));
  assert.ok(!none.ok);
  assert.equal(none.refusal.code, "no_run");
  const opened = await decisionOpenFrom({ subject: "item:i012", question: "Which?", options: ["a", "b"], waiters: [{ task: T1, run: RUN }] }, w);
  assert.ok(opened.ok);
  const said = ownerSays(w.store, "d001 a");
  const r = await decisionAnswerFrom({ decision: "d001", answer: "a", owner_action: said }, w);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(w.calls("orchestration run-current").length, 1);
  assert.deepEqual(r.value.resolved, ["gate_000000000001"]);
  assert.equal(w.store.events({ type: "decision_answered" })[0]?.payload.linked_by, "orchestrator");
});

test("the CLI refuses a bad subcommand or waiter before opening the store", async () => {
  const sub = await decisionCommand.run({ values: {}, positionals: ["list"] });
  assert.ok(!sub.ok);
  const waiter = await decisionCommand.run({ values: { waiter: ["task_1"] }, positionals: ["add"] });
  assert.ok(!waiter.ok);
  assert.match(waiter.refusal.reason, /<task>@<run>/);
});
