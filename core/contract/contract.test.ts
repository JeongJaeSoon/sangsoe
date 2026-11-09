import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ALLOWED_TRANSITIONS,
  ContractError,
  canTransition,
  checkDedupeKey,
  dedupeKey,
  EVENTS,
  type EventDef,
  eventDef,
  ITEM_STATES,
  ORCA_OWNED_KEYS,
} from "./index.ts";

// Appendix #signal-flow "event 이름 전체", every writer's row, plus the names decisions 82·83·85·86·88·91
// added there. plugin_approved (U3, split Q12) is added by its unit; start_refused is a `signal` kind (decision 94 (바)).
const SPEC_TYPES = [
  ...["waiting_human", "turn_ended", "worker_idle", "loop_detected", "session_started", "gate_denied"],
  ...["worker_stuck", "worker_dead", "compacted", "waiting_released", "owner_action", "evidence", "owner_act_unlinked"],
  "mention_new",
  ...["item_ready", "todo_due", "trigger_unclear", "close_suggested", "escalation_stale", "decision_closed", "job_drift"],
  ...["resource_leak", "capacity_free", "pressure_high"],
  ...["wake_unconfirmed", "run_stalled", "waiting_decision", "observed_change", "decision_untracked"],
  ...["verify_tier_set", "pr_opened", "pr_review_requested", "pr_changes_requested", "pr_ready_to_merge", "pr_merged"],
  ...["main_green", "main_red", "pr_closed", "pr_base_changed", "ci_failed", "review_commented", "review_replied"],
  "rate_limited",
  ...["land_requested", "land_failed"],
  ...["reap_done", "reap_blocked", "resource_adopted", "reap_round", "reap_candidate", "timer_stalled"],
  ...["review_ask_sent", "unmapped_reviewer", "notified", "edge_added", "edge_removed", "flow_expanded", "resource"],
  ...["item_created", "item_extra_set", "item_transition", "priority_set", "flow_step_skipped", "decision_opened"],
  ...["decision_joined", "decision_answered", "escalation", "refusal_report", "stage_recorded", "worker_done"],
  ...["model_changed", "signal", "owner_class", "owner_text_redacted"],
];

const eventsDir = new URL("./events/", import.meta.url);
const fixtures: { type: string; target?: string; dedupe_key?: string; payload: Record<string, unknown> }[] = readFileSync(
  new URL("../../test/fixtures/events/events.jsonl", import.meta.url),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

test("every spec event type has its own file, registered under the file's name", async () => {
  const files = readdirSync(eventsDir).map((f) => f.replace(/\.ts$/, ""));
  assert.equal(new Set(SPEC_TYPES).size, 74);
  assert.deepEqual(
    SPEC_TYPES.filter((t) => !files.includes(t)),
    [],
  );
  for (const name of files) {
    const mod = (await import(new URL(`${name}.ts`, eventsDir).href)) as { default: EventDef };
    assert.equal(mod.default.type, name, `events/${name}.ts defines ${mod.default.type}`);
    assert.equal(eventDef(name), mod.default, `${name} is registered in contract/index.ts`);
  }
  assert.equal(Object.keys(EVENTS).length, files.length);
});

test("each type has one fixture line its validator accepts", () => {
  assert.deepEqual(fixtures.map((f) => f.type).sort(), Object.keys(EVENTS).sort());
  for (const f of fixtures) {
    const def = eventDef(f.type);
    assert.ok(def, f.type);
    def.payload(f.payload, f.type);
    if (f.dedupe_key) checkDedupeKey(def, f.dedupe_key, f.payload, { target: f.target });
  }
});

test("each validator rejects its fixture with a required field removed or a wrong type", () => {
  for (const f of fixtures) {
    const def = eventDef(f.type) as EventDef;
    assert.throws(() => def.payload("not an object", f.type), ContractError, f.type);
    const required = Object.keys(f.payload).filter((k) => {
      const { [k]: _, ...rest } = f.payload;
      try {
        def.payload(rest, f.type);
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(required.length > 0, `${f.type} has at least one required field`);
  }
});

test("readers ignore fields they do not know (tolerant reader)", () => {
  const def = EVENTS.pr_merged;
  const out = def.payload({ pr: "acme/api#1", merge_sha: "abcdef1", added_later: 3 }, "pr_merged");
  assert.equal((out as Record<string, unknown>).added_later, 3);
});

test("no payload may carry a fact Orca owns (decision 74)", () => {
  for (const f of fixtures) {
    const def = eventDef(f.type) as EventDef;
    for (const k of ORCA_OWNED_KEYS) {
      assert.throws(() => def.payload({ ...f.payload, [k]: "x" }, f.type), /Orca owns this fact/, `${f.type}.${k}`);
    }
  }
});

test("dedupe_key: <prefix>:<target>[:<condition>], the prefix is the type's own and no two types share one", () => {
  const prefixes = Object.values(EVENTS).map((d) => d.dedupe);
  assert.equal(new Set(prefixes).size, prefixes.length);
  assert.equal(EVENTS.notified.dedupe, "notify");
  assert.equal(EVENTS.decision_opened.dedupe, "decision");
  assert.equal(EVENTS.item_ready.dedupe, "ready");
  assert.equal(EVENTS.edge_added.dedupe, "edge");
  assert.equal(EVENTS.waiting_released.dedupe, "waiting_released");
  assert.equal(dedupeKey(EVENTS.decision_opened, "api-version", "r2"), "decision:api-version:r2");
  checkDedupeKey(EVENTS.waiting_released, "waiting_released:68");
  assert.throws(() => checkDedupeKey(EVENTS.notified, "notified:lead:x"), /keys start with "notify:"/);
  assert.throws(() => checkDedupeKey(EVENTS.item_ready, "ready:"), /expected <prefix>/);
  assert.throws(() => checkDedupeKey(EVENTS.item_ready, "ready:a b"), /expected <prefix>/);
});

test("transition table: 19 allowed and 30 refused of the 49 ordered pairs (C1)", () => {
  let allowed = 0;
  let refused = 0;
  const perState: Record<string, number> = {};
  for (const from of ITEM_STATES) {
    for (const to of ITEM_STATES) {
      if (canTransition(from, to)) {
        allowed++;
        perState[from] = (perState[from] ?? 0) + 1;
        assert.notEqual(from, to, "a same-state transition is refused");
      } else refused++;
    }
  }
  assert.equal(ITEM_STATES.length * ITEM_STATES.length, 49);
  assert.equal(allowed, 19);
  assert.equal(refused, 30);
  assert.deepEqual(perState, { planned: 3, ready: 4, in_progress: 5, blocked: 4, on_hold: 3 });
  assert.deepEqual(ALLOWED_TRANSITIONS.done, []);
  assert.deepEqual(ALLOWED_TRANSITIONS.cancelled, []);
  assert.ok(canTransition("in_progress", "ready"), "a dropped Dispatch returns the item to ready");
  assert.ok(!canTransition("planned", "in_progress"), "nothing starts before it is ready");
});
