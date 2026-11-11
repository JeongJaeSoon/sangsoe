import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decisionAnswerFrom,
  decisionMootFrom,
  decisionOpenFrom,
  parseDecisionAnswer,
  parseDecisionMoot,
  parseDecisionOpen,
} from "../../core/index.ts";
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

test("S4: a caller cannot claim the hook or button link; only their own entrances set it", async () => {
  for (const linked of ["hook", "button"]) {
    const r = parseDecisionAnswer({ decision: "d001", answer: "a", owner_action: 1, linked_by: linked });
    assert.equal(r.ok ? "" : r.refusal.code, "bad_input", linked);
  }
  const both = await expectSameViaBothEntrances({
    tool: "decision_answer",
    input: { decision: "d007", answer: "a", owner_action: 1, linked_by: "hook" },
    argv: ["decision", "answer", "--decision", "d007", "--answer", "a", "--owner-action", "1", "--linked-by", "hook"],
  });
  assert.deepEqual(both, {
    ok: false,
    refusal: { code: "bad_input", reason: "linked_by: expected orchestrator|observed", fix: "pass linked_by as orchestrator|observed" },
  });
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
    refusal: {
      code: "bad_input",
      reason: "subject: expected item:iNNN, item:<task id> or scope:<group>",
      fix: "pass subject as item:iNNN, item:<task id> or scope:<group>",
    },
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

test("decision_open, decision_answer and decision moot act in the Run Orca reports for this session", async () => {
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

test("decision_open takes a Task id as its item, and keys it under the Task's iNNN alias when it has one", async () => {
  // A Task the orchestrator made with `task-create` and started by id has no alias (smoke P2).
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }], { currentRun: RUN });
  const byId = await decisionOpenFrom({ subject: `item:${T1}`, question: "Which?", options: ["a", "b"], waiters: [{ task: T1, run: RUN }] }, w);
  assert.ok(byId.ok, JSON.stringify(byId));
  assert.equal(byId.value.status, "opened");

  const aliased = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }], { currentRun: RUN });
  aliased.store.append({ type: "item_created", source: "test", payload: { task: T1, alias: "i012", who: "orchestrator", done_when: "x", owner_action: 0 } });
  const first = await decisionOpenFrom({ subject: "item:i012", question: "Which?", options: ["a", "b"], waiters: [{ task: T1, run: RUN }] }, aliased);
  const second = await decisionOpenFrom({ subject: `item:${T1}`, question: "Which, again?", options: ["b", "a"], waiters: [{ task: T1, run: RUN }] }, aliased);
  assert.ok(first.ok && second.ok);
  assert.equal(second.value.decision, first.value.decision);
  assert.equal(second.value.status, "joined");
});

test("decision moot takes no evidence from its caller, and the parsers ignore a run passed in the input", async () => {
  // Naming a PR cannot moot a decision: the entrance only checks Orca's waiters or resumes a moot.
  for (const raw of [{ decision: "d001" }, { decision: "d001", pr: "acme/api#999" }]) {
    assert.deepEqual(parseDecisionMoot(raw), { ok: true, value: { decision: "d001", evidence: { kind: "tasks_closed" } } });
  }
  const live = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }], { currentRun: RUN });
  assert.ok((await decisionOpenFrom({ subject: "item:i012", question: "Which?", waiters: [{ task: T1, run: RUN }] }, live)).ok);
  const claimed = await decisionMootFrom({ decision: "d001", pr: "acme/api#999" }, live);
  assert.ok(!claimed.ok);
  assert.equal(claimed.refusal.code, "not_moot");
  assert.equal(live.store.events({ type: "decision_closed" }).length, 0);

  // A run in the input cannot stand in for the bound one: gate-create would still bind to Orca's.
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const r = await decisionOpenFrom({ subject: "item:i012", question: "Which?", waiters: [{ task: T1, run: RUN }], run: RUN }, w);
  assert.ok(!r.ok);
  assert.equal(r.refusal.code, "no_run");
  assert.equal(w.calls("orchestration gate-create").length, 0);
});

test("the CLI refuses a bad subcommand or waiter", async () => {
  const { run } = await import("../../cli/main.ts");
  const sub = await run(["decision", "list", "--json"]);
  assert.equal(sub.code, 1);
  const waiter = await run(["decision", "add", "--waiter", "task_1", "--json"]);
  assert.equal(waiter.code, 1);
  assert.match(JSON.parse(waiter.out).reason, /<task>@<run>/);
});
