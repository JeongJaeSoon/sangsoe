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
  recordHook,
  restartSessions,
  type StartRequest,
  Store,
} from "../../core/index.ts";
import * as core from "../../core/index.ts";
import { createFakeOrca } from "../fake-orca/index.ts";
import { createSessionWorld } from "../session/world.ts";

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
  /** Who runs the command: the orchestrator (pid 100) by default, or the idle lead (pid 200). */
  caller?: "orchestrator" | "lead";
  /** Server age per pid; every server is stale unless named here. */
  age?: Record<number, string>;
  stop?: () => ExecResult;
  /** How long each `terminal list` takes on the clock; claude never shows in the new terminal when set. */
  listMs?: number;
  /**
   * The lead's old Dispatch is settled and its session already runs again in another terminal of the
   * same worktree, with no sangsoe MCP server: `orca` as an Orca restore re-opens it
   * (`--plugin-dir … --effort … --resume <id>`, no --agent), `restart` as an earlier restart that
   * ended before its bind left it.
   */
  restored?: "orca" | "restart";
  /** session_started launch fields for the lead's session, oldest first, after the row start_unit's session wrote. */
  launches?: Record<string, string>[];
  /** Bind through start_unit's real core on this fake Orca instead of a stub. */
  realBind?: boolean;
};

const RESTORED_TERM = "term_00000000-0000-4000-8000-0000000000r1";
/** As many Runs as the measuring machine held: a walk over them is what stalled the first measurement. */
const RUNS = Array.from({ length: 85 }, (_, i) => ({ id: `run_${String(i + 100).padStart(12, "0")}` }));

// The orchestrator (100) runs this command through its shell (150 → 151); a lead caller (200) through
// 250 → 251. 200 is the idle lead, 300 a lead mid-turn, 400 a worker in the lead's Run, 500 a session
// the owner opened by hand outside any worktree.
function harness(s: Setup = {}) {
  const age = (pid: number) => s.age?.[pid] ?? STALE;
  const lead =
    s.restored === "orca"
      ? `  200     1 00:10:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --effort medium --resume ${LEAD_SESSION}`
      : s.restored === "restart"
        ? `  200   199 00:10:00 ${CLAUDE} --resume ${LEAD_SESSION} --plugin-dir ${PLUGIN_DIR} --model m-main --effort medium`
        : `  200     1 1-00:00:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --resume 0a1b2c3d-0000-4000-8000-0000000000aa --model m-main --effort medium --verbose`;
  const self = s.caller === "lead" ? 251 : 151;
  const ps = [
    `  100     1 3-00:00:00 ${CLAUDE} --continue --agent sangsoe:orchestrator`,
    `  101   100 ${age(101)} node ${ENTRY}`,
    ...(s.caller === "lead"
      ? [`  250   200     00:05 /bin/zsh -c sangsoe restart --stale`, `  251   250     00:05 node /opt/sangsoe/libexec/dist/cli/main.js restart --stale`]
      : [`  150   100     00:05 /bin/zsh -c sangsoe restart --stale`, `  151   150     00:05 node /opt/sangsoe/libexec/dist/cli/main.js restart --stale`]),
    lead,
    // A session re-opened into a profile without sangsoe has no sangsoe MCP server.
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
  let bound: string | undefined;
  const settled = (u: Unit) => s.restored !== undefined && u.task === "task_lead" && bound === undefined;
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
  const restoredTerm = s.restored === "restart" ? NEW_TERM : RESTORED_TERM;
  let created = 0;
  const callerRun = s.caller === "lead" ? LEAD_RUN : ORCH_RUN;
  const fake = createFakeOrca({
    replies: {
      "orchestration-run-current": () => ok({ runId: callerRun }),
      "worktree-list": () =>
        ok({ worktrees: [PARENT_TREE, LEAD_TREE, BUSY_TREE, WORKER_TREE].map((id) => ({ id, path: pathOf(id), repoId: "repo-0001", hostId: "local", branch: "b", displayName: "d", isMainWorktree: false, isArchived: false, parentWorktreeId: null, childWorktreeIds: [], lastActivityAt: 0 })) }),
      // As Orca answers: without --run only the bound Run (the caller's), so a miss there says nothing of the others.
      "orchestration-worker-list": (args: readonly string[]) => {
        const run = flag(args, "run");
        const rows = UNITS.filter((u) => u.run === (run ?? callerRun)).map((u) => ({
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
        if (!u) return fail("dispatch_not_found");
        if (u.task === "task_lead" && bound) return ok({ dispatch: { id: bound, run_id: u.run, task_id: u.task, status: "dispatched" } });
        return ok({ dispatch: { id: u.dispatch, run_id: u.run, task_id: u.task, status: settled(u) ? "failed" : "dispatched" } });
      },
      "orchestration-worker-show": (args: readonly string[]) => {
        const u = UNITS.find((x) => x.dispatch === flag(args, "dispatch"));
        if (!u) return fail("dispatch_not_found");
        const state = s.restored !== undefined && u.task === "task_lead" ? { state: "failed", liveness: "exited" } : { state: "ready", liveness: "live" };
        return ok({ dispatchId: u.dispatch, taskId: u.task, runId: u.run, ...state, terminal: u.terminal, workspace: u.tree });
      },
      "orchestration-task-list": (args: readonly string[]) =>
        ok({
          tasks: UNITS.filter((u) => u.run === flag(args, "run")).map((u) => ({
            id: u.task,
            status: s.restored && u.task === "task_lead" && !bound ? "ready" : "dispatched",
            title: u.task,
            spec: `sangsoe-role: ${u.role}\nbrief`,
          })),
        }),
      "orchestration-task-update": () => ok({ task: { id: "task_lead", status: "ready" } }),
      "orchestration-worker-start": () => {
        bound = "ctx_new";
        return ok({ dispatchId: "ctx_new" });
      },
      "orchestration-inbox": (args: readonly string[]) =>
        ok({
          messages:
            flag(args, "terminal") === `run:${ORCH_RUN}`
              ? [{ id: "msg_h1", type: "handoff", subject: "handoff:task_lead", body: "next", from: "x", to: "y", handled: false }]
              : [],
        }),
      "worktree-ps": () =>
        ok({
          worktrees: UNITS.map((u) => ({ worktreeId: u.tree, hostId: "local", repo: "api", path: pathOf(u.tree), branch: "b", isMainWorktree: false, isArchived: false, liveTerminalCount: 1, unverifiableTerminalCount: 0, status: "active", agents: [{ paneKey: u.pane, state: u.state, agentType: "claude", agentWait: null }] })),
          truncated: false,
        }),
      "terminal-list": (args: readonly string[]) => {
        clock += s.listMs ?? 0;
        const tree = (flag(args, "worktree") ?? "").replace(/^id:/, "");
        const own = UNITS.filter((u) => u.tree === tree && !(s.restored && u.task === "task_lead")).map((u) => {
          const [tabId, leafId] = u.pane.split(":");
          return { handle: u.terminal, tabId, leafId, agentIdentity: "claude", executionHostId: "local" };
        });
        const restored = s.restored && tree === LEAD_TREE ? [{ handle: restoredTerm, tabId: "tabL", leafId: "leafL", agentIdentity: "claude", executionHostId: "local" }] : [];
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
  for (const u of UNITS) {
    store.append({
      type: "unit_started",
      source: "test",
      entity: "task",
      entity_id: u.task,
      payload: { kind: u.role, picked_by: "role", model: "m-main", effort: "medium", route: "none", budget: 0, budget_per: "unit", used: 0, worktree: u.tree, run: u.run },
    });
  }
  store.append({ type: "session_started", source: "test", entity: "task", entity_id: "task_lead", payload: { session: LEAD_SESSION, role: "lead", model: "m" } });
  for (const [i, l] of (s.launches ?? []).entries()) {
    store.append({ type: "session_started", source: "test", entity: "task", entity_id: "task_lead", dedupe_key: `l${i}`, payload: { session: LEAD_SESSION, role: "lead", model: "m", ...l } });
  }
  store.append({ type: "session_started", source: "test", entity: "task", entity_id: "task_w", payload: { session: "0a1b2c3d-0000-4000-8000-000000000003", role: "worker", model: "m" } });
  store.append({ type: "session_started", source: "test", target: `run:${ORCH_RUN}`, payload: { session: ORCH_SESSION, role: "orchestrator", model: "m" } });
  const binds: StartRequest[] = [];
  const sleeps: number[] = [];
  const emitted: string[] = [];
  const ports: RestartPorts = {
    orca: createOrcaAdapter(fake.exec),
    store,
    host,
    self: { pid: self, cwd: s.cwd ?? (s.caller === "lead" ? pathOf(LEAD_TREE) : pathOf(PARENT_TREE)), terminal: "term_orch" },
    installed: () => ({ version: "0.1.13", at: NOW - 3_600_000 }),
    now: () => clock,
    exists: (p) => p === PLUGIN_DIR,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    emit: (line) => emitted.push(line),
    ...(s.realBind
      ? {}
      : {
          bind: async (req: StartRequest) => {
            binds.push(req);
            return { kind: "resumed", taskId: "task_lead", dispatchId: "ctx_new", from: "ctx_lead", worktreeId: LEAD_TREE, terminal: NEW_TERM, notes: [] } as const;
          },
        }),
  };
  const named = (cmd: string) => fake.calls.filter((c) => c.slice(1, 1 + cmd.split(" ").length).join(" ") === cmd);
  const at = (cmd: string) => fake.calls.findIndex((c) => c.slice(1, 1 + cmd.split(" ").length).join(" ") === cmd);
  const orcaCalls = () => fake.calls.filter((c) => c[0] === "orca").map((c) => c.slice(1, 3).join(" "));
  return { ports, fake, named, at, binds, sleeps, hostCalls, store, emitted, orcaCalls, clock: () => clock, restoredTerm };
}

const leadCommand =
  `while kill -0 200 2>/dev/null; do sleep 1; done; '${CLAUDE}' '--resume' '${LEAD_SESSION}' '--plugin-dir' '${PLUGIN_DIR}' '--model' 'm-main' '--effort' 'medium'`;
const WRITES = ["orchestration worker-stop", "terminal create", "orchestration send", "orchestration worker-start", "orchestration worker-abandon"];

test("decision 330 (1): the dry run lists each stale session with its role, Task, session and flags, and why it is or is not restarted", async () => {
  const h = harness();
  const out = await restartSessions(h.ports, { dryRun: true });
  assert.equal(out.code, 0, out.lines.join("\n"));
  const text = out.lines.join("\n");
  assert.match(out.lines[0] ?? "", /낡은 세션 5개 \(부른 쪽 orchestrator, Run run_00000000000f\) — dry-run/);
  assert.match(text, /pid 200 {2}lead task_lead ctx_lead .* session 0a1b2c3d-0000-4000-8000-000000000001 {2}state done {2}flags --plugin-dir \/home\/u\/Application Support\/orca\/agent-view --model m-main --effort medium {2}dropped --verbose\n {4}→ restart: 쉬고 있다\(마지막 handoff msg_h1\)/);
  assert.ok(out.lines.includes(`    command: ${leadCommand}`), text);
  assert.match(text, /pid 300 {2}lead task_busy ctx_busy .*state working.*\n {4}→ skip: 턴 중이다\(agent working\)/);
  assert.match(text, /pid 400 .*\n {4}→ skip: 부른 쪽 Run\(run_00000000000f\)에 이 worktree 의 Dispatch 가 없다/);
  assert.match(text, /pid 500 .*\n {4}→ skip: Orca worktree 밖의 세션이다/);
  assert.match(text, /pid 100 {2}orchestrator - - .*session 0a1b2c3d-0000-4000-8000-00000000000f.*flags --agent sangsoe:orchestrator\n {4}→ self:/);
  assert.ok(out.lines.includes(`    command: while kill -0 100 2>/dev/null; do sleep 1; done; '${CLAUDE}' '--resume' '${ORCH_SESSION}' '--agent' 'sangsoe:orchestrator'`), text);
  for (const w of WRITES) assert.equal(h.named(w).length, 0, `dry run calls no ${w}`);
  assert.equal(h.binds.length, 0);
  assert.deepEqual(h.hostCalls, ["ps -ww -axo pid=,ppid=,etime=,args=", "lsof -a -d cwd -Fpn -p 101,201,301,401,501"]);
});

test("decision 330 (A): planning reads a bounded set of Orca calls and never walks every Run, for an orchestrator or a lead caller", async () => {
  for (const [label, setup, opts] of [
    ["orchestrator --stale", {}, { dryRun: true }],
    ["orchestrator --task", {}, { task: "task_lead", dryRun: true }],
    ["lead --stale", { caller: "lead" }, { dryRun: true }],
  ] as const) {
    const h = harness(setup);
    const out = await restartSessions(h.ports, opts);
    assert.equal(out.code, 0, `${label}: ${out.lines.join("\n")}`);
    assert.equal(h.named("orchestration run-list").length, 0, `${label}: no walk over every Run`);
    assert.ok(h.orcaCalls().length <= 10, `${label}: ${h.orcaCalls().length} Orca calls: ${h.orcaCalls().join(", ")}`);
  }
  const lead = harness({ caller: "lead" });
  const text = (await restartSessions(lead.ports, { dryRun: true })).lines.join("\n");
  assert.match(text, /부른 쪽 lead, Run run_000000000001/);
  assert.match(text, /pid 400 {2}worker task_w ctx_w .*state done.*\n {4}→ restart: 쉬고 있다/);
  assert.match(text, /pid 200 {2}lead task_lead ctx_lead .*\n {4}→ skip: 이 명령을 부른 세션이다/);
});

test("decision 330 (B): the wait for claude in the new terminal is bounded by the clock, not by how many sleeps it took", async () => {
  const h = harness({ listMs: 30_000 });
  const out = await restartSessions(h.ports, { task: "task_lead", dryRun: false });
  assert.equal(out.code, 1);
  assert.match(out.lines.join("\n"), /90초 안에 claude 가 붙지 않았다/);
  const created = h.at("terminal create");
  const lists = h.fake.calls.slice(created).filter((c) => c.slice(1, 3).join(" ") === "terminal list");
  assert.ok(lists.length <= 4, `${lists.length} terminal lists after the create`);
  assert.equal(h.binds.length, 0);
});

test("decision 330 (C): --task binds a settled Task whose session already runs again in its worktree, with no stop and no new terminal", async () => {
  for (const restored of ["orca", "restart"] as const) {
    const plan = harness({ restored });
    const dry = await restartSessions(plan.ports, { task: "task_lead", dryRun: true });
    assert.match(dry.lines.join("\n"), new RegExp(`pid 200 {2}lead task_lead ctx_lead [\\s\\S]*→ bind: .*${plan.restoredTerm}`), dry.lines.join("\n"));

    const h = harness({ restored, realBind: true });
    const out = await restartSessions(h.ports, { task: "task_lead", dryRun: false });
    assert.equal(out.code, 0, `${restored}: ${out.lines.join("\n")}`);
    for (const w of ["orchestration worker-stop", "terminal create", "orchestration worker-abandon"]) assert.equal(h.named(w).length, 0, `${restored}: no ${w}`);
    const starts = h.named("orchestration worker-start");
    assert.equal(starts.length, 1, restored);
    assert.equal(flag(starts[0] ?? [], "terminal"), h.restoredTerm);
    assert.match(out.lines.join("\n"), new RegExp(`✓ task_lead: Dispatch ctx_lead → ctx_new, 터미널 ${h.restoredTerm}`));
    assert.equal(h.store.events({ type: "unit_resumed" }).length, 1);
  }
});

test("decision 330 (D): the first recorded launch fields win over what ps shows, and the settings folder rides in front of the command", async () => {
  const h = harness({
    launches: [
      { launch_agent: "sangsoe:lead", launch_name: "lead:alpha", launch_effort: "high", config_dir: "/home/u/.claude-a" },
      { launch_effort: "medium", config_dir: "/home/u/.claude-b" },
    ],
  });
  const out = await restartSessions(h.ports, { task: "task_lead", dryRun: true });
  assert.ok(
    out.lines.includes(
      `    command: while kill -0 200 2>/dev/null; do sleep 1; done; CLAUDE_CONFIG_DIR='/home/u/.claude-a' '${CLAUDE}' '--resume' '${LEAD_SESSION}' '--plugin-dir' '${PLUGIN_DIR}' '--model' 'm-main' '--effort' 'high' '--agent' 'sangsoe:lead' '--name' 'lead:alpha'`,
    ),
    out.lines.join("\n"),
  );
});

test("decision 330 (E): SessionStart records how the session was launched, read only once it has a role", async () => {
  const w = createSessionWorld({ heldRun: "run_000000000001" });
  let reads = 0;
  const launch = () => {
    reads++;
    return { agent: "sangsoe:worker", name: "worker:a", model: "m-main", effort: "high", configDir: "/home/u/.claude-a" };
  };
  await recordHook("session-start", w, { cwd: w.dir, session_id: "s1", source: "startup" }, { launch });
  const row = w.store.events({ type: "session_started" }).at(-1);
  assert.deepEqual(
    [row?.payload.launch_agent, row?.payload.launch_name, row?.payload.launch_model, row?.payload.launch_effort, row?.payload.config_dir],
    ["sangsoe:worker", "worker:a", "m-main", "high", "/home/u/.claude-a"],
  );
  const none = createSessionWorld({ spec: "no role line" });
  none.dispatched = false;
  await recordHook("session-start", none, { cwd: none.dir, session_id: "s2", source: "startup" }, { launch });
  assert.equal(reads, 1, "a session with no role reads no ps");
  const broken = createSessionWorld();
  const lines = await recordHook("session-start", broken, { cwd: broken.dir, session_id: "s3", source: "startup" }, {
    launch: () => {
      throw new Error("ps failed");
    },
  });
  assert.match(lines[0] ?? "", /sangsoe-role: worker/, "a launch that cannot be read never fails the hook");
});

test("decision 330 (E): the hook reads its session's launch from the nearest claude above it", () => {
  const host: Host = {
    env: { HOME: "/home/u", CLAUDE_CONFIG_DIR: "/home/u/.claude-a" },
    nodeVersion: "24.15.0",
    exists: () => false,
    readText: () => "",
    run: (cmd) =>
      cmd === "ps"
        ? {
            code: 0,
            stdout: [
              `  898     1 01:00 ${CLAUDE} --plugin-dir ${PLUGIN_DIR} --model opus --effort high --agent sangsoe:lead --name lead:alpha`,
              "  899   898 00:01 /bin/sh -c sangsoe hook session-start",
              "  900   899 00:01 node /opt/sangsoe/libexec/dist/cli/main.js hook session-start",
            ].join("\n"),
            stderr: "",
          }
        : { code: 127, stdout: "", stderr: "" },
  };
  assert.deepEqual(core.sessionLaunch(host, 900, NOW), { agent: "sangsoe:lead", name: "lead:alpha", model: "opus", effort: "high", configDir: "/home/u/.claude-a" });
  assert.equal(core.sessionLaunch({ ...host, run: () => ({ code: 1, stdout: "", stderr: "" }) }, 900, NOW), undefined);
});

test("decision 330 (F): each line is emitted as it is made, the same lines the command returns", async () => {
  const h = harness();
  const out = await restartSessions(h.ports, { dryRun: false });
  assert.deepEqual(h.emitted, out.lines);
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

test("decision 330 (2): a failure after the stop names the --task run that finishes it", async () => {
  const h = harness({ listMs: 30_000 });
  const out = await restartSessions(h.ports, { task: "task_lead", dryRun: false });
  assert.match(out.lines.join("\n"), /sangsoe restart --task task_lead/);
});

test("decision 330 (2): --task restarts the one child holding that Task even when its server is current", async () => {
  const fresh = { age: { 101: FRESH, 201: FRESH, 301: FRESH, 401: FRESH, 501: FRESH } };
  const none = await restartSessions(harness(fresh).ports, { dryRun: true });
  assert.deepEqual(none.lines.slice(1), ["  없다"]);
  const out = await restartSessions(harness(fresh).ports, { task: "task_lead", dryRun: true });
  assert.equal(out.lines.filter((l) => l.startsWith("  pid ")).length, 1, out.lines.join("\n"));
  assert.match(out.lines.join("\n"), /pid 200 {2}lead task_lead[\s\S]*→ restart/);
  const missing = await restartSessions(harness().ports, { task: "task_none", dryRun: true });
  assert.equal(missing.code, 1);
  const other = await restartSessions(harness().ports, { task: "task_w", dryRun: true });
  assert.match(other.lines.join("\n"), /→ skip: Run run_000000000001 의 Task 다/);
});

test("decision 330 (1): a worker does not restart sessions", async () => {
  const h = harness({ cwd: pathOf(WORKER_TREE) });
  const out = await restartSessions(h.ports, { dryRun: false });
  assert.equal(out.code, 1);
  assert.match(out.lines[0] ?? "", /워커는 세션을 다시 띄우지 않는다/);
  for (const w of WRITES) assert.equal(h.named(w).length, 0);
});

test("decision 330: flags are read back from ps text whose paths hold spaces; session flags go, unknown ones are listed", () => {
  const twice = `${CLAUDE} --plugin-dir ${PLUGIN_DIR} --resume 0a1b --plugin-dir /home/u/other dir/view --model=m-main --name lead:a --continue --verbose`;
  const exists = (p: string) => p === PLUGIN_DIR || p === "/home/u/other dir/view";
  assert.deepEqual(readLaunch(twice, exists), {
    bin: CLAUDE,
    flags: ["--plugin-dir", PLUGIN_DIR, "--plugin-dir", "/home/u/other dir/view", "--model", "m-main", "--name", "lead:a"],
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
