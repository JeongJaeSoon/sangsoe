import type { GroupBriefRow, GroupBriefView, GroupItemsView, ViewInput } from "../contract/index.ts";
import { type ItemFacts, itemFacts, leadPriority, toStatusRow } from "./item_status.ts";

const open = (f: ItemFacts) => f.state !== "done" && f.state !== "cancelled";

/** One row per lead (and "others") that has an open item. `done` counts every closed ✅ item. */
export function groupBriefFrom(input: ViewInput, facts: readonly ItemFacts[]): GroupBriefRow[] {
  const leads = [...new Set(facts.filter(open).map((f) => f.lead))];
  return leads.map((lead) => {
    const mine = facts.filter((f) => f.lead === lead);
    const blocked = mine.filter((f) => f.state === "blocked");
    const oldest = blocked.map((f) => f.since ?? input.now).sort()[0] ?? null;
    return {
      lead,
      items: mine.filter(open).length,
      blocked: blocked.length,
      priority: leadPriority(input, lead, facts),
      oldestBlockedSince: oldest,
      done: mine.filter((f) => f.state === "done").length,
    };
  });
}

export const group_brief: GroupBriefView = (input) => groupBriefFrom(input, itemFacts(input));
export const group_items: GroupItemsView = (input, lead) =>
  itemFacts(input)
    .filter((f) => f.lead === lead)
    .map(toStatusRow);
