import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_MONITOR_CONFIG,
  decisionAnswer,
  decisionOpen,
  type Exec,
  judgeStall,
  linkShell,
  type MonitorConfig,
  type MonitorDeps,
  nullChatProvider,
  type OrcaAdapter,
  orchestratorRun,
  runAbove,
  type OrcaPluginRow,
  recordShellLink,
  runMonitor,
  type ShellLine,
  type Store,
  type StoredEvent,
  stallCheck,
  VERSION,
  type VerifySpec,
} from "../../core/index.ts";
import { createWorld, ownerSays, type World } from "../decision/world.ts";
import { SEND_TYPES } from "../fake-orca/index.ts";
import { later, RUN as OWNER_RUN, type OwnerWorld, ownerWorld, T0 } from "../owner/world.ts";

// queue-monitor scenarios (split §2 U17): the detection side of the decision loop and the owner
// queue, on the same fake Orca the function-side tests use. Each round goes through runMonitor,
// the path the worker timer and `sangsoe monitor run queue` share.

const RUN = "run_000000000001";
const ORCH_RUN = "run_000000000009";
const T1 = "task_000000000001";
const T2 = "task_000000000002";
const T3 = "task_000000000003";
const D1 = "ctx_000000000001";
const MIN = 60_000;

const noExec: Exec = async () => ({ code: null, stdout: "", stderr: "", failure: "spawn" });

type DepsOpts = { now?: number; dry?: boolean; config?: Partial<MonitorConfig>; gh?: MonitorDeps["gh"] };
function deps(store: Store, orca: OrcaAdapter, o: DepsOpts = {}): MonitorDeps {
  return {
    orca,
    exec: noExec,
    events: (f) => store.events(f),
    ...(o.dry ? {} : { append: (e) => store.append(e), core: { store, orca } }),
    now: () => o.now ?? Date.now(),
    config: { ...DEFAULT_MONITOR_CONFIG, ...o.config },
    chat: nullChatProvider,
    sample: () => ({ cpus: 8 }),
    ...(o.gh ? { gh: o.gh } : {}),
    coreVersion: VERSION,
  };
}

const queue = (d: MonitorDeps) => runMonitor("queue", d);
const types = (r: { planned: { type: string }[] }) => r.planned.map((e) => e.type);

async function openDecision(w: World, waiters = [{ task: T1, run: RUN }]) {
  const r = await decisionOpen(w, {
    subject: "item:i012",
    options: ["Path versioning", "Header versioning"],
    question: "Which API versioning scheme?",
    waiters,
    callerRun: RUN,
  });
  assert.ok(r.ok && r.value.status === "opened", JSON.stringify(r));
  return r.value.decision;
}

const RUN2 = "run_000000000002";

/** A second Run's session asks the same question: its Task joins the open decision. */
async function joinFrom(w: World, run: string, task: string) {
  w.useRun(run);
  const r = await decisionOpen(w, { subject: "item:i012", options: ["Path versioning", "Header versioning"], question: "Which API versioning scheme?", waiters: [{ task, run }], callerRun: run });
  w.useRun(RUN);
  assert.ok(r.ok, JSON.stringify(r));
}

/** The hook recorded the answer, then the process died before decision_answer resolved the gate. */
function answerWithoutDelivery(w: World, d: string): number {
  const said = ownerSays(w.store, `${d} header`);
  w.store.append({
    type: "decision_answered",
    source: "UserPromptSubmit",
    dedupe_key: `decision_answered:${d}`,
    payload: { decision: d, owner_action: said, answer: "header", linked_by: "hook" },
  });
  return said;
}

// A gated waiter has not started: Orca refuses a gate on a Task whose worker runs (decision 197).
const GATED = { id: T1, run: RUN, status: "pending" };

test("answer_gate_unresolved (queue side): the round re-calls decision_answer, the gate's Run resolves it once", async () => {
  const w = createWorld([GATED]);
  const d = await openDecision(w);
  const said = answerWithoutDelivery(w, d);

  const first = await queue(deps(w.store, w.orca));
  assert.ok(first.calls.some((c) => c.startsWith(`decision_answer ${d} again: answered, handed off 1`)), first.calls.join("\n"));
  assert.equal(w.calls("orchestration gate-resolve").length, 0, "the worker holds no Run: the gate is handed to its Run");
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`]);
  assert.match(w.sends[0]?.body ?? "", /decision_answer with decision=d001/);

  await queue(deps(w.store, w.orca));
  assert.equal(w.sends.length, 1, "the handoff goes once");

  // The session holding the Run makes the same call: one resolve. No worker yet, so no message (91④(i)).
  const there = await decisionAnswer(w, { decision: d, answer: "header", ownerAction: said, linkedBy: "hook", callerRun: RUN });
  assert.ok(there.ok);
  assert.deepEqual(there.value.resolved, ["gate_000000000001"]);
  const after = await queue(deps(w.store, w.orca));
  assert.ok(!after.calls.some((c) => c.includes("decision_answer")), "delivered: nothing left to re-call");
  assert.equal(w.calls("orchestration gate-resolve").length, 1);
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`]);
});

test("answer_gate_unresolved: a handoff still unresolved past the wait is escalation_stale once, one tier up", async () => {
  // The lead's Run is coordinated by a terminal that ORCH_RUN's Dispatch runs: that Run is the tier above.
  const w = createWorld([GATED], { above: { [RUN]: ORCH_RUN } });
  const d = await openDecision(w);
  answerWithoutDelivery(w, d);
  await queue(deps(w.store, w.orca));
  const late = Date.now() + 31 * MIN;
  const dry = await queue(deps(w.store, w.orca, { now: late, dry: true }));
  assert.ok(dry.calls.includes(`raise ${d} on ${T1} to run:${ORCH_RUN}: dry run: not sent`), dry.calls.join("\n"));
  assert.equal(w.sends.length, 1, "a dry run sends nothing");
  const r = await queue(deps(w.store, w.orca, { now: late }));
  assert.deepEqual(r.written.filter((e) => e.type === "escalation_stale").length, 1);
  assert.deepEqual(w.store.events({ type: "escalation_stale" }).map((e) => e.payload), [{ ref: d }]);
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`, `run:${ORCH_RUN}`]);
  await queue(deps(w.store, w.orca, { now: late + 5 * MIN }));
  assert.equal(w.store.events({ type: "escalation_stale" }).length, 1);
  assert.equal(w.sends.length, 2, "raised once");
});

test("answer_gate_unresolved: no Dispatch runs the lead's coordinator, so no Run above: the event only", async () => {
  const w = createWorld([GATED], { above: {} });
  const d = await openDecision(w);
  answerWithoutDelivery(w, d);
  await queue(deps(w.store, w.orca));
  const r = await queue(deps(w.store, w.orca, { now: Date.now() + 31 * MIN }));
  assert.equal(w.store.events({ type: "escalation_stale" }).length, 1);
  assert.ok(r.unseen.includes(`Run above ${RUN}: none, its coordinator is no Dispatch`), r.unseen.join("\n"));
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`], "the handoff only");
});

test("decision_moot_closed: a waiter whose Task row was not read is unknown, so a closed PR moots nothing", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: D1 },
    { id: T2, run: RUN2, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  await openDecision(w);
  await joinFrom(w, RUN2, T2);
  w.tasks.delete(T2);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#3", task: T1 } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#4", task: T2 } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#3" } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#4" } });
  const r = await queue(deps(w.store, w.orca));
  assert.equal(w.store.events({ type: "decision_closed" }).length, 0, r.calls.join("\n"));
});

test("decision_moot_closed (detection side): every waiter Task closed moots the decision through U8's function", async () => {
  const w = createWorld([GATED]);
  const d = await openDecision(w);
  assert.equal((await queue(deps(w.store, w.orca))).calls.filter((c) => c.includes("decision_moot")).length, 0, "a live waiter: not moot");

  const t1 = w.tasks.get(T1);
  assert.ok(t1);
  t1.status = "completed";
  delete t1.dispatchId;
  const r = await queue(deps(w.store, w.orca));
  assert.ok(r.calls.includes(`decision_moot ${d} (tasks_closed): moot, handed off 0`), r.calls.join("\n"));
  assert.deepEqual(w.store.events({ type: "decision_closed" }).map((e) => e.payload), [{ decision: d, reason: "moot", evidence: "tasks_closed" }]);
  assert.equal(w.calls("orchestration gate-resolve").length, 0, "a closed Task's gate is not called");
  assert.equal(w.calls("orchestration task-update").length, 0, "moot closes the decision, never an item");
  assert.deepEqual(w.sends.map((s) => s.to), [`run:${RUN}`]);

  await queue(deps(w.store, w.orca));
  assert.equal(w.store.events({ type: "decision_closed" }).length, 1);
  assert.equal(w.sends.length, 1, "told once");
});

test("decision_moot_closed (detection side): a waiter's PR closed unmerged moots it; the live gate goes to its Run", async () => {
  const w = createWorld([GATED]);
  const d = await openDecision(w);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#3", task: T1 } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#3" } });
  const r = await queue(deps(w.store, w.orca));
  assert.ok(r.calls.includes(`decision_moot ${d} (pr_closed:acme/api#3): moot, handed off 1`), r.calls.join("\n"));
  assert.equal(w.store.events({ type: "decision_closed" })[0]?.payload.evidence, "pr_closed:acme/api#3");
  assert.equal(w.gates.get("gate_000000000001")?.status, "pending", "resolved by its own Run, not from here");
  assert.match(w.sends[0]?.body ?? "", /sangsoe decision moot --decision d001/);
});

test("a PR closed before the decision opened, or one with a newer open PR beside it, moots nothing", async () => {
  const w = createWorld([
    { id: T1, run: RUN, status: "dispatched", dispatchId: D1 },
    { id: T2, run: RUN, status: "dispatched", dispatchId: "ctx_000000000002" },
  ]);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#3", task: T1 } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#3" } });
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#4", task: T1 } });
  const d = await openDecision(w, [
    { task: T1, run: RUN },
    { task: T2, run: RUN },
  ]);
  await queue(deps(w.store, w.orca));
  assert.equal(w.store.events({ type: "decision_closed" }).length, 0, "#3 closed before d001 opened");

  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#4" } });
  await queue(deps(w.store, w.orca));
  assert.equal(w.store.events({ type: "decision_closed" }).length, 0, "T2 still waits with no closed PR");

  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/api#5", task: T2 } });
  w.store.append({ type: "pr_closed", source: "pr-monitor", payload: { pr: "acme/api#5" } });
  await queue(deps(w.store, w.orca));
  assert.deepEqual(w.store.events({ type: "decision_closed" }).map((e) => e.payload), [{ decision: d, reason: "moot", evidence: "pr_closed:acme/api#4" }]);
});

test("ready, todo_due and ⚠️ trigger_unclear: once each, item_ready only after the lead was told", async () => {
  const w = createWorld(
    [
      { id: T1, run: RUN, status: "ready" },
      { id: T2, run: RUN, status: "ready" },
      { id: T3, run: RUN, status: "pending" },
    ],
    { currentRun: RUN },
  );
  for (const [task, alias] of [
    [T1, "i001"],
    [T2, "i002"],
    [T3, "i003"],
  ] as const) {
    w.store.append({ type: "item_created", source: "test", payload: { task, alias, who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: task });
  }
  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T2, exec_by: "owner", trigger: "2026-01-01" } });
  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T3, trigger: "when legal signs off" } });

  const dry = await queue(deps(w.store, w.orca, { dry: true }));
  assert.deepEqual(types(dry).filter((t) => t !== "job_drift"), ["todo_due", "trigger_unclear", "item_ready"]);
  assert.deepEqual(dry.written, []);
  assert.ok(dry.calls.includes(`would call notifyReady i001 (lead of ${RUN})`));
  assert.deepEqual(dry.acts, [
    { what: `notify run:${RUN} 📅 todo_due: ${T2}`, ok: null, detail: "not run" },
    { what: `notify run:${RUN} ⚠️ trigger_unclear: ${T3}`, ok: null, detail: "not run" },
  ]);
  assert.equal(w.sends.length, 0, "a dry run sends nothing");

  const live = await queue(deps(w.store, w.orca));
  assert.deepEqual(live.written.map((e) => e.type).filter((t) => t !== "job_drift"), ["todo_due", "trigger_unclear", "item_ready"]);
  assert.deepEqual(w.sends.map((s) => [s.to, s.type, s.subject.split(":")[0]]), [
    [`run:${RUN}`, "status", "🟢 준비됨"],
    [`run:${RUN}`, "status", "📅 todo_due"],
    [`run:${RUN}`, "status", "⚠️ trigger_unclear"],
  ]);
  const again = await queue(deps(w.store, w.orca));
  assert.deepEqual(again.planned.filter((e) => e.type !== "job_drift"), [], "nothing twice");
  assert.deepEqual(again.acts, [], "each notice once");
  assert.equal(w.sends.length, 3);
  assert.equal(w.store.events({ type: "trigger_unclear" }).length, 1, "⚠️ once per item");
});

test("a todo_due row whose notice failed is offered again until it goes, then never", async () => {
  const w = createWorld([{ id: T2, run: RUN, status: "ready" }], { currentRun: RUN });
  w.store.append({ type: "item_created", source: "test", payload: { task: T2, alias: "i002", who: "lead:api", done_when: "done", owner_action: 0 }, entity: "task", entity_id: T2 });
  w.store.append({ type: "item_extra_set", source: "test", payload: { task: T2, exec_by: "owner", trigger: "2026-01-01" } });
  w.failSendTo(`run:${RUN}`);
  const first = await queue(deps(w.store, w.orca));
  assert.deepEqual(first.acts.map((a) => [a.ok, a.detail]), [[false, "send_failed"]]);
  w.failSendTo(null);
  const second = await queue(deps(w.store, w.orca));
  assert.deepEqual(second.acts.map((a) => [a.ok, a.detail]), [[true, "sent"]]);
  assert.deepEqual((await queue(deps(w.store, w.orca))).acts, []);
  assert.equal(w.store.events({ type: "todo_due" }).length, 1);
});

test("job_drift: the installed plugin out of line with the brew tree, once per drift; unreadable is zero action", async () => {
  const w = createWorld([]);
  const row = (o: Partial<OrcaPluginRow>): OrcaPluginRow => ({
    pluginKey: "local.sangsoe",
    name: "sangsoe",
    version: VERSION,
    consentFingerprint: "fp",
    status: "enabled",
    isDev: true,
    needsReconsent: false,
    ...o,
  });
  const withPlugins = (rows: OrcaPluginRow[] | null): OrcaAdapter => ({
    ...w.orca,
    pluginList: async () => (rows ? { ok: true, value: rows } : { ok: false, error: { code: "orca_down", message: "x" } }),
  });
  assert.deepEqual(types(await queue(deps(w.store, withPlugins([row({})])))), []);
  const down = await queue(deps(w.store, withPlugins(null)));
  assert.deepEqual(types(down), []);
  assert.ok(down.unseen.includes("plugin list"));

  const old = await queue(deps(w.store, withPlugins([row({ version: "0.0.1" })])));
  assert.deepEqual(old.planned.map((e) => e.payload), [{ plugin: "local.sangsoe", expected: `${VERSION} enabled`, actual: "0.0.1 enabled" }]);
  assert.deepEqual(types(await queue(deps(w.store, withPlugins([row({ version: "0.0.1" })])))), [], "same drift: once");
  const reconsent = await queue(deps(w.store, withPlugins([row({ needsReconsent: true })])));
  assert.deepEqual(reconsent.planned.map((e) => e.dedupe_key), [`job_drift:local.sangsoe:${VERSION}%20enabled:${VERSION}%20needs_reconsent`]);
});

// The owner queue's world: a fake Orca that records every verb it does not answer, so a verb that
// closes or settles something (task-update, gate-resolve) shows up. A send (the ready notice) is a
// message, not a close.
const CLOSING = new Set(["taskUpdate", "gateResolve"]);
const closing = (verbs: readonly string[]) => verbs.filter((k) => CLOSING.has(k));
function ownerOrca(w: OwnerWorld) {
  const unexpected: string[] = [];
  const base: Partial<OrcaAdapter> = {
    taskList: w.orca.taskList,
    pluginList: w.orca.pluginList,
    gateList: async () => ({ ok: true, value: [] }),
    runCurrent: async () => ({ ok: true, value: { runId: OWNER_RUN } }),
  };
  const orca = new Proxy(base, {
    get: (t, k: string) =>
      t[k as keyof OrcaAdapter] ??
      (async () => {
        unexpected.push(k);
        return { ok: false, error: { code: "not_faked", message: k } };
      }),
  }) as OrcaAdapter;
  return { orca, unexpected };
}

const T = "task_000000000001";
const HINT = "gh workflow run promote-to-production.yml";
const ownerDeps = (w: OwnerWorld, orca: OrcaAdapter) => deps(w.store, orca, { now: Date.parse(w.now), gh: w.ghClient });

test("owner_item_probe_closes (probe side) and the queue round closes nothing", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "pr_merged", pr: "acme/api#40" } satisfies VerifySpec });
  const { orca, unexpected } = ownerOrca(w);
  w.gh.set("repos/acme/api/pulls/40", { merged: false });
  assert.deepEqual(types(await queue(ownerDeps(w, orca))).filter((t) => t !== "job_drift"), [], "false: nothing");
  w.gh.set("repos/acme/api/pulls/40", { merged: true, merge_commit_sha: "abc1234" });
  const r = await queue(ownerDeps(w, orca));
  assert.deepEqual(
    r.written.map((e) => e.type).filter((t) => t !== "job_drift"),
    ["evidence", "close_suggested"],
  );
  assert.equal(w.store.events({ type: "close_suggested" })[0]?.payload.reason, "verified");
  assert.equal(w.state(T), "ready", "the holder closes it, not the monitor");
  assert.deepEqual(closing(unexpected), [], "no task-update, gate-resolve or worker-release");
  assert.deepEqual(types(await queue(ownerDeps(w, orca))).filter((t) => t !== "job_drift"), [], "verified once");
});

function bang(w: OwnerWorld, o: Partial<ShellLine> = {}) {
  const l: ShellLine = {
    uuid: `u-${w.store.events().length}`,
    command: `${HINT} -R acme/api -f ref=main`,
    exitCode: 0,
    stdout: "https://github.com/acme/api/actions/runs/111\n",
    stderr: "",
    repo: "acme/api",
    ts: w.now,
    ...o,
  };
  recordShellLink(w.store, l, linkShell(w.input(), w.facts(), l));
}

test("owner_ran_command_marks_verifying (probe side): the round reads run_ok only once the item is marked", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const { orca, unexpected } = ownerOrca(w);
  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "success" });
  await queue(ownerDeps(w, orca));
  assert.deepEqual(w.ghCalls, [], "no mark: run_ok is not read");
  bang(w);
  const r = await queue(ownerDeps(w, orca));
  assert.ok(r.calls.includes("probeRound: read 1, passed 1, skipped 0"), r.calls.join("\n"));
  assert.deepEqual(w.store.events({ type: "evidence" }).map((e) => e.payload.kind), ["owner_act:seen", "probe:run_ok"]);
  assert.equal(w.state(T), "ready");
  assert.deepEqual(closing(unexpected), []);
});

test("owner_input_probe_fails_no_change (probe side): a failing probe writes nothing, then verify_unconfirmed once", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const { orca } = ownerOrca(w);
  bang(w);
  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "failure" });
  const n = w.store.events().length;
  await queue(ownerDeps(w, orca));
  assert.equal(w.store.events().filter((e) => e.type !== "job_drift").length, n);
  w.at(later(T0, 31));
  await queue(ownerDeps(w, orca));
  w.at(later(T0, 45));
  await queue(ownerDeps(w, orca));
  assert.deepEqual(
    w.store.events({ type: "escalation_stale" }).map((e) => e.payload),
    [{ ref: T, reason: "verify_unconfirmed" }],
  );
  assert.equal(w.state(T), "ready");
});

test("verify_unconfirmed goes to the item's owning lead (decision 91② row 11), once", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const sent: string[] = [];
  const { orca } = ownerOrca(w);
  const withSend = new Proxy(orca, {
    get: (t, k: string) =>
      k === "send"
        ? async (m: { to: string; type?: string }) => {
            assert.ok(SEND_TYPES.has(m.type ?? ""), `orca refuses --type ${m.type}`);
            sent.push(`${m.to} ${m.type}`);
            return { ok: true, value: { message: { id: `msg_${sent.length}` } } };
          }
        : t[k as keyof OrcaAdapter],
  }) as OrcaAdapter;
  bang(w);
  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "failure" });
  await queue(ownerDeps(w, withSend));
  w.at(later(T0, 31));
  await queue(ownerDeps(w, withSend));
  w.at(later(T0, 45));
  await queue(ownerDeps(w, withSend));
  // status, never escalation: queue-monitor holds no Dispatch and Orca refuses its escalation (sender_not_assignee).
  assert.deepEqual(sent.filter((s) => !s.includes("escalation")).length, sent.length);
  assert.equal(sent.filter((s) => s === `run:${OWNER_RUN} status`).length, 2, "the ready notice and verify_unconfirmed, once each");
});

test("probeRound honours gh_budget: below 10% no gh probe is read, above it they are", async () => {
  const w = ownerWorld();
  w.item(T, { verify: { kind: "run_ok", repo: "acme/api" }, cmdHint: HINT });
  const { orca } = ownerOrca(w);
  bang(w);
  w.gh.set("repos/acme/api/actions/runs/111", { status: "completed", conclusion: "success" });
  const budget = (remaining: number) => () => ({ resource: "core", limit: 5000, remaining, resetAt: 0 });
  const low = await queue({ ...ownerDeps(w, orca), ghBudget: budget(400) });
  assert.ok(low.calls.includes("probeRound: read 0, passed 0, skipped 1"), low.calls.join("\n"));
  assert.deepEqual(w.ghCalls, []);
  const slow = await queue({ ...ownerDeps(w, orca), ghBudget: budget(1000) });
  assert.ok(slow.calls.includes("probeRound: read 1, passed 1, skipped 0"), slow.calls.join("\n"));
});

test("waiting_human_released (escalation side): unreleased past lead_minutes is escalated once; a released wait is not", async () => {
  const w = ownerWorld();
  w.item(T, { who: "lead:api", status: "dispatched" });
  const { orca } = ownerOrca(w);
  const wait = (session: string) =>
    w.store.append({ type: "waiting_human", source: "hook:notification", payload: { session }, entity: "task", entity_id: T });
  const a = wait("s1");
  const b = wait("s2");
  w.store.append({ type: "waiting_released", source: "hook:release", payload: { ref: String(b.seq), outcome: "answered", by: "unknown", evidence: "turn_ended" }, dedupe_key: `waiting_released:${b.seq}` });
  assert.equal((await queue(ownerDeps(w, orca))).planned.filter((e) => e.type === "escalation_stale").length, 0, "inside lead_minutes");
  w.at(later(T0, 11));
  const r = await queue(ownerDeps(w, orca));
  assert.ok(r.unseen.includes("screen excerpt: the Orca adapter has no terminal read"));
  w.at(later(T0, 20));
  await queue(ownerDeps(w, orca));
  assert.deepEqual(
    w.store.events({ type: "escalation_stale" }).map((e) => e.payload),
    [{ ref: String(a.seq), reason: "waiting_unreleased" }],
  );
});

const reap = (store: Store, trigger: "timer" | "hint", rootsOk: boolean, round: number) =>
  store.append({ type: "reap_round", source: "reaper", payload: { trigger, roots_ok: rootsOk, round } });
const ev = (seq: number, ts: string, payload: Record<string, unknown>): StoredEvent =>
  ({ seq, ts, type: "reap_round", source: "reaper", payload }) as unknown as StoredEvent;

test("timer_stalled: judged from reap_round rows, age past 3× the period or roots_ok=false three running", () => {
  const P = 15 * MIN;
  const at = (m: number) => new Date(Date.parse(T0) + m * MIN).toISOString();
  const now = (m: number) => Date.parse(T0) + m * MIN;
  assert.deepEqual(judgeStall([], now(500), P), [], "no round at all is unknown, not a stall");
  const rows = [ev(1, at(0), { trigger: "timer", roots_ok: true }), ev(2, at(40), { trigger: "hint", roots_ok: true })];
  assert.deepEqual(judgeStall(rows, now(45), P), []);
  const [age] = judgeStall(rows, now(46), P);
  assert.equal(age?.dedupe_key, "timer_stalled:reaper:age:1", "a hint round does not hide the stopped timer");
  assert.deepEqual(age?.payload, { kind: "reaper", reason: "no timer round for 46 min (period 15 min)" });

  const roots = [1, 2, 3, 4].map((i) => ev(i, at(i), { trigger: "timer", roots_ok: i === 1 }));
  assert.deepEqual(judgeStall(roots.slice(0, 3), now(5), P), [], "two failures are not three");
  assert.deepEqual(judgeStall(roots, now(5), P).map((e) => e.dedupe_key), ["timer_stalled:reaper:roots:2"]);
  const five = [...roots, ev(5, at(5), { trigger: "timer", roots_ok: false })];
  assert.deepEqual(judgeStall(five, now(6), P).map((e) => e.dedupe_key), ["timer_stalled:reaper:roots:2"], "same streak: same key");
});

test("stallCheck writes each stall once and tells the orchestrator once; without its Run it writes only", async () => {
  // The store names RUN (a decision's waiter); RUN's coordinator runs under ORCH_RUN's Dispatch.
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }], { above: { [RUN]: ORCH_RUN } });
  await openDecision(w);
  const sent = w.sends.length;
  const t0 = Date.now();
  reap(w.store, "timer", true, 1);
  const dry = await stallCheck(deps(w.store, w.orca, { now: t0 + 46 * MIN, dry: true }));
  assert.deepEqual(dry.written, []);
  assert.deepEqual(dry.calls, [`would tell orchestrator run:${ORCH_RUN}: no timer round for 46 min (period 10 min)`]);
  const first = await stallCheck(deps(w.store, w.orca, { now: t0 + 46 * MIN }));
  assert.deepEqual(first.written.map((e) => e.inserted), [true]);
  const again = await stallCheck(deps(w.store, w.orca, { now: t0 + 50 * MIN }));
  assert.deepEqual(again.written.map((e) => e.inserted), [false]);
  assert.deepEqual(again.calls, [], "told already: no second lookup, no second send");
  assert.deepEqual(w.sends.slice(sent).map((s) => s.to), [`run:${ORCH_RUN}`]);
  assert.equal(w.store.events({ type: "timer_stalled" }).length, 1);

  const v = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }], { above: {} });
  await openDecision(v);
  const vsent = v.sends.length;
  reap(v.store, "timer", true, 1);
  const quiet = await stallCheck(deps(v.store, v.orca, { now: t0 + 46 * MIN }));
  assert.deepEqual(quiet.calls, ["orchestrator Run unknown: timer_stalled written only"]);
  assert.equal(v.sends.length, vsent);
});

test("orchestratorRun: the one top above every named Run; two different tops are unknown", async () => {
  const two = createWorld(
    [
      { id: T1, run: RUN, status: "dispatched", dispatchId: D1 },
      { id: T2, run: RUN2, status: "dispatched", dispatchId: "ctx_000000000002" },
    ],
    { above: { [RUN]: ORCH_RUN, [RUN2]: "run_000000000008" } },
  );
  await openDecision(two);
  await joinFrom(two, RUN2, T2);
  assert.equal(await orchestratorRun(two.store.events(), runAbove(two.orca)), undefined);
  const chain = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }], { above: { [RUN]: RUN2, [RUN2]: ORCH_RUN } });
  await openDecision(chain);
  assert.equal(await orchestratorRun(chain.store.events(), runAbove(chain.orca)), ORCH_RUN, "a sub-lead's Run climbs to the top");
});

test("runAbove fails closed: an unread hop, a list cut short, another host's rows or a shared terminal is unknown, never the top", async () => {
  type Opts = { showFails?: string; pages?: number; nonLocal?: number; dupe?: boolean };
  // RUN's coordinator runs under RUN2's Dispatch; RUN2's under ORCH_RUN's.
  const stub = (o: Opts = {}) =>
    ({
      runShow: async ({ id }: { id: string }) =>
        id === o.showFails ? { ok: false, error: { code: "x", message: "x" } } : { ok: true, value: { runId: id, objective: "", coordinatorHandle: `term_${id}` } },
      workerList: async ({ cursor }: { cursor?: string }) => {
        const page = Number(cursor ?? 0);
        const rows = page === 0 ? [{ dispatchId: "ctx_a", terminal: `term_${RUN}` }, { dispatchId: "ctx_b", terminal: `term_${RUN2}` }, ...(o.dupe ? [{ dispatchId: "ctx_c", terminal: `term_${RUN}` }] : [])] : [];
        const more = page + 1 < (o.pages ?? 1);
        return { ok: true, value: { rows, nonLocal: { rows: o.nonLocal ?? 0, hostIds: [] }, omittedHostIds: [], truncated: more, ...(more ? { nextCursor: String(page + 1) } : {}) } };
      },
      workerShow: async ({ dispatch }: { dispatch: string }) => ({ ok: true, value: { dispatchId: dispatch, taskId: "t", runId: dispatch === "ctx_a" ? RUN2 : ORCH_RUN, state: "ready" } }),
    }) as unknown as OrcaAdapter;
  const w = createWorld([{ id: T1, run: RUN, status: "dispatched", dispatchId: D1 }]);
  await openDecision(w);
  const events = w.store.events();
  assert.equal(await orchestratorRun(events, runAbove(stub())), ORCH_RUN);
  assert.deepEqual(await runAbove(stub())(ORCH_RUN), { kind: "top" });
  assert.equal(await orchestratorRun(events, runAbove(stub({ showFails: RUN2 }))), undefined, "RUN2 unread is not RUN2 on top");
  assert.equal(await orchestratorRun(events, runAbove(stub({ showFails: ORCH_RUN }))), undefined);
  assert.equal(await orchestratorRun(events, runAbove(stub({ pages: 21 }))), undefined, "past 20 pages");
  assert.equal(await orchestratorRun(events, runAbove(stub({ pages: 3 }))), ORCH_RUN, "a few pages are read in full");
  assert.equal(await orchestratorRun(events, runAbove(stub({ nonLocal: 1 }))), undefined, "another host's rows");
  assert.deepEqual(await runAbove(stub({ dupe: true }))(RUN), { kind: "unknown" }, "two Dispatches on one terminal");
});

test("one notify path: core/detect and the plugin's monitors reach notify only through sendNotice", () => {
  const roots = ["core/detect", "orca-plugin"];
  // vendor/ is the gitignored core copy `npm pack` stages into the plugin, not source.
  const files = roots
    .flatMap((r) => readdirSync(r, { recursive: true, encoding: "utf8" }).map((f) => join(r, f)))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/vendor/"));
  const callers = files.filter((f) => /from\s+"[./]*notify\/notify\.ts"|\bnotify\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(callers, ["core/detect/notice.ts"]);
  assert.deepEqual(files.filter((f) => /\.send\(/.test(readFileSync(f, "utf8"))), [], "no Orca send beside notify");
  const users = files.filter((f) => readFileSync(f, "utf8").includes("sendNotice("));
  assert.deepEqual(users.sort(), ["core/detect/notice.ts", "core/detect/orca/round.ts", "core/detect/pr/round.ts", "core/detect/queue/round.ts"]);
});
