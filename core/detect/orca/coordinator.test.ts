import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxMessage, LocalRows, WorktreePsAgent, WorktreePsRow } from "../../contract/orca.ts";
import { DEFAULT_MONITOR_CONFIG as C, minutes, type Planned } from "../monitor.ts";
import { type CoordinatorRead, fromMail, INBOX_PAGE, judgeCoordinators, namedRuns, oldUnread, recipientOf } from "./coordinator.ts";

// Decision 245: a Run whose coordinator holds no Dispatch is stalled when its mail sits unread N
// minutes and that coordinator's agent in `worktree ps` has not worked since the mail arrived.
// Orca's fields only: the read flag, created_at, the ps agent's state and stateStartedAt. No screen
// text (decision 87), no store rows.

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ago = (m: number) => NOW - minutes(m);
const iso = (ms: number) => new Date(ms).toISOString();
const N = C.stuckMinutes;

let n = 0;
const mail = (to: string, sentAgo: number, more: Partial<InboxMessage> = {}): InboxMessage => ({
  id: `msg_${++n}`,
  type: "worker_done",
  from: "dispatch:ctx_1",
  to,
  subject: "s",
  handled: false,
  createdAt: iso(ago(sentAgo)),
  ...more,
});
const agent = (pane: string, a: Partial<WorktreePsAgent>): WorktreePsAgent => ({ paneKey: pane, state: "done", agentType: "claude", agentWait: null, ...a });
const ps = (...agents: WorktreePsAgent[]): LocalRows<WorktreePsRow> => ({
  rows: [{ worktreeId: "w", repo: "api", path: "/w", branch: "b", isMainWorktree: false, isArchived: false, liveTerminalCount: 1, unverifiableTerminalCount: 0, status: "idle", agents }],
  nonLocal: { rows: 0, hostIds: [] },
  omittedHostIds: [],
  truncated: false,
});
const lead: CoordinatorRead = { pane: "tab_l:leaf_l", handle: "term_lead", dispatch: false };
const orch: CoordinatorRead = { pane: "tab_o:leaf_o", handle: "term_orch", dispatch: false };
const coords = new Map([
  ["run_a", lead],
  ["run_o", orch],
]);

function judge(inbox: InboxMessage[] | null, rows: LocalRows<WorktreePsRow> | null, k: ReadonlyMap<string, CoordinatorRead> = coords) {
  const planned: Planned[] = [];
  const unseen: string[] = [];
  judgeCoordinators(inbox, k, rows, NOW, C, planned, unseen);
  return { planned, unseen };
}

test("mail unread N minutes after the coordinator went idle: one run_stalled naming the Run and its coordinator", () => {
  const r = judge([mail("run:run_a", N + 5)], ps(agent(lead.pane ?? "", { stateStartedAt: ago(90) })));
  assert.deepEqual(
    r.planned.map((e) => [e.type, e.payload]),
    [["run_stalled", { run: "run_a", coordinator: "term_lead" }]],
  );
  assert.equal(r.planned[0]?.dedupe_key, `run_stalled:run_a:coordinator:tab_l%3Aleaf_l:${ago(90)}`);
});

test("more mail in the same stall is the same key; a turn after it re-arms with a new key", () => {
  const idle = ps(agent(lead.pane ?? "", { stateStartedAt: ago(90) }));
  const a = judge([mail("run:run_a", 60)], idle).planned[0]?.dedupe_key;
  const b = judge([mail("run:run_a", 60), mail("run:run_a", N + 1)], idle).planned[0]?.dedupe_key;
  assert.ok(a);
  assert.equal(a, b);
  const later = judge([mail("run:run_a", 40)], ps(agent(lead.pane ?? "", { stateStartedAt: ago(50) }))).planned[0]?.dedupe_key;
  assert.ok(later && later !== a);
});

test("an older unread message from before the last turn does not hide mail that came after it", () => {
  const box = [mail("run:run_a", 120), mail("run:run_a", 60)];
  const r = judge(box, ps(agent(lead.pane ?? "", { stateStartedAt: ago(100) })));
  assert.deepEqual(
    r.planned.map((e) => e.dedupe_key),
    [`run_stalled:run_a:coordinator:tab_l%3Aleaf_l:${ago(100)}`],
  );
});

test("a coordinator that took a turn after the mail, is working, or waits on a person is not stalled", () => {
  const box = [mail("run:run_a", 60)];
  assert.deepEqual(judge(box, ps(agent(lead.pane ?? "", { stateStartedAt: ago(50) }))).planned, [], "idle since after the mail");
  assert.deepEqual(judge(box, ps(agent(lead.pane ?? "", { state: "working", stateStartedAt: ago(90) }))).planned, [], "a long turn is not a stall");
  const wait = agent(lead.pane ?? "", { state: "waiting", stateStartedAt: ago(90), agentWait: { state: "permission" } });
  assert.deepEqual(judge(box, ps(wait)).planned, [], "waiting_human covers it");
});

test("mail read, younger than N, or without created_at is no stall", () => {
  const idle = ps(agent(lead.pane ?? "", { stateStartedAt: ago(90) }));
  assert.deepEqual(judge([mail("run:run_a", 60, { handled: true })], idle).planned, []);
  assert.deepEqual(judge([mail("run:run_a", N - 1)], idle).planned, []);
  const { createdAt: _, ...bare } = mail("run:run_a", 60);
  assert.deepEqual(judge([bare], idle).planned, []);
  assert.deepEqual(judge([mail("dispatch:ctx_9", 60)], idle).planned, [], "a Dispatch's mail is not a Run's");
});

test("a coordinator holding a Dispatch is left to Orca's stop mail; what was not seen is unseen, not quiet", () => {
  const idle = ps(agent(lead.pane ?? "", { stateStartedAt: ago(90) }));
  const box = [mail("run:run_a", 60)];
  assert.deepEqual(judge(box, idle, new Map([["run_a", { ...lead, dispatch: true }]])), { planned: [], unseen: [] });
  const noWorkers = new Map<string, CoordinatorRead>([["run_a", { pane: "tab_l:leaf_l", handle: "term_lead" }]]);
  const cases: [ReadonlyMap<string, CoordinatorRead>, LocalRows<WorktreePsRow> | null][] = [
    [new Map(), idle],
    [noWorkers, idle],
    [coords, ps()],
    [coords, null],
    [coords, ps(agent(lead.pane ?? "", {}))],
  ];
  for (const [k, rows] of cases) {
    const r = judge(box, rows, k);
    assert.deepEqual(r.planned, []);
    assert.equal(r.unseen.length, 1, r.unseen.join("\n"));
  }
  assert.deepEqual(judge(null, idle), { planned: [], unseen: [] }, "judgeWakes already reports the inbox unread");
});

test("a full page that does not reach N minutes back is unseen", () => {
  const page = Array.from({ length: INBOX_PAGE }, () => mail("run:run_z", 1, { handled: true }));
  assert.equal(judge(page, ps()).unseen.length, 1);
});

test("oldUnread keeps the newest old unread mail per Run; namedRuns reads recipients and run_id", () => {
  const newest = mail("run:run_a", 40);
  const box = [mail("run:run_a", 80), newest, mail("run:run_a", N - 1), mail("run:run_b", 5), mail("dispatch:ctx_1", 90, { runId: "run_c" })];
  assert.deepEqual([...oldUnread(box, NOW, C)].map(([r, m]) => [r, m.id]), [["run_a", newest.id]]);
  assert.deepEqual(namedRuns(box), ["run_a", "run_b", "run_c"]);
});

test("fromMail: the newest terminal and pane that sent the Run's mail to one of its Dispatches", () => {
  const box = [
    mail("dispatch:ctx_1", 30, { runId: "run_a", from: "term_x", senderPane: "old:pane" }),
    mail("dispatch:ctx_2", 10, { runId: "run_a", from: "term_y", senderPane: "new:pane" }),
    mail("run:run_a", 5, { runId: "run_a", from: "term_w", senderPane: "worker:pane" }),
    mail("dispatch:ctx_3", 1, { runId: "run_b", from: "term_z", senderPane: "other:pane" }),
  ];
  assert.deepEqual(fromMail(box, "run_a"), { pane: "new:pane", handle: "term_y" });
  assert.equal(fromMail(box, "run_q"), undefined);
});

test("recipientOf: the one other top Run, the stalled Run when it is the only top, else no one", () => {
  assert.equal(recipientOf("run_a", coords), "run_o");
  assert.equal(recipientOf("run_o", new Map([["run_o", orch]])), "run_o");
  assert.equal(recipientOf("run_a", new Map([...coords, ["run_b", { pane: "p:b", handle: "term_b", dispatch: false }]])), undefined);
  assert.equal(recipientOf("run_a", new Map([...coords, ["run_d", { pane: "p:d", handle: "term_d", dispatch: true }]])), "run_o", "a dispatched lead is no top");
  assert.equal(recipientOf("run_a", new Map([["run_a", lead], ["run_o", { pane: "p:o", handle: "term_o" }]])), undefined, "unknown Dispatch is no top");
  assert.equal(recipientOf("run_a", new Map([["run_a", lead], ["run_o", { unresolved: true }]])), undefined, "a live coordinator not placed is unknown");
  assert.equal(recipientOf("run_a", new Map([["run_a", lead], ["run_o", orch], ["run_g", {}]])), "run_o", "a Run with no live terminal is no top");
  assert.equal(recipientOf("run_o", new Map([["run_o", orch], ["run_g", {}]])), undefined, "a Run with no live terminal may be a resumed orchestrator: no self-notice");
});
