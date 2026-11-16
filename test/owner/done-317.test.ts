import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBrief,
  countsAsEvidence,
  deliverOwnRun,
  itemFacts,
  type OrcaAdapter,
  ownerDone,
  ownerTodoFrom,
  panelCore,
  Store,
  type VerifySpec,
  type ViewInput,
} from "../../core/index.ts";
import { errorNote } from "../../orca-plugin/panel/view.ts";

// Decision 317: Orca takes no task-update from the plugin's process (decision 274), so the panel's
// 완료 records the press and the session that holds the item's Run closes the Task from its prompt
// hook, as decision 275 does for a merged PR.

const RUN = "run_000000000001";
const OTHER = "run_000000000002";
const T = "task_000000000001";
const NOW = "2026-11-16T12:00:00.000Z";
// Orca's code for a write from a process with no terminal (decision 274).
const NO_SENDER_TERMINAL = "no_active_sender_terminal";
const PRESSED ="완료 기록됨: 그 Run 의 세션이 닫는다(대기)";

type Row = { id: string; run: string; status: string; title: string; result?: string };

function world(o: { verify?: VerifySpec; status?: string } = {}) {
  const store = Store.open({ path: ":memory:", clock: () => NOW });
  const tasks: Row[] = [{ id: T, run: RUN, status: o.status ?? "ready", title: "promote to production" }];
  const calls: string[] = [];
  const orca = {
    taskList: async ({ run }: { run: string }) => {
      calls.push("task-list");
      return { ok: true, value: tasks.filter((t) => t.run === run) };
    },
    gateList: async () => {
      calls.push("gate-list");
      return { ok: true, value: [] };
    },
    workerShow: async () => {
      calls.push("worker-show");
      return { ok: false, error: { code: "not_found", message: "" } };
    },
    taskUpdate: async (a: { id: string; status: string; result?: string; run?: string }) => {
      calls.push(`task-update ${a.id} ${a.status} ${a.run ?? "-"}`);
      // The plugin's process passes no Run and Orca cannot tie it to a terminal (decision 274).
      if (!a.run) return { ok: false, error: { code: NO_SENDER_TERMINAL, message: "Could not determine the calling terminal" } };
      const t = tasks.find((x) => x.id === a.id);
      if (t) Object.assign(t, { status: a.status, result: a.result });
      return { ok: true, value: {} };
    },
  } as unknown as OrcaAdapter;
  store.append({ type: "item_created", source: "item_create", payload: { task: T, alias: "i001", who: "owner", done_when: "promoted", owner_action: 0, run: RUN } });
  if (o.verify) store.append({ type: "item_extra_set", source: "test", payload: { task: T, verify: o.verify }, entity: "task", entity_id: T });
  const input = (): ViewInput => ({
    orca: { tasks: tasks.map((t) => ({ id: t.id, runId: t.run, status: t.status as "ready", deps: [], ...(t.result ? { result: t.result } : {}) })), gates: [] },
    events: store.events(),
    now: NOW,
  });
  // The panel's ports, the Orca adapter included: the press must not use it.
  const panelPorts = { orca, store };
  const press = () => ownerDone(panelPorts, input(), itemFacts(input()), { task: T });
  const prompt = async (run = RUN) => {
    const before = calls.length;
    const out = await deliverOwnRun({ store, orca }, run, NOW);
    assert.ok("run" in out, JSON.stringify(out));
    return { calls: calls.slice(before), lines: out.lines };
  };
  const state = () => itemFacts(input()).find((f) => f.task === T)?.state;
  return { store, tasks, calls, orca, input, press, prompt, state };
}

test("317: 완료 calls no Orca; it records the press and one waiting request, and answers pending", async () => {
  const w = world();
  const r = await w.press();
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((r.value as { status?: string }).status, "pending");
  assert.deepEqual(w.calls, [], "the plugin's process makes no task-update Orca would refuse");
  assert.deepEqual(
    w.store.events({ type: "owner_action" }).map((e) => [e.payload.origin, e.entity_id]),
    [["button", T]],
  );
  const asks = w.store.events({ type: "evidence" }).filter((e) => e.payload.kind === "owner_act:done");
  assert.equal(asks.length, 1, "one waiting owner_done request");
  assert.equal(asks[0]?.entity_id, T);
  assert.equal(w.store.events({ type: "item_transition" }).length, 0, "nothing moved: the Task is still open in Orca");
  assert.equal(w.store.events().filter(countsAsEvidence).length, 0, "the request is the owner's input, not evidence");
  assert.equal(w.tasks[0]?.status, "ready");

  // A second press while it waits (a stale panel) writes nothing more.
  const again = await w.press();
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(w.store.events({ type: "evidence" }).filter((e) => e.payload.kind === "owner_act:done").length, 1);
  assert.deepEqual(w.calls, []);
});

test("317: a press something blocks is refused as before and leaves no request", async () => {
  const w = world();
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/app#12", task: T } });
  const r = await w.press();
  assert.equal(r.ok ? null : r.refusal.code, "done_blocked");
  assert.equal(w.store.events({ type: "evidence" }).length, 0);
  assert.deepEqual(w.calls, []);
  assert.deepEqual((await w.prompt()).calls, ["task-list", "gate-list"], "no request: the hook closes nothing");
});

test("317: the session that holds the Run closes the pressed Task with its Run, once, and says so", async () => {
  const w = world();
  assert.ok((await w.press()).ok);
  const first = await w.prompt();
  assert.deepEqual(first.calls, ["task-list", `task-update ${T} completed ${RUN}`, "task-list", "gate-list"]);
  assert.equal(first.lines.length, 1);
  assert.match(first.lines[0] ?? "", / 오너가 완료를 누른 항목을 닫았다: i001\.$/);
  assert.deepEqual([w.tasks[0]?.status, w.tasks[0]?.result], ["completed", "owner_done"]);
  const moved = w.store.events({ type: "item_transition" });
  assert.deepEqual(moved.map((e) => [e.source, e.payload.from, e.payload.to, e.payload.reason]), [["UserPromptSubmit", "ready", "done", "owner_done"]]);
  const proof = w.store.events().filter(countsAsEvidence);
  assert.equal(proof.length, 1, "no verify: the press is the evidence");
  assert.equal(proof[0]?.payload.kind, "owner_done");
  assert.equal(w.state(), "done");

  const later = await w.prompt();
  assert.deepEqual([later.calls, later.lines], [["task-list", "gate-list"], []], "closed: no call, no line");
  assert.equal(w.store.events({ type: "item_transition" }).length, 1);
  assert.equal(w.store.events().filter(countsAsEvidence).length, 1);
});

test("317: a session that holds another Run leaves it; with a verify the closed item reads ⏳ and the press is no evidence", async () => {
  const w = world({ verify: { kind: "pr_merged", pr: "acme/app#12" } });
  assert.ok((await w.press()).ok);
  const other = await w.prompt(OTHER);
  assert.ok(!other.calls.some((c) => c.startsWith("task-update")), "not this Run's Task");
  assert.equal(w.tasks[0]?.status, "ready");

  const mine = await w.prompt();
  assert.ok(mine.calls.includes(`task-update ${T} completed ${RUN}`));
  assert.equal(w.store.events({ type: "item_transition" }).length, 1);
  assert.equal(w.store.events().filter(countsAsEvidence).length, 0, "a verify exists: the probe gives the evidence");
  assert.equal(w.state(), "pending_verify");
});

test("317: an Orca `pending` Task that reads 🟢 is pressed and closed the same way", async () => {
  const w = world({ status: "pending" });
  assert.equal(w.state(), "ready", "GRAPH reads a pending Task with nothing ahead of it as 🟢");
  assert.ok((await w.press()).ok);
  const p = await w.prompt();
  assert.ok(p.calls.includes(`task-update ${T} completed ${RUN}`), JSON.stringify(p.calls));
  assert.equal(w.state(), "done");
});

test("317: a blocker that appears before the hook keeps the request waiting and the Task open", async () => {
  const w = world();
  assert.ok((await w.press()).ok);
  w.store.append({ type: "pr_opened", source: "pr-monitor", payload: { pr: "acme/app#12", task: T } });
  const p = await w.prompt();
  assert.ok(!p.calls.some((c) => c.startsWith("task-update")));
  assert.equal(w.tasks[0]?.status, "ready");
  assert.equal(w.store.events({ type: "item_transition" }).length, 0);
});

test("317: with no session on the Run, brief and panel read the press as waiting on that Run's session", async () => {
  const w = world();
  assert.ok((await w.press()).ok);
  assert.deepEqual(ownerTodoFrom(w.input(), itemFacts(w.input())), [], "pressed: nothing left for the owner to press");
  const b = buildBrief(w.input());
  const row = b.inProgress.rows.find((r) => r.id === "i001");
  assert.equal(row?.cells[3]?.text, PRESSED);
});

test("317: the panel's 완료 says it was recorded for the Run's session, not a refusal", async () => {
  const w = world();
  const core = panelCore({ orca: w.orca, withStore: (fn) => fn(w.store), now: () => NOW, load: async () => ({ ok: true, value: w.input() }) });
  const r = await core.act({ kind: "done", item: "i001" });
  assert.deepEqual(r.ok ? r.value : r, { status: "pending_close", label: "기록했다 — 그 Run 의 세션이 닫는다", item: "i001" });
  assert.deepEqual(w.calls, []);
});

test("317: a refusal's banner shows its code and, for Orca's, Orca's code and what it means in the text", () => {
  const strip = (html: string) => html.replace(/<[^>]+>/g, "");
  const said = strip(errorNote({ code: "orca_error", reason: `task-update ${T}: ${NO_SENDER_TERMINAL} Could not determine the calling terminal`, fix: "x" }));
  assert.doesNotMatch(said, /답하지 않았다/, "Orca answered: it refused");
  assert.match(said, /orca_error/);
  assert.match(said, new RegExp(NO_SENDER_TERMINAL));
  assert.match(said, /터미널/, "what Orca's code means, in Korean");
  assert.doesNotMatch(said, /Could not determine/, "the English reason stays in the title");

  // The other shape a reason takes: "(<code>: <message>)".
  assert.match(strip(errorNote({ code: "orca_error", reason: "task-create 실패 (runtime_unreachable: connect ECONNREFUSED)", fix: "x" })), /runtime_unreachable/);
  // An Orca code with no meaning listed still shows; a non-Orca refusal shows its own code.
  assert.match(strip(errorNote({ code: "orca_error", reason: "gate-list run_1: weird_new_code boom", fix: "x" })), /weird_new_code/);
  assert.match(strip(errorNote({ code: "not_ready", reason: "i001 is done, not 🟢", fix: "x" })), /not_ready/);
});
