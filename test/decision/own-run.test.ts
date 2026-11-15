import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACTED_LABEL,
  ANSWER_PENDING_LABEL,
  answerNotifiedKey,
  DEFAULT_MONITOR_CONFIG,
  decisionAnswer,
  decisionMoot,
  decisionOpen,
  dedupeKey,
  deliverOwnRun,
  EVENTS,
  type MonitorDeps,
  noSender,
  nullChatProvider,
  panelCore,
  QUEUE_CALLER,
  recordHook,
  runMonitor,
  VERSION,
} from "../../core/index.ts";
import { createWorld, ownerSays, TIMER, type World } from "./world.ts";

// Decision 274, from the P3 smoke on Orca 1.4.259: the panel's worker has no terminal, Orca takes no
// message from it, and the gate of a decision answered there stayed pending. The session holding the
// gate's Run now delivers from its own hook.

const RUN = "run_000000000001";
const T1 = "task_000000000001";
const T2 = "task_000000000002";
const NOW = "2026-11-15T12:00:00Z";

async function opened(w: World): Promise<string> {
  w.as({ run: RUN, terminal: true });
  const r = await decisionOpen(w, { subject: "item:i012", options: ["yes", "no"], question: "Take it?", waiters: [{ task: T1, run: RUN }], callerRun: RUN });
  assert.ok(r.ok && r.value.status === "opened", JSON.stringify(r));
  return r.value.decision;
}

const item = (w: World, task: string, extra: Record<string, unknown> = {}, run = RUN) => {
  const said = ownerSays(w.store, `make ${task}`);
  w.store.append({
    type: "item_created",
    source: "core:item",
    entity: "task",
    entity_id: task,
    payload: { task, run, alias: `i${task.slice(-3)}`, who: "worker", done_when: "the check passes", owner_action: said },
  });
  if (Object.keys(extra).length > 0) w.store.append({ type: "item_extra_set", source: "test", payload: { task, ...extra } });
};

test("274: an answer from a process with no terminal is recorded, asks Orca to send once, and leaves the gate to its Run", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  w.strict();
  w.as(TIMER);
  const said = ownerSays(w.store, `${d} yes`);
  const r = await decisionAnswer(w, { decision: d, answer: "yes", ownerAction: said, linkedBy: "button", callerRun: "" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value, { status: "answered", decision: d, resolved: [], notified: [], handedOff: [], pending: [T1] });
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending");
  assert.deepEqual(w.sends, []);
  assert.equal(w.store.events({ type: "notified" }).length, 0);
  assert.equal(w.calls("orchestration send").length, 1);
  assert.equal(noSender(w.orca), true);

  // The queue round's re-answer of the same decision no longer reaches Orca at all.
  const again = await decisionAnswer(w, { decision: d, answer: "yes", ownerAction: said, linkedBy: "button", callerRun: "" });
  assert.ok(again.ok && again.value.pending.length === 1);
  assert.equal(w.calls("orchestration send").length, 1, "the refusal is remembered for the life of the process");
});

test("274: the Run's own session resolves the gate of a decision answered in the panel, and says so in one line", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  w.strict();
  w.as(TIMER);
  const said = ownerSays(w.store, `${d} yes`);
  await decisionAnswer(w, { decision: d, answer: "yes", ownerAction: said, linkedBy: "button", callerRun: "" });

  // Another process: the session that holds the Run, with a terminal and its own adapter.
  w.as({ run: RUN, terminal: true });
  assert.equal(noSender(w.orca), false);
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.resolved, ["gate_000000000001"]);
  assert.equal(w.gates.get("gate_000000000001")?.status, "resolved");
  assert.equal(w.gates.get("gate_000000000001")?.resolution, `${d}: yes`);
  assert.equal(out.lines.length, 1);
  assert.match(out.lines[0] ?? "", new RegExp(`닫힌 결정 ${d} 의 게이트 1개를 풀었다`));

  const quiet = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in quiet);
  assert.deepEqual([quiet.resolved, quiet.lines], [[], []], "nothing new: no line and no second resolve");
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
});

test("284: the item a resolved gate was holding is counted in the same line, not one prompt later", async () => {
  // The 0.1.10 release smoke: the line said 준비됨 1 while the item the gate freed was ready too; it came at the next prompt.
  const w = createWorld([
    { id: T1, run: RUN, status: "pending" },
    { id: T2, run: RUN, status: "pending" },
  ]);
  item(w, T1);
  item(w, T2);
  const d = await opened(w);
  w.strict();
  w.as(TIMER);
  await decisionAnswer(w, { decision: d, answer: "yes", ownerAction: ownerSays(w.store, `${d} yes`), linkedBy: "button", callerRun: "" });

  w.as({ run: RUN, terminal: true });
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.lines, [`sangsoe: Run ${RUN} — 🟢 준비됨 2 · 📅 기한 0 · ⚠️ trigger 불명 0 (새로 2건). 목록은 resource ready 와 brief 로 읽는다. 닫힌 결정 ${d} 의 게이트 1개를 풀었다.`]);
  const again = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in again);
  assert.deepEqual(again.lines, [], "nothing is left for the next prompt");
});

test("274: ready, due and unclear items of the Run are one count line, once per transition", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "pending" },
    { id: T2, run: RUN, status: "pending" },
    { id: "task_000000000003", run: RUN, status: "pending" },
  ]);
  w.as({ run: RUN, terminal: true });
  item(w, T1);
  item(w, T2, { exec_by: "owner", trigger: "2026-01-01" });
  item(w, "task_000000000003", { trigger: "when the vendor answers" });

  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.lines, [`sangsoe: Run ${RUN} — 🟢 준비됨 1 · 📅 기한 1 · ⚠️ trigger 불명 1 (새로 3건). 목록은 resource ready 와 brief 로 읽는다.`]);
  const rows = (type: string) => w.store.events({ type }).map((e) => e.entity_id);
  assert.deepEqual([rows("item_ready"), rows("todo_due"), rows("trigger_unclear")], [[T1], [T2], ["task_000000000003"]]);
  assert.deepEqual(w.sends, [], "told in the hook's line, not by mail");

  const again = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in again);
  assert.deepEqual(again.lines, [], "the same items a second time print nothing");

  // A queue round from a process that can send finds each of them told already and mails nothing.
  w.as({ run: null, terminal: true });
  const round = await runMonitor("queue", timer(w));
  assert.ok(round.calls.includes("notifyReady i001: already"), round.calls.join("\n"));
  assert.deepEqual(round.acts, []);
  assert.deepEqual(w.sends, []);
});

test("274: an item whose predecessor sits in another Run is told ready once that Run's Task is done", async () => {
  const OTHER = "run_000000000002";
  const w = createWorld([
    { id: T1, run: RUN, status: "pending" },
    { id: T2, run: OTHER, status: "pending" },
  ]);
  w.as({ run: RUN, terminal: true });
  item(w, T1);
  item(w, T2, {}, OTHER);
  const [pred, succ] = [`item:${T2}`, `item:${T1}`];
  w.store.append({ type: "edge_added", source: "GRAPH", dedupe_key: dedupeKey(EVENTS.edge_added, pred, succ, "blocks"), payload: { pred, succ, kind: "blocks" } });

  const waiting = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in waiting, JSON.stringify(waiting));
  assert.deepEqual(waiting.lines, [], "the predecessor is open: nothing is ready");
  const read = w.calls("orchestration task-list").map((argv) => argv.find((a) => a.startsWith("run_")));
  assert.deepEqual(read, [RUN, OTHER], "its own Run, then the one Run that holds a predecessor");

  const t2 = w.tasks.get(T2);
  assert.ok(t2);
  t2.status = "completed";
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.lines, [`sangsoe: Run ${RUN} — 🟢 준비됨 1 · 📅 기한 0 · ⚠️ trigger 불명 0 (새로 1건). 목록은 resource ready 와 brief 로 읽는다.`]);
  assert.deepEqual(w.store.events({ type: "item_ready" }).map((e) => e.entity_id), [T1], "only this Run's item is told");
});

// The plugin worker's queue round over the same world: it has no terminal, so it writes rows and sends nothing.
const timer = (w: World): MonitorDeps => ({
  orca: w.orca,
  exec: async () => ({ code: 1, stdout: "", stderr: "" }),
  events: (f) => w.store.events(f),
  append: (e) => w.store.append(e),
  now: () => Date.parse(NOW),
  config: DEFAULT_MONITOR_CONFIG,
  chat: nullChatProvider,
  sample: () => ({ cpus: 8 }),
  core: { store: w.store, orca: w.orca },
  coreVersion: VERSION,
});

test("274: rows the timer wrote first are still told once by the Run's session, and the timer then counts none left", async () => {
  const T3 = "task_000000000003";
  const w = createWorld([
    { id: T1, run: RUN, status: "pending" },
    { id: T2, run: RUN, status: "pending" },
    { id: T3, run: RUN, status: "pending" },
  ]);
  w.as({ run: RUN, terminal: true });
  item(w, T1, { exec_by: "owner", trigger: "2026-01-01" });
  item(w, T2, { trigger: "when the vendor answers" });
  item(w, T3);
  w.strict();
  w.as(TIMER);
  const monitor = timer(w);
  const first = await runMonitor("queue", monitor);
  assert.deepEqual(first.acts.map((a) => a.detail.split(":")[0]), ["no_sender", "no_sender"], JSON.stringify(first.acts));
  const second = await runMonitor("queue", monitor);
  assert.ok(second.calls.some((c) => c.startsWith("notices: 2 left to their Runs' own sessions")), second.calls.join("\n"));
  assert.ok(second.calls.some((c) => c.startsWith("notifyReady: 1 left to their Runs' own sessions")), second.calls.join("\n"));
  assert.equal(w.store.events({ type: "todo_due" }).length + w.store.events({ type: "trigger_unclear" }).length, 2, "the timer wrote both rows");

  w.as({ run: RUN, terminal: true });
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.lines, [`sangsoe: Run ${RUN} — 🟢 준비됨 1 · 📅 기한 1 · ⚠️ trigger 불명 1 (새로 3건). 목록은 resource ready 와 brief 로 읽는다.`]);
  const again = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in again);
  assert.deepEqual(again.lines, []);

  w.as(TIMER);
  const third = await runMonitor("queue", monitor);
  assert.deepEqual(third.acts, []);
  assert.ok(!third.calls.some((c) => c.startsWith("notices:") || c.startsWith("notifyReady")), third.calls.join("\n"));
  assert.deepEqual(w.sends, []);
});

test("274: a decision the timer closed as moot keeps its gate until the Run's session resumes the same call", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  w.strict();
  w.as(TIMER);
  const r = await decisionMoot(w, { decision: d, evidence: { kind: "pr_closed", pr: "acme/api#4" }, callerRun: QUEUE_CALLER });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual([r.value.status, r.value.pending], ["moot", [T1]]);
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending");

  w.as({ run: RUN, terminal: true });
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.resolved, ["gate_000000000001"]);
  assert.equal(w.gates.get("gate_000000000001")?.resolution, `MOOT ${d}: pr_closed:acme/api#4`);
  assert.match(out.lines[0] ?? "", new RegExp(`닫힌 결정 ${d} 의 게이트 1개를 풀었다`));
  const quiet = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in quiet);
  assert.deepEqual([quiet.resolved, quiet.lines], [[], []]);
});

// A lead as Orca binds it: its own Run, and a Dispatch in the orchestrator's Run, which is why Orca
// refuses its mail to any other Run's mailbox, its own included (decision 197).
const ORCH = "run_000000000009";
const asLead = (w: World) => w.as({ run: RUN, dispatchRun: ORCH, terminal: true });

// Every kind of waiter, for both roles, is in own-run-waiters.test.ts. Here: the path through the real
// calls, from the panel's answer to the timer's next round.
test("274: a closed Task's answer, told by the Run's hook, reads as delivered: the timer does not answer it again", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  const t1 = w.tasks.get(T1);
  assert.ok(t1);
  t1.status = "completed";
  w.strict();
  w.as(TIMER);
  const said = ownerSays(w.store, `${d} yes`);
  const r = await decisionAnswer(w, { decision: d, answer: "yes,\nafter the release", ownerAction: said, linkedBy: "button", callerRun: "" });
  assert.ok(r.ok && r.value.pending.length === 1, JSON.stringify(r));
  const sent = w.calls("orchestration send").length;

  asLead(w);
  const out = await deliverOwnRun(w, RUN, NOW);
  assert.ok("run" in out, JSON.stringify(out));
  assert.deepEqual(out.lines, [
    `sangsoe: Run ${RUN} — 🟢 준비됨 0 · 📅 기한 0 · ⚠️ trigger 불명 0 (새로 0건). 목록은 resource ready 와 brief 로 읽는다. 닫힌 Task 가 기다리던 결정: ${d}: yes, after the release.`,
  ]);
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending", "a closed Task's gate stays open on purpose (91④(ii))");
  assert.equal(w.calls("orchestration send").length, sent, "the Run is told by its own hook, not by mail");
  assert.deepEqual(w.store.events({ type: "notified" }).map((e) => e.dedupe_key), [answerNotifiedKey(d, T1).dedupe_key]);
  w.as(TIMER);
  const round = await runMonitor("queue", timer(w));
  assert.ok(!round.calls.some((c) => c.startsWith("decision_answer")), round.calls.join("\n"));
});

test("274: a lead's prompt hook prints the line; a worker's makes no Orca call; Stop prints nothing", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  w.as({ run: RUN, terminal: true });
  item(w, T1);
  const deps = { store: w.store, orca: w.orca };
  w.store.append({ type: "session_started", source: "SessionStart", payload: { session: "cc-worker", role: "worker", model: "m" } });
  w.store.append({ type: "session_started", source: "SessionStart", payload: { session: "cc-lead", role: "lead", model: "m" } });

  const before = w.calls().length;
  assert.deepEqual(await recordHook("user-prompt-submit", deps, { session_id: "cc-worker", prompt: "go on" }), []);
  assert.deepEqual(w.calls().slice(before), []);

  assert.deepEqual(await recordHook("stop", deps, { session_id: "cc-lead" }), []);
  assert.equal(w.store.events({ type: "item_ready" }).length, 0, "Stop leaves the line to the next prompt");

  const lines = await recordHook("user-prompt-submit", deps, { session_id: "cc-lead", prompt: "You have 1 orchestration message." });
  assert.equal(lines.length, 1);
  assert.match(lines[0] ?? "", /^sangsoe: Run run_000000000001 — 🟢 준비됨 1 /);
  assert.deepEqual(w.calls().slice(before).map((c) => c[1]), ["run-current", "task-list", "gate-list"]);

  // A lead that holds no Run yet: one read, no line.
  w.as({ run: null, terminal: true });
  const idle = w.calls().length;
  assert.deepEqual(await recordHook("user-prompt-submit", { store: w.store, orca: w.orca }, { session_id: "cc-lead", prompt: "hello" }), []);
  assert.deepEqual(w.calls().slice(idle).map((c) => c[1]), ["run-current"]);
});

test("274: the panel button answers with a label that says the Run delivers, not a refusal", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  w.strict();
  w.as(TIMER);
  const core = panelCore({ orca: w.orca, now: () => NOW, withStore: (fn) => fn(w.store), load: async () => ({ ok: true, value: { orca: { tasks: [], gates: [] }, events: w.store.events(), now: NOW } as never }) });
  const r = await core.act({ kind: "answer", decision: d, text: "yes" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.label, ANSWER_PENDING_LABEL);
  assert.equal(w.store.events({ type: "owner_action" }).at(-1)?.payload.origin, "button");
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending");
});

test("274: the same button from a process that can send keeps the plain label", async () => {
  const w = createWorld([{ id: T1, run: RUN, status: "pending" }]);
  const d = await opened(w);
  w.as({ run: null, terminal: true });
  const core = panelCore({ orca: w.orca, now: () => NOW, withStore: (fn) => fn(w.store), load: async () => ({ ok: true, value: { orca: { tasks: [], gates: [] }, events: w.store.events(), now: NOW } as never }) });
  const r = await core.act({ kind: "answer", decision: d, text: "yes" });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.value.label, ACTED_LABEL.answered);
  assert.equal(w.sends.length, 1, "the gate's Run got the handoff by mail");
});
