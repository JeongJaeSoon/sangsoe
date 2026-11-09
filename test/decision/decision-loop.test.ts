import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerNotifiedKey,
  decision,
  decisionAnswer,
  decisionKey,
  decisionMoot,
  decisionMootFrom,
  decisionOpen,
  waiterReading,
} from "../../core/index.ts";
import { createWorld, ownerSays, type World } from "./world.ts";

// Scenarios of appendix #decision-loop-detail on fake Orca. The orchestrator's LLM link step is replaced
// by fixed input: the test names the decision the answer belongs to.

const RUN = "run_000000000001";
const OTHER_RUN = "run_000000000002";
const ORCH_RUN = "run_000000000009";
const T1 = "task_000000000001";
const T2 = "task_000000000002";
const T3 = "task_000000000003";

const ask = (waiters: { task: string; run: string }[], extra: Partial<Parameters<typeof decisionOpen>[1]> = {}) => ({
  subject: "item:i012",
  options: ["Path versioning", "Header versioning"],
  question: "Which API versioning scheme?",
  waiters,
  callerRun: RUN,
  ...extra,
});

async function open(w: World, waiters = [{ task: T1, run: RUN }], callerRun = RUN) {
  const r = await decisionOpen(w, ask(waiters, { callerRun }));
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(r.value.status === "opened" || r.value.status === "joined");
  return r.value;
}

function row(w: World, d: string) {
  const gates = [...w.gates.values()].map((g) => ({ id: g.id, taskId: g.taskId, open: g.status === "pending" }));
  return decision({ orca: { tasks: [], gates }, events: w.store.events(), now: "2026-11-10T00:00:00Z" }).find(
    (r) => r.decision === d,
  );
}

test("decisionKey ignores wording, case, spacing, edge punctuation and option order", () => {
  const k = decisionKey("item:i012", ["Path versioning", "Header versioning"]);
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(decisionKey("ITEM:i012 ", ["  header   VERSIONING.", "path versioning"]), k);
  assert.notEqual(decisionKey("item:i013", ["Path versioning", "Header versioning"]), k);
  assert.notEqual(decisionKey("item:i012", ["Path versioning"]), k);
});

test("decisionOpen issues dNNN, gates each waiter Task once, and records only ids", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T2, run: RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  const v = await open(w);
  assert.equal(v.status, "opened");
  assert.equal(v.decision, "d001");
  assert.equal(w.gates.size, 1);
  assert.match([...w.gates.values()][0]?.question ?? "", /^d001: Which API versioning scheme\?$/);

  const joined = await open(w, [{ task: T1, run: RUN }, { task: T2, run: RUN }]);
  assert.equal(joined.status, "joined");
  assert.equal(joined.decision, "d001");
  assert.equal(w.gates.size, 2, "T1 keeps its gate, T2 gets one");
  await open(w, [{ task: T1, run: RUN }, { task: T2, run: RUN }]);
  assert.equal(w.calls("orchestration gate-create").length, 2, "a re-call creates no gate");
  assert.equal(w.store.events({ type: "decision_opened" }).length, 1);
  assert.deepEqual(
    w.store.events({ type: "decision_joined" }).map((e) => e.payload),
    [
      { decision: "d001", waiter: T1, gate: "gate_000000000001", run: RUN },
      { decision: "d001", waiter: T2, gate: "gate_000000000002", run: RUN },
    ],
  );
  assert.equal(row(w, "d001")?.state, "open");
});

test("decisionOpen reuses a gate a crashed call already created", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const gated = await w.orca.gateCreate({ task: T1, question: "d001: Which API versioning scheme?" });
  assert.ok(gated.ok);
  w.store.allocate("d");
  w.store.append({
    type: "decision_opened",
    source: "decision_open",
    dedupe_key: `decision:${decisionKey("item:i012", ["Path versioning", "Header versioning"])}`,
    payload: { decision: "d001", decision_key: decisionKey("item:i012", ["Path versioning", "Header versioning"]) },
  });
  const v = await open(w);
  assert.equal(v.status, "joined");
  assert.deepEqual(v.gates, ["gate_000000000001"]);
  assert.equal(w.gates.size, 1);
});

test("a decision with no waiter gates a carrier Task in the orchestrator Run, once", async () => {
  const w = createWorld([]);
  const fromRun = await decisionOpen(w, ask([], { carrierRun: ORCH_RUN }));
  assert.ok(!fromRun.ok, "the carrier Task is created in the caller's own Run only");
  assert.equal(fromRun.refusal.code, "cross_run_waiter");
  const r = await decisionOpen(w, ask([], { carrierRun: ORCH_RUN, callerRun: ORCH_RUN }));
  assert.ok(r.ok);
  assert.equal(r.value.status, "opened");
  const carrier = [...w.tasks.values()].find((t) => t.title === "d001");
  assert.ok(carrier);
  assert.equal(carrier.run, ORCH_RUN);
  assert.deepEqual(
    w.store.events({ type: "item_extra_set" }).map((e) => e.payload),
    [{ task: carrier.id, exec_by: "owner" }],
  );
  assert.ok(!(await decisionOpen(w, ask([]))).ok, "no waiter and no carrier Run is refused");
  await decisionOpen(w, ask([], { carrierRun: ORCH_RUN, callerRun: ORCH_RUN }));
  assert.equal(w.calls("orchestration task-create").length, 1);
  assert.equal(w.gates.size, 1);
});

test("decision_reask_blocked: the same question after the answer returns the answer and opens nothing", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const said = ownerSays(w.store, "d001 path versioning");
  assert.ok((await decisionAnswer(w, { decision: d, answer: "path versioning", ownerAction: said, linkedBy: "hook", callerRun: RUN })).ok);

  const again = await decisionOpen(w, {
    ...ask([{ task: T2, run: RUN }]),
    question: "Should the API version go in the path or a header?",
    options: ["header versioning", "PATH VERSIONING"],
  });
  assert.ok(again.ok);
  assert.deepEqual(again.value, { status: "closed", decision: "d001", answer: "path versioning", reason: "answered" });
  assert.equal(w.store.events({ type: "decision_opened" }).length, 1);
  assert.equal(w.calls("orchestration gate-create").length, 1);
});

test("decision_answer_linked: an answer linked to dNNN resolves the waiter's gate and tells the worker once", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  assert.equal(waiterReading({ id: T1, runId: RUN, status: "blocked", deps: [], activeDispatchId: "ctx_000000000001" }, [
    { id: "gate_000000000001", taskId: T1, open: true },
  ]), "blocked");

  // Fixed input in place of the orchestrator's link step: "go with path" belongs to d001.
  const said = ownerSays(w.store, "go with path");
  const r = await decisionAnswer(w, { decision: d, answer: "go with path", ownerAction: said, linkedBy: "orchestrator", callerRun: RUN });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, {
    status: "answered",
    decision: "d001",
    resolved: ["gate_000000000001"],
    notified: [T1],
    handedOff: [],
  });
  const gate = w.gates.get("gate_000000000001");
  assert.equal(gate?.status, "resolved");
  assert.equal(gate?.resolution, "d001: go with path");
  assert.equal(w.sends.length, 1);
  assert.equal(w.sends[0]?.to, "dispatch:ctx_000000000001");
  assert.match(w.sends[0]?.body ?? "", /d001/);
  assert.match(w.sends[0]?.body ?? "", /go with path/);
  const view = row(w, d);
  assert.equal(view?.state, "closed");
  assert.equal(view?.linkedBy, "orchestrator");
  assert.equal(view?.undelivered, false);

  // Decision 84③: Orca may show the Task ready, but its worker still holds it, so it reads 🔄.
  assert.equal(waiterReading({ id: T1, runId: RUN, status: "ready", deps: [], activeDispatchId: "ctx_000000000001" }, [
    { id: "gate_000000000001", taskId: T1, open: false },
  ]), "in_progress");
  assert.equal(waiterReading({ id: T1, runId: RUN, status: "ready", deps: [] }, []), null);
  // A closed Task keeps its gate open on purpose (91④(ii)); it is not 🚧.
  assert.equal(waiterReading({ id: T1, runId: RUN, status: "completed", deps: [] }, [
    { id: "gate_000000000001", taskId: T1, open: true },
  ]), null);
});

test("a re-called decision_answer is idempotent: one gate-resolve, one notify", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const said = ownerSays(w.store, "d001 path");
  const input = { decision: d, answer: "path", ownerAction: said, linkedBy: "hook" as const, callerRun: RUN };
  assert.ok((await decisionAnswer(w, input)).ok);
  const second = await decisionAnswer(w, input);
  assert.ok(second.ok);
  assert.deepEqual(second.value.resolved, []);
  assert.deepEqual(second.value.notified, []);
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
  assert.equal(w.sends.length, 1);
  assert.equal(w.store.events({ type: "decision_answered" }).length, 1);
  assert.equal(w.store.events({ type: "decision_closed" }).length, 1);
  assert.equal(w.store.events({ type: "notified" }).length, 1);
});

test("answer_gate_unresolved: an answer recorded with its gate still open is delivered by the re-call, once", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const said = ownerSays(w.store, "d001 header");
  // The hook recorded the answer, then the process died before the gate was resolved.
  w.store.append({
    type: "decision_answered",
    source: "UserPromptSubmit",
    dedupe_key: `decision_answered:${d}`,
    payload: { decision: d, owner_action: said, answer: "header", linked_by: "hook" },
  });
  assert.equal(row(w, d)?.undelivered, true);

  const r = await decisionAnswer(w, { decision: d, answer: "header", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok);
  assert.deepEqual(r.value.resolved, ["gate_000000000001"]);
  assert.equal(row(w, d)?.undelivered, false);
  assert.equal(row(w, d)?.state, "closed");
  await decisionAnswer(w, { decision: d, answer: "header", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
  assert.equal(w.sends.length, 1);
});

test("a later, different answer to an answered decision changes nothing", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const a = ownerSays(w.store, "d001 path");
  await decisionAnswer(w, { decision: d, answer: "path", ownerAction: a, linkedBy: "hook", callerRun: RUN });
  const b = ownerSays(w.store, "d001 header");
  const r = await decisionAnswer(w, { decision: d, answer: "header", ownerAction: b, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok);
  assert.equal(row(w, d)?.answer, "path");
  assert.equal(w.gates.get("gate_000000000001")?.resolution, "d001: path");
  assert.equal(w.sends.length, 1);
});

test("owner_direct_merge (function side): an observed merge closes the decision through the same path", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const merged = w.store.append({
    type: "pr_merged",
    source: "pr-monitor",
    dedupe_key: "pr_merged:acme%2Fapi%237",
    payload: { pr: "acme/api#7", merge_sha: "abcdef1" },
  });
  const r = await decisionAnswer(w, {
    decision: d,
    answer: "merged acme/api#7",
    ownerAction: merged.seq,
    linkedBy: "observed",
    callerRun: RUN,
  });
  assert.ok(r.ok);
  assert.equal(row(w, d)?.state, "closed");
  assert.equal(row(w, d)?.linkedBy, "observed");
  assert.equal(w.gates.get("gate_000000000001")?.status, "resolved");
  assert.equal(w.sends.length, 1);
});

test("a gate bound to another Run is handed to that Run by message, not resolved from here", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T2, run: OTHER_RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  const across = await decisionOpen(w, ask([{ task: T1, run: RUN }, { task: T2, run: OTHER_RUN }]));
  assert.ok(!across.ok, "gate-create binds to the caller's Run, so a waiter elsewhere is refused before any write");
  assert.equal(across.refusal.code, "cross_run_waiter");
  assert.equal(w.store.events().length, 0);
  assert.equal(w.calls().length, 0);

  // Each Run's session opens the same decision for its own Task: one dNNN, two gates.
  const { decision: d } = await open(w, [{ task: T1, run: RUN }]);
  const joined = await open(w, [{ task: T2, run: OTHER_RUN }], OTHER_RUN);
  assert.equal(joined.status, "joined");
  assert.equal(joined.decision, d);
  const said = ownerSays(w.store, "d001 path");
  const r = await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok);
  assert.deepEqual(r.value.resolved, ["gate_000000000001"]);
  assert.deepEqual(r.value.handedOff, [T2]);
  assert.equal(w.gates.get("gate_000000000002")?.status, "pending");
  assert.deepEqual(w.sends.map((s) => s.to).sort(), ["dispatch:ctx_000000000001", `run:${OTHER_RUN}`]);

  // The other Run's session calls the same function; its gate resolves and its worker is told once.
  const there = await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: OTHER_RUN });
  assert.ok(there.ok);
  assert.deepEqual(there.value.resolved, ["gate_000000000002"]);
  assert.deepEqual(there.value.handedOff, [], "T1's gate is already resolved, so nothing goes back");
  assert.equal(w.sends.filter((s) => s.to === "dispatch:ctx_000000000002").length, 1);
  assert.equal(w.calls("orchestration gate-resolve").length, 2);
});

test("late_answer_reaches_next_worker (ii): a waiter Task already closed gets one message to its Run", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T3, run: RUN, status: "dispatched", dispatchId: "ctx_000000000003" },
  ]);
  const { decision: d } = await open(w, [{ task: T1, run: RUN }, { task: T3, run: RUN }]);
  const t1 = w.tasks.get(T1);
  const t3 = w.tasks.get(T3);
  assert.ok(t1 && t3);
  t1.status = "completed";
  delete t1.dispatchId;
  t3.status = "ready"; // between workers: (i) is the start procedure's, so nothing is sent now
  delete t3.dispatchId;

  const said = ownerSays(w.store, "d001 path");
  const r = await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok);
  assert.deepEqual(r.value.notified, [T1]);
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending", "a closed Task's gate is not called");
  assert.equal(w.gates.get("gate_000000000002")?.status, "resolved");
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`]);
  const keys = w.store.events({ type: "notified" }).map((e) => e.dedupe_key);
  assert.deepEqual(keys, [answerNotifiedKey(d, T1).dedupe_key]);
  assert.ok(!keys.includes(answerNotifiedKey(d, T3).dedupe_key), "the key stays free for the next worker's first prompt");
  await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.equal(w.sends.length, 1);
});

test("decision_moot_closed: a closed PR moots the decision, frees the gate with MOOT, tells the worker once", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const input = { decision: d, evidence: { kind: "pr_closed" as const, pr: "acme/api#3" }, callerRun: RUN };
  const r = await decisionMoot(w, input);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, { status: "moot", decision: d, resolved: ["gate_000000000001"], notified: [T1], handedOff: [] });
  assert.equal(w.gates.get("gate_000000000001")?.resolution, "MOOT d001: pr_closed:acme/api#3");
  assert.deepEqual(w.store.events({ type: "decision_closed" }).map((e) => e.payload), [
    { decision: d, reason: "moot", evidence: "pr_closed:acme/api#3" },
  ]);
  assert.equal(w.store.events({ type: "notified" })[0]?.dedupe_key, `notify:${T1}:moot:${d}`);
  assert.equal(row(w, d)?.closedReason, "moot");

  const again = await decisionMoot(w, input);
  assert.ok(again.ok);
  assert.deepEqual(again.value, { status: "moot", decision: d, resolved: [], notified: [], handedOff: [] });
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
  assert.equal(w.sends.length, 1);

  // A late answer is recorded only: no reopen, no gate, no message.
  const said = ownerSays(w.store, "d001 path after all");
  const late = await decisionAnswer(w, { decision: d, answer: "path after all", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(late.ok);
  assert.equal(late.value.status, "late");
  assert.deepEqual(w.store.events({ type: "decision_answered" }).map((e) => e.payload.late), [true]);
  assert.equal(row(w, d)?.state, "closed");
  assert.equal(row(w, d)?.closedReason, "moot");
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
  assert.equal(w.sends.length, 1);
});

test("moot by closed Tasks: needs every non-carrier waiter closed, and calls no gate of a closed Task", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T2, run: RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  const { decision: d } = await open(w, [{ task: T1, run: RUN }, { task: T2, run: RUN }]);
  const input = { decision: d, evidence: { kind: "tasks_closed" as const }, callerRun: RUN };
  const t1 = w.tasks.get(T1);
  const t2 = w.tasks.get(T2);
  assert.ok(t1 && t2);
  t1.status = "completed";
  delete t1.dispatchId;
  const early = await decisionMoot(w, input);
  assert.ok(!early.ok);
  assert.equal(early.refusal.code, "not_moot");
  assert.equal(row(w, d)?.state, "open");

  // A failed Task is not closed for this purpose; Orca's cancel is failed with result=cancelled.
  t2.status = "failed";
  delete t2.dispatchId;
  const failed = await decisionMoot(w, input);
  assert.ok(!failed.ok);
  assert.equal(failed.refusal.code, "not_moot");
  t2.result = "cancelled";
  const r = await decisionMoot(w, input);
  assert.ok(r.ok);
  assert.deepEqual(r.value.resolved, []);
  assert.equal(w.calls("orchestration gate-resolve").length, 0);
  assert.deepEqual(r.value.notified, [T1, T2]);
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`, `run:${RUN}`]);
});

test("moot never closes an answered decision, and a carrier Task alone does not make it moot", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const said = ownerSays(w.store, "d001 path");
  await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  const r = await decisionMoot(w, { decision: d, evidence: { kind: "pr_closed", pr: "acme/api#3" }, callerRun: RUN });
  assert.ok(r.ok);
  assert.equal(r.value.status, "not_open");
  assert.equal(row(w, d)?.closedReason, "answered");

  const c = createWorld([]);
  const opened = await decisionOpen(c, ask([], { carrierRun: ORCH_RUN, callerRun: ORCH_RUN }));
  assert.ok(opened.ok);
  const carrier = [...c.tasks.values()][0];
  assert.ok(carrier);
  carrier.status = "completed";
  const m = await decisionMoot(c, { decision: opened.value.decision, evidence: { kind: "tasks_closed" }, callerRun: ORCH_RUN });
  assert.ok(!m.ok);
  assert.equal(m.refusal.code, "not_moot");
});

test("decisionAnswer needs the owner_action it cites, and one owner_action answers one decision", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const opened = w.store.events({ type: "decision_opened" })[0]?.seq ?? 0;
  for (const [ownerAction, linkedBy] of [
    [opened, "hook"],
    [999, "orchestrator"],
    [ownerSays(w.store, "d001 path"), "observed"],
  ] as const) {
    const r = await decisionAnswer(w, { decision: d, answer: "path", ownerAction, linkedBy, callerRun: RUN });
    assert.ok(!r.ok);
    assert.equal(r.refusal.code, "no_owner_action");
  }
  assert.equal(row(w, d)?.state, "open");

  const second = await decisionOpen(w, { ...ask([{ task: T1, run: RUN }]), subject: "item:i013" });
  assert.ok(second.ok && second.value.status === "opened");
  const said = ownerSays(w.store, "path");
  assert.ok((await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "orchestrator", callerRun: RUN })).ok);
  const reused = await decisionAnswer(w, {
    decision: second.value.decision,
    answer: "path",
    ownerAction: said,
    linkedBy: "orchestrator",
    callerRun: RUN,
  });
  assert.ok(!reused.ok);
  assert.equal(reused.refusal.code, "owner_action_used");
});

test("two concurrent opens of one waiter keep one gate and resolve the duplicate", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const [a, b] = await Promise.all([decisionOpen(w, ask([{ task: T1, run: RUN }])), decisionOpen(w, ask([{ task: T1, run: RUN }]))]);
  assert.ok(a.ok && b.ok);
  assert.ok(a.value.status !== "closed" && b.value.status !== "closed");
  assert.deepEqual(a.value.gates, b.value.gates);
  assert.equal(w.calls("orchestration gate-create").length, 2, "both calls saw no gate and created one");
  const open = [...w.gates.values()].filter((g) => g.status === "pending");
  assert.deepEqual(open.map((g) => g.id), a.value.gates);
  for (const g of [...w.gates.values()].filter((x) => x.status !== "pending")) {
    assert.equal(g.resolution, `d001: duplicate gate, see ${a.value.gates[0]}`);
  }
  assert.equal(w.store.events({ type: "decision_joined" }).length, 1);
});

test("an answer recorded before a racing moot's close row is still delivered", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" }]);
  const { decision: d } = await open(w);
  const said = ownerSays(w.store, "d001 path");
  w.store.append({
    type: "decision_answered",
    source: "UserPromptSubmit",
    dedupe_key: `decision_answered:${d}`,
    payload: { decision: d, owner_action: said, answer: "path", linked_by: "hook" },
  });
  // The moot checked an open decision, then wrote its close row after the answer landed.
  w.store.append({
    type: "decision_closed",
    source: "decision_moot",
    dedupe_key: `decision_closed:${d}`,
    payload: { decision: d, reason: "moot", evidence: "tasks_closed" },
  });
  assert.equal(row(w, d)?.state, "answered");
  const r = await decisionAnswer(w, { decision: d, answer: "path", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.resolved, ["gate_000000000001"]);
  assert.equal(w.gates.get("gate_000000000001")?.resolution, "d001: path");
  assert.equal(row(w, d)?.undelivered, false);
});

test("a moot hands a foreign gate to its Run, which resolves it with `decision moot`, and tells a closed waiter there", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T2, run: OTHER_RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
    { id: T3, run: OTHER_RUN, status: "dispatched", dispatchId: "ctx_000000000003" },
  ]);
  const { decision: d } = await open(w);
  await open(w, [{ task: T2, run: OTHER_RUN }, { task: T3, run: OTHER_RUN }], OTHER_RUN);
  const t3 = w.tasks.get(T3);
  assert.ok(t3);
  t3.status = "completed";
  delete t3.dispatchId;

  const r = await decisionMoot(w, { decision: d, evidence: { kind: "pr_closed", pr: "acme/api#3" }, callerRun: RUN });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.handedOff, [T2]);
  assert.deepEqual([...r.value.notified].sort(), [T1, T3]);
  const handoff = w.sends.find((s) => s.type === "handoff");
  assert.equal(handoff?.to, `run:${OTHER_RUN}`);
  assert.match(handoff?.body ?? "", /Run there: sangsoe decision moot --decision d001$/);
  const closed = w.sends.filter((s) => s.type === "decision_gate" && s.to === `run:${OTHER_RUN}`);
  assert.equal(closed.length, 1, "T3's Run hears once that its closed waiter's question is moot");

  // The other Run's session runs what the handoff names: its gate resolves under the first evidence.
  w.useRun(OTHER_RUN);
  const there = await decisionMootFrom({ decision: d }, w);
  assert.ok(there.ok, JSON.stringify(there));
  assert.deepEqual(there.value.handedOff, []);
  const t2gate = [...w.gates.values()].find((g) => g.taskId === T2);
  assert.equal(t2gate?.status, "resolved");
  assert.equal(t2gate?.resolution, "MOOT d001: pr_closed:acme/api#3");
  assert.equal(w.sends.filter((s) => s.to === "dispatch:ctx_000000000002").length, 1);
  assert.equal(w.sends.filter((s) => s.type === "handoff").length, 1);
});

test("one waiter's failed send does not hold back the next waiter's gate, and a re-call finishes it", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: "ctx_000000000001" },
    { id: T2, run: RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  const { decision: d } = await open(w, [{ task: T1, run: RUN }, { task: T2, run: RUN }]);
  const said = ownerSays(w.store, "d001 path");
  const input = { decision: d, answer: "path", ownerAction: said, linkedBy: "hook" as const, callerRun: RUN };
  w.failSendTo("dispatch:ctx_000000000001");
  const r = await decisionAnswer(w, input);
  assert.ok(!r.ok);
  assert.equal(r.refusal.code, "release_incomplete");
  assert.match(r.refusal.reason, new RegExp(`^${T1}: send_failed`));
  assert.equal(w.gates.get("gate_000000000002")?.status, "resolved", "T2 is freed although T1's send failed");
  assert.equal(w.sends.filter((s) => s.to === "dispatch:ctx_000000000002").length, 1);

  w.failSendTo(null);
  const again = await decisionAnswer(w, input);
  assert.ok(again.ok, JSON.stringify(again));
  assert.deepEqual(again.value.notified, [T1]);
  assert.equal(w.calls("orchestration gate-resolve").length, 2);
  assert.equal(w.sends.length, 2);
});

test("decisionAnswer refuses an unknown decision", async () => {
  const w = createWorld([]);
  const r = await decisionAnswer(w, { decision: "d404", answer: "x", ownerAction: 1, linkedBy: "hook", callerRun: RUN });
  assert.ok(!r.ok);
  assert.equal(r.refusal.code, "unknown_decision");
});
