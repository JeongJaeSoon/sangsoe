import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { buildArgs, createOrcaAdapter, parseEnvelope, recoverWrite } from "./adapter.ts";
import { ORCA_COMMANDS } from "./commands.ts";

// design.html §2 "첫째 칸" table, the commands the core calls. Not here: rows marked 쓰지 않음, and the
// verbs sessions run themselves from their own text (decision 193: `run-create`, `run-use`, `ask`,
// `reply`, `worker-release`, `worktree set`, `reference list`, `search`, and the consuming mail read;
// scripts read mail with `inbox`, decision 60).
const DESIGN_TABLE = [
  "orchestration task-create",
  "orchestration task-list",
  "orchestration task-update",
  "orchestration run-current",
  "orchestration run-show",
  // Decision 207: worker-list is scoped to the bound Run, so finding one's own Dispatch walks the Runs.
  "orchestration run-list",
  "orchestration gate-create",
  "orchestration gate-resolve",
  "orchestration gate-list",
  "orchestration send",
  "orchestration inbox",
  "orchestration worker-start",
  "orchestration worker-show",
  "orchestration worker-list",
  "orchestration dispatch-show",
  "worktree ps",
  "worktree list",
  "worktree rm",
  // Decision 202: start_unit makes the worktree first so its local settings exist before the session,
  // records the setup shell (and whether a setup script may run in it), and closes only that shell.
  "worktree create",
  "terminal list",
  "terminal close",
  "repo show",
  "reference add",
  "reference find",
  "ports",
  "diagnostics memory",
  "plugin inspect",
  // The table's `plugin enable` is `sangsoe plugin approve`'s alone (decision 77, test/approve-only.test.ts).
  // Start checks (decisions 60, 63, 88, 90).
  "status",
  "agent hooks status",
  "agent-context",
  "host list",
  "plugin list",
  "orchestration request-show",
];

test("every command in the design's first-slot table has a wrapper", () => {
  const wrapped = new Set(Object.values(ORCA_COMMANDS).map((s) => s.path.join(" ")));
  for (const c of DESIGN_TABLE) assert.ok(wrapped.has(c), `no wrapper for orca ${c}`);
  assert.equal(wrapped.size, DESIGN_TABLE.length, "a wrapper the design table does not name");
});

test("every write that Orca can replay carries --retry-request in its flag list", () => {
  for (const [name, spec] of Object.entries(ORCA_COMMANDS)) {
    if ("write" in spec) assert.ok((spec.flags as readonly string[]).includes("retry-request"), name);
  }
});

test("buildArgs refuses a flag the table does not list", () => {
  assert.throws(() => buildArgs("worktreeRm", { flags: { force: true } }), /--force is not in ORCA_COMMANDS/);
  assert.deepEqual(buildArgs("taskList", { flags: { run: "run_1", ready: false } }), [
    "orchestration",
    "task-list",
    "--run",
    "run_1",
    "--json",
  ]);
});

test("worktree rm always runs the archive hook and deletes the branch, never forces", async () => {
  const fake = createFakeOrca();
  await createOrcaAdapter(fake.exec).worktreeRm({ worktree: "id:wt-1" });
  assert.deepEqual(fake.calls[0], [
    "orca",
    "worktree",
    "rm",
    "--worktree",
    "id:wt-1",
    "--run-hooks",
    "--delete-branch",
    "--json",
  ]);
});

test("parseEnvelope reads ok, error and bare documents", () => {
  assert.deepEqual(parseEnvelope({ code: 0, stdout: '{"ok":true,"result":{"a":1}}', stderr: "" }, false), {
    ok: true,
    value: { a: 1 },
  });
  assert.deepEqual(
    parseEnvelope({ code: 1, stdout: '{"ok":false,"error":{"code":"run_required","message":"m"}}', stderr: "" }, false),
    { ok: false, error: { code: "run_required", message: "m" } },
  );
  assert.deepEqual(parseEnvelope({ code: 0, stdout: '{"schemaVersion":1,"commands":[]}', stderr: "" }, false), {
    ok: true,
    value: { schemaVersion: 1, commands: [] },
  });
  const exit3 = parseEnvelope({ code: 3, stdout: '{"ok":true,"result":{"state":"approval_required"}}', stderr: "" }, false);
  assert.equal(exit3.ok, false);
  assert.equal(!exit3.ok && exit3.error.code, "exit_3");
});

test("a lost response is response_lost and keeps any request id a write reported", () => {
  const lost = parseEnvelope({ code: null, stdout: "", stderr: "retry with --retry-request req_42", failure: "timeout" }, true);
  assert.deepEqual(lost.ok ? null : [lost.error.code, lost.requestId], ["response_lost", "req_42"]);
  const nested = parseEnvelope({ code: 0, stdout: '{"ok":true,"result":{"receipt":{"requestId":"req_7"}}}', stderr: "" }, true);
  assert.equal(nested.requestId, "req_7");
  const read = parseEnvelope({ code: 0, stdout: '{"ok":true,"result":{"requestId":"req_8"}}', stderr: "" }, false);
  assert.equal(read.requestId, undefined, "reads do not carry request ids");
});

test("recoverWrite replays only after request-show, and never on absent", async () => {
  const absent = createFakeOrca();
  const orca = createOrcaAdapter(absent.exec);
  const r = await recoverWrite(orca, "req_000000000001", (o) => orca.send({ to: "run:r", subject: "s" }, o));
  assert.equal(!r.ok && r.error.code, "request_absent");
  assert.deepEqual(
    absent.calls.map((c) => c.slice(1, 3).join(" ")),
    ["orchestration request-show"],
  );

  const done = createFakeOrca({
    replies: { "orchestration-request-show": { ok: true, result: { requestId: "req_9", state: "completed" } } },
  });
  const orca2 = createOrcaAdapter(done.exec);
  const replayed = await recoverWrite(orca2, "req_9", (o) => orca2.send({ to: "run:r", subject: "s" }, o));
  assert.equal(replayed.ok, true);
  const send = done.calls[1] ?? [];
  assert.equal(send[2], "send");
  assert.equal(send[send.indexOf("--retry-request") + 1], "req_9");
});

test("task-list --full rows (Orca's stored names) read as the plain list's title, dispatchId and assignee", async () => {
  // Shape read from a live `orca orchestration task-list --full --json`, 2026-11-11.
  const full = createFakeOrca({
    replies: {
      "orchestration-task-list": {
        ok: true,
        result: {
          tasks: [
            { id: "task_1", run_id: "run_1", task_title: "d001", status: "ready", result: null, dispatch_id: "ctx_1", assignee_handle: "term_1" },
            { id: "task_2", run_id: "run_1", task_title: "plain", status: "pending", result: null },
          ],
        },
      },
    },
  });
  const r = await createOrcaAdapter(full.exec).taskList({ run: "run_1", full: true });
  assert.ok(r.ok);
  assert.deepEqual(
    r.value.map((t) => [t.id, t.title, t.dispatchId, t.assignee]),
    [["task_1", "d001", "ctx_1", "term_1"], ["task_2", "plain", undefined, undefined]],
  );
});

test("recoverWrite does not replay on a state it does not know", async () => {
  const odd = createFakeOrca({ replies: { "orchestration-request-show": { ok: true, result: {} } } });
  const orca = createOrcaAdapter(odd.exec);
  const r = await recoverWrite(orca, "req_9", (o) => orca.send({ to: "run:r", subject: "s" }, o));
  assert.equal(!r.ok && r.error.code, "unexpected_shape");
  assert.equal(odd.calls.length, 1, "only request-show ran");
});

test("a positional value starting with a dash is refused before Orca runs", async () => {
  const fake = createFakeOrca();
  const r = await createOrcaAdapter(fake.exec).referenceFind({ query: "--include-archived" });
  assert.equal(!r.ok && r.error.code, "invalid_argument");
  assert.equal(fake.calls.length, 0);
});

test("worker-list keeps the cursor of the next page", async () => {
  const r = await createOrcaAdapter(createFakeOrca().exec).workerList({});
  assert.ok(r.ok);
  assert.equal(r.value.nextCursor, "cursor-0002");
  assert.equal(r.value.truncated, true);
});

test("a host-row read without its row array is unexpected_shape, not zero rows", async () => {
  const fake = createFakeOrca({ replies: { "worktree-list": { ok: true, result: { hostScope: {} } } } });
  const r = await createOrcaAdapter(fake.exec).worktreeList({});
  assert.equal(!r.ok && r.error.code, "unexpected_shape");
});

test("malformed rows and fields stay inside OrcaResult", async () => {
  const fake = createFakeOrca({
    replies: {
      "orchestration-task-list": { ok: true, result: { tasks: {} } },
      "worktree-list": { ok: true, result: { worktrees: [null] } },
      status: { ok: true, result: { runtime: { reachable: true } } },
    },
  });
  const orca = createOrcaAdapter(fake.exec);
  for (const r of [await orca.taskList({ run: "run_1" }), await orca.worktreeList({}), await orca.status()]) {
    assert.equal(!r.ok && r.error.code, "unexpected_shape");
  }
});

test("rows missing the fields callers read are unexpected_shape", async () => {
  const fake = createFakeOrca({
    replies: {
      "agent-context": { commands: [{}] },
      "plugin-list": { ok: true, result: { plugins: [{}] } },
      "orchestration-worker-list": { ok: true, result: { workers: [{ host: "local" }] } },
      status: { ok: true, result: { runtime: { capabilities: [1] } } },
    },
  });
  const orca = createOrcaAdapter(fake.exec);
  for (const r of [await orca.agentContext(), await orca.pluginList(), await orca.workerList({}), await orca.status()]) {
    assert.equal(!r.ok && r.error.code, "unexpected_shape");
  }
});

test("first writes never mint a request id", async () => {
  const fake = createFakeOrca();
  await createOrcaAdapter(fake.exec).taskCreate({ spec: "do it", deps: ["task_1"] });
  assert.ok(!(fake.calls[0] ?? []).includes("--retry-request"));
  assert.ok((fake.calls[0] ?? []).includes('["task_1"]'), "deps go as a JSON array");
});

test("reads unwrap the recorded result", async () => {
  const orca = createOrcaAdapter(createFakeOrca().exec);
  const tasks = await orca.taskList({ run: "run_000000000001" });
  assert.deepEqual(tasks.ok && tasks.value.map((t) => t.status), ["dispatched", "completed", "pending"]);
  const inbox = await orca.inbox({ limit: 3 });
  assert.equal(inbox.ok && inbox.value.length, 3);
  const dispatch = await orca.dispatchShow({ task: "task_000000000001" });
  assert.equal(dispatch.ok && dispatch.value.depth, 1);
  const hooks = await orca.agentHooksStatus();
  assert.equal(hooks.ok && hooks.value.enabled, true);
});

test("inbox maps the --full record: read becomes handled, the handles from and to, payload ids parsed", async () => {
  const inbox = await createOrcaAdapter(createFakeOrca().exec).inbox({ limit: 3 });
  assert.ok(inbox.ok);
  const [status, done, stop] = inbox.value;
  assert.equal(status?.handled, false, "read 0 is unhandled, so wake_unconfirmed can fire");
  assert.equal(done?.handled, true);
  assert.equal(done?.from, "term_00000000-0000-4000-8000-000000000001");
  assert.equal(done?.to, "run:run_000000000001");
  assert.deepEqual(done?.payload, { taskId: "task_000000000001", dispatchId: "ctx_000000000001" }, "the outcome stays in Orca");
  assert.equal(stop?.payload?.stopReason, "errored");
  assert.equal(status?.payload, undefined);
  assert.equal(status?.createdAt, "2026-11-14T08:00:00Z", "created_at tells how long mail sat unread (decision 245)");
  assert.equal(stop?.createdAt, undefined, "a row without created_at has no age");
});

test("gate-list reads options from the JSON text Orca returns; anything else leaves them unknown", async () => {
  const gate = (options: unknown) => ({ id: "gate_1", taskId: "task_1", status: "pending", question: "q", options });
  const fake = createFakeOrca({
    replies: {
      "orchestration-gate-list": {
        ok: true,
        result: { runId: "run_1", gates: [gate('["exponential x3","none"]'), gate("[]"), gate("not json"), gate("[1]"), gate(null)] },
      },
    },
  });
  const r = await createOrcaAdapter(fake.exec).gateList({ run: "run_1" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(
    r.value.map((g) => g.options),
    [["exponential x3", "none"], [], undefined, undefined, undefined],
  );
});

test("a result without the expected field is unexpected_shape, not undefined rows", async () => {
  const fake = createFakeOrca({ replies: { "orchestration-task-list": { ok: true, result: {} } } });
  const r = await createOrcaAdapter(fake.exec).taskList({ run: "run_1" });
  assert.equal(!r.ok && r.error.code, "unexpected_shape");
});

test("ports reads one worktree's listeners, and only from the local host", async () => {
  const fake = createFakeOrca();
  const wt = "repo-0001::/home/dev/workspaces/api/feature-a";
  const r = await createOrcaAdapter(fake.exec).ports({ worktree: `id:${wt}` });
  assert.deepEqual(fake.calls[0], ["orca", "ports", "--worktree", `id:${wt}`, "--json"]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(
    r.value.map((p) => [p.port, p.owner?.worktreeId]),
    [[5173, wt]],
  );

  const remote = createFakeOrca({ replies: { ports: { ok: true, result: { executionHostId: "ssh-1", ports: [] } } } });
  const far = await createOrcaAdapter(remote.exec).ports({ worktree: "id:x" });
  assert.equal(!far.ok && far.error.code, "non_local_host", "decision 88: a remote host's listeners are not this PC's");

  const unnamed = createFakeOrca({ replies: { ports: { ok: true, result: { ports: [] } } } });
  const unknown = await createOrcaAdapter(unnamed.exec).ports({ worktree: "id:x" });
  assert.equal(!unknown.ok && unknown.error.code, "non_local_host", "decision 88: a missing host is not local");

  for (const row of [{ port: 1 }, { id: "a", port: "5173" }]) {
    const bad = createFakeOrca({ replies: { ports: { ok: true, result: { executionHostId: "local", ports: [row] } } } });
    const shape = await createOrcaAdapter(bad.exec).ports({ worktree: "id:x" });
    assert.equal(!shape.ok && shape.error.code, "unexpected_shape", JSON.stringify(row));
  }
});

test("worker-start passes --keep-open bare and --repo with its selector", async () => {
  const fake = createFakeOrca();
  const orca = createOrcaAdapter(fake.exec);
  await orca.workerStart({ task: "task_1", agent: "claude", worktree: "new-child", keepOpen: true, repo: "id:repo-2" });
  assert.deepEqual(fake.calls[0], [
    "orca",
    "orchestration",
    "worker-start",
    "--task",
    "task_1",
    "--agent",
    "claude",
    "--worktree",
    "new-child",
    "--keep-open",
    "--repo",
    "id:repo-2",
    "--json",
  ]);
  await orca.workerStart({ task: "task_1", agent: "claude", worktree: "new-child", keepOpen: false });
  assert.ok(!(fake.calls[1] ?? []).includes("--keep-open"), "keepOpen false sends nothing");
});

test("the rows no caller used are gone from the table", () => {
  const gone = ["runCreate", "runUse", "ask", "reply", "workerRelease", "worktreeSet", "referenceList", "search", "terminalWaitIdle"];
  for (const name of gone) assert.equal(name in ORCA_COMMANDS, false, name);
});
