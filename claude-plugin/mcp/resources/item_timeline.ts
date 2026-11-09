import { existsSync } from "node:fs";
import { defaultDbPath, foldFacts, item_timeline, type StoredEvent, Store } from "../../../core/index.ts";
import type { ResourceDef } from "../contract.ts";

/** One item's rows from the core view, the item named by its Orca Task id or its iNNN alias. */
export function timelineText(events: readonly StoredEvent[], item: string): string {
  const task = foldFacts(events).aliases.get(item) ?? item;
  const rows = item_timeline({ orca: { tasks: [], gates: [] }, events, now: "" }, task);
  return JSON.stringify({ task, rows });
}

export default {
  name: "item_timeline",
  uriTemplate: "sangsoe://item/{task}/timeline",
  description:
    "One item's events in order, session noise left out: the owner's words that made it, their class, transitions, evidence, its PRs' signals and its decisions. {task} is the Orca Task id or the iNNN alias.",
  mimeType: "application/json",
  read: ({ task = "" }) => {
    // Opening the store creates it; a read with no database yet has no events.
    if (!existsSync(defaultDbPath())) return timelineText([], task);
    const store = Store.open();
    try {
      return timelineText(store.events(), task);
    } finally {
      store.close();
    }
  },
} satisfies ResourceDef;
