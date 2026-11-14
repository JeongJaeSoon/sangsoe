import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../../claude-plugin/mcp/tools/unit_close.ts";
import { createOrcaAdapter, type ExecResult, Store } from "../../core/index.ts";

// Decision 263: unit_close closes one finished unit's agent terminal by handle, and says which
// condition failed otherwise. A scripted Orca answers the three reads; every call is kept.

const WS = "wt-1::/work/acme/api";
const TERM = "term_unit";
const ME = "term_caller";
const DISPATCH = "ctx_done";

type Scene = {
  show?: Record<string, unknown> | "error";
  terminals?: unknown[];
  agents?: unknown[];
  psTruncated?: boolean;
  closeFails?: boolean;
  /** The worktree whose `terminal list` shows the rows; any other worktree lists none. */
  listedIn?: string;
  /** The worktree `worktree ps` files the agents under. */
  agentsIn?: string;
  /** A second terminal row on another host beside the local target: the list is then partial. */
  remoteTerminalRow?: boolean;
  /** A second `worktree ps` row on another host beside the local one: the page is then partial. */
  remotePsRow?: boolean;
};

const ok = (result: unknown): ExecResult => ({ code: 0, stdout: JSON.stringify({ ok: true, result }), stderr: "" });
const bad = (code: string): ExecResult => ({ code: 1, stdout: JSON.stringify({ ok: false, error: { code, message: code } }), stderr: "" });

function world(s: Scene = {}) {
  const calls: string[][] = [];
  const exec = async (_file: string, args: readonly string[]): Promise<ExecResult> => {
    calls.push([...args]);
    const cmd = args.slice(0, 2).join(" ");
    if (cmd === "orchestration worker-show") {
      if (s.show === "error") return bad("not_found");
      return ok({ dispatchId: DISPATCH, taskId: "task_1", runId: "run_1", state: "succeeded", terminal: TERM, terminalState: "retained", workspace: WS, ...s.show });
    }
    if (cmd === "terminal list") {
      const rows = s.terminals ?? [{ handle: TERM, worktreeId: WS, executionHostId: "local", agentIdentity: "claude", tabId: "tab1", leafId: "leaf1" }];
      if (s.remoteTerminalRow) rows.push({ handle: "term_remote", worktreeId: WS, executionHostId: "remote-1", agentIdentity: "claude", tabId: "t9", leafId: "l9" });
      // As Orca does: scoped to the worktree when asked, every worktree's rows when not.
      const at = args.indexOf("--worktree") >= 0 ? args[args.indexOf("--worktree") + 1] : undefined;
      return ok({ terminals: at === undefined || at === `id:${s.listedIn ?? WS}` ? rows : [] });
    }
    if (cmd === "worktree ps") {
      const agents = s.agents ?? [{ paneKey: "tab1:leaf1", state: "done", agentType: "claude", agentWait: null }];
      const row = (id: string, host: string) => ({ worktreeId: id, hostId: host, repo: "api", path: "/work/acme/api", branch: "b", isMainWorktree: false, isArchived: false, liveTerminalCount: 1, unverifiableTerminalCount: 0, status: "x", agents });
      const worktrees = [row(s.agentsIn ?? WS, "local"), ...(s.remotePsRow ? [row("wt-9::/work/remote", "remote-1")] : [])];
      return ok({ worktrees, ...(s.psTruncated ? { truncated: true } : {}) });
    }
    if (cmd === "terminal close") return s.closeFails ? bad("terminal_not_found") : ok({ closed: true });
    return bad("unexpected");
  };
  const store = Store.open({ path: ":memory:" });
  const orca = createOrcaAdapter(exec);
  const run = (caller: string | undefined = ME, dispatch = DISPATCH) => handle({ dispatch }, { orca, store }, caller);
  const closes = () => calls.filter((c) => c[0] === "terminal" && c[1] === "close");
  return { run, closes, calls, store };
}

const code = (r: Awaited<ReturnType<ReturnType<typeof world>["run"]>>) => (r.ok ? "ok" : r.refusal.code);

test("a succeeded unit with an idle agent has its terminal closed by handle, and one event names it", async () => {
  const w = world();
  const r = await w.run();
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(w.closes(), [["terminal", "close", "--terminal", TERM, "--json"]]);
  const rows = w.store.events().filter((e) => e.type === "unit_closed");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.payload, { dispatch: DISPATCH, terminal: TERM });
  await w.run();
  assert.equal(w.store.events().filter((e) => e.type === "unit_closed").length, 1, "a second close is one row");
});

test("failed and cancelled Dispatches close too", async () => {
  for (const state of ["failed", "cancelled"]) {
    const w = world({ show: { state } });
    assert.ok((await w.run()).ok, state);
    assert.equal(w.closes().length, 1, state);
  }
});

const REFUSED: [string, Scene, string | undefined, string][] = [
  ["a Dispatch that is still working", { show: { state: "ready" } }, ME, "not_final"],
  ["an abandoned Dispatch", { show: { state: "abandoned" } }, ME, "not_final"],
  ["a Dispatch Orca cannot show", { show: "error" }, ME, "dispatch_unreadable"],
  ["a Dispatch with no terminal", { show: { terminal: undefined } }, ME, "no_terminal"],
  ["an already released terminal", { show: { terminalState: "released" } }, ME, "terminal_released"],
  ["a release in progress", { show: { terminalState: "release_pending" } }, ME, "terminal_released"],
  ["the caller's own terminal", {}, TERM, "caller_terminal"],
  ["an unknown caller", {}, "", "caller_unknown"],
  ["a terminal Orca no longer lists", { terminals: [] }, ME, "terminal_not_live"],
  ["a listed terminal with no agent", { terminals: [{ handle: TERM, tabId: "tab1", leafId: "leaf1" }] }, ME, "terminal_not_live"],
  ["an agent that is working", { agents: [{ paneKey: "tab1:leaf1", state: "working", agentType: "claude", agentWait: null }] }, ME, "agent_not_idle"],
  ["an agent in a state sangsoe does not know", { agents: [{ paneKey: "tab1:leaf1", state: "blocked", agentType: "claude", agentWait: null }] }, ME, "agent_not_idle"],
  ["an agent holding a wait", { agents: [{ paneKey: "tab1:leaf1", state: "idle", agentType: "claude", agentWait: { state: "waiting" } }] }, ME, "agent_not_idle"],
  ["an agent whose wait Orca never looked at", { agents: [{ paneKey: "tab1:leaf1", state: "idle", agentType: "claude" }] }, ME, "agent_not_idle"],
  ["no agent row for the terminal", { agents: [{ paneKey: "other:pane", state: "done", agentType: "claude", agentWait: null }] }, ME, "agent_not_idle"],
  ["a truncated worktree ps", { psTruncated: true }, ME, "agent_not_idle"],
  ["a terminal that is listed only under another worktree", { listedIn: "wt-2::/work/acme/web" }, ME, "terminal_not_live"],
  ["an agent row filed under another worktree with the same pane key", { agentsIn: "wt-2::/work/acme/web" }, ME, "agent_not_idle"],
  ["a remote row listed next to the local terminal, which makes the terminal list partial", { remoteTerminalRow: true }, ME, "terminal_not_live"],
  ["a remote row on the worktree ps page, which makes the page partial", { remotePsRow: true }, ME, "agent_not_idle"],
  ["a sibling pane of the same tab at rest while the terminal's own pane is not listed", { agents: [{ paneKey: "tab1:leaf2", state: "idle", agentType: "claude", agentWait: null }] }, ME, "agent_not_idle"],
  ["a close Orca fails", { closeFails: true }, ME, "close_failed"],
];

for (const [name, scene, caller, want] of REFUSED) {
  test(`refuses ${name} with ${want} and closes no other way`, async () => {
    const w = world(scene);
    const r = await w.run(caller);
    assert.equal(code(r), want, JSON.stringify(r));
    if (want !== "close_failed") assert.equal(w.closes().length, 0);
    assert.equal(w.store.events().filter((e) => e.type === "unit_closed").length, 0);
    for (const c of w.calls) assert.ok(!c.some((a) => ["--tab", "--all", "--worktree"].includes(a) && c[1] === "close"), c.join(" "));
  });
}

test("an empty Dispatch id is invalid input and reads nothing", async () => {
  const w = world();
  assert.equal(code(await w.run(ME, " ")), "invalid_input");
  assert.equal(w.calls.length, 0);
});
