import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { itemNew } from "../../cli/commands/item-new.ts";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import { handle } from "../../claude-plugin/mcp/tools/start_unit.ts";
import {
  checkLineage,
  createOrcaAdapter,
  type ExecResult,
  MODEL_CATALOG,
  MODEL_POLICY,
  type Requester,
  type StartRequest,
  Store,
  startUnit,
} from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

const PARENT_TREE = "repo-0001::/home/dev/src/api";
const CHILD_TREE = "repo-0001::/home/dev/workspaces/api/feature-a";
const ORCH = "term_00000000-0000-4000-8000-00000000000f";
/** The lead's own Run, where it creates and starts; its Dispatch lives in the orchestrator's. */
const RUN = "run_000000000001";
const ORCH_RUN = "run_00000000000f";
const NEW_TASK = "task_new";

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const fail = (code: string, message = code): ExecResult => ({
  code: 1,
  stdout: JSON.stringify({ ok: false, error: { code, message } }),
  stderr: "",
});
const flag = (args: readonly string[], name: string) => args[args.indexOf(`--${name}`) + 1];

const dispatchRow = (id: string, task: string, depth: number, run: string) => ({
  dispatch: { id, run_id: run, task_id: task, status: "dispatched", depth, failure_count: 0, creator_handle: ORCH },
});

type Setup = {
  scenario?: string;
  requesterDepth?: number;
  requesterDispatch?: "missing";
  /** The worktree Orca says the requester's Dispatch runs in. */
  requesterWorkspace?: string;
  /** What run-current answers for the calling session. */
  heldRun?: string | null;
  newTaskStatus?: string;
  /** The role line task-list --full shows on task_new's spec; worker by default. */
  existingRole?: string;
  /** What `dispatch-show --task task_new` answers after the start. */
  newDispatch?: "missing";
  taskList?: () => ExecResult;
  workerStart?: () => ExecResult;
  /** A live Dispatch in the requester's worktree, on worker-list's second page (a lead claiming orchestrator). */
  liveDispatchInParent?: boolean;
  replies?: Record<string, FakeReply>;
};

const workerRow = (dispatchId: string, workspace: string, liveness: string) => ({
  dispatchId,
  taskId: `task_${dispatchId.slice(4)}`,
  state: liveness === "live" ? "ready" : "settled",
  liveness,
  workspace,
  host: "local",
});

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
          return s.requesterDispatch === "missing" ? fail("dispatch_not_found") : ok(dispatchRow("ctx_lead", task, s.requesterDepth ?? 1, ORCH_RUN));
        }
        if (task === NEW_TASK && s.newDispatch !== "missing") return ok(dispatchRow("ctx_new", task, (s.requesterDepth ?? 1) + 1, RUN));
        return fail("dispatch_not_found");
      },
      "orchestration-worker-show": ok({
        dispatchId: "ctx_lead",
        taskId: "task_lead",
        runId: ORCH_RUN,
        state: "ready",
        workspace: s.requesterWorkspace ?? PARENT_TREE,
      }),
      "orchestration-worker-list": (args: readonly string[]) =>
        args.includes("--cursor")
          ? ok({ workers: s.liveDispatchInParent ? [workerRow("ctx_lead", PARENT_TREE, "live")] : [], scope: { source: "all" } })
          : ok({
              workers: [workerRow("ctx_000000000001", CHILD_TREE, "live"), workerRow("ctx_000000000003", PARENT_TREE, "gone")],
              scope: { source: "all" },
              nextCursor: "cursor-0002",
            }),
      "orchestration-run-current": ok({ runId: s.heldRun === undefined ? RUN : s.heldRun }),
      "orchestration-task-create": ok({ task: { id: NEW_TASK } }),
      "orchestration-task-list": () =>
        s.taskList
          ? s.taskList()
          : ok({ tasks: [{ id: NEW_TASK, status: s.newTaskStatus ?? "ready", title: "t", spec: `sangsoe-role: ${s.existingRole ?? "worker"}\nbrief` }] }),
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
const { taskId: _unused, ...noTask } = lead;
const orchestrator: Requester = { ...noTask, role: "orchestrator" };
const request = (over: Partial<StartRequest> = {}): StartRequest => ({
  requester: lead,
  childRole: "worker",
  task: { spec: "do the thing", title: "thing", deps: ["task_000000000002"] },
  agent: "claude",
  ...over,
});

type H = ReturnType<typeof harness>;
/** The calling session runs inside the api worktree (PARENT_TREE's path in the recording). */
const CALLER_CWD = "/home/dev/src/api/packages/web";
const ports = (h: H, slots: () => number = () => 1, cwd = CALLER_CWD) => ({ orca: h.orca, store: h.store, slots, cwd: () => cwd });
async function start(h: H, req: StartRequest = request(), slots: () => number = () => 1) {
  return startUnit(ports(h, slots), req);
}

function assertRefused(h: H, out: Awaited<ReturnType<typeof start>>, reason: string) {
  assert.equal(out.kind, "refused");
  assert.equal(out.kind === "refused" && out.reason, reason);
  const sig = h.signals();
  assert.equal(sig.length, 1, "one signal line");
  assert.deepEqual(sig[0]?.payload, { kind: "start_refused", reason });
  assert.equal(h.called("worker-start").length, 0, "no session opened");
}

function assertEscalatedToParent(h: H, out: Awaited<ReturnType<typeof start>>) {
  const sent = h.called("send");
  assert.equal(sent.length, 1, "one escalation");
  assert.equal(flag(sent[0] ?? [], "type"), "escalation");
  assert.equal(flag(sent[0] ?? [], "to"), ORCH);
  assert.equal(out.kind === "refused" && out.escalatedTo, ORCH);
}

// ---- the five refusals, in decision 94 (나)'s order ----

test("capability_missing: a required capability is absent; nothing is created and the parent hears", async () => {
  const h = harness({ scenario: "missing-capability" });
  const out = await start(h);
  assertRefused(h, out, "capability_missing");
  assert.equal(h.called("task-create").length, 0);
  assertEscalatedToParent(h, out);
});

test("lineage_invalid: a worker starts nothing, and its parent hears about it", async () => {
  const h = harness();
  const out = await start(h, request({ requester: { ...lead, role: "worker" } }));
  assertRefused(h, out, "lineage_invalid");
  assertEscalatedToParent(h, out);
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
  const h = harness({ requesterWorkspace: "repo-0001::/nowhere" });
  assertRefused(h, await start(h, request({ requester: { ...lead, worktreeId: "repo-0001::/nowhere" } })), "lineage_invalid");
  assert.equal(h.called("task-create").length, 0);
});

test("lineage_invalid: a lead whose Dispatch is not at depth 1 is not a lead", async () => {
  const h = harness({ requesterDepth: 2 });
  assertRefused(h, await start(h), "lineage_invalid");
});

test("lineage_invalid: a claim Orca contradicts is refused (held Run, Dispatch's worktree, Dispatch inside the Run)", async () => {
  // A worker holds no Run, so claiming to be the orchestrator fails on run-current.
  const notHeld = harness({ heldRun: null });
  assertRefused(notHeld, await start(notHeld, request({ requester: orchestrator })), "lineage_invalid");
  // Someone else's Task: its Dispatch runs in another worktree.
  const other = harness({ requesterWorkspace: CHILD_TREE });
  assertRefused(other, await start(other), "lineage_invalid");
  // Starting inside the Run one's own Dispatch lives in: a worker, not the Run's holder.
  const inside = harness();
  assertRefused(inside, await start(inside, request({ requester: { ...lead, runId: ORCH_RUN } })), "lineage_invalid");
});

test("lineage_invalid: an orchestrator holding a Task is refused; an orchestrator refusal ends at the owner", async () => {
  const h = harness();
  const out = await start(h, request({ requester: { ...orchestrator, taskId: "task_lead" } }));
  assertRefused(h, out, "lineage_invalid");
  assert.equal(out.kind === "refused" && out.escalatedTo, "owner");
  assert.equal(h.called("send").length, 0);
  const esc = h.store.events({ type: "escalation" });
  assert.equal(esc.length, 1);
  assert.deepEqual(esc[0]?.payload, { to: "owner", reason: "start_refused:lineage_invalid" });
});

test("lineage_invalid: a lead claiming to be the orchestrator is refused by its own live Dispatch", async () => {
  // A lead holds its own Run, so run-current passes; its worktree's live Dispatch gives it away.
  const h = harness({ liveDispatchInParent: true });
  const out = await start(h, request({ requester: orchestrator, childRole: "lead" }));
  assertRefused(h, out, "lineage_invalid");
  assert.match(out.kind === "refused" ? out.detail : "", /ctx_lead/);
  assert.equal(h.called("worker-list").length, 2, "followed the cursor past the first page");
  assert.equal(h.called("task-create").length, 0);
  // The same worktree with only settled Dispatches is the orchestrator's.
  const clean = harness();
  assert.equal((await start(clean, request({ requester: orchestrator, childRole: "lead" }))).kind, "started");
});

test("lineage_invalid: a declared worktree the calling session does not run in is refused, on every path", async () => {
  // A lead naming some other clean worktree as its own, to pass as the orchestrator.
  const elsewhere = "/home/dev/workspaces/api/feature-a";
  const orch = harness();
  const out = await startUnit(ports(orch, () => 1, elsewhere), request({ requester: orchestrator, childRole: "lead" }));
  assertRefused(orch, out, "lineage_invalid");
  assert.match(out.kind === "refused" ? out.detail : "", /작업 폴더/);
  const asLead = harness();
  assertRefused(asLead, await startUnit(ports(asLead, () => 1, elsewhere), request()), "lineage_invalid");
  // A sibling folder sharing the prefix is not inside.
  const sibling = harness();
  assertRefused(sibling, await startUnit(ports(sibling, () => 1, "/home/dev/src/api-old"), request()), "lineage_invalid");
});

test("lineage_invalid: with a worktree nested in the checkout, only the innermost one is the caller's", async () => {
  const recorded = JSON.parse(readFileSync(new URL("../fake-orca/scenarios/local/worktree-list.json", import.meta.url), "utf8"));
  const nested = "/home/dev/src/api/.worktrees/lead-x";
  const main = recorded.result.worktrees[0];
  recorded.result.worktrees.push({ ...main, id: `repo-0001::${nested}`, path: nested, isMainWorktree: false });
  // A lead running in the nested worktree names the main checkout, which also contains its cwd.
  const h = harness({ replies: { "worktree-list": () => ({ code: 0, stdout: JSON.stringify(recorded), stderr: "" }) } });
  const out = await startUnit(ports(h, () => 1, `${nested}/src`), request({ requester: orchestrator, childRole: "lead" }));
  assertRefused(h, out, "lineage_invalid");
});

test("the worktree binding compares physical paths: a symlinked root still matches", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sangsoe-start-"));
  t.after(() => rmSync(dir, { recursive: true }));
  mkdirSync(join(dir, "api", "web"), { recursive: true });
  symlinkSync(join(dir, "api"), join(dir, "link"));
  const recorded = JSON.parse(readFileSync(new URL("../fake-orca/scenarios/local/worktree-list.json", import.meta.url), "utf8"));
  recorded.result.worktrees = [{ ...recorded.result.worktrees[0], id: PARENT_TREE, path: join(dir, "link") }];
  const h = harness({ replies: { "worktree-list": () => ({ code: 0, stdout: JSON.stringify(recorded), stderr: "" }) } });
  const out = await startUnit(ports(h, () => 1, realpathSync(join(dir, "api", "web"))), request());
  assert.equal(out.kind, "started");
});

test("lineage_invalid: an unsettled Dispatch Orca cannot call live still gives a lead away", async () => {
  const h = harness({
    replies: {
      "orchestration-worker-list": () => ok({ workers: [{ ...workerRow("ctx_lead", PARENT_TREE, "unknown"), state: "ready" }], scope: { source: "all" } }),
    },
  });
  assertRefused(h, await start(h, request({ requester: orchestrator })), "lineage_invalid");
});

test("lineage_invalid: an unreadable worker-list is not a pass for the orchestrator", async () => {
  const h = harness({ replies: { "orchestration-worker-list": () => fail("runtime_unavailable") } });
  assertRefused(h, await start(h, request({ requester: orchestrator })), "lineage_invalid");
});

test("depth_exceeded: an orchestrator does not start a lead that could not start workers", async () => {
  const h = harness();
  assertRefused(h, await start(h, request({ requester: orchestrator, childRole: "lead", maxDepth: 1 })), "depth_exceeded");
});

test("orca_error: a failed worker-start is refused with Orca's code; the Task stays", async () => {
  const h = harness({ workerStart: () => fail("task_not_startable", "deps not done") });
  const out = await start(h);
  assert.equal(out.kind === "refused" && out.reason, "orca_error");
  assert.match(out.kind === "refused" ? out.detail : "", /task_not_startable/);
  assert.equal(h.called("task-update").length, 0, "the Task is not closed");
  assert.equal(h.called("send").length, 1);
});

test("orca_error: unreadable capacity is reported, not taken for a full machine", async () => {
  const h = harness();
  const out = await start(h, request(), () => {
    throw new Error("worker-list runtime_unavailable");
  });
  assert.equal(out.kind === "refused" && out.reason, "orca_error");
  assert.equal(h.called("worker-start").length, 0);
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
  assertEscalatedToParent(h, out);
});

test("worker_start_dispatched (2): enough depth → a Dispatch and no event", async () => {
  const h = harness();
  const out = await start(h, request({ maxDepth: 3 }));
  assert.deepEqual(out, { kind: "started", taskId: NEW_TASK, dispatchId: "ctx_new", worktreeId: CHILD_TREE, notes: [] });
  assert.equal(h.store.events().length, 0);
  const ws = h.called("worker-start")[0] ?? [];
  assert.equal(flag(ws, "worktree"), "new-child");
  assert.equal(flag(ws, "task"), NEW_TASK);
  assert.equal(flag(ws, "run"), RUN);
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
  const out = await start(h, request(), () => 0);
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

test("T5: no_dispatch starts count too; failed reads before the start do not", async () => {
  const h = harness({ workerStart: () => ok({}), newDispatch: "missing" });
  const req = request({ task: { id: NEW_TASK } });
  for (let i = 0; i < 3; i++) await start(h, req);
  assert.equal(h.store.events({ type: "loop_detected" }).length, 1);
  assert.equal((await start(h, req)).kind, "stopped");

  const reads = harness({ taskList: () => fail("runtime_unavailable") });
  for (let i = 0; i < 4; i++) assert.equal((await start(reads, req)).kind, "refused");
  assert.equal(reads.store.events({ type: "loop_detected" }).length, 0);
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

test("a new Task goes through task-create --deps on the requester's Run: role line first, late answers after the brief", async () => {
  const h = harness();
  await start(h, request({ task: { spec: "brief x", deps: ["task_a"], lateAnswers: ["d001: yes"] } }));
  const tc = h.called("task-create")[0] ?? [];
  assert.equal(flag(tc, "deps"), JSON.stringify(["task_a"]));
  assert.equal(flag(tc, "run"), RUN);
  assert.match(flag(tc, "spec") ?? "", /^sangsoe-role: worker\nbrief x\n[\s\S]*d001: yes/);
});

test("a lead's Task carries the lead role line", async () => {
  const h = harness();
  await start(h, request({ requester: orchestrator, childRole: "lead" }));
  assert.match(flag(h.called("task-create")[0] ?? [], "spec") ?? "", /^sangsoe-role: lead\n/);
});

test("an existing Task starts only as the role its spec's first line names, for both roles", async () => {
  // Orca cannot rewrite a spec: an item written for a worker would start a lead as a worker.
  const asLead = harness();
  assertRefused(asLead, await start(asLead, request({ requester: orchestrator, childRole: "lead", task: { id: NEW_TASK } })), "lineage_invalid");
  const asWorker = harness({ existingRole: "lead" });
  assertRefused(asWorker, await start(asWorker, request({ task: { id: NEW_TASK } })), "lineage_invalid");

  const lead = harness({ existingRole: "  lead " });
  assert.equal((await start(lead, request({ requester: orchestrator, childRole: "lead", task: { id: NEW_TASK } }))).kind, "started");
  const worker = harness();
  assert.equal((await start(worker, request({ task: { id: NEW_TASK } }))).kind, "started");
  assert.ok((worker.called("task-list")[0] ?? []).includes("--full"), "the spec comes from task-list --full");
});

test("item_create writes the role it is given as the spec's first line; worker by default", async () => {
  const specs: string[] = [];
  const fake = createFakeOrca({
    replies: {
      "orchestration-task-create": (args: readonly string[]) => {
        specs.push(flag(args, "spec") ?? "");
        return ok({ taskId: `task_${specs.length}` });
      },
    },
  });
  const ports = { orca: createOrcaAdapter(fake.exec), store: Store.open({ path: ":memory:" }) };
  const base = { runId: RUN, spec: "brief", who: "lead:api", doneWhen: "merged" };
  assert.ok((await itemCreate({ ...base, role: "lead" }, ports)).ok);
  assert.ok((await itemCreate(base, ports)).ok);
  assert.deepEqual(specs, ["sangsoe-role: lead\nbrief", "sangsoe-role: worker\nbrief"]);
  const bad = await itemCreate({ ...base, role: "orchestrator" }, ports);
  assert.equal(bad.ok ? "" : bad.refusal.code, "invalid_input");
  assert.equal(specs.length, 2, "no Task for a role off the list");

  const cli = { run: RUN, spec: "brief", who: "lead:api", "done-when": "merged" };
  assert.ok((await itemNew({ ...cli, role: "lead" }, ports)).ok);
  const badCli = await itemNew({ ...cli, role: "orchestrator" }, ports);
  assert.equal(badCli.ok ? "" : badCli.refusal.code, "invalid_input");
  assert.deepEqual(specs.slice(2), ["sangsoe-role: lead\nbrief"], "the CLI entrance takes the same role");
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

test("the start_unit MCP tool carries late answers into the first prompt", async () => {
  const h = harness();
  const r = await handle(
    { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN, childRole: "worker", spec: "brief", lateAnswers: ["d002: no"] },
    ports(h),
  );
  assert.equal(r.ok, true);
  assert.match(flag(h.called("task-create")[0] ?? [], "spec") ?? "", /d002: no/);
});

test("MCP start_unit refuses input it would otherwise drop or misread, before calling Orca", async () => {
  const base = { worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN };
  const cases = [
    { ...base, role: "lead", childRole: "worker", task: "task_000000000002", lateAnswers: ["d002: no"] },
    { ...base, childRole: "lead", spec: "brief" },
    { ...base, role: "lead", childRole: "boss", spec: "brief" },
  ];
  for (const input of cases) {
    const h = harness();
    const r = await handle(input, ports(h));
    assert.equal(r.ok === false && r.refusal.code, "invalid_input", JSON.stringify(input));
    assert.equal(h.fake.calls.length, 0);
  }
});

test("decision 164: worker-start gets the role row's alias and effort; an escalation is recorded as model_changed", async () => {
  const h = harness();
  await start(h, request({ requester: orchestrator, childRole: "lead" }));
  const ws = h.called("worker-start")[0] ?? [];
  const row = MODEL_POLICY.lead;
  assert.equal(flag(ws, "model"), MODEL_CATALOG.find((c) => c.tier === row.tier)?.alias);
  assert.equal(flag(ws, "effort"), row.effort);
  assert.deepEqual(h.store.events({ type: "model_changed" }), []);

  const h2 = harness();
  const base = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN, childRole: "worker", spec: "brief" };
  const top = MODEL_POLICY.design.raiseEffort.at(-1);
  const r = await handle({ ...base, kind: "design", effort: top, tier: MODEL_POLICY.design.thenTier, reason: "max still misses the race" }, ports(h2));
  assert.equal(r.ok, true);
  const ws2 = h2.called("worker-start")[0] ?? [];
  assert.equal(flag(ws2, "model"), MODEL_CATALOG.find((c) => c.tier === MODEL_POLICY.design.thenTier)?.alias);
  const target = MODEL_CATALOG.find((c) => c.tier === MODEL_POLICY.design.thenTier);
  assert.equal(flag(ws2, "effort"), target?.apiDefaultEffort, "the new tier starts at its own effort (decision 172)");
  const changed = h2.store.events({ type: "model_changed" });
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.payload.reason, "max still misses the race");
});

test("MCP start_unit refuses a model choice off the table before calling Orca", async () => {
  const base = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN, childRole: "worker", spec: "brief" };
  const cases = [
    { ...base, kind: "orchestrator" },
    { ...base, kind: "lead" },
    { ...base, kind: "design", tier: MODEL_POLICY.design.thenTier, reason: "skip the ladder" },
    { ...base, kind: "design", effort: MODEL_POLICY.design.raiseEffort.at(-1) },
    { ...base, kind: "worker", effort: "low", reason: "cheaper" },
  ];
  for (const input of cases) {
    const h = harness();
    const r = await handle(input, ports(h));
    assert.equal(r.ok === false && r.refusal.code, "invalid_input", JSON.stringify(input));
    assert.equal(h.fake.calls.length, 0);
  }
});

// ---- unit_lineage_complete on fake Orca ----

const recorded = { "orchestration-dispatch-show": ok(dispatchRow("ctx_000000000001", "task_000000000001", 1, RUN)) };
const unit = { taskId: "task_000000000001", runId: RUN, parentWorktreeId: PARENT_TREE };

test("unit_lineage_complete: a started unit has its Dispatch, Run and parentWorktreeId", async () => {
  // worker-show and worktree list come from the recording: ctx_000000000001 in feature-a, a child of the api worktree.
  const fake = createFakeOrca({ replies: asReplies(recorded) });
  const r = await checkLineage(createOrcaAdapter(fake.exec), [unit]);
  assert.deepEqual(r.units[0]?.problems, []);
  assert.equal(r.ok, true);
});

test("unit_lineage_complete: a missing Dispatch, a different parent or Run, a crossed worker, or no parent fails", async () => {
  const lineage = async (replies: Record<string, FakeReply>, u = unit) =>
    checkLineage(createOrcaAdapter(createFakeOrca({ replies: asReplies(replies) }).exec), [u]);
  assert.equal((await lineage({}, { ...unit, taskId: "task_unknown" })).ok, false);
  const wrongParent = await lineage(recorded, { ...unit, parentWorktreeId: "repo-0001::/elsewhere" });
  assert.match(wrongParent.units[0]?.problems.join() ?? "", /부모가 다르다/);
  const wrongRun = await lineage(recorded, { ...unit, runId: "run_other" });
  assert.match(wrongRun.units[0]?.problems.join() ?? "", /Run 이 다르다/);
  const crossed = await lineage({
    ...recorded,
    "orchestration-worker-show": ok({ dispatchId: "ctx_other", taskId: "task_other", runId: "run_other", state: "ready", workspace: CHILD_TREE }),
  });
  assert.match(crossed.units[0]?.problems.join() ?? "", /워커가 이 Dispatch/);
  const orphan = await lineage({
    ...recorded,
    "orchestration-worker-show": ok({ dispatchId: "ctx_000000000001", taskId: "task_000000000001", runId: RUN, state: "ready", workspace: PARENT_TREE }),
  });
  assert.match(orphan.units[0]?.problems.join() ?? "", /parentWorktreeId 가 없다/);
});
