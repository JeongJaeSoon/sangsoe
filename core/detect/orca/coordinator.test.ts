import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredEvent } from "../../contract/index.ts";
import type { InboxMessage } from "../../contract/orca.ts";
import { DEFAULT_MONITOR_CONFIG as C, minutes, type Planned } from "../monitor.ts";
import { INBOX_PAGE, judgeCoordinators, orchestratorRunOf } from "./coordinator.ts";

// Decision 245: a coordinator holding no Dispatch is stalled when its Run's mail sits unread N
// minutes after that session's last turn end. Orca's read flag and created_at plus the store's own
// session_started and turn_ended rows are the whole input: no screen text (decision 87).

const NOW = Date.parse("2026-11-14T12:00:00Z");
const ago = (m: number) => new Date(NOW - minutes(m)).toISOString();
const N = C.stuckMinutes;

let seq = 0;
const ev = (type: string, ts: string, payload: Record<string, unknown>, more: Partial<StoredEvent> = {}): StoredEvent =>
  ({ seq: ++seq, ts, type, source: "t", target: null, entity: null, entity_id: null, subject: null, dedupe_key: null, payload, ...more }) as unknown as StoredEvent;
const started = (session: string, run: string, ts: string, more: { role?: string; task?: string } = {}) =>
  ev("session_started", ts, { session, role: more.role ?? "lead", model: "m" }, {
    target: `run:${run}`,
    ...(more.task ? { entity: "task", entity_id: more.task, subject: "run:run_up" } : {}),
  });
const turn = (session: string, ts: string) => ev("turn_ended", ts, { session });
const mail = (to: string, createdAt: string, handled = false, id = `msg_${++seq}`): InboxMessage => ({ id, type: "worker_done", from: "dispatch:ctx_1", to, subject: "s", handled, createdAt });

function judge(inbox: InboxMessage[] | null, events: StoredEvent[]) {
  const planned: Planned[] = [];
  const unseen: string[] = [];
  judgeCoordinators(inbox, events, NOW, C, planned, unseen);
  return { planned, unseen };
}

test("mail unread N minutes after the coordinator's last turn end: one run_stalled for its Run", () => {
  const events = [started("s_lead", "run_a", ago(120)), turn("s_lead", ago(90))];
  const r = judge([mail("run:run_a", ago(N + 5))], events);
  assert.deepEqual(
    r.planned.map((e) => [e.type, e.payload]),
    [["run_stalled", { run: "run_a", session: "s_lead" }]],
  );
  assert.match(String(r.planned[0]?.dedupe_key), /^run_stalled:run_a:coordinator:s_lead:/);
});

test("a later round of the same stall plans the same key, so the store keeps one row", () => {
  const events = [started("s_lead", "run_a", ago(120)), turn("s_lead", ago(90))];
  const box = [mail("run:run_a", ago(N + 5))];
  const a = judge(box, events).planned[0]?.dedupe_key;
  const b = judge([...box, mail("run:run_a", ago(N + 1))], events).planned[0]?.dedupe_key;
  assert.ok(a);
  assert.equal(a, b, "more mail in the same stall is the same episode");
});

test("a turn that ends after the mail clears it; the next stall after that turn is a new key", () => {
  const events = [started("s_lead", "run_a", ago(120)), turn("s_lead", ago(90))];
  const first = judge([mail("run:run_a", ago(60))], events).planned[0]?.dedupe_key;
  const took = [...events, turn("s_lead", ago(50))];
  assert.deepEqual(judge([mail("run:run_a", ago(60))], took).planned, [], "a session that takes a turn is not stalled");
  const again = judge([mail("run:run_a", ago(60)), mail("run:run_a", ago(45))], took).planned[0]?.dedupe_key;
  assert.ok(first && again && first !== again, "re-arms after the next turn");
});

test("a session that reads its mail, or mail younger than N, is not stalled", () => {
  const events = [started("s_lead", "run_a", ago(120)), turn("s_lead", ago(90))];
  assert.deepEqual(judge([mail("run:run_a", ago(60), true)], events).planned, []);
  assert.deepEqual(judge([mail("run:run_a", ago(N - 1))], events).planned, []);
});

test("without a turn record the session's start is its last turn end", () => {
  const events = [started("s_orch", "run_o", ago(120), { role: "orchestrator" })];
  assert.equal(judge([mail("run:run_o", ago(60))], events).planned.length, 1);
  assert.deepEqual(judge([mail("run:run_o", ago(130))], events).planned, [], "mail older than the session is not this session's stall");
});

test("only the Run's latest coordinator counts, and only when it holds no Dispatch", () => {
  const dispatched = [started("s_lead", "run_a", ago(120), { task: "task_lead" })];
  assert.deepEqual(judge([mail("run:run_a", ago(60))], dispatched).planned, [], "Orca's stop mail covers a Dispatch holder");
  const replaced = [started("s_old", "run_a", ago(200)), started("s_new", "run_a", ago(40))];
  assert.deepEqual(judge([mail("run:run_a", ago(60))], replaced).planned, [], "mail before the new session started");
  assert.deepEqual(judge([mail("run:run_b", ago(60)), mail("dispatch:ctx_9", ago(60))], replaced).planned, [], "no sangsoe coordinator for run_b; a Dispatch's mail is not a Run's");
});

test("mail with no created_at is not judged; an unread inbox is unseen", () => {
  const events = [started("s_lead", "run_a", ago(120))];
  const { createdAt: _, ...bare } = mail("run:run_a", ago(60));
  assert.deepEqual(judge([bare], events).planned, []);
  assert.deepEqual(judge(null, events), { planned: [], unseen: [] }, "judgeWakes already reports the inbox unread");
});

test("a full page that does not reach N minutes back is unseen, not quiet", () => {
  const events = [started("s_lead", "run_a", ago(120))];
  const page = Array.from({ length: INBOX_PAGE }, () => mail("run:run_z", ago(1), true));
  const r = judge(page, events);
  assert.deepEqual(r.planned, []);
  assert.equal(r.unseen.length, 1);
});

test("the orchestrator's Run is the Run its latest Task-less session held", () => {
  assert.equal(orchestratorRunOf([started("s_lead", "run_a", ago(5))]), undefined);
  const events = [started("s_o1", "run_o1", ago(100), { role: "orchestrator" }), started("s_o2", "run_o2", ago(10), { role: "orchestrator" }), started("s_lead", "run_a", ago(5))];
  assert.equal(orchestratorRunOf(events), "run_o2");
});
