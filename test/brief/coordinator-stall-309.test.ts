import assert from "node:assert/strict";
import { test } from "node:test";
import { type BriefInput, panelView, renderMarkdown } from "../../core/index.ts";

// Decision 309: orca-monitor writes run_stalled{coordinator} for a Dispatch-less coordinator that
// stopped (decision 245), and since decision 274 the timer cannot send its notice. The brief and
// status bar item B are where the owner reads it: one 🚨 line per Run until a session holding that
// Run moves again, or 24 hours pass.

const NOW = "2026-11-11T12:00:00Z";
const LINE = /🚨 코디네이터 멈춤 · run:run_l · term_lead · 45m 전 감지/;

type Ev = { type: string; ts: string; target?: string; subject?: string; payload: Record<string, unknown> };
type At = (minutesAgo: number) => string;

function input(fill: (push: (e: Ev) => void, at: At) => void, now = NOW): BriefInput {
  const at: At = (m) => new Date(Date.parse(now) - m * 60_000).toISOString();
  const rows: Ev[] = [];
  fill((e) => rows.push(e), at);
  const events = rows.map((e, i) => ({
    seq: i + 1,
    source: "test",
    target: e.target ?? null,
    subject: e.subject ?? null,
    entity: null,
    entity_id: null,
    actor: null,
    needs: "none",
    severity: null,
    dedupe_key: null,
    schema_v: 1,
    before: null,
    ...e,
  }));
  return { orca: { tasks: [], gates: [] }, events, now } as unknown as BriefInput;
}

type Push = (e: Ev) => void;
const started = (push: Push, session: string, role: string, held: string | null, ts: string, subject?: string) =>
  push({ type: "session_started", ts, ...(held ? { target: `run:${held}` } : {}), ...(subject ? { subject: `run:${subject}` } : {}), payload: { session, role, model: "m" } });
const stalled = (push: Push, run: string, ts: string, coordinator: string | null = "term_lead") =>
  push({ type: "run_stalled", ts, payload: { run, ...(coordinator ? { coordinator } : {}) } });
const turn = (push: Push, session: string, ts: string) => push({ type: "turn_ended", ts, payload: { session } });

function read(i: BriefInput) {
  const v = panelView(i, {});
  assert.ok(v.ok, JSON.stringify(v));
  return { text: renderMarkdown(v.value.model), status: v.value.status };
}

test("an unresolved coordinator stall: one 🚨 line in the brief and a danger 🚨 entry on status bar item B", () => {
  const r = read(
    input((p, at) => {
      started(p, "sess_lead", "lead", "run_l", at(200));
      stalled(p, "run_l", at(45));
    }),
  );
  assert.match(r.text, LINE);
  assert.equal(r.text.match(/🚨 코디네이터 멈춤/g)?.length, 1);
  assert.match(r.status.text, /🚨 1/);
  assert.equal(r.status.tone, "danger");
  assert.match(r.status.tooltip, LINE);
});

test("the holder's next turn, prompt or restart ends it", () => {
  const cases: [string, (p: Push, at: At) => void][] = [
    ["turn", (p, at) => turn(p, "sess_lead", at(10))],
    ["owner prompt", (p, at) => p({ type: "owner_action", ts: at(10), payload: { origin: "chat", summary: "x", hash: "h", cc_session: "sess_lead" } })],
    ["restart", (p, at) => started(p, "sess_lead_2", "lead", "run_l", at(10))],
  ];
  for (const [name, move] of cases) {
    const r = read(
      input((p, at) => {
        started(p, "sess_lead", "lead", "run_l", at(200));
        stalled(p, "run_l", at(45));
        move(p, at);
      }),
    );
    assert.doesNotMatch(r.text, /코디네이터 멈춤/, name);
    assert.doesNotMatch(r.status.text, /🚨/, name);
  }
});

test("a worker of that Run, or another Run's coordinator, ending a turn does not end it", () => {
  const r = read(
    input((p, at) => {
      started(p, "sess_lead", "lead", "run_l", at(200));
      started(p, "sess_worker", "worker", "run_l", at(150), "run_l");
      started(p, "sess_orch", "orchestrator", "run_o", at(300));
      // A turn before the row is the turn the stall came after.
      turn(p, "sess_lead", at(46));
      stalled(p, "run_l", at(45));
      turn(p, "sess_worker", at(20));
      turn(p, "sess_orch", at(10));
    }),
  );
  assert.match(r.text, LINE);
});

test("only the Run a session holds now counts, read from target, never subject", () => {
  const moved = read(
    input((p, at) => {
      started(p, "sess_lead", "lead", "run_l", at(300));
      // The same session took another Run since: its turns are that Run's.
      started(p, "sess_lead", "lead", "run_x", at(100));
      stalled(p, "run_l", at(45));
      turn(p, "sess_lead", at(10));
    }),
  );
  assert.match(moved.text, LINE);

  const tasked = read(
    input((p, at) => {
      // A lead with a Task lives in the orchestrator's Run (subject) and holds none yet.
      started(p, "sess_tasked", "lead", null, at(200), "run_l");
      stalled(p, "run_l", at(45));
      turn(p, "sess_tasked", at(10));
    }),
  );
  assert.match(tasked.text, LINE);
});

test("a worker run_stalled (no coordinator) and a stall older than 24 hours show nothing", () => {
  const r = read(
    input((p, at) => {
      stalled(p, "run_w", at(30), null);
      stalled(p, "run_l", at(25 * 60));
    }),
  );
  assert.doesNotMatch(r.text, /코디네이터 멈춤/);
  assert.doesNotMatch(r.status.text, /🚨/);
});

test("one stall written under two pane keys is one line; a stall after a resolved one shows again", () => {
  const twice = read(
    input((p, at) => {
      stalled(p, "run_l", at(50));
      stalled(p, "run_l", at(45));
    }),
  );
  assert.equal(twice.text.match(/🚨 코디네이터 멈춤/g)?.length, 1);
  assert.match(twice.text, LINE);

  const again = read(
    input((p, at) => {
      started(p, "sess_lead", "lead", "run_l", at(300));
      stalled(p, "run_l", at(200));
      turn(p, "sess_lead", at(100));
      stalled(p, "run_l", at(45));
    }),
  );
  assert.match(again.text, LINE);
});
