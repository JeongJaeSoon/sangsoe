import type { DecisionRow, OwnerTodoRow, ViewGate, ViewInput } from "../contract/index.ts";
import { decision } from "../store/views/decision.ts";
import { ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS, type OwnerConfig, type OwnerItemFacts } from "./types.ts";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * "Answered but a waiter's gate is still open". The decision view sets `undelivered` only while the
 * row is `answered`, but decisionAnswer writes decision_closed{answered} right after the answer, so a
 * closed-by-answer row with an open waiter gate is undelivered too.
 */
export function isUndelivered(d: DecisionRow, gates: readonly ViewGate[]): boolean {
  if (d.undelivered) return true;
  if (d.closedReason !== "answered") return false;
  const open = new Set(gates.filter((g) => g.open).map((g) => g.id));
  return d.waiters.some((w) => w.gate !== null && open.has(w.gate));
}

/** A refused start leaves its Task open; it stops being the owner's once Orca shows the Task moved on. */
const STILL_REFUSED = new Set(["pending", "ready"]);

/**
 * The owner's to-do (decisions 12, 89, 91): open decisions, the owner's 🟢 items, waiting_human rows
 * the owning lead could not release, and undelivered answers. Every row leaves only on an observed
 * fact or a recorded answer: a verify probe that came true takes the owner item out (it goes to the
 * holder as close_suggested), waiting_released takes the wait out. An orchestrator's refused start
 * (escalation{to: owner}, decision 94 (다)) is the owner's too, as the row of the item whose Task it
 * could not start. One item is one row.
 */
export function ownerTodoFrom(input: ViewInput, facts: readonly OwnerItemFacts[], cfg: Pick<OwnerConfig, "waitMinutes"> = OWNER_DEFAULTS): OwnerTodoRow[] {
  const byTask = new Map(facts.map((f) => [f.task, f]));
  const marks = ownerMarks(input, cfg);
  const opened = new Map<string, string>();
  const answered = new Map<string, string>();
  const stale = new Set<string>();
  const released = new Set<string>();
  for (const e of input.events) {
    const d = str(e.payload.decision);
    if (e.type === "decision_opened" && d) opened.set(d, e.ts);
    if (e.type === "decision_answered" && d && e.payload.late !== true && !answered.has(d)) answered.set(d, e.ts);
    if (e.type === "escalation_stale" && e.payload.reason === "waiting_unreleased") stale.add(String(e.payload.ref));
    if (e.type === "waiting_released") released.add(String(e.payload.ref));
  }

  const rows: OwnerTodoRow[] = [];
  for (const d of decision(input)) {
    if (d.state === "open") rows.push({ kind: "decision", ref: d.decision, whyOwner: null, since: opened.get(d.decision) ?? input.now });
    else if (isUndelivered(d, input.orca.gates)) rows.push({ kind: "undelivered_answer", ref: d.decision, whyOwner: null, since: answered.get(d.decision) ?? input.now });
  }
  for (const f of facts) {
    if (f.state !== "ready" || !isOwnerItem(f)) continue;
    if (marks.get(f.task)?.verified) continue;
    rows.push({ kind: "owner_item", ref: f.alias, whyOwner: f.whyOwner, since: f.since ?? input.now });
  }
  for (const e of input.events) {
    if (e.type !== "waiting_human" || !stale.has(String(e.seq)) || released.has(String(e.seq))) continue;
    const f = e.entity === "task" && e.entity_id ? byTask.get(e.entity_id) : undefined;
    if (f && (f.state === "done" || f.state === "cancelled")) continue;
    const why = str(e.payload.excerpt) ?? str(e.payload.tool);
    rows.push({ kind: "waiting_human", ref: f ? f.alias : `w${e.seq}`, whyOwner: why, since: e.ts });
  }
  const tasks = new Map(input.orca.tasks.map((t) => [t.id, t]));
  for (const e of input.events) {
    if (e.type !== "escalation" || e.payload.to !== "owner" || e.entity !== "task" || !e.entity_id) continue;
    const f = byTask.get(e.entity_id);
    const t = tasks.get(e.entity_id);
    if (!f || !t || !STILL_REFUSED.has(t.status)) continue;
    rows.push({ kind: "owner_item", ref: f.alias, whyOwner: str(e.payload.reason), since: e.ts });
  }
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.ref) && seen.add(r.ref));
}
