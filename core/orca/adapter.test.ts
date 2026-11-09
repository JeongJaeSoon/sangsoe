import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeOrca } from "../../test/fake-orca/index.ts";
import { buildArgs, createOrcaAdapter, parseEnvelope, recoverWrite } from "./adapter.ts";
import { ORCA_COMMANDS } from "./commands.ts";

// design.html §2 "첫째 칸" table, the command column, minus the rows marked 쓰지 않음.
// The table's consuming mail read is the sessions' own verb; scripts read mail with `inbox` (decision 60).
const DESIGN_TABLE = [
  "orchestration task-create",
  "orchestration task-list",
  "orchestration task-update",
  "orchestration run-create",
  "orchestration run-use",
  "orchestration run-current",
  "orchestration run-show",
  "orchestration gate-create",
  "orchestration gate-resolve",
  "orchestration gate-list",
  "orchestration send",
  "orchestration ask",
  "orchestration reply",
  "orchestration inbox",
  "orchestration worker-start",
  "orchestration worker-show",
  "orchestration worker-list",
  "orchestration dispatch-show",
  "orchestration worker-release",
  "worktree set",
  "worktree ps",
  "worktree list",
  "worktree rm",
  "reference add",
  "reference list",
  "reference find",
  "search",
  "terminal wait",
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
  const inbox = await orca.inbox({ limit: 2 });
  assert.equal(inbox.ok && inbox.value.length, 2);
  const dispatch = await orca.dispatchShow({ task: "task_000000000001" });
  assert.equal(dispatch.ok && dispatch.value.depth, 1);
  const hooks = await orca.agentHooksStatus();
  assert.equal(hooks.ok && hooks.value.enabled, true);
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
