// Decision 246: one owner command sends one recovery line to every session still stopped on a lost
// login, and never a second line to the same stop.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { AUTH_RECOVER_LINE, authRecover, type OrcaAdapter, type OrcaResult, Store, type WorkerShow } from "../../core/index.ts";
import { recover } from "../../cli/commands/recover.ts";

type Sent = { terminal: string; text: string; enter?: boolean; waitSubmit?: number };
type Fake = Pick<OrcaAdapter, "workerShow" | "worktreePs" | "terminalList" | "terminalSend" | "requestShow"> & { sent: Sent[]; calls: string[] };

const worker = (dispatch: string, task: string, terminal: string, over: Partial<WorkerShow> = {}): WorkerShow => ({
  dispatchId: dispatch,
  taskId: task,
  runId: "run_1",
  state: "ready",
  liveness: "live",
  terminal,
  terminalState: "retained",
  workspace: `repo::/w/${task}`,
  ...over,
});

function fakeOrca(
  o: {
    workers?: WorkerShow[];
    terminals?: Record<string, { handle: string; agentIdentity?: string }[]>;
    refuse?: boolean;
    /** The first send meets an open menu: Orca types nothing (decision 86 ③). */
    blocked?: boolean;
    /** A failure after the text may have been typed (a submit wait that timed out). */
    submitTimeout?: boolean;
    /** worktree ps comes back cut short. */
    truncated?: boolean;
    /** terminal list comes back cut short. */
    listTruncated?: boolean;
    /** The first send's response is lost; request-show then answers this state. */
    lost?: "absent" | "completed" | "pending";
    /** The replay under the request id answers this refusal code. */
    replayRefused?: string;
  } = {},
): Fake {
  const sent: Sent[] = [];
  const calls: string[] = [];
  const ok = <T>(value: T): Promise<OrcaResult<T>> => Promise.resolve({ ok: true, value });
  return {
    sent,
    calls,
    workerShow: (a) => {
      calls.push(`workerShow ${a.dispatch}`);
      const w = (o.workers ?? []).find((x) => x.dispatchId === a.dispatch);
      return w ? ok(w) : Promise.resolve({ ok: false, error: { code: "not_found", message: a.dispatch } });
    },
    worktreePs: () => {
      calls.push("worktreePs");
      const rows = Object.keys(o.terminals ?? {}).map((id) => ({
        worktreeId: `repo::/w/${id}`,
        worktreeInstanceId: id,
        hostId: "local",
        repo: "acme/api",
        path: `/w/${id}`,
        branch: "main",
        liveTerminalCount: (o.terminals?.[id] ?? []).length,
        agents: [],
      }));
      return ok({ rows, truncated: o.truncated === true, omittedHostIds: [], nonLocal: { rows: 0 } } as never);
    },
    terminalList: (a) => {
      calls.push(`terminalList ${a.worktree}`);
      const id = (a.worktree ?? "").replace(/^id:repo::\/w\//, "");
      return ok({ rows: o.terminals?.[id] ?? [], truncated: o.listTruncated === true, omittedHostIds: [], nonLocal: { rows: 0 } } as never);
    },
    terminalSend: (a, w) => {
      calls.push(`terminalSend ${a.terminal}${w?.retryRequest ? ` retry ${w.retryRequest}` : ""}`);
      if (o.refuse) return Promise.resolve({ ok: false, error: { code: "terminal_handle_stale", message: "terminal_handle_stale" } });
      if (o.blocked && sent.length === 0 && !calls.some((c, i) => i < calls.length - 1 && c.startsWith("terminalSend"))) {
        return Promise.resolve({ ok: false, error: { code: "agent_prompt_blocked", message: "a menu is open" } });
      }
      if (o.submitTimeout) return Promise.resolve({ ok: false, error: { code: "exit_1", message: "prompt not seen to start a turn" } });
      if (o.lost && !w?.retryRequest && !calls.some((c, i) => i < calls.length - 1 && c.startsWith("terminalSend"))) {
        return Promise.resolve({ ok: false, error: { code: "response_lost", message: "timed out" }, requestId: "req_1" });
      }
      if (o.replayRefused && w?.retryRequest) return Promise.resolve({ ok: false, error: { code: o.replayRefused, message: o.replayRefused } });
      sent.push(a);
      return ok({ accepted: true });
    },
    requestShow: (a) => {
      calls.push(`requestShow ${a.request}`);
      return ok({ state: o.lost } as never);
    },
  };
}

function world() {
  const store = Store.open({ path: ":memory:" });
  const dead = (dispatch: string, task: string, cause?: "auth") =>
    store.append({
      type: "worker_dead",
      source: "orca-monitor",
      entity: "dispatch",
      entity_id: dispatch,
      target: task,
      payload: { reason: "stop_failure", ...(cause ? { cause } : {}) },
    }).seq;
  const idle = (task: string) => store.append({ type: "worker_idle", source: "Stop", entity: "task", entity_id: task, payload: { session: `s_${task}` } }).seq;
  return { store, dead, idle };
}

test("246: two auth stops, one already recovered: exactly one line, to the still-stopped session", async () => {
  const { store, dead, idle } = world();
  dead("ctx_a", "task_a", "auth");
  dead("ctx_b", "task_b", "auth");
  idle("task_b");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a"), worker("ctx_b", "task_b", "term_b")] });

  const r = await authRecover(store, orca, { send: true });

  assert.deepEqual(orca.sent, [{ terminal: "term_a", text: AUTH_RECOVER_LINE, enter: true, waitSubmit: 10 }]);
  assert.deepEqual(
    r.rows.map((x) => [x.who, x.verdict]),
    [["ctx_a", "sent"]],
    "the recovered session is not a target at all",
  );
  assert.equal(store.events({ type: "owner_action" }).length, 1);
  assert.ok(!orca.calls.includes("workerShow ctx_b"), "a recovered stop is not even looked up");
});

test("246: a second --send run sends nothing to a stop it already sent to", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  await authRecover(store, orca, { send: true });
  const again = await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1);
  assert.deepEqual(
    again.rows.map((x) => [x.who, x.verdict]),
    [["ctx_a", "already"]],
  );
  assert.equal(store.events({ type: "owner_action" }).length, 1);
});

test("246: a new auth stop after the line was sent is a new stop and gets its own line", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  await authRecover(store, orca, { send: true });
  dead("ctx_a", "task_a", "auth");
  await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 2);
});

test("246: the dry run lists what it would send and sends and writes nothing", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const before = store.events().length;
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  const r = await authRecover(store, orca, { send: false });
  assert.deepEqual(
    r.rows.map((x) => [x.who, x.terminal, x.verdict]),
    [["ctx_a", "term_a", "would_send"]],
  );
  assert.equal(orca.sent.length, 0);
  assert.ok(!orca.calls.some((c) => c.startsWith("terminalSend")));
  assert.equal(store.events().length, before);
});

test("246: a stop that is not a lost login, or whose latest stop is not, is not picked", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a");
  dead("ctx_b", "task_b", "auth");
  dead("ctx_b", "task_b");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a"), worker("ctx_b", "task_b", "term_b")] });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(r.rows, []);
  assert.equal(orca.sent.length, 0);
});

test("246: a Dispatch that is gone or settled is listed as skipped, not sent to", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  dead("ctx_b", "task_b", "auth");
  const orca = fakeOrca({
    workers: [worker("ctx_a", "task_a", "term_a", { liveness: "gone" }), worker("ctx_b", "task_b", "term_b", { state: "succeeded" })],
  });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(
    r.rows.map((x) => x.verdict),
    ["skip", "skip"],
  );
  assert.equal(orca.sent.length, 0);
});

test("246: a refused send writes no row, so the next run tries again", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const r = await authRecover(store, fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], refuse: true }), { send: true });
  assert.deepEqual(
    r.rows.map((x) => x.verdict),
    ["failed"],
  );
  assert.equal(store.events({ type: "owner_action" }).length, 0);
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1);
});

test("246: a session without a Dispatch is sent to only when its worktree holds exactly one agent terminal", async () => {
  const { store } = world();
  const wait = (session: string, worktree: string) =>
    store.append({ type: "waiting_human", source: "StopFailure", payload: { session, cause: "auth", worktree } }).seq;
  wait("sess_one", "wt_one");
  wait("sess_two", "wt_two");
  const released = wait("sess_back", "wt_back");
  store.append({
    type: "waiting_released",
    source: "Stop",
    dedupe_key: `waiting_released:${released}`,
    payload: { ref: String(released), outcome: "answered", by: "unknown", evidence: "turn_ended" },
  });
  const orca = fakeOrca({
    terminals: {
      wt_one: [{ handle: "term_one", agentIdentity: "claude" }, { handle: "term_shell" }],
      wt_two: [
        { handle: "term_x", agentIdentity: "claude" },
        { handle: "term_y", agentIdentity: "claude" },
      ],
      wt_back: [{ handle: "term_back", agentIdentity: "claude" }],
    },
  });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(
    r.rows.map((x) => [x.who, x.verdict]),
    [
      ["sess_one", "sent"],
      ["sess_two", "skip"],
    ],
  );
  assert.deepEqual(
    orca.sent.map((s) => s.terminal),
    ["term_one"],
  );
});

test("246: two stops on one terminal get one line, on this run and the next", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  store.append({ type: "waiting_human", source: "orca-monitor", entity: "task", entity_id: "task_a", payload: { dispatch: "ctx_a", cause: "auth" } });
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  const r = await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1);
  assert.deepEqual(
    r.rows.map((x) => x.verdict),
    ["sent", "skip"],
  );
  const again = await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1, "the Dispatch's wait is the same stop the line already covered");
  assert.deepEqual(
    again.rows.map((x) => x.verdict),
    ["already", "already"],
  );
});

test("246: a session without a Dispatch that stops again keeps its open wait: no second line, the row names the restart", async () => {
  const { store } = world();
  store.append({ type: "waiting_human", source: "StopFailure", payload: { session: "sess_one", cause: "auth", worktree: "wt_one" } });
  const orca = fakeOrca({ terminals: { wt_one: [{ handle: "term_one", agentIdentity: "claude" }] } });
  await authRecover(store, orca, { send: true });
  const again = await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1);
  assert.equal(again.rows[0]?.verdict, "already");
  assert.match(again.rows[0]?.why ?? "", /claude --continue/);
});

test("246: a lost response is replayed only under Orca's request id; when request-show cannot say, it is recorded and not sent again", async () => {
  const replayed = world();
  replayed.dead("ctx_a", "task_a", "auth");
  const a = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], lost: "completed" });
  const r1 = await authRecover(replayed.store, a, { send: true });
  assert.deepEqual(
    a.calls.filter((c) => !c.startsWith("workerShow")),
    ["terminalSend term_a", "requestShow req_1", "terminalSend term_a retry req_1"],
  );
  assert.equal(r1.rows[0]?.verdict, "sent");

  const unknown = world();
  unknown.dead("ctx_a", "task_a", "auth");
  const b = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], lost: "absent" });
  const r2 = await authRecover(unknown.store, b, { send: true });
  assert.equal(r2.rows[0]?.verdict, "undetermined");
  assert.equal(unknown.store.events({ type: "owner_action" }).length, 1, "it may have arrived, so the stop counts as sent");
  await authRecover(unknown.store, b, { send: true });
  assert.equal(b.calls.filter((c) => c.startsWith("terminalSend")).length, 1);
});

test("246: a completed request whose replay answers a refusal before writing is failed, not recorded, and tried again next run", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], lost: "completed", replayRefused: "terminal_handle_stale" });
  const r = await authRecover(store, orca, { send: true });
  assert.equal(r.rows[0]?.verdict, "failed");
  assert.equal(store.events({ type: "owner_action" }).length, 0);
  const again = await authRecover(store, orca, { send: true });
  assert.equal(again.rows[0]?.verdict, "sent", "the stop was not counted as sent, so the next run sends");
  assert.equal(orca.sent.length, 1);
});

test("246: a pending request's refused replay, or invalid_argument on a replay, may follow a typed line: recorded, never sent again", async () => {
  for (const [lost, code] of [
    ["pending", "agent_prompt_blocked"],
    ["completed", "invalid_argument"],
  ] as const) {
    const { store, dead } = world();
    dead("ctx_a", "task_a", "auth");
    const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], lost, replayRefused: code });
    const r = await authRecover(store, orca, { send: true });
    assert.equal(r.rows[0]?.verdict, "undetermined", `${lost} ${code}`);
    await authRecover(store, orca, { send: true });
    assert.equal(orca.calls.filter((c) => c.startsWith("terminalSend")).length, 2, `${lost} ${code}: the send and its one replay, nothing on the next run`);
  }
});

test("246: a cut-short terminal list is unread, even when the rows it shows hold one agent terminal", async () => {
  const { store } = world();
  store.append({ type: "waiting_human", source: "StopFailure", payload: { session: "sess_one", cause: "auth", worktree: "wt_one" } });
  const orca = fakeOrca({ terminals: { wt_one: [{ handle: "term_one", agentIdentity: "claude" }] }, listTruncated: true });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(
    r.rows.map((x) => [x.verdict, x.unread]),
    [["skip", true]],
  );
  assert.equal(orca.sent.length, 0);
});

test("246: a Dispatch's auth wait followed by a finished turn is not picked, before the monitor releases it", async () => {
  const { store, dead, idle } = world();
  dead("ctx_a", "task_a", "auth");
  store.append({ type: "waiting_human", source: "orca-monitor", entity: "task", entity_id: "task_a", payload: { dispatch: "ctx_a", cause: "auth" } });
  idle("task_a");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(r.rows, []);
  assert.equal(orca.sent.length, 0);
});

test("246: a send that failed after it may have typed the line is recorded, and the next run sends nothing", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], submitTimeout: true });
  const r = await authRecover(store, orca, { send: true });
  assert.equal(r.rows[0]?.verdict, "undetermined");
  await authRecover(store, orca, { send: true });
  assert.equal(orca.calls.filter((c) => c.startsWith("terminalSend")).length, 1);
  const cli = await recover({ send: true }, orca as unknown as OrcaAdapter, ["auth"], () => store);
  assert.ok("lines" in cli);
  assert.equal(cli.code, 0, "a later run that only reports 이미 보냄 is not a failure");
});

test("246: a prompt Orca would not type over an open menu is retried on the next run", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")], blocked: true });
  const r = await authRecover(store, orca, { send: true });
  assert.equal(r.rows[0]?.verdict, "failed");
  assert.equal(store.events({ type: "owner_action" }).length, 0);
  await authRecover(store, orca, { send: true });
  assert.equal(orca.sent.length, 1);
});

test("246: a cut-short worktree ps is unread, not a missing worktree", async () => {
  const { store } = world();
  store.append({ type: "waiting_human", source: "StopFailure", payload: { session: "sess_one", cause: "auth", worktree: "wt_one" } });
  const orca = fakeOrca({ terminals: { wt_one: [{ handle: "term_one", agentIdentity: "claude" }] }, truncated: true });
  const r = await authRecover(store, orca, { send: true });
  assert.deepEqual(
    r.rows.map((x) => [x.verdict, x.unread]),
    [["skip", true]],
  );
  assert.equal(orca.sent.length, 0);
});

test("246: --db names an existing store; a missing path is refused, not created", async () => {
  const r = await recover({ db: "/nonexistent/sangsoe-246.db" }, fakeOrca() as unknown as OrcaAdapter, ["auth"]);
  assert.ok("ok" in r && !r.ok && r.refusal.code === "invalid_input");
});

test("246: an Orca read failure exits 1", async () => {
  const { store, dead } = world();
  dead("ctx_gone", "task_a", "auth");
  const r = await recover({}, fakeOrca() as unknown as OrcaAdapter, ["auth"], () => store);
  assert.ok("lines" in r);
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /worker-show 실패/);
});

test("246: sangsoe recover auth is a dry run unless --send, and prints the sign-in step first", async () => {
  const { store, dead } = world();
  dead("ctx_a", "task_a", "auth");
  const orca = fakeOrca({ workers: [worker("ctx_a", "task_a", "term_a")] });
  const dry = await recover({}, orca as unknown as OrcaAdapter, ["auth"], () => store);
  assert.ok("lines" in dry && dry.code === 0);
  assert.match(dry.lines[0] ?? "", /\/login/);
  assert.match(dry.lines.join("\n"), /ctx_a.*term_a.*보낼 것/);
  assert.equal(orca.sent.length, 0);
  const real = await recover({ send: true }, orca as unknown as OrcaAdapter, ["auth"], () => store);
  assert.ok("lines" in real && real.code === 0);
  assert.equal(orca.sent.length, 1);
  const bad = await recover({ send: true }, orca as unknown as OrcaAdapter, [], () => store);
  assert.ok("ok" in bad && !bad.ok, "--send without auth is refused");
});

// Decision 136 stays: only the owner's CLI reaches Orca's terminal send, never the plugin, the MCP
// server, a monitor round or a timer.
test("246: terminalSend is called only from core/recover", () => {
  const ROOT = new URL("../..", import.meta.url).pathname;
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      if (n === "node_modules" || n === ".git" || n === "dist") return [];
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const code = ["core", "cli", "orca-plugin", "claude-plugin"]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => /\.(ts|js|sh|py)$/.test(f) && !/\.test\.ts$/.test(f));
  const callers = code.filter((f) => /\bterminalSend\b|terminal["', ]+send\b/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(callers.sort(), ["core/contract/orca.ts", "core/orca/adapter.ts", "core/orca/commands.ts", "core/recover/auth.ts"]);
  const entrances = code.filter((f) => /\bauthRecover\b|recover\/auth\.ts/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(entrances.sort(), ["cli/commands/recover.ts", "core/index.ts", "core/recover/auth.ts"], "only the owner's CLI calls authRecover");
});
