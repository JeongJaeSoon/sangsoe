import type { OwnerTodoRow, OwnerTodoView, ViewInput } from "../contract/index.ts";
import { decision } from "../store/views/decision.ts";
import { type ItemFacts, itemFacts } from "./item_status.ts";

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * The four kinds of decision 89 / glossary "오너 할 일", and nothing else: open decisions and
 * undelivered answers come from U8's `decision` view; the owner's 🟢 items and the item a waiting
 * session works on come from the same item facts the tables use. An `escalation{to:"owner"}` row is
 * not one of the four.
 */
export function ownerTodoFrom(input: ViewInput, facts: readonly ItemFacts[]): OwnerTodoRow[] {
  const byTask = new Map(facts.map((f) => [f.task, f]));
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
    else if (d.undelivered) rows.push({ kind: "undelivered_answer", ref: d.decision, whyOwner: null, since: answered.get(d.decision) ?? input.now });
  }
  for (const f of facts) {
    if (f.state === "ready" && (f.execBy === "owner" || f.who === "owner")) {
      rows.push({ kind: "owner_item", ref: f.alias, whyOwner: f.whyOwner, since: f.since ?? input.now });
    }
  }
  for (const e of input.events) {
    if (e.type !== "waiting_human" || !stale.has(String(e.seq)) || released.has(String(e.seq))) continue;
    const f = e.entity === "task" && e.entity_id ? byTask.get(e.entity_id) : undefined;
    if (f && (f.state === "done" || f.state === "cancelled")) continue;
    const why = str(e.payload.excerpt) ?? str(e.payload.tool);
    rows.push({ kind: "waiting_human", ref: f ? f.alias : `w${e.seq}`, whyOwner: why, since: e.ts });
  }
  // One item, one row: a waiting session on an owner item is still that item's single to-do.
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.ref) && seen.add(r.ref));
}

export const owner_todo: OwnerTodoView = (input) => ownerTodoFrom(input, itemFacts(input));
