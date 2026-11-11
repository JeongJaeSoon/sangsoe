import type { EventDef } from "./define.ts";
import advisor_used from "./events/advisor_used.ts";
import capacity_free from "./events/capacity_free.ts";
import ci_failed from "./events/ci_failed.ts";
import close_suggested from "./events/close_suggested.ts";
import compacted from "./events/compacted.ts";
import decision_answered from "./events/decision_answered.ts";
import decision_closed from "./events/decision_closed.ts";
import decision_joined from "./events/decision_joined.ts";
import decision_opened from "./events/decision_opened.ts";
import decision_untracked from "./events/decision_untracked.ts";
import edge_added from "./events/edge_added.ts";
import edge_removed from "./events/edge_removed.ts";
import escalation from "./events/escalation.ts";
import escalation_stale from "./events/escalation_stale.ts";
import evidence from "./events/evidence.ts";
import flow_expanded from "./events/flow_expanded.ts";
import flow_step_skipped from "./events/flow_step_skipped.ts";
import gate_denied from "./events/gate_denied.ts";
import item_created from "./events/item_created.ts";
import item_extra_set from "./events/item_extra_set.ts";
import item_ready from "./events/item_ready.ts";
import item_transition from "./events/item_transition.ts";
import job_drift from "./events/job_drift.ts";
import land_failed from "./events/land_failed.ts";
import land_requested from "./events/land_requested.ts";
import loop_detected from "./events/loop_detected.ts";
import main_green from "./events/main_green.ts";
import main_red from "./events/main_red.ts";
import mention_new from "./events/mention_new.ts";
import model_changed from "./events/model_changed.ts";
import notified from "./events/notified.ts";
import observed_change from "./events/observed_change.ts";
import owner_act_unlinked from "./events/owner_act_unlinked.ts";
import owner_action from "./events/owner_action.ts";
import owner_class from "./events/owner_class.ts";
import owner_text_redacted from "./events/owner_text_redacted.ts";
import pr_base_changed from "./events/pr_base_changed.ts";
import pr_changes_requested from "./events/pr_changes_requested.ts";
import pr_closed from "./events/pr_closed.ts";
import pr_merged from "./events/pr_merged.ts";
import pr_opened from "./events/pr_opened.ts";
import pr_ready_to_merge from "./events/pr_ready_to_merge.ts";
import pr_reopened from "./events/pr_reopened.ts";
import plugin_approved from "./events/plugin_approved.ts";
import pr_review_requested from "./events/pr_review_requested.ts";
import pressure_high from "./events/pressure_high.ts";
import priority_set from "./events/priority_set.ts";
import rate_limited from "./events/rate_limited.ts";
import reap_blocked from "./events/reap_blocked.ts";
import reap_candidate from "./events/reap_candidate.ts";
import reap_done from "./events/reap_done.ts";
import reap_round from "./events/reap_round.ts";
import refusal_report from "./events/refusal_report.ts";
import resource from "./events/resource.ts";
import resource_adopted from "./events/resource_adopted.ts";
import resource_leak from "./events/resource_leak.ts";
import review_ask_sent from "./events/review_ask_sent.ts";
import review_commented from "./events/review_commented.ts";
import review_replied from "./events/review_replied.ts";
import review_verdict from "./events/review_verdict.ts";
import run_stalled from "./events/run_stalled.ts";
import session_started from "./events/session_started.ts";
import signal from "./events/signal.ts";
import stage_recorded from "./events/stage_recorded.ts";
import timer_stalled from "./events/timer_stalled.ts";
import todo_due from "./events/todo_due.ts";
import trigger_unclear from "./events/trigger_unclear.ts";
import turn_ended from "./events/turn_ended.ts";
import unit_started from "./events/unit_started.ts";
import unmapped_reviewer from "./events/unmapped_reviewer.ts";
import verify_tier_set from "./events/verify_tier_set.ts";
import waiting_decision from "./events/waiting_decision.ts";
import waiting_human from "./events/waiting_human.ts";
import waiting_released from "./events/waiting_released.ts";
import wake_unconfirmed from "./events/wake_unconfirmed.ts";
import worker_dead from "./events/worker_dead.ts";
import worker_done from "./events/worker_done.ts";
import worker_idle from "./events/worker_idle.ts";
import worker_stuck from "./events/worker_stuck.ts";

export * from "./clock.ts";
export * from "./dedupe.ts";
export * from "./define.ts";
export * from "./notify-key.ts";
export * from "./transitions.ts";
export type * from "./views.ts";
export { ITEM_READINGS, READING_LABEL } from "./views.ts";

// A new event type is one file under events/ plus one import line and one entry here (split §1.3).
export const EVENTS = {
  advisor_used,
  capacity_free,
  ci_failed,
  close_suggested,
  compacted,
  decision_answered,
  decision_closed,
  decision_joined,
  decision_opened,
  decision_untracked,
  edge_added,
  edge_removed,
  escalation,
  escalation_stale,
  evidence,
  flow_expanded,
  flow_step_skipped,
  gate_denied,
  item_created,
  item_extra_set,
  item_ready,
  item_transition,
  job_drift,
  land_failed,
  land_requested,
  loop_detected,
  main_green,
  main_red,
  mention_new,
  model_changed,
  notified,
  observed_change,
  owner_act_unlinked,
  owner_action,
  owner_class,
  owner_text_redacted,
  pr_base_changed,
  pr_changes_requested,
  pr_closed,
  pr_merged,
  pr_opened,
  pr_ready_to_merge,
  pr_reopened,
  plugin_approved,
  pr_review_requested,
  pressure_high,
  priority_set,
  rate_limited,
  reap_blocked,
  reap_candidate,
  reap_done,
  reap_round,
  refusal_report,
  resource,
  resource_adopted,
  resource_leak,
  review_ask_sent,
  review_commented,
  review_replied,
  review_verdict,
  run_stalled,
  session_started,
  signal,
  stage_recorded,
  timer_stalled,
  todo_due,
  trigger_unclear,
  turn_ended,
  unit_started,
  unmapped_reviewer,
  verify_tier_set,
  waiting_decision,
  waiting_human,
  waiting_released,
  wake_unconfirmed,
  worker_dead,
  worker_done,
  worker_idle,
  worker_stuck,
} as const;

export type Events = typeof EVENTS;
export type EventType = keyof Events;
export type PayloadOf<T extends EventType> = Events[T] extends EventDef<T, infer P> ? P : never;

export function eventDef(type: string): EventDef | undefined {
  return Object.hasOwn(EVENTS, type) ? (EVENTS[type as EventType] as EventDef) : undefined;
}
