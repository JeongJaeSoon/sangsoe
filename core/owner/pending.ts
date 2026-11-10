import type { StoredEvent } from "../contract/index.ts";
import { ownerMarks } from "./marks.ts";
import { isOwnerItem, OWNER_DEFAULTS } from "./types.ts";

/**
 * Decision 181 (Q1): a to-do closes on verification. For each owner item with a verify: when a probe
 * saw it true, or null while none has. A Task Orca shows completed whose entry here is null reads
 * pending verification, whoever completed it (the panel button, a lead's task-update, a merge close).
 */
export function ownerVerify(events: readonly StoredEvent[]): Map<string, string | null> {
  const who = new Map<string, { who: string; execBy: string | null }>();
  for (const e of events) {
    const p = e.payload;
    if (e.type === "item_created") who.set(String(p.task), { who: String(p.who), execBy: who.get(String(p.task))?.execBy ?? null });
    else if (e.type === "item_extra_set" && typeof p.exec_by === "string") {
      const w = who.get(String(p.task)) ?? { who: "", execBy: null };
      who.set(String(p.task), { ...w, execBy: p.exec_by });
    }
  }
  const out = new Map<string, string | null>();
  // `now` only ages a mark into "검증 안 됨"; whether a probe saw the effect does not depend on it.
  for (const [task, m] of ownerMarks({ events, now: new Date(0).toISOString() }, OWNER_DEFAULTS)) {
    const w = who.get(task);
    if (m.verify && w && isOwnerItem(w)) out.set(task, m.verified?.ts ?? null);
  }
  return out;
}
