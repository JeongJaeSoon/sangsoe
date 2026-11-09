import assert from "node:assert/strict";
import { test } from "node:test";
import { decisionAnswerFrom, decisionOpenFrom, parseDecisionAnswer, parseDecisionOpen } from "../../core/index.ts";
import { expectSameViaBothEntrances } from "../boundaries/both-entrances.ts";
import { createWorld, ownerSays } from "./world.ts";

const RUN = "run_000000000001";
const T1 = "task_000000000001";

test("the parsers refuse malformed input before anything runs", () => {
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
    { decision: "1", answer: "a", owner_action: 1 },
    { decision: "d001", answer: "a", owner_action: 0 },
    { decision: "d001", answer: "a", owner_action: 1, linked_by: "chat" },
  ]) {
    const r = parseDecisionAnswer(raw);
    assert.ok(!r.ok, JSON.stringify(raw));
    assert.equal(r.refusal.code, "bad_input");
  }
});

test("a malformed call opens no store: the deps factory is never called", async () => {
  const never = () => assert.fail("deps opened for a malformed call");
  assert.ok(!(await decisionOpenFrom({ subject: "i012", question: "q" }, never)).ok);
  assert.ok(!(await decisionAnswerFrom({ decision: "1", answer: "a", owner_action: 1 }, never)).ok);
});

test("both entrances refuse the same malformed decision the same way", async () => {
  const open = await expectSameViaBothEntrances({
    tool: "decision_open",
    input: { subject: "i012", question: "Which?" },
    argv: ["decision", "add", "--subject", "i012", "--question", "Which?"],
  });
  assert.deepEqual(open, {
    ok: false,
    refusal: { code: "bad_input", reason: "subject: expected item:iNNN or scope:<group>", fix: "pass subject as item:iNNN or scope:<group>" },
  });
  const answer = await expectSameViaBothEntrances({
    tool: "decision_answer",
    input: { decision: "7", answer: "a", owner_action: 1 },
    argv: ["decision", "answer", "--decision", "7", "--answer", "a", "--owner-action", "1"],
  });
  assert.deepEqual(answer, {
    ok: false,
    refusal: { code: "bad_input", reason: "decision: expected dNNN", fix: "pass decision as dNNN" },
  });
});

test("decision_open and decision_answer without a run read this session's Run from Orca", async () => {
  const none = await decisionAnswerFrom({ decision: "d001", answer: "a", owner_action: 1 }, createWorld([]));
  assert.ok(!none.ok);
  assert.equal(none.refusal.code, "no_run");
  const noneOpen = await decisionOpenFrom({ subject: "item:i012", question: "Which?", waiters: [{ task: T1, run: RUN }] }, createWorld([]));
  assert.ok(!noneOpen.ok);
  assert.equal(noneOpen.refusal.code, "no_run");

  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }], { currentRun: RUN });
  const opened = await decisionOpenFrom({ subject: "item:i012", question: "Which?", options: ["a", "b"], waiters: [{ task: T1, run: RUN }] }, w);
  assert.ok(opened.ok);
  const said = ownerSays(w.store, "d001 a");
  const r = await decisionAnswerFrom({ decision: "d001", answer: "a", owner_action: said }, w);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(w.calls("orchestration run-current").length, 2);
  assert.deepEqual(r.value.resolved, ["gate_000000000001"]);
  assert.equal(w.store.events({ type: "decision_answered" })[0]?.payload.linked_by, "orchestrator");
});

test("the CLI refuses a bad subcommand or waiter", async () => {
  const { run } = await import("../../cli/main.ts");
  const sub = await run(["decision", "list", "--json"]);
  assert.equal(sub.code, 1);
  const waiter = await run(["decision", "add", "--waiter", "task_1", "--json"]);
  assert.equal(waiter.code, 1);
  assert.match(JSON.parse(waiter.out).reason, /<task>@<run>/);
});
