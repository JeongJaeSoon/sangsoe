import assert from "node:assert/strict";
import { test } from "node:test";
import { restart } from "../../cli/commands/restart.ts";
import {
  createOrcaAdapter,
  type ExecResult,
  type Host,
  type RestartPorts,
  type RunResult,
  readLaunch,
  restartSessions,
  type StartRequest,
  Store,
} from "../../core/index.ts";
import { createFakeOrca } from "../fake-orca/index.ts";

// Decision 330: after an upgrade the caller restarts its own idle children whose MCP server runs stale
// code: worker-stop, a new terminal running `claude --resume <session>` with the old flags, then
// start_unit's resume (decision 322). Fixture names only.

const NOW = Date.parse("2026-11-17T12:00:00Z");
const ENTRY = "/opt/sangsoe/libexec/claude-plugin/../dist/claude-plugin/mcp/server.js";
const CLAUDE = "/home/u/.local/bin/claude";
const PLUGIN_DIR = "/home/u/Application Support/orca/agent-view";
const STALE = "02:00:00";
const FRESH = "10:00";

const ORCH_RUN = "run_00000000000f";
const LEAD_RUN = "run_000000000001";
const PARENT_TREE = "repo-0001::/home/dev/src/api";
const LEAD_TREE = "repo-0001::/home/dev/workspaces/api/lead-a";
const BUSY_TREE = "repo-0001::/home/dev/workspaces/api/lead-b";
const WORKER_TREE = "repo-0001::/home/dev/workspaces/api/worker-a";
const pathOf = (tree: string) => tree.split("::")[1] as string;
const NEW_TERM = "term_00000000-0000-4000-8000-0000000000n1";
const SELF_TERM = "term_00000000-0000-4000-8000-0000000000n2";
const LEAD_SESSION = "0a1b2c3d-0000-4000-8000-000000000001";
const ORCH_SESSION = "0a1b2c3d-0000-4000-8000-00000000000f";

type Unit = { task: string; dispatch: string; run: string; tree: string; role: "lead" | "worker"; terminal: string; pane: string; state: string };
const UNITS: Unit[] = [
  { task: "task_lead", dispatch: "ctx_lead", run: ORCH_RUN, tree: LEAD_TREE, role: "lead", terminal: "term_lead", pane: "tabL:leafL", state: "done" },
  { task: "task_busy", dispatch: "ctx_busy", run: ORCH_RUN, tree: BUSY_TREE, role: "lead", terminal: "term_busy", pane: "tabB:leafB", state: "working" },
  { task: "task_w", dispatch: "ctx_w", run: LEAD_RUN, tree: WORKER_TREE, role: "worker", terminal: "term_w", pane: "tabW:leafW", state: "done" },
];

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const fail = (code: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code, message: code } }), stderr: "" });
const flag = (args: readonly string[], name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);

type Setup = {
  /** The CLI process's folder; the orchestrator's worktree by default. */
  cwd?: string;
  /** Server age per pid; every server is stale unless named here. */
  age?: Record<number, string>;
  stop?: () => ExecResult;
  /** How long each `terminal list` takes on the clock; claude never shows in the new terminal when set. */
  listMs?: number;
  /**
   * The lead's old Dispatch failed and Orca already re-opened its session in another terminal of the
   * same worktree, as an Orca restore does: `--plugin-dir … --effort … --resume <id>`, no --agent.
   */
  restored?: boolean;
};

const RESTORED_TERM = "term_00000000-0000-4000-8000-0000000000r1";
/** As many Runs as the measuring machine held: a walk over them is what stalled the first measurement. */
const RUNS = Array.from({ length: 85 }, (_, i) => ({ id: `run_${String(i + 100).padStart(12, "0")}` }));

// The orchestrator (100) runs this command through its shell (150 → 151). 200 is the idle lead, 300 a lead
// mid-turn, 400 a worker in the lead's Run, 500 a session the owner opened by hand, 600 a fresh session.
function harness(s: Setup = {}) {
  const age = (pid: number) => s.age?.[pid] ?? STALE;
  const lead = s.restored
    ? `  200     1 00:10:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --effort medium --resume ${LEAD_SESSION}`
    : `  200     1 1-00:00:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --resume 0a1b2c3d-0000-4000-8000-0000000000aa --model m-main --effort medium --verbose`;
  const ps = [
    `  100     1 3-00:00:00 ${CLAUDE} --continue --agent sangsoe:orchestrator`,
    `  101   100 ${age(101)} node ${ENTRY}`,
    `  150   100     00:05 /bin/zsh -c sangsoe restart --stale`,
    `  151   150     00:05 node /opt/sangsoe/libexec/dist/cli/main.js restart --stale`,
    lead,
    // A session Orca restored into a profile without sangsoe has no sangsoe MCP server.
    ...(s.restored ? [] : [`  201   200 ${age(201)} node ${ENTRY}`]),
    `  300     1 1-00:00:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --model m-main`,
    `  301   300 ${age(301)} node ${ENTRY}`,
    `  400     1 1-00:00:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --model m-small`,
    `  401   400 ${age(401)} node ${ENTRY}`,
    `  500     1 1-00:00:00 ${CLAUDE} --model m-small`,
    `  501   500 ${age(501)} node ${ENTRY}`,
  ].join("\n");
  const cwd: Record<number, string> = {
    100: pathOf(PARENT_TREE),
    101: pathOf(PARENT_TREE),
    200: pathOf(LEAD_TREE),
    201: pathOf(LEAD_TREE),
    300: pathOf(BUSY_TREE),
    301: pathOf(BUSY_TREE),
    400: pathOf(WORKER_TREE),
    401: pathOf(WORKER_TREE),
    500: "/home/dev/scratch",
    501: "/home/dev/scratch",
  };
  let clock = NOW;
  const settled = (u: Unit) => s.restored === true && u.task === "task_lead";
  const hostCalls: string[] = [];
  const host: Host = {
    env: { HOME: "/home/u" },
    nodeVersion: "24.15.0",
    exists: () => false,
    readText: () => "",
    run(cmd, args): RunResult {
      hostCalls.push([cmd, ...args].join(" "));
      if (cmd === "ps") return { code: 0, stdout: ps, stderr: "" };
      if (cmd === "lsof") {
        const pids = (args.at(-1) ?? "").split(",").map(Number);
        return { code: 0, stdout: pids.filter((p) => cwd[p]).map((p) => `p${p}\nfcwd\nn${cwd[p]}\n`).join(""), stderr: "" };
      }
      return { code: 127, stdout: "", stderr: "unexpected" };
    },
  };
  let created = 0;
  const fake = createFakeOrca({
    replies: {
      "orchestration-run-current": () => ok({ runId: ORCH_RUN }),
      "worktree-list": () =>
        ok({ worktrees: [PARENT_TREE, LEAD_TREE, BUSY_TREE, WORKER_TREE].map((id) => ({ id, path: pathOf(id), repoId: "repo-0001", hostId: "local", branch: "b", displayName: "d", isMainWorktree: false, isArchived: false, parentWorktreeId: null, childWorktreeIds: [], lastActivityAt: 0 })) }),
      // As Orca answers: without --run only the bound Run (the caller's), so a miss there says nothing of the others.
      "orchestration-worker-list": (args: readonly string[]) => {
        const run = flag(args, "run");
        const rows = UNITS.filter((u) => u.run === (run ?? ORCH_RUN)).map((u) => ({
          dispatchId: u.dispatch,
          taskId: u.task,
          state: settled(u) ? "failed" : "ready",
          liveness: settled(u) ? "exited" : "live",
          terminal: u.terminal,
          workspace: u.tree,
          host: "local",
        }));
        return ok({ workers: rows, scope: { source: run ? "run" : "bound" } });
      },
      "orchestration-run-list": () => ok({ runs: [{ id: ORCH_RUN }, { id: LEAD_RUN }, ...RUNS] }),
      "orchestration-dispatch-show": (args: readonly string[]) => {
        const u = UNITS.find((x) => x.task === flag(args, "task"));
        return u ? ok({ dispatch: { id: u.dispatch, taskId: u.task, status: settled(u) ? "failed" : "dispatched" } }) : fail("dispatch_not_found");
      },
      "orchestration-worker-show": (args: readonly string[]) => {
        const u = UNITS.find((x) => x.dispatch === flag(args, "dispatch"));
        if (!u) return fail("dispatch_not_found");
        const state = settled(u) ? { state: "failed", liveness: "exited" } : { state: "ready", liveness: "live" };
        return ok({ dispatchId: u.dispatch, taskId: u.task, runId: u.run, ...state, terminal: u.terminal, workspace: u.tree });
      },
      "orchestration-task-list": (args: readonly string[]) =>
        ok({ tasks: UNITS.filter((u) => u.run === flag(args, "run")).map((u) => ({ id: u.task, status: "dispatched", title: u.task, spec: `sangsoe-role: ${u.role}\nbrief` })) }),
      "worktree-ps": () =>
        ok({
          worktrees: UNITS.map((u) => ({ worktreeId: u.tree, hostId: "local", repo: "api", path: pathOf(u.tree), branch: "b", isMainWorktree: false, isArchived: false, liveTerminalCount: 1, unverifiableTerminalCount: 0, status: "active", agents: [{ paneKey: u.pane, state: u.state, agentType: "claude", agentWait: null }] })),
          truncated: false,
        }),
      "terminal-list": (args: readonly string[]) => {
        clock += s.listMs ?? 0;
        const tree = (flag(args, "worktree") ?? "").replace(/^id:/, "");
        const own = UNITS.filter((u) => u.tree === tree && !settled(u)).map((u) => {
          const [tabId, leafId] = u.pane.split(":");
          return { handle: u.terminal, tabId, leafId, agentIdentity: "claude", executionHostId: "local" };
        });
        const restored = s.restored && tree === LEAD_TREE ? [{ handle: RESTORED_TERM, tabId: "tabL", leafId: "leafL", agentIdentity: "claude", executionHostId: "local" }] : [];
        // The new terminal shows claude from the second read on, unless claude never comes up.
        const fresh = created > 0 ? [{ handle: NEW_TERM, executionHostId: "local", ...(created++ > 1 && s.listMs === undefined ? { agentIdentity: "claude" } : {}) }] : [];
        return ok({ terminals: [...own, ...restored, ...(tree === LEAD_TREE ? fresh : [])], hostScope: { hostIds: ["local"], omittedHostIds: [] }, truncated: false });
      },
      "orchestration-worker-stop": () => (s.stop ? s.stop() : ok({ dispatchId: "ctx_lead", processAction: "closed_agent_terminal" })),
      "terminal-create": (args: readonly string[]) => {
        if (flag(args, "worktree") === `id:${LEAD_TREE}`) created = 1;
        return ok({ terminal: { handle: flag(args, "worktree") === `id:${PARENT_TREE}` ? SELF_TERM : NEW_TERM } });
      },
      "orchestration-send": () => ok({ messageId: "msg_1" }),
    },
  });
  const store = Store.open({ path: ":memory:" });
  store.append({ type: "session_started", source: "test", entity: "task", entity_id: "task_lead", payload: { session: LEAD_SESSION, role: "lead", model: "m" } });
  store.append({ type: "session_started", source: "test", entity: "task", entity_id: "task_w", payload: { session: "0a1b2c3d-0000-4000-8000-000000000003", role: "worker", model: "m" } });
  store.append({ type: "session_started", source: "test", target: `run:${ORCH_RUN}`, payload: { session: ORCH_SESSION, role: "orchestrator", model: "m" } });
  const binds: StartRequest[] = [];
  const sleeps: number[] = [];
  const emitted: string[] = [];
  const ports: RestartPorts = {
    orca: createOrcaAdapter(fake.exec),
    store,
    host,
    self: { pid: 151, cwd: s.cwd ?? pathOf(PARENT_TREE), terminal: "term_orch" },
    installed: () => ({ version: "0.1.13", at: NOW - 3_600_000 }),
    now: () => clock,
    exists: (p) => p === PLUGIN_DIR,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    emit: (line) => emitted.push(line),
    bind: async (req) => {
      binds.push(req);
      return { kind: "resumed", taskId: "task_lead", dispatchId: "ctx_new", from: "ctx_lead", worktreeId: LEAD_TREE, terminal: NEW_TERM, notes: [] };
    },
  };
  const named = (cmd: string) => fake.calls.filter((c) => c.slice(1, 1 + cmd.split(" ").length).join(" ") === cmd);
  const at = (cmd: string) => fake.calls.findIndex((c) => c.slice(1, 1 + cmd.split(" ").length).join(" ") === cmd);
  return { ports, fake, named, at, binds, sleeps, hostCalls, store, emitted };
}

const leadCommand =
  `while kill -0 200 2>/dev/null; do sleep 1; done; '${CLAUDE}' '--resume' '${LEAD_SESSION}' '--plugin-dir' '${PLUGIN_DIR}' '--model' 'm-main' '--effort' 'medium'`;
const WRITES = ["orchestration worker-stop", "terminal create", "orchestration send", "orchestration worker-start", "orchestration worker-abandon"];

test("decision 330 (1): the dry run lists each stale session with its role, Task, session and flags, and why it is or is not restarted", async () => {
  const h = harness({ age: { 601: FRESH } });
  const out = await restartSessions(h.ports, { dryRun: true });
  assert.equal(out.code, 0, out.lines.join("\n"));
  const text = out.lines.join("\n");
  assert.match(out.lines[0] ?? "", /낡은 세션 5개 \(부른 쪽 orchestrator, Run run_00000000000f\) — dry-run/);
  assert.match(text, /pid 200 {2}lead task_lead ctx_lead .* session 0a1b2c3d-0000-4000-8000-000000000001 {2}state done {2}flags --plugin-dir \/home\/u\/Application Support\/orca\/agent-view --model m-main --effort medium {2}dropped --verbose\n {4}→ restart: 쉬고 있다/);
  assert.ok(out.lines.includes(`    command: ${leadCommand}`), text);
  assert.match(text, /pid 300 {2}lead task_busy ctx_busy .*state working.*\n {4}→ skip: 턴 중이다\(agent working\)/);
  assert.match(text, /pid 400 {2}worker task_w ctx_w .*\n {4}→ skip: Run run_000000000001 의 Task 다/);
  assert.match(text, /pid 500 .*\n {4}→ skip: sangsoe 역할이 없는 세션이다/);
  assert.match(text, /pid 100 {2}orchestrator - - .*session 0a1b2c3d-0000-4000-8000-00000000000f.*flags --agent sangsoe:orchestrator\n {4}→ self:/);
  assert.ok(out.lines.includes(`    command: while kill -0 100 2>/dev/null; do sleep 1; done; '${CLAUDE}' '--resume' '${ORCH_SESSION}' '--agent' 'sangsoe:orchestrator'`), text);
  for (const w of WRITES) assert.equal(h.named(w).length, 0, `dry run calls no ${w}`);
  assert.equal(h.binds.length, 0);
  assert.deepEqual(h.hostCalls, ["ps -ww -axo pid=,ppid=,etime=,args=", "lsof -a -d cwd -Fpn -p 101,201,301,401,501"]);
});

test("decision 330 (2): an idle child is stopped, resumed in a new terminal of its worktree once claude shows there, and bound back to its Task", async () => {
  const h = harness();
  const out = await restartSessions(h.ports, { dryRun: false });
  assert.equal(out.code, 0, out.lines.join("\n"));
  const stops = h.named("orchestration worker-stop");
  assert.deepEqual(stops.map((c) => flag(c, "dispatch")), ["ctx_lead"], "only the idle child in the caller's Run");
  const creates = h.named("terminal create");
  assert.deepEqual(creates.map((c) => [flag(c, "worktree"), flag(c, "command")]), [
    [`id:${LEAD_TREE}`, leadCommand],
    [`id:${PARENT_TREE}`, `while kill -0 100 2>/dev/null; do sleep 1; done; '${CLAUDE}' '--resume' '${ORCH_SESSION}' '--agent' 'sangsoe:orchestrator'`],
  ]);
  assert.ok(h.at("orchestration worker-stop") < h.at("terminal create"), "the old session stops before the new terminal opens");
  assert.ok(h.sleeps.length >= 1, "the bind waits until claude shows in the new terminal");
  assert.equal(h.binds.length, 1);
  assert.deepEqual(h.binds[0], {
    requester: { role: "orchestrator", runId: ORCH_RUN },
    childRole: "lead",
    task: { id: "task_lead" },
    agent: "claude",
    resume: { worktreeId: LEAD_TREE, sessionId: LEAD_SESSION, terminal: NEW_TERM },
  });
  const sent = h.named("orchestration send");
  assert.equal(sent.length, 1);
  assert.deepEqual([flag(sent[0] ?? [], "to"), flag(sent[0] ?? [], "type")], [NEW_TERM, "status"]);
  assert.match(flag(sent[0] ?? [], "body") ?? "", /sangsoe restart --stale/);
  const text = out.lines.join("\n");
  assert.match(text, /✓ task_lead: Dispatch ctx_lead → ctx_new, 터미널 term_00000000-0000-4000-8000-0000000000n1/);
  assert.match(text, /✓ 이 세션: 새 터미널 term_00000000-0000-4000-8000-0000000000n2 이 pid 100 가 끝나기를 기다린다\n {4}오너: Orca 에서 이 세션의 터미널 term_orch 을 닫으면/);
});

test("decision 330 (2): a worker-stop Orca refuses opens no terminal and binds nothing", async () => {
  const h = harness({ stop: () => fail("stop_unknown") });
  const out = await restartSessions(h.ports, { dryRun: false });
  assert.equal(out.code, 1);
  assert.match(out.lines.join("\n"), /✗ task_lead: worker-stop ctx_lead 실패\(stop_unknown\)/);
  assert.equal(h.named("terminal create").filter((c) => flag(c, "worktree") === `id:${LEAD_TREE}`).length, 0);
  assert.equal(h.binds.length, 0);
});

test("decision 330 (2): --task restarts the one child holding that Task even when its server is current", async () => {
  const h = harness({ age: { 101: FRESH, 201: FRESH, 301: FRESH, 401: FRESH, 501: FRESH } });
  const none = await restartSessions(h.ports, { dryRun: true });
  assert.deepEqual(none.lines.slice(1), ["  없다"]);
  const out = await restartSessions(harness({ age: { 101: FRESH, 201: FRESH, 301: FRESH, 401: FRESH, 501: FRESH } }).ports, { task: "task_lead", dryRun: true });
  assert.equal(out.lines.filter((l) => l.startsWith("  pid ")).length, 1, out.lines.join("\n"));
  assert.match(out.lines.join("\n"), /pid 200 {2}lead task_lead[\s\S]*→ restart/);
  const missing = await restartSessions(harness().ports, { task: "task_none", dryRun: true });
  assert.equal(missing.code, 1);
});

test("decision 330 (1): a worker does not restart sessions", async () => {
  const h = harness({ cwd: pathOf(WORKER_TREE) });
  const out = await restartSessions(h.ports, { dryRun: false });
  assert.equal(out.code, 1);
  assert.match(out.lines[0] ?? "", /워커는 세션을 다시 띄우지 않는다/);
  for (const w of WRITES) assert.equal(h.named(w).length, 0);
});

test("decision 330: flags are read back from ps text whose paths hold spaces; session flags go, unknown ones are listed", () => {
  const twice = `${CLAUDE} --plugin-dir ${PLUGIN_DIR} --resume 0a1b --plugin-dir /home/u/other dir/view --model=m-main --continue --verbose`;
  const exists = (p: string) => p === PLUGIN_DIR || p === "/home/u/other dir/view";
  assert.deepEqual(readLaunch(twice, exists), {
    bin: CLAUDE,
    flags: ["--plugin-dir", PLUGIN_DIR, "--plugin-dir", "/home/u/other dir/view", "--model", "m-main"],
    dropped: ["--verbose"],
  });
  assert.match(readLaunch(`${CLAUDE} --plugin-dir /gone/dir`, exists).problem ?? "", /--plugin-dir/);
  assert.match(readLaunch("/usr/bin/vim --model x", exists).problem ?? "", /claude 가 아니다/);
});

test("decision 330: the CLI takes exactly one of --stale and --task", async () => {
  const h = harness();
  for (const values of [{}, { stale: true, task: "task_lead" }]) {
    const out = await restart(values, h.ports.host, h.ports.orca, () => h.store);
    assert.ok("ok" in out && !out.ok, JSON.stringify(out));
  }
});
