import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../../claude-plugin/mcp/tools/start_unit.ts";
import { createOrcaAdapter, type ExecResult, type Requester, type StartRequest, Store, startUnit } from "../../core/index.ts";
import { createFakeOrca } from "../fake-orca/index.ts";

// Decision 322: a lead or worker session re-opened with `claude --resume` in a new terminal is bound
// back to its own Task through start_unit, under the same lineage, depth and role checks as a start.

const PARENT_TREE = "repo-0001::/home/dev/src/api";
const CHILD_TREE = "repo-0001::/home/dev/workspaces/api/feature-a";
const OTHER_TREE = "repo-0001::/home/dev/workspaces/api/feature-b";
const ORCH = "term_00000000-0000-4000-8000-00000000000f";
const OLD_TERM = "term_00000000-0000-4000-8000-0000000000b1";
const NEW_TERM = "term_00000000-0000-4000-8000-0000000000b2";
const SESSION = "0a1b2c3d-0000-4000-8000-000000000001";
const RUN = "run_000000000001";
const ORCH_RUN = "run_00000000000f";
const TASK = "task_res";
const OLD = "ctx_old";
const NEW = "ctx_res";
const CALLER_CWD = "/home/dev/src/api/packages/web";

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const fail = (code: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code, message: code } }), stderr: "" });
const flag = (args: readonly string[], name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

type Setup = {
  /** The resumed Task's role line; worker by default. */
  role?: "worker" | "lead";
  /** The Run the resumed Task lives in; RUN by default. */
  taskRun?: string;
  /** The old worker as Orca shows it before any abandon. */
  oldState?: string;
  oldLiveness?: string;
  oldWorkspace?: string;
  /** The Task's status before the abandon; Orca leaves it dispatched until the Dispatch settles. */
  taskStatus?: string;
  /** Terminals Orca lists in the Task's worktree. */
  terminals?: string[];
  abandon?: () => ExecResult;
  workerStart?: () => ExecResult;
};

function harness(s: Setup = {}) {
  let abandoned = false;
  let status = s.taskStatus ?? "dispatched";
  let started = false;
  const fake = createFakeOrca({
    replies: {
      "orchestration-dispatch-show": (args: readonly string[]) => {
        const task = flag(args, "task");
        if (task === "task_lead") {
          return ok({ dispatch: { id: "ctx_lead", run_id: ORCH_RUN, task_id: task, status: "dispatched", depth: 1, failure_count: 0, creator_handle: ORCH } });
        }
        if (task === TASK) {
          const id = started ? NEW : OLD;
          return ok({ dispatch: { id, run_id: RUN, task_id: TASK, status: started ? "dispatched" : "failed", depth: 2, failure_count: 0 } });
        }
        return fail("dispatch_not_found");
      },
      "orchestration-worker-show": (args: readonly string[]) => {
        const id = flag(args, "dispatch");
        if (id === "ctx_lead") return ok({ dispatchId: "ctx_lead", taskId: "task_lead", runId: ORCH_RUN, state: "ready", workspace: PARENT_TREE });
        if (id === OLD) {
          return ok({
            dispatchId: OLD,
            taskId: TASK,
            runId: RUN,
            state: abandoned ? "abandoned" : (s.oldState ?? "ready"),
            liveness: s.oldLiveness ?? "unverifiable",
            terminal: OLD_TERM,
            workspace: s.oldWorkspace ?? CHILD_TREE,
          });
        }
        return fail("dispatch_not_found");
      },
      // A plain value would be printed as the document itself, so every reply here is a function.
      "orchestration-worker-list": () => ok({ workers: [], scope: { source: "all" } }),
      "orchestration-worker-abandon": () => {
        if (s.abandon) return s.abandon();
        abandoned = true;
        status = "failed";
        return ok({ dispatchId: OLD, state: "abandoned" });
      },
      "orchestration-task-update": (args: readonly string[]) => {
        status = flag(args, "status") ?? status;
        return ok({ task: { id: TASK, status } });
      },
      "orchestration-run-current": () => ok({ runId: RUN }),
      "orchestration-task-list": (args: readonly string[]) => {
        const run = flag(args, "run");
        if (run === ORCH_RUN && s.role !== "lead") {
          return ok({ tasks: [{ id: "task_lead", status: "dispatched", title: "lead", spec: "sangsoe-role: lead\nprogram brief" }] });
        }
        if (run !== (s.taskRun ?? RUN)) return ok({ tasks: [] });
        return ok({ tasks: [{ id: TASK, status, title: "t", spec: `sangsoe-role: ${s.role ?? "worker"}\nbrief` }] });
      },
      "orchestration-worker-start": () => {
        if (s.workerStart) return s.workerStart();
        started = true;
        return ok({ dispatchId: NEW });
      },
      "terminal-list": (args: readonly string[]) =>
        ok({
          terminals: (flag(args, "worktree") === `id:${CHILD_TREE}` ? (s.terminals ?? [OLD_TERM, NEW_TERM]) : []).map((handle) => ({ handle, worktreeId: CHILD_TREE, executionHostId: "local" })),
          hostScope: { hostIds: ["local"], omittedHostIds: [] },
          truncated: false,
        }),
    },
  });
  const store = Store.open({ path: ":memory:" });
  const orca = createOrcaAdapter(fake.exec);
  const called = (sub: string) => fake.calls.filter((c) => c.slice(1, 3).join(" ") === `orchestration ${sub}`);
  const named = (cmd: string) => fake.calls.filter((c) => c.slice(1, 3).join(" ") === cmd);
  const index = (sub: string) => fake.calls.findIndex((c) => c.slice(1, 3).join(" ") === `orchestration ${sub}`);
  return { fake, store, orca, called, named, index };
}
type H = ReturnType<typeof harness>;

/** What start_unit and SessionStart wrote when the unit first started and its session opened. */
function seed(h: H, o: { worktree?: string; sessionTask?: string; session?: string } = {}) {
  h.store.append({
    type: "unit_started",
    source: "test",
    entity: "task",
    entity_id: TASK,
    payload: { kind: "worker", picked_by: "role", model: "m-main", effort: "medium", route: "worktree_file", budget: 3, budget_per: "unit", used: 0, worktree: o.worktree ?? CHILD_TREE, run: RUN },
  });
  h.store.append({
    type: "session_started",
    source: "test",
    entity: "task",
    entity_id: o.sessionTask ?? TASK,
    payload: { session: o.session ?? SESSION, role: "worker", model: "m-main" },
  });
}

const lead: Requester = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN };
const orchestrator: Requester = { role: "orchestrator", worktreeId: PARENT_TREE, runId: RUN };
const resume = { worktreeId: CHILD_TREE, sessionId: SESSION, terminal: NEW_TERM };
const request = (over: Partial<StartRequest> = {}): StartRequest => ({
  requester: lead,
  childRole: "worker",
  task: { id: TASK },
  agent: "claude",
  resume,
  ...over,
});
const ports = (h: H) => ({
  orca: h.orca,
  store: h.store,
  slots: () => 0,
  cwd: () => CALLER_CWD,
  advisorSetting: () => true,
  writeSettings: () => {},
  parentRead: () => {},
  dropParentRead: () => {},
  hookFile: () => false,
});

function refusedBeforeAbandon(h: H, out: Awaited<ReturnType<typeof startUnit>>, reason: string, why: RegExp) {
  assert.equal(out.kind, "refused", JSON.stringify(out));
  assert.equal(out.kind === "refused" && out.reason, reason);
  assert.match(out.kind === "refused" ? out.detail : "", why);
  assert.equal(h.called("worker-abandon").length, 0, "the old Dispatch is left as it was");
  assert.equal(h.called("task-update").length, 0);
  assert.equal(h.called("worker-start").length, 0, "no session bound");
  assert.equal(h.store.events({ type: "unit_resumed" }).length, 0);
}

test("decision 322 (1): a worker re-opened in a new terminal is bound back to its Task; the old Dispatch is abandoned", async () => {
  const h = harness();
  seed(h);
  // A full machine does not hold a resume back: one session replaces one.
  const out = await startUnit(ports(h), request());
  assert.equal(out.kind, "resumed", JSON.stringify(out));
  assert.deepEqual(out.kind === "resumed" && { task: out.taskId, dispatch: out.dispatchId, from: out.from, terminal: out.terminal }, { task: TASK, dispatch: NEW, from: OLD, terminal: NEW_TERM });

  assert.equal(flag(h.called("worker-abandon")[0] ?? [], "dispatch"), OLD);
  const update = h.called("task-update")[0] ?? [];
  assert.deepEqual([flag(update, "id"), flag(update, "status"), flag(update, "run")], [TASK, "ready", RUN]);
  const ws = h.called("worker-start")[0] ?? [];
  assert.deepEqual(
    ["task", "terminal", "worktree", "run"].map((f) => flag(ws, f)),
    [TASK, NEW_TERM, `id:${CHILD_TREE}`, RUN],
  );
  for (const f of ["agent", "model", "effort", "keep-open"]) assert.ok(!ws.includes(`--${f}`), `--${f} does not go with --terminal`);
  assert.ok(h.index("worker-abandon") < h.index("task-update") && h.index("task-update") < h.index("worker-start"), "abandon, reopen, then bind");
  assert.equal(h.named("worktree create").length, 0, "no new worktree");
  assert.equal(h.named("terminal create").length, 0, "the caller opened the terminal");

  const rows = h.store.events({ type: "unit_resumed" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.entity_id, TASK);
  assert.deepEqual(rows[0]?.payload, { dispatch: NEW, from: OLD, session: SESSION, terminal: NEW_TERM, worktree: CHILD_TREE, run: RUN });
  assert.equal(h.store.events({ type: "unit_started" }).length, 1, "a resume is not a new start");
  assert.equal(h.store.events({ type: "signal" }).length, 0);
});

test("decision 322 (1): a second call after an abandon that went through does not abandon again; a ready Task is not reopened", async () => {
  const h = harness({ oldState: "abandoned", taskStatus: "ready" });
  seed(h);
  const out = await startUnit(ports(h), request());
  assert.equal(out.kind, "resumed", JSON.stringify(out));
  assert.equal(h.called("worker-abandon").length, 0);
  assert.equal(h.called("task-update").length, 0);
  assert.equal(h.called("worker-start").length, 1);
});

test("decision 322 (2): another Task's worktree or session, an unknown session, or a terminal outside the worktree is refused before anything changes", async () => {
  const cases: [string, Setup, Parameters<typeof seed>[1], Partial<StartRequest>, RegExp][] = [
    ["worktree of another Task", {}, {}, { resume: { ...resume, worktreeId: OTHER_TREE } }, /worktree/],
    ["Task's worktree per Orca differs", { oldWorkspace: OTHER_TREE }, {}, {}, /worktree/],
    ["session of another Task", {}, { sessionTask: "task_other" }, {}, /세션/],
    ["session never seen", {}, { session: "0a1b2c3d-0000-4000-8000-000000000009" }, {}, /세션/],
    ["terminal not in the worktree", { terminals: [OLD_TERM] }, {}, {}, /터미널/],
    ["old session still live", { oldLiveness: "live" }, {}, {}, /살아/],
    ["Task not in the requester's Run", { taskRun: "run_000000000077" }, {}, {}, /Run/],
    ["a session id that is not an id", {}, {}, { resume: { ...resume, sessionId: "x; rm -rf ~" } }, /세션/],
  ];
  for (const [name, setup, seeded, over, why] of cases) {
    const h = harness(setup);
    seed(h, seeded);
    const out = await startUnit(ports(h), request(over));
    assert.equal(out.kind === "refused" && out.reason, "lineage_invalid", `${name}: ${JSON.stringify(out)}`);
    refusedBeforeAbandon(h, out, "lineage_invalid", why);
  }
});

test("decision 322 (2): lineage, depth and role are checked as on a first start", async () => {
  const worker = harness();
  seed(worker);
  refusedBeforeAbandon(worker, await startUnit(ports(worker), request({ requester: { ...lead, role: "worker" } })), "lineage_invalid", /워커/);

  const deep = harness();
  seed(deep);
  refusedBeforeAbandon(deep, await startUnit(ports(deep), request({ maxDepth: 1 })), "depth_exceeded", /깊이/);

  // The Task's role line names a worker: it is not resumed as a lead.
  const role = harness();
  seed(role);
  refusedBeforeAbandon(role, await startUnit(ports(role), request({ requester: orchestrator, childRole: "lead" })), "lineage_invalid", /spec 첫 줄/);

  // A resume names an existing Task.
  const spec = harness();
  seed(spec);
  refusedBeforeAbandon(spec, await startUnit(ports(spec), request({ task: { spec: "x" } })), "lineage_invalid", /Task/);
});

test("decision 322 (2): a failed bind after the abandon says the Task is left ready for a plain start", async () => {
  const h = harness({ workerStart: () => fail("terminal_not_agent") });
  seed(h);
  const out = await startUnit(ports(h), request());
  assert.equal(out.kind === "refused" && out.reason, "orca_error", JSON.stringify(out));
  assert.match(out.kind === "refused" ? out.detail : "", /abandon/);
  assert.match(out.kind === "refused" ? out.detail : "", new RegExp(NEW_TERM));
  assert.equal(h.called("worker-abandon").length, 1);
  assert.equal(h.store.events({ type: "unit_resumed" }).length, 0);

  const stuck = harness({ abandon: () => fail("stop_in_flight") });
  seed(stuck);
  const refused = await startUnit(ports(stuck), request());
  assert.equal(refused.kind === "refused" && refused.reason, "orca_error", JSON.stringify(refused));
  assert.equal(stuck.called("worker-start").length, 0);
});

test("decision 322 (3): the orchestrator resumes a lead that holds a Task the same way", async () => {
  const h = harness({ role: "lead" });
  seed(h);
  const out = await startUnit(ports(h), request({ requester: orchestrator, childRole: "lead" }));
  assert.equal(out.kind, "resumed", JSON.stringify(out));
  assert.equal(out.kind === "resumed" && out.from, OLD);
  assert.equal(flag(h.called("worker-abandon")[0] ?? [], "dispatch"), OLD);
  assert.equal(flag(h.called("worker-start")[0] ?? [], "terminal"), NEW_TERM);
  assert.equal(h.store.events({ type: "unit_resumed" }).length, 1);
});

test("decision 322: MCP start_unit passes resume through and refuses it without a task", async () => {
  const h = harness();
  seed(h);
  const input = { role: "lead", worktreeId: PARENT_TREE, taskId: "task_lead", runId: RUN, childRole: "worker", task: TASK, resume };
  const out = await handle(input, ports(h));
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.ok && (out.value as { kind: string }).kind, "resumed");

  const bad = harness();
  const { task: _t, ...noTask } = input;
  const refused = await handle({ ...noTask, spec: "x" }, ports(bad));
  assert.equal(!refused.ok && refused.refusal.code, "invalid_input");
  const partial = await handle({ ...input, resume: { worktreeId: CHILD_TREE } }, ports(bad));
  assert.equal(!partial.ok && partial.refusal.code, "invalid_input");
  assert.equal(bad.fake.calls.length, 0, "refused before Orca");
});
