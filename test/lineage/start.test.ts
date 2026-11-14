import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { itemNew } from "../../cli/commands/item-new.ts";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import { handle } from "../../claude-plugin/mcp/tools/start_unit.ts";
import {
  ADVISOR_FROM_SETTING,
  ADVISOR_FROM_WORKTREE,
  ADVISOR_NOT_APPLIED,
  ADVISOR_SPENT,
  checkLineage,
  classKind,
  createOrcaAdapter,
  resolveModel,
  UNIT_CLASSES,
  dedupeKey,
  EVENTS,
  type ExecResult,
  type ExpectedUnit,
  MODEL_CATALOG,
  MODEL_POLICY,
  type Requester,
  type StartRequest,
  Store,
  startUnit,
  type WorktreeSettings,
} from "../../core/index.ts";
import { createFakeOrca, type FakeReply } from "../fake-orca/index.ts";

const PARENT_TREE = "repo-0001::/home/dev/src/api";
const CHILD_PATH = "/home/dev/workspaces/api/feature-a";
const CHILD_TREE = `repo-0001::${CHILD_PATH}`;
/** What worker-start's --worktree names after start_unit made the worktree (decision 202). */
const CHILD_SELECTOR = `id:${CHILD_TREE}`;
/** The plain shell `worktree create` opens in the new worktree. */
const SHELL = "term_00000000-0000-4000-8000-0000000000aa";
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
  /** The first line of task_lead's spec in the orchestrator's Run; null leaves task_lead out of that list. */
  requesterRoleLine?: string | null;
  /** task-list on the orchestrator's Run, where the lead's own Task lives; `taskList` answers the rest. */
  requesterTaskList?: () => ExecResult;
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
      "orchestration-task-list": (args: readonly string[]) =>
        flag(args, "run") === ORCH_RUN
          ? s.requesterTaskList
            ? s.requesterTaskList()
            : ok({ tasks: s.requesterRoleLine === null ? [] : [{ id: "task_lead", status: "dispatched", title: "lead", spec: `${s.requesterRoleLine ?? "sangsoe-role: lead"}\nprogram brief` }] })
          : s.taskList
            ? s.taskList()
            : ok({ tasks: [{ id: NEW_TASK, status: s.newTaskStatus ?? "ready", title: "t", spec: `sangsoe-role: ${s.existingRole ?? "worker"}\nbrief` }] }),
      "orchestration-worker-start": () => (s.workerStart ? s.workerStart() : ok({ dispatchId: "ctx_new", worktreeId: CHILD_TREE })),
      "worktree-create": ok({ worktree: { id: CHILD_TREE, path: CHILD_PATH, repoId: "repo-0001" } }),
      "terminal-list": ok({ terminals: [{ handle: SHELL, worktreeId: CHILD_TREE, executionHostId: "local" }], hostScope: { hostIds: ["local"], omittedHostIds: [] }, truncated: false }),
      "repo-show": ok({ repo: { id: "repo-0001", hookSettings: { scripts: { setup: "", archive: "" } } } }),
      ...s.replies,
    }),
  });
  const store = Store.open({ path: ":memory:" });
  const orca = createOrcaAdapter(fake.exec);
  const called = (sub: string) => fake.calls.filter((c) => c.slice(1, 3).join(" ") === `orchestration ${sub}`);
  const named = (cmd: string) => fake.calls.filter((c) => c.slice(1, 3).join(" ") === cmd);
  /** Every local-settings write, in order: the worktree path and what went in. */
  const written: { path: string; settings: WorktreeSettings }[] = [];
  return { fake, store, orca, called, named, written, signals: () => store.events({ type: "signal" }) };
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
// The owner's advisorModel is fixed here so the launch does not depend on this machine's settings.
const ports = (h: H, slots: () => number = () => 1, cwd = CALLER_CWD) => ({
  orca: h.orca,
  store: h.store,
  slots,
  cwd: () => cwd,
  advisorSetting: () => true,
  writeSettings: (path: string, settings: WorktreeSettings) => {
    h.written.push({ path, settings });
  },
  hookFile: () => false,
});
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

// ---- decision 243: a lead that holds its Run but has no Task ----

/** A lead started outside start_unit: it holds its Run and runs in its worktree, with no Dispatch of its own. */
const taskless: Requester = noTask;

test("decision 243: a Task-less lead holding the Run starts a worker under its worktree; the rows name that Run", async () => {
  const h = harness();
  const out = await start(h, request({ requester: taskless }));
  assert.equal(out.kind, "started", JSON.stringify(out));
  assert.equal(flag(h.named("worktree create")[0] ?? [], "parent-worktree"), `id:${PARENT_TREE}`);
  assert.equal(flag(h.called("worker-start")[0] ?? [], "run"), RUN);
  assert.equal(h.called("worker-list").length, 2, "its worktree is scanned for a live Dispatch");
  assert.ok(!h.called("dispatch-show").some((c) => flag(c, "task") === "task_lead"), "no Dispatch of its own to read");
  assert.equal(h.store.events({ type: "item_created" })[0]?.payload.who, `lead:${RUN}`);
  assert.equal(h.store.events({ type: "unit_started" })[0]?.payload.run, RUN);
});

test("decision 243: a Task-less lead starts no lead, and its refusal ends at the owner", async () => {
  const h = harness();
  const out = await start(h, request({ requester: taskless, childRole: "lead" }));
  assertRefused(h, out, "lineage_invalid");
  assert.match(out.kind === "refused" ? out.detail : "", /리드는 리드를 시작하지 않는다/);
  assert.equal(out.kind === "refused" && out.escalatedTo, "owner");
  assert.equal(h.called("send").length, 0);
  assert.deepEqual(h.store.events({ type: "escalation" })[0]?.payload, { to: "owner", reason: "start_refused:lineage_invalid" });
});

test("decision 243: a session with a live Dispatch in its worktree cannot drop its Task to pass as a Task-less lead", async () => {
  const live = harness({ liveDispatchInParent: true });
  const out = await start(live, request({ requester: taskless }));
  assertRefused(live, out, "lineage_invalid");
  assert.match(out.kind === "refused" ? out.detail : "", /ctx_lead/);
  const unread = harness({ replies: { "orchestration-worker-list": () => fail("runtime_unavailable") } });
  assertRefused(unread, await start(unread, request({ requester: taskless })), "lineage_invalid");
});

test("decision 243: a Task-less lead must hold the Run and name the worktree it runs in", async () => {
  for (const heldRun of [null, ORCH_RUN]) {
    const h = harness({ heldRun });
    assertRefused(h, await start(h, request({ requester: taskless })), "lineage_invalid");
  }
  const { worktreeId: _w, ...noTree } = taskless;
  const bare = harness();
  const r = await startUnit(ports(bare, () => 1, "/"), request({ requester: noTree, repo: "name:acme-web" }));
  assertRefused(bare, r, "lineage_invalid");
  assert.match(r.kind === "refused" ? r.detail : "", /worktree 없이 시작하는 것은 오케스트레이터뿐/);
  const elsewhere = harness();
  const e = await startUnit(ports(elsewhere, () => 1, "/home/dev/workspaces/api/feature-a"), request({ requester: taskless }));
  assertRefused(elsewhere, e, "lineage_invalid");
  assert.match(e.kind === "refused" ? e.detail : "", /작업 폴더/);
});

test("decision 243: a Task-less lead's worker sits at depth 1 under the depth setting", async () => {
  const deep = harness();
  assertRefused(deep, await start(deep, request({ requester: taskless, maxDepth: 0 })), "depth_exceeded");
  const fits = harness();
  assert.equal((await start(fits, request({ requester: taskless, maxDepth: 1 }))).kind, "started");
});

test("decision 243: MCP start_unit passes a lead with no taskId to the core", async () => {
  const h = harness();
  const r = await handle({ role: "lead", worktreeId: PARENT_TREE, runId: RUN, childRole: "worker", spec: "brief" }, ports(h));
  assert.equal(r.ok && (r.value as { kind: string }).kind, "started", JSON.stringify(r));
});

test("decision 243 ③: a lead with a Task is a lead only if its Task's role line says so, read from its Dispatch's Run", async () => {
  // A depth-1 worker holding a Run of its own would otherwise pass as a lead.
  const worker = harness({ requesterRoleLine: "sangsoe-role: worker" });
  const out = await start(worker, request());
  assertRefused(worker, out, "lineage_invalid");
  assert.match(out.kind === "refused" ? out.detail : "", /sangsoe-role/);
  // It has a Dispatch, so the refusal goes to whoever started it, not to the owner.
  assertEscalatedToParent(worker, out);
  assert.equal(worker.store.events({ type: "escalation" }).length, 0);
  const read = worker.called("task-list").find((c) => flag(c, "run") === ORCH_RUN) ?? [];
  assert.ok(read.includes("--full"), "the spec comes from task-list --full on the Dispatch's Run");
  for (const s of [{ requesterRoleLine: null }, { requesterRoleLine: "program brief, no role line" }, { requesterTaskList: () => fail("runtime_unavailable") }]) {
    const h = harness(s);
    assertRefused(h, await start(h), "lineage_invalid");
  }
  const noRun = harness({
    replies: { "orchestration-dispatch-show": () => ok({ dispatch: { ...dispatchRow("ctx_lead", "task_lead", 1, ORCH_RUN).dispatch, run_id: "" } }) },
  });
  const r = await start(noRun);
  assertRefused(noRun, r, "lineage_invalid");
  assert.match(r.kind === "refused" ? r.detail : "", /Run 이 없다/);
  const lead = harness();
  assert.equal((await start(lead)).kind, "started");
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

test("decision 207: a lead whose Dispatch has settled tells its parent by status, not escalation (Orca: sender_not_assignee)", async () => {
  const settledLead = {
    dispatch: { ...dispatchRow("ctx_lead", "task_lead", 1, ORCH_RUN).dispatch, status: "completed", completed_at: "2026-11-11 03:00:00" },
  };
  const h = harness({ workerStart: () => fail("task_not_startable", "deps not done"), replies: { "orchestration-dispatch-show": (args: readonly string[]) => (flag(args, "task") === "task_lead" ? ok(settledLead) : fail("dispatch_not_found")) } });
  const out = await start(h);
  assert.equal(out.kind === "refused" && out.reason, "orca_error");
  const sent = h.called("send");
  assert.equal(sent.length, 1);
  assert.equal(flag(sent[0] ?? [], "type"), "status");
  assert.ok(!(sent[0] ?? []).includes("--dispatch-id"), "a settled Dispatch is named by no message");
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
  const worker = MODEL_POLICY.worker;
  assert.deepEqual(out, {
    kind: "started",
    taskId: NEW_TASK,
    alias: "i001",
    dispatchId: "ctx_new",
    worktreeId: CHILD_TREE,
    shell: SHELL,
    launch: { model: MODEL_CATALOG.find((c) => c.tier === worker.tier)?.alias, effort: worker.effort, route: "worktree_file" },
    notes: [ADVISOR_FROM_WORKTREE],
  });
  assert.deepEqual(h.store.events().map((e) => e.type), ["item_created", "unit_started"], "the alias row and the row it started on");
  const ws = h.called("worker-start")[0] ?? [];
  assert.equal(flag(ws, "worktree"), CHILD_SELECTOR);
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
  assert.deepEqual(h.store.events().map((e) => e.type), ["item_created"], "only the new Task's alias row");
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
  const r = await start(h);
  const dead = h.store.events({ type: "worker_dead" });
  assert.equal(dead.length, 1);
  assert.equal(dead[0]?.entity_id, "ctx_dead");
  // Decision 201: the alarm names the Task, or the brief has no item to raise it on.
  assert.ok("taskId" in r && r.taskId);
  assert.equal(dead[0]?.target, r.taskId);
});

test("decision 200: unit_started records the picked row before worker-start, for the new session's SessionStart", async () => {
  let seenAtStart = -1;
  const h = harness({
    workerStart: () => {
      seenAtStart = h.store.events({ type: "unit_started" }).length;
      return ok({ dispatchId: "ctx_new", worktreeId: CHILD_TREE });
    },
  });
  assert.equal((await start(h)).kind, "started");
  assert.equal(seenAtStart, 1, "the row is recorded before the session starts");
  const started = h.store.events({ type: "unit_started" });
  assert.equal(started[0]?.entity_id, NEW_TASK);
  assert.deepEqual(
    { ...started[0]?.payload },
    {
      kind: "worker",
      picked_by: "role",
      model: MODEL_CATALOG.find((c) => c.tier === MODEL_POLICY.worker.tier)?.alias,
      effort: MODEL_POLICY.worker.effort,
      advisor: MODEL_CATALOG.find((c) => c.tier === MODEL_POLICY.worker.advisor)?.alias,
      route: "worktree_file",
      budget: MODEL_POLICY.worker.budget.calls,
      budget_per: "unit",
      used: 0,
      worktree: CHILD_TREE,
      shell: SHELL,
      setup: "none",
      run: RUN,
    },
  );
  // A row with no advisor records none, and picked_by comes from the caller.
  const review = resolveModel("review");
  assert.ok(review.ok);
  const r = harness();
  await start(r, request({ model: review.value, pickedBy: "kind" }));
  const p = r.store.events({ type: "unit_started" })[0]?.payload;
  assert.equal(p?.route, "none");
  assert.equal(p?.advisor, undefined);
  assert.equal(p?.picked_by, "kind");
});

test("decision 202: the new worktree's local settings carry the row's advisor before the session starts, never the user settings", async () => {
  let writtenAtStart = -1;
  const h = harness({
    workerStart: () => {
      writtenAtStart = h.written.length;
      return ok({ dispatchId: "ctx_new", worktreeId: CHILD_TREE });
    },
  });
  await start(h);
  assert.equal(writtenAtStart, 1, "the file exists before the session");
  assert.deepEqual(h.written, [{ path: CHILD_PATH, settings: { advisorModel: aliasOf(MODEL_POLICY.worker.advisor) } }]);
  const order = h.fake.calls.map((c) => c.slice(1, 3).join(" "));
  assert.ok(order.indexOf("worktree create") < order.indexOf("orchestration worker-start"));
  const ws = h.called("worker-start")[0] ?? [];
  assert.ok(!ws.includes("--advisor") && !ws.includes("--repo"), "Orca refuses creation flags on an existing worktree");
  assert.ok(ws.includes("--keep-open"), "a worker in an existing worktree would close at worker_done");
  // A row with no advisor turns off one the owner's own setting would add.
  const review = resolveModel("review");
  assert.ok(review.ok);
  const r = harness();
  await start(r, request({ model: review.value }));
  assert.deepEqual(r.written[0]?.settings, { disableAdvisor: true });
  // A file that cannot be written falls back to decision 187's owner-setting route.
  const remote = harness();
  const out = await startUnit(
    {
      ...ports(remote),
      writeSettings: () => {
        throw new Error("remote worktree");
      },
    },
    request(),
  );
  assert.ok(out.kind === "started" && out.launch.route === "owner_setting", JSON.stringify(out));
});

test("decision 202: a unit whose row budget is spent starts with the advisor off in its worktree file", async () => {
  const spendAll = (x: H) => {
    for (let i = 0; i < MODEL_POLICY.worker.budget.calls; i++) {
      x.store.append({
        type: "advisor_used",
        source: "Stop",
        entity: "task",
        entity_id: NEW_TASK,
        dedupe_key: dedupeKey(EVENTS.advisor_used, `m${i}`),
        payload: { session: "sess-0", msg: `m${i}`, model: "x", input_tokens: 1, output_tokens: 1 },
      });
    }
  };
  assert.ok(MODEL_POLICY.worker.budget.calls > 0);
  const s = harness();
  spendAll(s);
  const spent = await start(s, request({ task: { id: NEW_TASK } }));
  assert.ok(spent.kind === "started" && spent.notes.includes(ADVISOR_SPENT), JSON.stringify(spent));
  assert.deepEqual(s.written[0]?.settings, { disableAdvisor: true });
  // The worker row never runs its main tier without an advisor: it moves to its floor.
  assert.equal(flag(s.called("worker-start")[0] ?? [], "model"), aliasOf(MODEL_POLICY.worker.withoutAdvisor));
  const row = s.store.events({ type: "unit_started" })[0]?.payload;
  assert.equal(row?.used, MODEL_POLICY.worker.budget.calls);
  assert.equal(row?.route, "none");
  // ...without dropping an effort the lead already raised.
  const raised = resolveModel("worker", { effort: "high", reason: "first Act-on" });
  assert.ok(raised.ok);
  const sr = harness();
  spendAll(sr);
  await start(sr, request({ task: { id: NEW_TASK }, model: raised.value }));
  assert.equal(flag(sr.called("worker-start")[0] ?? [], "effort"), "high");
  // Without the file, an owner advisorModel still attaches: the start says so instead of claiming it off.
  const so = harness();
  spendAll(so);
  const owned = await startUnit(
    { ...ports(so), advisorSetting: () => true, writeSettings: () => { throw new Error("remote worktree"); } },
    request({ task: { id: NEW_TASK } }),
  );
  assert.ok(owned.kind === "started" && owned.notes.some((n) => n.includes("오너 설정의 advisorModel")), JSON.stringify(owned));
  assert.ok(!owned.notes.includes(ADVISOR_SPENT), "no claim that the advisor is off");
});

test("decision 202: the setup shell is recorded only when it is the worktree's one non-agent terminal, and kept with a setup script", async () => {
  const term = (rows: Record<string, string>[]) =>
    ok({ terminals: rows.map((r) => ({ executionHostId: "local", ...r })), hostScope: { hostIds: ["local"], omittedHostIds: [] }, truncated: false });
  const shellOf = async (replies: Record<string, FakeReply>, hookFile = false) => {
    const h = harness({ replies });
    const out = await startUnit({ ...ports(h), hookFile: () => hookFile }, request());
    assert.equal(out.kind, "started", JSON.stringify(out));
    const p = h.store.events({ type: "unit_started" })[0]?.payload;
    return { shell: p?.shell, setup: p?.setup, notes: out.kind === "started" ? out.notes : [] };
  };
  assert.equal((await shellOf({ "terminal-list": term([{ handle: SHELL, agentIdentity: "claude" }]) })).shell, undefined, "an agent's terminal is never the shell");
  assert.equal((await shellOf({ "terminal-list": term([{ handle: SHELL }, { handle: "term_other" }]) })).shell, undefined, "two terminals: which one is unknown");
  assert.equal((await shellOf({ "terminal-list": fail("runtime_unreachable") })).shell, undefined);
  const script = await shellOf({ "repo-show": ok({ repo: { hookSettings: { scripts: { setup: "npm ci" } } } }) });
  assert.deepEqual([script.shell, script.setup], [SHELL, "script"]);
  assert.ok(script.notes.some((n) => n.includes(SHELL)), "the kept shell is named for the owner");
  assert.equal((await shellOf({}, true)).setup, "script", "a repo orca.yaml counts as a setup script");
  assert.equal((await shellOf({ "repo-show": fail("repo_not_found") })).setup, "unknown");
});

test("decision 202: a definite failed start closes only the recorded shell and removes the worktree; anything else stays", async () => {
  const term = (rows: Record<string, string>[]) =>
    ok({ terminals: rows.map((r) => ({ executionHostId: "local", ...r })), hostScope: { hostIds: ["local"], omittedHostIds: [] }, truncated: false });
  const acts =(h: H) => h.fake.calls.map((c) => c.slice(1, 3).join(" ")).filter((c) => c === "terminal close" || c === "worktree rm");
  const clean = harness({ workerStart: () => fail("agent_failed") });
  const out = await start(clean);
  assert.equal(out.kind, "refused");
  assert.deepEqual(acts(clean), ["terminal close", "worktree rm"]);
  assert.equal(flag(clean.named("terminal close")[0] ?? [], "terminal"), SHELL);
  assert.ok(!(clean.named("terminal close")[0] ?? []).includes("--all"));
  // Another terminal (an agent that came up, the owner's own): nothing is closed or removed.
  let lists = 0;
  const busy = harness({
    workerStart: () => fail("agent_failed"),
    replies: { "terminal-list": () => (lists++ === 0 ? term([{ handle: SHELL }]) : term([{ handle: SHELL }, { handle: "term_agent", agentIdentity: "claude" }])) },
  });
  const left = await start(busy);
  assert.deepEqual(acts(busy), []);
  assert.ok(left.kind === "refused" && left.detail.includes(CHILD_TREE) && left.detail.includes("term_agent"), JSON.stringify(left));
  // A lost answer, a request Orca cannot account for, a non-zero exit with a result, or a reported
  // Dispatch may own a live agent: left and named.
  for (const workerStart of [
    () => ({ code: 1, stdout: "", stderr: "socket closed" }),
    () => ({ code: 1, stdout: "", stderr: "lost; retry with --retry-request req_lost" }),
    () => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code: "agent_failed", message: "x" }, requestId: "req_seen" }), stderr: "" }),
    () => ({ code: 2, stdout: JSON.stringify({ ok: true, result: {} }), stderr: "" }),
    () => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code: "start_failed", message: "x", data: { dispatchId: "ctx_dead" } } }), stderr: "" }),
  ]) {
    const d = harness({ workerStart, replies: { "orchestration-request-show": ok({ state: "absent" }) } });
    const failed = await start(d);
    assert.deepEqual(acts(d), []);
    assert.ok(failed.kind === "refused" && failed.detail.includes(CHILD_TREE), JSON.stringify(failed));
  }
  // A lost request Orca still holds, whose replay is refused without an id: the first one reached Orca.
  let sent = 0;
  const replayed = harness({
    workerStart: () =>
      sent++ === 0 ? { code: 1, stdout: "", stderr: "lost; retry with --retry-request req_held" } : fail("agent_failed"),
    replies: { "orchestration-request-show": ok({ state: "pending" }) },
  });
  const held = await start(replayed);
  assert.equal(sent, 2, "replayed once");
  assert.deepEqual(acts(replayed), []);
  assert.ok(held.kind === "refused" && held.detail.includes(CHILD_TREE) && held.detail.includes(SHELL), JSON.stringify(held));
  // A setup that may still be running is not cut short: the shell and the worktree stay, both named.
  for (const [replies, hookFile] of [
    [{ "repo-show": ok({ repo: { hookSettings: { scripts: { setup: "npm ci" } } } }) }, false],
    [{ "repo-show": fail("repo_not_found") }, false],
    [{}, true],
  ] as const) {
    const s = harness({ workerStart: () => fail("agent_failed"), replies });
    const failed = await startUnit({ ...ports(s), hookFile: () => hookFile }, request());
    assert.deepEqual(acts(s), []);
    assert.ok(failed.kind === "refused" && failed.detail.includes(CHILD_TREE) && failed.detail.includes(SHELL), JSON.stringify(failed));
  }
});

test("decision 202: a failed worktree create names the requested worktree, since a lost answer may still have made it", async () => {
  const h = harness({ replies: { "worktree-create": fail("runtime_unreachable") } });
  const out = await start(h);
  const name = flag(h.named("worktree create")[0] ?? [], "name");
  assert.ok(name && out.kind === "refused" && out.detail.includes(name), JSON.stringify(out));
  assert.equal(h.called("worker-start").length, 0);
});

test("decision 178: a Task Orca released at its predecessor's worker_done waits while that PR is open, starts once it merges", async () => {
  const rows = () =>
    ok({
      tasks: [
        { id: "task_pred", status: "completed", title: "p", deps: "[]" },
        { id: NEW_TASK, status: "ready", title: "t", deps: JSON.stringify(["task_pred"]), spec: "sangsoe-role: worker\nbrief" },
      ],
    });
  const h = harness({ taskList: rows });
  h.store.append({ type: "pr_opened", source: "test", payload: { pr: "acme/api#41", task: "task_pred" } });
  const held = await start(h, request({ task: { id: NEW_TASK } }));
  assert.equal(held.kind === "waiting" && held.why, "not_ready");
  assert.equal(h.called("worker-start").length, 0);
  assert.equal(h.signals().length, 0, "a wait is not a refusal");

  h.store.append({ type: "pr_merged", source: "test", payload: { pr: "acme/api#41", merge_sha: "a".repeat(40) } });
  assert.equal((await start(h, request({ task: { id: NEW_TASK } }))).kind, "started");
});

test("decision 178: start_unit holds only on a merge wait in its own Run; another Run's predecessor and a hold are queue-monitor's", async () => {
  const h = harness();
  const [pred, succ] = ["item:task_other_run", `item:${NEW_TASK}`];
  h.store.append({ type: "edge_added", source: "GRAPH", payload: { pred, succ, kind: "blocks" }, dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, "blocks") });
  h.store.append({ type: "item_extra_set", source: "test", payload: { task: NEW_TASK, hold: true } });
  assert.equal((await start(h, request({ task: { id: NEW_TASK } }))).kind, "started");
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

  const empty = await itemCreate({ ...base, role: "" }, ports);
  const emptyCli = await itemNew({ ...cli, role: "" }, ports);
  assert.deepEqual([empty.ok ? "" : empty.refusal.code, emptyCli.ok ? "" : emptyCli.refusal.code], ["invalid_input", "invalid_input"], "an empty role is refused by both");
  assert.equal(specs.length, 3, "no Task for an empty role");
});

test("ticket references attach to the new worktree; a failure does not stop the start", async () => {
  const h = harness({ replies: { "reference-add": fail("no_such_worktree") } });
  const out = await start(h, request({ references: ["https://tracker.example/acme-1"] }));
  assert.equal(out.kind, "started");
  assert.equal(out.kind === "started" && out.notes.filter((n) => n.startsWith("reference add")).length, 1);
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

// ---- decision 187: unit class → main model + advisor at launch ----

const aliasOf = (tier: string | undefined) => MODEL_CATALOG.find((c) => c.tier === tier)?.alias;
const contextDoc = JSON.parse(readFileSync(new URL("../fake-orca/scenarios/local/agent-context.json", import.meta.url), "utf8"));
/** The recorded command schema plus the `--advisor` an Orca with an advisor launch option would list. */
const withAdvisor = {
  "agent-context": () => {
    const doc = structuredClone(contextDoc);
    doc.commands.find((c: { command: string }) => c.command === "orchestration worker-start").flags.push("advisor");
    return { code: 0, stdout: JSON.stringify(doc), stderr: "" };
  },
};
const unitBase = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN, childRole: "worker", spec: "brief" };

test("decision 211: S5's call (orchestrator, class mechanical) starts a worker the fake's Orca launch check takes", async () => {
  const row = MODEL_POLICY[classKind("mechanical")];
  const h = harness();
  const r = await handle(
    { role: "orchestrator", worktreeId: PARENT_TREE, runId: RUN, childRole: "worker", class: "mechanical", spec: "read-only: list the open PRs" },
    ports(h),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const ws = h.called("worker-start")[0] ?? [];
  assert.equal(flag(ws, "model"), aliasOf(row.tier));
  assert.ok(!ws.includes("--effort"), "no effort for a model Orca takes none for (decision 209)");
  // What S5 saw: the 0.1.0 row (this tier at its API default effort) is the pair Orca refuses.
  const old = MODEL_CATALOG.find((c) => c.tier === row.tier);
  assert.ok(old);
  const refused = await h.orca.workerStart({ task: NEW_TASK, agent: "claude", worktree: { existing: CHILD_SELECTOR }, run: RUN, model: old.alias, effort: old.apiDefaultEffort });
  assert.equal(refused.ok === false && refused.error.code, "invalid_argument");
  assert.match(refused.ok ? "" : refused.error.message, new RegExp(`does not support effort ${old.apiDefaultEffort}`));
});

test("decision 187: each unit class launches its row's main model and, through Orca's option, its advisor", async () => {
  for (const cls of UNIT_CLASSES) {
    const row = MODEL_POLICY[classKind(cls)];
    const h = harness({ replies: withAdvisor });
    const r = await handle({ ...unitBase, class: cls }, { ...ports(h), advisorSetting: () => false });
    assert.equal(r.ok, true, cls);
    const ws = h.called("worker-start")[0] ?? [];
    assert.equal(flag(ws, "model"), aliasOf(row.tier), `${cls} model`);
    // Decision 209: a model whose Orca catalog row lists no effort gets no --effort.
    const takes = MODEL_CATALOG.find((c) => c.tier === row.tier)?.orcaEfforts.includes(row.effort);
    assert.equal(ws.includes("--effort") ? flag(ws, "effort") : undefined, takes ? row.effort : undefined, `${cls} effort`);
    assert.equal(ws.includes("--advisor") ? flag(ws, "advisor") : undefined, aliasOf(row.advisor), `${cls} advisor`);
  }
});

test("decision 187: without Orca's option the advisor flag is never sent; the owner's setting or the worker's floor decides", async () => {
  const worker = MODEL_POLICY.worker;
  // Decision 202's file cannot be written here, so decision 187's two paths decide.
  const noFile = () => {
    throw new Error("remote worktree");
  };
  const h = harness();
  const r = await handle(unitBase, { ...ports(h), advisorSetting: () => true, writeSettings: noFile });
  const ws = h.called("worker-start")[0] ?? [];
  assert.ok(!ws.includes("--advisor"));
  assert.equal(flag(ws, "model"), aliasOf(worker.tier));
  assert.ok(r.ok && (r.value as { notes: string[] }).notes.includes(ADVISOR_FROM_SETTING));
  assert.deepEqual(h.store.events({ type: "model_changed" }), []);

  const h2 = harness();
  const r2 = await handle(unitBase, { ...ports(h2), advisorSetting: () => false, writeSettings: noFile });
  const ws2 = h2.called("worker-start")[0] ?? [];
  assert.ok(!ws2.includes("--advisor"));
  assert.equal(flag(ws2, "model"), aliasOf(worker.withoutAdvisor), "a worker never runs its main tier without an advisor");
  assert.equal(flag(ws2, "effort"), MODEL_CATALOG.find((c) => c.tier === worker.withoutAdvisor)?.apiDefaultEffort);
  assert.ok(r2.ok && (r2.value as { notes: string[] }).notes.includes(ADVISOR_NOT_APPLIED));
  const changed = h2.store.events({ type: "model_changed" });
  assert.equal(changed.length, 1);
  assert.equal(changed[0]?.payload.reason, ADVISOR_NOT_APPLIED);
});

test("decision 187: a choice whose advisor ranks below its main tier is refused before any Task exists", async () => {
  const h = harness();
  const resolved = resolveModel("worker");
  assert.ok(resolved.ok);
  const bad = { ...resolved.value, advisor: aliasOf("fast") ?? "", advisorTier: "fast" as const };
  const out = await startUnit({ ...ports(h), advisorSetting: () => true }, request({ model: bad }));
  assertRefused(h, out, "model_invalid");
  assert.equal(h.called("task-create").length, 0);
});

test("decision 187: item_create records the class and start_unit starts the existing Task on it; bad classes are refused", async () => {
  const h = harness({ replies: withAdvisor });
  const made = await itemCreate({ runId: RUN, spec: "brief", who: "lead:x", doneWhen: "merged", class: "hard" }, { orca: h.orca, store: h.store });
  assert.ok(made.ok);
  const r = await handle({ ...unitBase, spec: undefined, task: NEW_TASK }, { ...ports(h), advisorSetting: () => false });
  assert.equal(r.ok, true);
  const ws = h.called("worker-start")[0] ?? [];
  assert.equal(flag(ws, "model"), aliasOf(MODEL_POLICY.hard.tier));
  assert.equal(flag(ws, "advisor"), aliasOf(MODEL_POLICY.hard.advisor));

  for (const input of [{ class: "huge" }, { class: "hard", role: "lead" }]) {
    const h2 = harness();
    const bad = await itemCreate({ runId: RUN, spec: "brief", who: "lead:x", doneWhen: "merged", ...input }, { orca: h2.orca, store: h2.store });
    assert.equal(bad.ok === false && bad.refusal.code, "invalid_input", JSON.stringify(input));
    const cli = await itemNew({ run: RUN, spec: "brief", who: "lead:x", "done-when": "merged", ...input }, { orca: h2.orca, store: h2.store });
    assert.equal(cli.ok === false && cli.refusal.code, "invalid_input", JSON.stringify(input));
    assert.equal(h2.called("task-create").length, 0);
  }
  for (const input of [{ class: "huge" }, { class: "hard", kind: "review" }, { class: "hard", childRole: "lead" }]) {
    const h3 = harness();
    const r3 = await handle({ ...unitBase, ...input }, ports(h3));
    assert.equal(r3.ok === false && r3.refusal.code, "invalid_input", JSON.stringify(input));
    assert.equal(h3.fake.calls.length, 0);
  }
});

test("decision 187: sangsoe item new --class records the class start_unit reads; an explicit class or kind beats it", async () => {
  const h = harness({ replies: withAdvisor });
  const made = await itemNew({ run: RUN, spec: "brief", who: "lead:x", "done-when": "merged", class: "hard" }, { orca: h.orca, store: h.store });
  assert.ok(made.ok);
  const stored = h.store.events({ type: "item_extra_set" }).map((e) => e.payload.unit_class);
  assert.deepEqual(stored, ["hard"]);
  const byId = { ...unitBase, spec: undefined, task: NEW_TASK };
  for (const [over, kind] of [
    [{}, "hard"],
    [{ class: "default" }, "worker"],
    [{ kind: "review" }, "review"],
  ] as const) {
    const h2 = harness({ replies: withAdvisor });
    h2.store.append({ type: "item_extra_set", source: "core:item", payload: { task: NEW_TASK, unit_class: "hard" }, entity: "task", entity_id: NEW_TASK });
    const r = await handle({ ...byId, ...over }, ports(h2));
    assert.equal(r.ok, true, JSON.stringify(over));
    const ws = h2.called("worker-start")[0] ?? [];
    assert.equal(flag(ws, "model"), aliasOf(MODEL_POLICY[kind].tier), JSON.stringify(over));
    assert.equal(ws.includes("--advisor") ? flag(ws, "advisor") : undefined, aliasOf(MODEL_POLICY[kind].advisor), JSON.stringify(over));
  }
});

test("decision 187: a class given with a new spec stays with the Task for a restart by id", async () => {
  const h = harness();
  const r = await handle({ ...unitBase, class: "hard" }, ports(h));
  assert.equal(r.ok, true);
  assert.deepEqual(
    h.store.events({ type: "item_extra_set" }).map((e) => [e.payload.task, e.payload.unit_class]),
    [[NEW_TASK, "hard"]],
  );
});

test("decision 187: a choice with an advisor but no advisor tier is refused, since its pairing cannot be checked", async () => {
  const h = harness();
  const resolved = resolveModel("worker");
  assert.ok(resolved.ok);
  const { advisorTier: _t, ...noTier } = resolved.value;
  const out = await startUnit(ports(h), request({ model: noTier }));
  assertRefused(h, out, "model_invalid");
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
  const lineage = async (replies: Record<string, FakeReply>, u: ExpectedUnit = unit) =>
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
  // decision 197: a new-top-level unit has no parent to expect; its Dispatch and Run still bind it.
  const { parentWorktreeId: _p, ...topLevel } = unit;
  const top = await lineage({
    ...recorded,
    "orchestration-worker-show": ok({ dispatchId: "ctx_000000000001", taskId: "task_000000000001", runId: RUN, state: "ready", workspace: PARENT_TREE }),
  }, topLevel);
  assert.deepEqual(top.units[0]?.problems, []);
  assert.match((await lineage(recorded, { ...topLevel, runId: "run_other" })).units[0]?.problems.join() ?? "", /Run 이 다르다/);
});

// ---- decision 197: placement, target repo, keep-open, alias, T5 once ----

const { worktreeId: _tree, ...plainFolder } = orchestrator;
const TARGET = "name:acme-web";

test("decision 197: an orchestrator in no worktree (cwd / or a plain folder) starts a top-level worktree in --repo, lineage on its Run", async () => {
  for (const cwd of ["/", "/srv/owner-notes"]) {
    const h = harness();
    const out = await startUnit(ports(h, () => 1, cwd), request({ requester: plainFolder, childRole: "lead", repo: TARGET }));
    assert.equal(out.kind, "started", JSON.stringify(out));
    // Decision 202: the worktree is made first, with no parent (new-top-level's lineage), in the target repo.
    const made = h.named("worktree create")[0] ?? [];
    assert.equal(flag(made, "repo"), TARGET);
    assert.ok(!made.includes("--parent-worktree"), "no parent worktree to keep");
    assert.ok(made.includes("--no-parent"), "Orca would infer a parent from a folder context");
    const ws = h.called("worker-start")[0] ?? [];
    assert.equal(flag(ws, "worktree"), CHILD_SELECTOR);
    assert.ok(!ws.includes("--repo"), "Orca refuses creation flags on an existing worktree");
    assert.equal(flag(ws, "run"), RUN);
    assert.equal(h.called("worker-list").length, 0, "no worktree to scan for a Dispatch");
  }
});

test("decision 197: without a worktree, only an orchestrator outside every worktree and with a repo may start", async () => {
  // No repo: Orca would have nowhere to put the worktree.
  const noRepo = harness();
  assertRefused(noRepo, await startUnit(ports(noRepo, () => 1, "/"), request({ requester: plainFolder, childRole: "lead" })), "lineage_invalid");
  // A lead or a worker always names its worktree.
  const { worktreeId: _w, ...leadNoTree } = lead;
  for (const role of ["lead", "worker"] as const) {
    const h = harness();
    const r = await startUnit(ports(h, () => 1, "/"), request({ requester: { ...leadNoTree, role }, repo: TARGET }));
    assertRefused(h, r, "lineage_invalid");
    assert.match(r.kind === "refused" ? r.detail : "", /worktree 없이 시작하는 것은 오케스트레이터뿐/);
  }
  // A partial worktree list could hide the caller's own worktree: refused, not read as "in none".
  const recorded = JSON.parse(readFileSync(new URL("../fake-orca/scenarios/local/worktree-list.json", import.meta.url), "utf8"));
  recorded.result.truncated = true;
  const partial = harness({ replies: { "worktree-list": () => ({ code: 0, stdout: JSON.stringify(recorded), stderr: "" }) } });
  const cut = await startUnit(ports(partial, () => 1, "/"), request({ requester: plainFolder, childRole: "lead", repo: TARGET }));
  assertRefused(partial, cut, "lineage_invalid");
  assert.match(cut.kind === "refused" ? cut.detail : "", /다 오지 않았다/);
  // A selector Orca would not read.
  const bad = harness();
  assertRefused(bad, await start(bad, request({ repo: "acme-web" })), "lineage_invalid");
});

test("S6 re-run NOW-B (decision 217): an orchestrator inside a worktree may leave worktreeId out; start_unit reads it from its folder", async () => {
  const h = harness();
  const out = await startUnit(ports(h, () => 1, CALLER_CWD), request({ requester: plainFolder, childRole: "lead" }));
  assert.equal(out.kind, "started", JSON.stringify(out));
  assert.equal(flag(h.named("worktree create")[0] ?? [], "parent-worktree"), `id:${PARENT_TREE}`, "the resolved worktree is the new one's parent");
  assert.equal(h.called("worker-list").length, 2, "the resolved worktree is scanned for a live Dispatch, as a declared one is");
  // A lead leaving its worktree out to pass as the orchestrator is still given away by its live Dispatch.
  const lead = harness({ liveDispatchInParent: true });
  const r = await startUnit(ports(lead, () => 1, CALLER_CWD), request({ requester: plainFolder, childRole: "lead" }));
  assertRefused(lead, r, "lineage_invalid");
  assert.match(r.kind === "refused" ? r.detail : "", /ctx_lead/);
});

test("decision 197: a target repo rides on the parent's child worktree, so the parent worktree is kept; an item's recorded repo is used by id", async () => {
  const h = harness();
  assert.equal((await start(h, request({ repo: TARGET }))).kind, "started");
  // Decision 202: new-child's lineage, made explicit: the requester's worktree is the new one's parent.
  const made = h.named("worktree create")[0] ?? [];
  assert.equal(flag(made, "parent-worktree"), `id:${PARENT_TREE}`);
  assert.ok(!made.includes("--no-parent"));
  assert.equal(flag(made, "repo"), TARGET);
  assert.equal(flag(h.called("worker-start")[0] ?? [], "worktree"), CHILD_SELECTOR);

  const byId = harness();
  byId.store.append({ type: "item_extra_set", source: "core:item", payload: { task: NEW_TASK, repo: "path:/home/dev/src/web" }, entity: "task", entity_id: NEW_TASK });
  assert.equal((await start(byId, request({ task: { id: NEW_TASK } }))).kind, "started");
  assert.equal(flag(byId.named("worktree create")[0] ?? [], "repo"), "path:/home/dev/src/web");
  const mine = harness();
  await start(mine, request());
  assert.ok(!(mine.named("worktree create")[0] ?? []).includes("--repo"), "no repo given or recorded: the requester's own");
});

test("decisions 197, 202: every start passes --keep-open, the lifetime Orca gives a new-child worker", async () => {
  const asLead = harness();
  await start(asLead, request({ requester: orchestrator, childRole: "lead" }));
  assert.ok((asLead.called("worker-start")[0] ?? []).includes("--keep-open"));
  const asWorker = harness();
  await start(asWorker, request());
  assert.ok((asWorker.called("worker-start")[0] ?? []).includes("--keep-open"));
});

test("decision 197: a Task start_unit creates gets an iNNN alias, so a decision can name it item:iNNN", async () => {
  const h = harness();
  const out = await start(h);
  assert.equal(out.kind === "started" && out.alias, "i001");
  const made = h.store.events({ type: "item_created" });
  assert.deepEqual(made.map((e) => [e.payload.task, e.payload.alias]), [[NEW_TASK, "i001"]]);
  assert.equal(made[0]?.payload.who, `lead:${RUN}`);
  const byId = harness();
  await start(byId, request({ task: { id: NEW_TASK } }));
  assert.equal(byId.store.events({ type: "item_created" }).length, 0, "an existing Task keeps the alias it has");
});

test("T5: two starts racing past the count on the third failure still write loop_detected once", async () => {
  const h = harness({ workerStart: () => fail("spawn_failed") });
  const req = request({ task: { id: NEW_TASK } });
  for (let i = 0; i < 2; i++) await start(h, req);
  const raced = await Promise.all([start(h, req), start(h, req)]);
  assert.deepEqual(raced.map((r) => r.kind), ["refused", "refused"]);
  assert.equal(h.store.events({ type: "loop_detected" }).length, 1);
});

test("decision 197: item_create and sangsoe item new record the target repo; a bad selector is refused before Orca", async () => {
  const h = harness();
  const made = await itemCreate({ runId: RUN, spec: "web change", who: "lead:web", doneWhen: "merged", repo: TARGET }, { orca: h.orca, store: h.store as never });
  assert.ok(made.ok, JSON.stringify(made));
  assert.deepEqual(h.store.events({ type: "item_extra_set" }).at(-1)?.payload, { task: NEW_TASK, repo: TARGET });
  const badMcp = await itemCreate({ runId: RUN, spec: "x", who: "w", doneWhen: "d", repo: "acme-web" }, { orca: h.orca, store: h.store as never });
  assert.equal(!badMcp.ok && badMcp.refusal.code, "invalid_input");

  const c = harness();
  const cli = await itemNew({ run: RUN, spec: "web change", who: "lead:web", "done-when": "merged", repo: TARGET }, { orca: c.orca, store: c.store as never });
  assert.ok(cli.ok, JSON.stringify(cli));
  assert.deepEqual(c.store.events({ type: "item_extra_set" }).at(-1)?.payload, { task: NEW_TASK, repo: TARGET });
  const badCli = await itemNew({ run: RUN, spec: "x", who: "w", "done-when": "d", repo: "acme-web" }, { orca: c.orca, store: c.store as never });
  assert.equal(!badCli.ok && badCli.refusal.code, "invalid_input");
  assert.equal(c.called("task-create").length, 1, "the bad selector never reached Orca");
});

test("decision 197: MCP start_unit takes repo and lets only an orchestrator leave worktreeId out", async () => {
  const h = harness();
  const noTree = await handle({ role: "lead", taskId: "task_lead", runId: RUN, childRole: "worker", spec: "x" }, ports(h));
  assert.equal(!noTree.ok && noTree.refusal.code, "invalid_input");
  const badRepo = await handle({ role: "orchestrator", runId: RUN, childRole: "lead", spec: "x", repo: "acme-web" }, ports(h));
  assert.equal(!badRepo.ok && badRepo.refusal.code, "invalid_input");
  assert.equal(h.called("worker-start").length, 0);
  const o = harness();
  const out = await handle({ role: "orchestrator", runId: RUN, childRole: "lead", spec: "x", repo: TARGET }, ports(o, () => 1, "/"));
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(flag(o.named("worktree create")[0] ?? [], "repo"), TARGET);
  assert.ok(!(o.named("worktree create")[0] ?? []).includes("--parent-worktree"), "top-level: no parent worktree");
  assert.equal(flag(o.called("worker-start")[0] ?? [], "worktree"), CHILD_SELECTOR);
});
