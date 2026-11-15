import assert from "node:assert/strict";
import { test } from "node:test";
import { deliverOwnRun, type OrcaAdapter, Store } from "../../core/index.ts";

// Decision 275: pr-monitor's round runs in the plugin's process, and Orca takes no task-update from
// it. The session that holds the Run makes the merge close from its prompt hook, with the same
// function, and leaves a Task alone while a live Dispatch holds it. The round's side of the same
// function is in core/detect/pr/round.test.ts ("275").

const RUN = "run_000000000001";
const OTHER = "run_000000000002";
const T = "task_000000000001";
const DISPATCH = "ctx_000000000001";
const REF = "acme/api#7";
const SHA = "1".repeat(40);
const NOW = "2026-11-15T12:00:00Z";
const COUNTS = `sangsoe: Run ${RUN} — 🟢 준비됨 0 · 📅 기한 0 · ⚠️ trigger 불명 0 (새로 0건). 목록은 resource ready 와 brief 로 읽는다.`;

type Row = { id: string; run: string; status: string; title: string; dispatchId?: string; result?: string };

function world(row: Omit<Row, "id" | "title">) {
  const store = Store.open({ path: ":memory:" });
  const tasks: Row[] = [{ id: T, title: "t", ...row }];
  const calls: string[] = [];
  const liveness = new Map<string, string>();
  const orca = {
    taskList: async ({ run }: { run: string }) => {
      calls.push("task-list");
      return { ok: true, value: tasks.filter((t) => t.run === run) };
    },
    gateList: async () => {
      calls.push("gate-list");
      return { ok: true, value: [] };
    },
    workerShow: async ({ dispatch }: { dispatch: string }) => {
      calls.push("worker-show");
      const l = liveness.get(dispatch);
      return l ? { ok: true, value: { dispatchId: dispatch, taskId: T, runId: RUN, state: "running", liveness: l } } : { ok: false, error: { code: "not_found", message: "" } };
    },
    taskUpdate: async (a: { id: string; status: string; result?: string }) => {
      calls.push(`task-update ${a.id} ${a.status}`);
      const t = tasks.find((x) => x.id === a.id);
      if (t) Object.assign(t, { status: a.status, result: a.result });
      return { ok: true, value: {} };
    },
  } as unknown as OrcaAdapter;
  store.append({ type: "item_created", source: "item_create", payload: { task: T, alias: "i007", who: "worker", done_when: "PR merged", owner_action: 1, run: row.run } });
  store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: REF, task: T } });
  store.append({ type: "pr_merged", source: "pr-monitor", payload: { pr: REF, merge_sha: SHA } });
  const prompt = async () => {
    const before = calls.length;
    const out = await deliverOwnRun({ store, orca }, RUN, NOW);
    assert.ok("run" in out, JSON.stringify(out));
    return { calls: calls.slice(before), lines: out.lines };
  };
  return { store, tasks, liveness, prompt };
}

test("275: the session that holds the Run closes its Task whose PR merged, says so once, and reads the rows again", async () => {
  const w = world({ run: RUN, status: "blocked" });
  const first = await w.prompt();
  assert.deepEqual(first.calls, ["task-list", `task-update ${T} completed`, "task-list", "gate-list"]);
  assert.deepEqual(first.lines, [`${COUNTS} 머지된 PR 의 Task 를 닫았다: ${REF}.`]);
  assert.deepEqual([w.tasks[0]?.status, w.tasks[0]?.result], ["completed", `merged ${REF} as ${SHA}`]);
  const moved = w.store.events({ type: "item_transition" });
  assert.deepEqual(moved.map((e) => [e.source, e.payload.task, e.payload.from, e.payload.to, e.payload.reason]), [["UserPromptSubmit", T, "blocked", "done", `pr_merged ${REF}`]]);

  const later = await w.prompt();
  assert.deepEqual([later.calls, later.lines], [["task-list", "gate-list"], []], "a closed Task costs no call and prints nothing");
  assert.equal(w.store.events({ type: "item_transition" }).length, 1);
});

test("275: a Task a live Dispatch holds is left open; it is closed on the first prompt after Orca says that Dispatch's terminal ended", async () => {
  const w = world({ run: RUN, status: "dispatched", dispatchId: DISPATCH });
  w.liveness.set(DISPATCH, "live");
  for (const n of [1, 2]) {
    const p = await w.prompt();
    assert.deepEqual([p.calls, p.lines], [["task-list", "worker-show", "gate-list"], []], `prompt ${n}: one read of the Dispatch, no write, no line`);
  }
  assert.equal(w.tasks[0]?.status, "dispatched");

  w.liveness.delete(DISPATCH);
  const unread = await w.prompt();
  assert.deepEqual([unread.calls, unread.lines], [["task-list", "worker-show", "gate-list"], []], "a Dispatch Orca does not show closes nothing");

  for (const unknown of ["unverifiable", "dead"]) {
    w.liveness.set(DISPATCH, unknown);
    const p = await w.prompt();
    assert.deepEqual([p.calls, p.lines], [["task-list", "worker-show", "gate-list"], []], `liveness ${unknown} does not say the worker ended: nothing is closed`);
  }
  assert.equal(w.tasks[0]?.status, "dispatched");

  w.liveness.set(DISPATCH, "gone");
  const ended = await w.prompt();
  assert.deepEqual(ended.calls, ["task-list", "worker-show", `task-update ${T} completed`, "task-list", "gate-list"]);
  assert.deepEqual(ended.lines, [`${COUNTS} 머지된 PR 의 Task 를 닫았다: ${REF}.`]);
});

test("275: a merged PR whose Task is another Run's is that Run's to close", async () => {
  const w = world({ run: OTHER, status: "blocked" });
  const p = await w.prompt();
  assert.deepEqual([p.calls, p.lines], [["task-list", "gate-list"], []]);
  assert.equal(w.tasks[0]?.status, "blocked");
});
