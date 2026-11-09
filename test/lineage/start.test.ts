import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkLineage,
  createOrcaAdapter,
  type ExecResult,
  type Requester,
  type StartRequest,
  Store,
  startUnit,
} from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

const PARENT_TREE = "repo-0001::/home/dev/src/api";
const CHILD_TREE = "repo-0001::/home/dev/workspaces/api/feature-a";
const ORCH = "term_00000000-0000-4000-8000-00000000000f";
const RUN = "run_000000000001";
const NEW_TASK = "task_new";

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const fail = (code: string, message = code): ExecResult => ({
  code: 1,
  stdout: JSON.stringify({ ok: false, error: { code, message } }),
  stderr: "",
});
const flag = (args: readonly string[], name: string) => args[args.indexOf(`--${name}`) + 1];

const dispatchRow = (id: string, task: string, depth: number) => ({
  dispatch: { id, run_id: RUN, task_id: task, status: "dispatched", depth, failure_count: 0, creator_handle: ORCH },
});

type Setup = {
  scenario?: string;
  requesterDepth?: number;
  requesterDispatch?: "missing";
  newTaskStatus?: string;
  /** What `dispatch-show --task task_new` answers after the start. */
  newDispatch?: "missing";
  workerStart?: () => ExecResult;
  replies?: Record<string, FakeReply>;
};

// The fake prints a plain value as the JSON document; an ExecResult has to come from a function.
const asReplies = (r: Record<string, FakeReply>) =>
  Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, typeof v === "object" && v !== null && "stdout" in v ? () => v as ExecResult : v]),
  );

function harness(s: Setup = {}) {
  const fake = createFakeOrca({
    scenario: s.scenario ?? "local",
    replies: asReplies({
      "orchestration-dispatch-show": (args: readonly string[]) => {
        const task = flag(args, "task");
        if (task === "task_lead") {
          return s.requesterDispatch === "missing" ? fail("dispatch_not_found") : ok(dispatchRow("ctx_lead", task, s.requesterDepth ?? 1));
        }
        if (task === NEW_TASK && s.newDispatch !== "missing") return ok(dispatchRow("ctx_new", task, (s.requesterDepth ?? 1) + 1));
        return fail("dispatch_not_found");
      },
      "orchestration-task-create": ok({ task: { id: NEW_TASK } }),
      "orchestration-task-list": ok({ tasks: [{ id: NEW_TASK, status: s.newTaskStatus ?? "ready", title: "t" }] }),
      "orchestration-worker-start": () => (s.workerStart ? s.workerStart() : ok({ dispatchId: "ctx_new", worktreeId: CHILD_TREE })),
      ...s.replies,
    }),
  });
  const store = Store.open({ path: ":memory:" });
  const orca = createOrcaAdapter(fake.exec);
  const called = (sub: string) => fake.calls.filter((c) => c.slice(1, 3).join(" ") === `orchestration ${sub}`);
  return { fake, store, orca, called, signals: () => store.events({ type: "signal" }) };
}

const lead: Requester = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN };
const request = (over: Partial<StartRequest> = {}): StartRequest => ({
  requester: lead,
  childRole: "worker",
  task: { spec: "/goal do the thing", title: "thing", deps: ["task_000000000002"] },
  agent: "claude",
  ...over,
});

async function start(h: ReturnType<typeof harness>, req: StartRequest = request(), slots = 1) {
  return startUnit({ orca: h.orca, store: h.store, slots: () => slots }, req);
}

function assertRefused(h: ReturnType<typeof harness>, out: Awaited<ReturnType<typeof start>>, reason: string) {
  assert.equal(out.kind, "refused");
  assert.equal(out.kind === "refused" && out.reason, reason);
  const sig = h.signals();
  assert.equal(sig.length, 1, "one signal line");
  assert.deepEqual(sig[0]?.payload, { kind: "start_refused", reason });
  assert.equal(h.called("worker-start").length, 0, "no session opened");
}

// ---- the five refusals, in decision 94 (나)'s order ----

test("capability_missing: a required capability is absent; nothing is created", async () => {
  const h = harness({ scenario: "missing-capability" });
  const out = await start(h);
  assertRefused(h, out, "capability_missing");
  assert.equal(h.called("task-create").length, 0);
});

test("lineage_invalid: a worker starts nothing, and its parent hears about it", async () => {
  const h = harness();
  const out = await start(h, request({ requester: { ...lead, role: "worker" } }));
  assertRefused(h, out, "lineage_invalid");
  const sent = h.called("send");
  assert.equal(sent.length, 1, "one escalation");
  assert.equal(flag(sent[0] ?? [], "type"), "escalation");
  assert.equal(flag(sent[0] ?? [], "to"), ORCH);
  assert.equal(out.kind === "refused" && out.escalatedTo, ORCH);
});

test("lineage_invalid: a lead does not start a lead", async () => {
  const h = harness();
  assertRefused(h, await start(h, request({ childRole: "lead" })), "lineage_invalid");
});

test("lineage_invalid: an unreadable requester Dispatch stops the start; there is no one to escalate to", async () => {
  const h = harness({ requesterDispatch: "missing" });
  const out = await start(h);
  assertRefused(h, out, "lineage_invalid");
  assert.equal(out.kind === "refused" && out.escalatedTo, null);
  assert.equal(h.called("send").length, 0);
});

test("lineage_invalid: an unreadable parent worktree stops the start", async () => {
  const h = harness();
  assertRefused(h, await start(h, request({ requester: { ...lead, worktreeId: "repo-0001::/nowhere" } })), "lineage_invalid");
  assert.equal(h.called("task-create").length, 0);
});

test("lineage_invalid: a lead whose Dispatch is not at depth 1 is not a lead", async () => {
  const h = harness({ requesterDepth: 2 });
  assertRefused(h, await start(h), "lineage_invalid");
});

test("lineage_invalid: an orchestrator holding a Task is refused; an orchestrator refusal goes to owner_todo", async () => {
  const h = harness();
  const out = await start(h, request({ requester: { ...lead, role: "orchestrator" } }));
  assertRefused(h, out, "lineage_invalid");
  assert.equal(out.kind === "refused" && out.escalatedTo, "owner_todo");
  assert.equal(h.called("send").length, 0);
});

test("depth_exceeded: an orchestrator does not start a lead that could not start workers", async () => {
  const h = harness();
  const { taskId: _, ...orch } = lead;
  const out = await start(h, request({ requester: { ...orch, role: "orchestrator" }, childRole: "lead", maxDepth: 1 }));
  assertRefused(h, out, "depth_exceeded");
});

test("orca_error: a failed worker-start is refused with Orca's code; the Task stays", async () => {
  const h = harness({ workerStart: () => fail("task_not_startable", "deps not done") });
  const out = await start(h);
  assert.equal(out.kind === "refused" && out.reason, "orca_error");
  assert.match(out.kind === "refused" ? out.detail : "", /task_not_startable/);
  assert.equal(h.called("task-update").length, 0, "the Task is not closed");
  assert.equal(h.called("send").length, 1);
});

test("no_dispatch: worker-start finished without a Dispatch, read back through dispatch-show", async () => {
  const h = harness({ workerStart: () => ok({ terminal: "term_x" }), newDispatch: "missing" });
  const out = await start(h);
  assert.equal(out.kind === "refused" && out.reason, "no_dispatch");
  assert.match(out.kind === "refused" ? out.detail : "", /term_x/);
  assert.equal(h.signals().length, 1);
});

// ---- worker_start_dispatched (decision 94 (사)): three cases ----

test("worker_start_dispatched (1): too little depth → refused, one start_refused line, one escalation, zero sessions", async () => {
  const h = harness();
  const out = await start(h, request({ maxDepth: 1 }));
  assertRefused(h, out, "depth_exceeded");
  assert.equal(h.called("send").length, 1);
});

test("worker_start_dispatched (2): enough depth → a Dispatch and no event", async () => {
  const h = harness();
  const out = await start(h, request({ maxDepth: 3 }));
  assert.deepEqual(out, { kind: "started", taskId: NEW_TASK, dispatchId: "ctx_new", worktreeId: CHILD_TREE, notes: [] });
  assert.equal(h.store.events().length, 0);
  const ws = h.called("worker-start")[0] ?? [];
  assert.equal(flag(ws, "worktree"), "new-child");
  assert.equal(flag(ws, "task"), NEW_TASK);
});

test("worker_start_dispatched (3): setting unread and no Dispatch → not a success, start_refused{no_dispatch}", async () => {
  const h = harness({ workerStart: () => ok({}), newDispatch: "missing" });
  const out = await start(h);
  assert.equal(out.kind, "refused");
  assert.deepEqual(h.signals()[0]?.payload, { kind: "start_refused", reason: "no_dispatch" });
});

// ---- not refusals: wait ----

test("a Task that is not ready waits, and nothing is written", async () => {
  const h = harness({ newTaskStatus: "pending" });
  const out = await start(h);
  assert.equal(out.kind === "waiting" && out.why, "not_ready");
  assert.equal(h.store.events().length, 0);
  assert.equal(h.called("worker-start").length, 0);
});

test("no capacity waits", async () => {
  const h = harness();
  const out = await start(h, request(), 0);
  assert.equal(out.kind === "waiting" && out.why, "no_capacity");
  assert.equal(h.called("worker-start").length, 0);
});

// ---- T5 ----

test("T5: an already dispatched Task is not started again", async () => {
  const h = harness({ newTaskStatus: "dispatched" });
  const out = await start(h, request({ task: { id: NEW_TASK } }));
  assert.equal(out.kind === "waiting" && out.why, "already_dispatched");
  assert.equal(h.called("worker-start").length, 0);
});

test("T5: the third failed start writes loop_detected once; the fourth does not call Orca", async () => {
  const h = harness({ workerStart: () => fail("spawn_failed") });
  const req = request({ task: { id: NEW_TASK } });
  for (let i = 0; i < 3; i++) assert.equal((await start(h, req)).kind, "refused");
  assert.equal(h.store.events({ type: "loop_detected" }).length, 1);
  const fourth = await start(h, req);
  assert.deepEqual(fourth, { kind: "stopped", taskId: NEW_TASK, why: "start_failed_3x" });
  assert.equal(h.called("worker-start").length, 3);
});

test("a failed start that reports a Dispatch writes worker_dead{start_failed}", async () => {
  const h = harness({
    workerStart: () => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code: "start_failed", message: "x", data: { dispatchId: "ctx_dead" } } }), stderr: "" }),
  });
  await start(h);
  const dead = h.store.events({ type: "worker_dead" });
  assert.equal(dead.length, 1);
  assert.equal(dead[0]?.entity_id, "ctx_dead");
});

// ---- task-create, first prompt, references ----

test("a new Task goes through task-create --deps on the requester's Run, late answers in the first prompt", async () => {
  const h = harness();
  await start(h, request({ task: { spec: "/goal x", deps: ["task_a"], lateAnswers: ["d001: yes"] } }));
  const tc = h.called("task-create")[0] ?? [];
  assert.equal(flag(tc, "deps"), JSON.stringify(["task_a"]));
  assert.equal(flag(tc, "run"), RUN);
  assert.match(flag(tc, "spec") ?? "", /^\/goal x\n[\s\S]*d001: yes/);
});

test("ticket references attach to the new worktree; a failure does not stop the start", async () => {
  const h = harness({ replies: { "reference-add": fail("no_such_worktree") } });
  const out = await start(h, request({ references: ["https://tracker.example/acme-1"] }));
  assert.equal(out.kind, "started");
  assert.equal(out.kind === "started" && out.notes.length, 1);
  const ref = h.fake.calls.find((c) => c[1] === "reference" && c[2] === "add") ?? [];
  assert.equal(flag(ref, "worktree"), CHILD_TREE);
  assert.ok(ref.includes("https://tracker.example/acme-1"));
});

// ---- unit_lineage_complete on fake Orca ----

test("unit_lineage_complete: a started unit has its Dispatch, Run and parentWorktreeId", async () => {
  const h = harness({ replies: { "orchestration-dispatch-show": ok(dispatchRow("ctx_000000000001", "task_000000000001", 1)) } });
  const r = await checkLineage(h.orca, [{ taskId: "task_000000000001", parentWorktreeId: PARENT_TREE }]);
  assert.deepEqual(r.units[0]?.problems, []);
  assert.equal(r.ok, true);
});

test("unit_lineage_complete: a missing parent, Dispatch or a different parent fails", async () => {
  const h = harness();
  const noDispatch = await checkLineage(h.orca, [{ taskId: "task_unknown", parentWorktreeId: PARENT_TREE }]);
  assert.equal(noDispatch.ok, false);
  const h2 = harness({ replies: { "orchestration-dispatch-show": ok(dispatchRow("ctx_000000000001", "task_000000000001", 1)) } });
  const wrong = await checkLineage(h2.orca, [{ taskId: "task_000000000001", parentWorktreeId: "repo-0001::/elsewhere" }]);
  assert.equal(wrong.ok, false);
  assert.match(wrong.units[0]?.problems[0] ?? "", /부모가 다르다/);
  const h3 = harness({
    replies: {
      "orchestration-dispatch-show": ok(dispatchRow("ctx_000000000001", "task_000000000001", 1)),
      "orchestration-worker-show": ok({ dispatchId: "ctx_000000000001", taskId: "task_000000000001", runId: RUN, state: "ready", workspace: PARENT_TREE }),
    },
  });
  const orphan = await checkLineage(h3.orca, [{ taskId: "task_000000000001", parentWorktreeId: PARENT_TREE }]);
  assert.match(orphan.units[0]?.problems[0] ?? "", /parentWorktreeId 가 없다/);
});
