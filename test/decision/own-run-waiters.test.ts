import assert from "node:assert/strict";
import { test } from "node:test";
import { answerNotifiedKey, deliverOwnRun, mootNotifiedKey } from "../../core/index.ts";
import { createWorld, ownerSays, type World } from "./world.ts";

// Decision 274: what the Run's own hook does for one waiter of a closed decision, over every kind of
// waiter. The table below is written out by hand, not derived from the code's `owed`: a cell the hook
// gets wrong, or a kind it forgets, fails here.

const RUN = "run_000000000001";
const OTHER = "run_000000000002";
const ORCH = "run_000000000009";
const T = "task_000000000001";
const GATE = "gate_000000000001";
const DISPATCH = "ctx_000000000001";
const D = "d001";
const NOW = "2026-11-15T12:00:00Z";
const COUNTS = `sangsoe: Run ${RUN} — 🟢 준비됨 0 · 📅 기한 0 · ⚠️ trigger 불명 0 (새로 0건). 목록은 resource ready 와 brief 로 읽는다.`;

type TaskState = "waiting" | "running" | "closed" | "elsewhere";
/** The waiter's gate: none recorded (it joined while its worker ran), still open, or resolved before this prompt. */
type GateState = "none" | "open" | "resolved";
type Cell = { task: TaskState; gate: GateState; carrier: boolean; told: boolean };
type Reason = "answered" | "moot";
type Due = readonly [resolve: boolean, tell: "worker" | "run" | null];

/** Per kind of waiter: is its open gate resolved, and who is told once. `elsewhere`: the Task is another Run's. */
const OWED: Record<TaskState, Partial<Record<GateState, Due>> & { carrierGate: boolean }> = {
  // No worker yet: the answer rides in its first prompt (91④(i)), so nobody is told now.
  waiting: { open: [true, null], resolved: [false, null], none: [false, null], carrierGate: true },
  // Orca refuses a gate on a running Task and an open gate keeps its Task from starting, so a running
  // Task has no open gate. One whose gate was resolved before its worker started is told by mail,
  // unless that worker's first prompt carried the answer and wrote the key first (the "+told" cells).
  running: { resolved: [false, "worker"], none: [false, "worker"], carrierGate: false },
  // A closed Task's gate stays open on purpose and its Run is told (91④(ii)). A gate resolved while
  // the Task was live was the delivery: the Run is not told again when the Task closes later.
  closed: { open: [false, "run"], resolved: [false, null], none: [false, "run"], carrierGate: false },
  elsewhere: { open: [false, null], resolved: [false, null], none: [false, null], carrierGate: false },
};
/** A carrier is told nothing; only its open gate on a live Task is resolved. */
const expected = (c: Cell): Due => {
  if (c.carrier) return [c.gate === "open" && OWED[c.task].carrierGate, null];
  const [resolve, tell] = OWED[c.task][c.gate] as Due;
  return [resolve, c.told ? null : tell];
};

const CELLS: Cell[] = (["waiting", "running", "closed", "elsewhere"] as const).flatMap((task) =>
  (["open", "resolved", "none"] as const)
    .filter((gate) => OWED[task][gate] !== undefined)
    .flatMap((gate) => [false, true].flatMap((carrier) => [false, true].map((told) => ({ task, gate, carrier, told })))),
);
const name = (c: Cell) => `${c.task}${c.gate === "none" ? "" : ` +gate ${c.gate}`}${c.carrier ? " +carrier" : ""}${c.told ? " +told" : ""}`;
const keyOf = (reason: Reason) => (reason === "moot" ? mootNotifiedKey(D, T) : answerNotifiedKey(D, T)).dedupe_key;

function world(c: Cell, reason: Reason): World {
  // Waiting: blocked by its open gate, else failed and startable again (a pending Task would read as ready).
  const status = { waiting: c.gate === "open" ? "blocked" : "failed", running: "dispatched", closed: "completed", elsewhere: "pending" }[c.task];
  const run = c.task === "elsewhere" ? OTHER : RUN;
  const w = createWorld([{ id: T, run, status, ...(c.task === "running" ? { dispatchId: DISPATCH } : {}) }]);
  if (c.gate !== "none") w.gates.set(GATE, { id: GATE, taskId: T, status: c.gate === "open" ? "pending" : "resolved", question: "Take it?" });
  if (c.carrier) w.store.append({ type: "item_extra_set", source: "test", payload: { task: T, exec_by: "owner" } });
  w.store.append({ type: "decision_opened", source: "decision_open", dedupe_key: "decision:k1", payload: { decision: D, decision_key: "k1" } });
  w.store.append({ type: "decision_joined", source: "decision_open", dedupe_key: `decision_joined:${D}:${T}`, payload: { decision: D, waiter: T, run, ...(c.gate !== "none" ? { gate: GATE } : {}) } });
  if (reason === "answered") {
    const said = ownerSays(w.store, `${D} yes`);
    w.store.append({ type: "decision_answered", source: "decision_answer", dedupe_key: `decision_answered:${D}`, payload: { decision: D, owner_action: said, answer: "yes", linked_by: "button" } });
    w.store.append({ type: "decision_closed", source: "decision_answer", dedupe_key: `decision_closed:${D}`, payload: { decision: D, reason: "answered" } });
  } else {
    w.store.append({ type: "decision_closed", source: "decision_moot", dedupe_key: `decision_closed:${D}`, payload: { decision: D, reason: "moot", evidence: "pr_closed:acme/api#4" } });
  }
  if (c.told) w.store.append({ type: "notified", source: "test", target: T, dedupe_key: keyOf(reason), payload: { msg_id: "msg_before", to: "x", msg_type: "status" } });
  w.strict();
  return w;
}

/** One prompt of the Run's session: the Orca calls it made and the lines it printed. */
async function prompt(w: World) {
  const before = w.calls().length;
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  return { calls: w.calls().slice(before).map((c) => c[1]), lines: out.lines, resolved: out.resolved };
}

// A lead as Orca binds it: its own Run, and a Dispatch in the orchestrator's Run, so Orca refuses its
// mail to any other Run's mailbox, its own included (decision 197). An orchestrator holds no Dispatch.
const ROLES = {
  "a lead with a Dispatch": (w: World) => w.as({ run: RUN, dispatchRun: ORCH, terminal: true }),
  "a session with no Dispatch": (w: World) => w.as({ run: RUN, terminal: true }),
} as const;

for (const [who, as] of Object.entries(ROLES)) {
  for (const reason of ["answered", "moot"] as const) {
    test(`274: every kind of waiter of a decision closed as ${reason}, as ${who}`, async () => {
      assert.equal(CELLS.length, 44);
      for (const c of CELLS) {
        const [resolve, tell] = expected(c);
        const w = world(c, reason);
        as(w);
        const first = await prompt(w);
        const recall = resolve || tell === "worker";
        const calls = [
          "task-list",
          "gate-list",
          // The re-call's own reads, what it does, and the gate-list that reads back what it resolved.
          ...(recall ? ["task-list", ...(c.gate !== "none" ? ["gate-list"] : []), ...(resolve ? ["gate-resolve"] : []), ...(tell === "worker" ? ["send"] : []), ...(resolve ? ["gate-list"] : [])] : []),
        ];
        assert.deepEqual(first.calls, calls, `${name(c)}: Orca calls of the first prompt`);
        const said = reason === "moot" ? `${D} 무효(moot)` : `${D}: yes`;
        const line = `${COUNTS}${resolve ? ` 닫힌 결정 ${D} 의 게이트 1개를 풀었다.` : ""}${tell === "run" ? ` 닫힌 Task 가 기다리던 결정: ${said}.` : ""}`;
        assert.deepEqual(first.lines, resolve || tell === "run" ? [line] : [], `${name(c)}: the line`);
        assert.deepEqual(first.resolved, resolve ? [GATE] : [], `${name(c)}: resolved`);
        if (c.gate !== "none") assert.equal(w.gates.get(GATE)?.status, resolve || c.gate === "resolved" ? "resolved" : "pending", `${name(c)}: the gate`);
        if (resolve) assert.equal(w.gates.get(GATE)?.resolution, reason === "moot" ? `MOOT ${D}: pr_closed:acme/api#4` : `${D}: yes`);
        assert.deepEqual(w.sends.map((s) => s.to), tell === "worker" ? [`dispatch:${DISPATCH}`] : [], `${name(c)}: mail`);
        assert.deepEqual(w.store.events({ type: "notified" }).map((e) => e.dedupe_key), c.told || tell ? [keyOf(reason)] : [], `${name(c)}: notified rows`);
        for (const n of [2, 3]) {
          const later = await prompt(w);
          assert.deepEqual([later.calls, later.lines], [["task-list", "gate-list"], []], `${name(c)}: prompt ${n} makes the two reads and prints nothing`);
        }
        assert.equal(w.store.events({ type: "notified" }).length, c.told || tell ? 1 : 0, `${name(c)}: no row after the first prompt`);
      }
    });
  }

  test(`274: a closed waiter and a live one of the same decision: the Run is told in the line before the re-call, so nothing is mailed (${who})`, async () => {
    const T2 = "task_000000000002";
    const G2 = "gate_000000000002";
    const w = world({ task: "closed", gate: "open", carrier: false, told: false }, "answered");
    w.tasks.set(T2, { id: T2, run: RUN, status: "blocked" });
    w.gates.set(G2, { id: G2, taskId: T2, status: "pending", question: "Take it?" });
    w.store.append({ type: "decision_joined", source: "decision_open", dedupe_key: `decision_joined:${D}:${T2}`, payload: { decision: D, waiter: T2, run: RUN, gate: G2 } });
    as(w);
    const first = await prompt(w);
    assert.deepEqual(first.calls, ["task-list", "gate-list", "task-list", "gate-list", "gate-resolve", "gate-list"], "no send: the closed Task's Run was told by the line");
    assert.deepEqual(first.lines, [`${COUNTS} 닫힌 결정 ${D} 의 게이트 1개를 풀었다. 닫힌 Task 가 기다리던 결정: ${D}: yes.`]);
    assert.deepEqual([w.gates.get(GATE)?.status, w.gates.get(G2)?.status], ["pending", "resolved"]);
    const later = await prompt(w);
    assert.deepEqual([later.calls, later.lines], [["task-list", "gate-list"], []]);
  });

  test(`274: a worker Orca cannot reach is tried again on each prompt, with no line and no row (${who})`, async () => {
    const w = world({ task: "running", gate: "none", carrier: false, told: false }, "answered");
    w.failSendTo(`dispatch:${DISPATCH}`);
    as(w);
    for (const n of [1, 2, 3]) {
      const p = await prompt(w);
      assert.deepEqual([p.calls, p.lines], [["task-list", "gate-list", "task-list", "send"], []], `prompt ${n}`);
    }
    assert.equal(w.store.events({ type: "notified" }).length, 0);
    w.failSendTo(null);
    assert.deepEqual((await prompt(w)).calls, ["task-list", "gate-list", "task-list", "send"]);
    assert.deepEqual((await prompt(w)).calls, ["task-list", "gate-list"], "told once it went through");
  });
}
