import assert from "node:assert/strict";
import { test } from "node:test";
import { handle as itemCreate } from "../../claude-plugin/mcp/tools/item_create.ts";
import {
  briefRuns,
  buildBrief,
  buildGroup,
  criticalPath,
  DEFAULT_MONITOR_CONFIG,
  graphRead,
  type MonitorDeps,
  nullChatProvider,
  readSnapshot,
  recordHook,
  runMonitor,
  VERSION,
  type ViewInput,
} from "../../core/index.ts";
import { createWorld, TIMER } from "../decision/world.ts";

// S6 NOW-3: a lead makes its items in its own Run. The plugin timer's rounds and the brief run with
// no current Run (or the orchestrator's), so they read only the Runs events name; the items must name theirs.

const LEAD_RUN = "run_00000000000l";
const ORCH_RUN = "run_000000000orc";
const LEAD = "lead:s6";
const LEAD_SESSION = "cc-lead-s6";
const PR = "acme/api#4";
const NOW = Date.parse("2026-11-11T03:00:00Z");

async function leadWorld() {
  const w = createWorld([]);
  const made = await itemCreate({ runId: LEAD_RUN, spec: "B", who: "worker", doneWhen: "PR merged", lead: LEAD }, { orca: w.orca, store: w.store });
  assert.ok(made.ok, JSON.stringify(made));
  const task = String((made.value as { task: string }).task);
  const monitor: MonitorDeps = {
    orca: w.orca,
    exec: async () => ({ code: 1, stdout: "", stderr: "" }),
    events: (f) => w.store.events(f),
    append: (e) => w.store.append(e),
    now: () => NOW,
    config: DEFAULT_MONITOR_CONFIG,
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
    core: { store: w.store, orca: w.orca },
    coreVersion: VERSION,
  };
  const view = async (): Promise<ViewInput> => {
    const snap = await readSnapshot(w.orca, briefRuns(w.store.events(), null));
    assert.ok(snap.ok);
    return { events: w.store.events(), orca: { tasks: snap.value.tasks, gates: snap.value.gates }, now: new Date(NOW).toISOString() };
  };
  return { w, task, monitor, view };
}

/** The PR of the lead's item moved its base: the item is done, its PR waits on a re-review. */
function baseMoved(x: Awaited<ReturnType<typeof leadWorld>>, from = "s6/a", to = "main") {
  const t = x.w.tasks.get(x.task);
  assert.ok(t);
  t.status = "completed";
  if (from === "s6/a") x.w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: PR, task: x.task, base: from, head_sha: "a".repeat(40), head: "s6/b" } });
  x.w.store.append({ type: "pr_base_changed", source: "pr-monitor", payload: { pr: PR, from, to } });
}

/** A lead session the SessionStart hook recorded, as Orca binds it: its own Run, its Dispatch in the orchestrator's. */
function leadSession(x: Awaited<ReturnType<typeof leadWorld>>) {
  x.w.store.append({ type: "session_started", source: "SessionStart", target: `run:${LEAD_RUN}`, payload: { session: LEAD_SESSION, role: "lead", model: "m" } });
}

const asLead = (x: Awaited<ReturnType<typeof leadWorld>>) => x.w.as({ run: LEAD_RUN, dispatchRun: ORCH_RUN, terminal: true });

test("S6 NOW-3: an item made in a lead's Run names that Run, so a read with no current Run sees it", async () => {
  const x = await leadWorld();
  assert.deepEqual(briefRuns(x.w.store.events(), null), [LEAD_RUN]);
  const input = await x.view();
  assert.deepEqual(input.orca.tasks.map((t) => t.id), [x.task]);
  assert.equal(buildBrief(input).groups, 1, "the brief without --run shows the lead's group");
  assert.notEqual(buildGroup(input, LEAD), null, "item_create's lead groups the item");
  assert.deepEqual(criticalPath(input, LEAD).path.map((n) => n.task), [x.task], "graph critical --lead finds it");
});

test("decision 219: the fake refuses what real Orca refuses the timer, a lead and an unbound caller", async () => {
  const x = await leadWorld();
  x.w.strict();
  x.w.as(TIMER);
  const fenced = await x.w.orca.taskCreate({ run: LEAD_RUN, spec: "x", title: "x" });
  assert.ok(!fenced.ok);
  assert.equal(fenced.error.code, "consumer_fenced");
  assert.notEqual(fenced.error.message, fenced.error.code, "Orca's message is more than its code");
  const timerSend = await x.w.orca.send({ to: `run:${LEAD_RUN}`, subject: "s", body: "b", type: "status" });
  assert.ok(!timerSend.ok, "a process with no terminal cannot send");
  asLead(x);
  const leadSend = await x.w.orca.send({ to: `run:${LEAD_RUN}`, subject: "s", body: "b", type: "status" });
  assert.ok(!leadSend.ok);
  assert.equal(leadSend.error.code, "dispatch_run_mismatch", "a lead's Dispatch is in the orchestrator's Run");
  assert.ok((await x.w.orca.taskCreate({ run: LEAD_RUN, spec: "x", title: "x" })).ok, "the bound session creates Tasks on its Run");
});

test("decision 219: the timer round makes no re-review item and sends no doomed wake; the lead's Stop hook makes the item", async () => {
  const x = await leadWorld();
  x.w.strict();
  x.w.as(TIMER);
  leadSession(x);
  baseMoved(x);
  const others = () => x.w.store.events({ type: "item_created" }).filter((e) => e.payload.task !== x.task);

  const round = await runMonitor("queue", x.monitor);
  assert.equal(others().length, 0, "Orca fences the timer out of the lead's Run");
  assert.deepEqual(x.w.calls("orchestration send"), [], "no send the timer cannot make");
  assert.ok(round.calls.some((c) => c.includes(`left to run:${LEAD_RUN}`)), round.calls.join("\n"));

  // A worker is bound to no Run it could make items in: its hooks make no Orca call at all.
  let before = x.w.calls().length;
  x.w.store.append({ type: "session_started", source: "SessionStart", payload: { session: "cc-worker", role: "worker", model: "m" } });
  await recordHook("stop", { store: x.w.store, orca: x.w.orca }, { session_id: "cc-worker" });
  assert.deepEqual(x.w.calls().slice(before), [], "a worker's Stop asks Orca nothing");

  // A lead bound to another Run asks which Run it holds once, then stops.
  before = x.w.calls().length;
  x.w.store.append({ type: "session_started", source: "SessionStart", payload: { session: "cc-other", role: "lead", model: "m" } });
  x.w.as({ run: ORCH_RUN, terminal: true });
  await recordHook("stop", { store: x.w.store, orca: x.w.orca }, { session_id: "cc-other" });
  assert.equal(others().length, 0, "a session bound to another Run does not make it");
  assert.deepEqual(x.w.calls().slice(before), [["orchestration", "run-current"]]);

  asLead(x);
  await recordHook("stop", { store: x.w.store, orca: x.w.orca }, { session_id: LEAD_SESSION });
  assert.equal(others().length, 1, "the lead's own hook made the item, no command run by anyone");
  assert.equal(others()[0]?.payload.run, LEAD_RUN);
  assert.deepEqual(graphRead.why(await x.view(), x.task).map((r) => r.kind), ["blocks"]);

  // Made once: the next wake's hooks read the store and stop there.
  const after = x.w.calls().length;
  await recordHook("user-prompt-submit", { store: x.w.store, orca: x.w.orca }, { session_id: LEAD_SESSION, prompt: "You have 1 orchestration message." });
  assert.equal(others().length, 1);
  assert.deepEqual(x.w.calls().slice(after), [], "nothing pending: store reads only, no Orca call");

  // The next base change of the same PR needs its own item; the lead's next wake makes it.
  baseMoved(x, "main", "release");
  await recordHook("user-prompt-submit", { store: x.w.store, orca: x.w.orca }, { session_id: LEAD_SESSION, prompt: "You have 1 orchestration message." });
  assert.equal(others().length, 2);
});

test("decision 219: a failed wake keeps Orca's code and message in the round's act", async () => {
  const x = await leadWorld();
  x.w.strict();
  x.w.as(TIMER);
  const t = x.w.tasks.get(x.task);
  assert.ok(t);
  t.status = "ready";
  x.w.store.append({ type: "item_extra_set", source: "test", payload: { task: x.task, exec_by: "owner", trigger: "2026-01-01" } });
  const round = await runMonitor("queue", x.monitor);
  const act = round.acts.find((a) => a.what.startsWith(`notify run:${LEAD_RUN}`));
  assert.ok(act, JSON.stringify(round.acts));
  assert.equal(act.ok, false);
  assert.match(act.detail, /send_failed: .*sender_unresolved Could not resolve the sender/);
});
