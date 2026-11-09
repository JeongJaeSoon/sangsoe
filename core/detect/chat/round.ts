import { dedupeKey, eventDef } from "../../contract/index.ts";
import type { MonitorDeps, Planned, Reading } from "../monitor.ts";

export async function chatRound(d: MonitorDeps, signal: AbortSignal): Promise<Reading> {
  const def = eventDef("mention_new");
  if (!def) throw new Error("no event type mention_new");
  const seen = new Set<string>();
  const planned: Planned[] = [];
  for (const { url } of await d.chat.mentions(signal)) {
    if (typeof url !== "string" || url === "" || seen.has(url)) continue;
    seen.add(url);
    planned.push({ type: "mention_new", source: "chat-monitor", payload: { url }, dedupe_key: dedupeKey(def, url) });
  }
  return { planned, unseen: [] };
}
